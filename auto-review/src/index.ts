/**
 * Codex-style automated approval review, selectable as a safety mode. The
 * plugin registers an `approval/request` answerer scoped to the
 * `'auto-review'` approval policy — the third permission knob value users
 * pick per session (or deployment-wide as the approval default): sandbox-
 * escalation asks (the `sandbox_permissions` + `justification` path shared
 * by bash and fs tools) on those sessions are answered by an isolated
 * reviewer subagent instead of a human. The reviewer receives the exact
 * operation (the full validated arguments), the user's genuine messages as
 * trusted authorization evidence, and the model's justification marked
 * untrusted; it judges the operation's intrinsic risk and the user's
 * authorization independently and returns a structured verdict. Sessions in
 * any other policy delegate to the composed answerer chain untouched, so a
 * human answerer and this answerer coexist per session. Catastrophic
 * operations match a configurable circuit-breaker list and are rejected
 * without a review round; a same-operation denial fuse stops the agent from
 * re-asking a denied operation with reworded justifications; every other
 * claim either gets a review verdict or fails closed.
 *
 * Channel isolation is structural: human decision questions
 * (`ask_user_question`) ride the separate `ctx.userQuestions` seam and never
 * reach this answerer, and the reviewer child (zero tools, no parent-preset
 * context, `maxDepth: 1`, delegated approval pinned to `never`) cannot ask
 * the user either.
 *
 * @module @deepseek-ai/dsh-auto-review
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome, ApprovalPolicy, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { claims, emitClaim } from './claims.ts'
import { selectTrustedUserContext } from './context.ts'
import { parseEscalationReason } from './reason.ts'
import { denialFuse, fingerprintOf, type DenialFuse } from './retry.ts'
import { reviewEscalation, type ReviewFacts } from './review.ts'
import { DEFAULT_DENY_PATTERNS, commandTextOf, compilePatterns, matchesAny } from './rules.ts'
export { DEFAULT_DENY_PATTERNS } from './rules.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'auto-review'

/** Tools whose escalation asks this answerer claims (any other ask delegates). */
export const DEFAULT_ANSWER_TOOLS: readonly string[] = ['bash', 'write', 'edit']

/** The reviewer subagent provider name when none is configured. */
export const DEFAULT_PROVIDER = 'spawn'

/** The reviewer prompt's operation-text cap. */
export const DEFAULT_MAX_COMMAND_BYTES = 8192

/** The reviewer prompt's trusted-user-context UTF-8 byte cap. */
export const DEFAULT_MAX_CONTEXT_BYTES = 4096

/** Consecutive denials of one operation before the fuse stops re-reviewing it. */
export const DEFAULT_MAX_RETRIES = 3

/** Plugin config. Every key optional — `static Config` supplies the defaults. */
export interface Config {
  /** Reviewer subagent provider name on `ctx.subagents` (default `spawn`). */
  readonly provider?: string
  /** Tool names whose escalation asks this answerer claims (default bash/write/edit). */
  readonly answerTools?: string[]
  /** Hard-deny the `denyPatterns` list without a review round (default true). */
  readonly circuitBreaker?: boolean
  /** Regex sources matched against the operation text; built-in catastrophic list by default. */
  readonly denyPatterns?: string[]
  /** Regex sources that allow a claim outright, before the circuit breaker (default empty). */
  readonly allowPatterns?: string[]
  /** Cap on the operation text that reaches the reviewer prompt (default 8192). */
  readonly maxCommandBytes?: number
  /** UTF-8 byte cap on the trusted user context in the reviewer prompt (default 4096). */
  readonly maxContextBytes?: number
  /** Consecutive denials of one operation before the fuse stops re-reviewing it (default 3; 0 disables). */
  readonly maxRetries?: number
  /** Delegate to the human answerer chain when a review cannot run (default false = fail closed). */
  readonly failClosed?: boolean
  /** Register the reviewer-policy system-prompt section for 'auto-review' sessions (default true). */
  readonly promptSection?: boolean
}

/** Runtime configuration schema for the auto-review plugin. */
export const Config: z<Config> = z.object({
  provider: z.string().default(DEFAULT_PROVIDER),
  answerTools: z.array(z.string()).default([...DEFAULT_ANSWER_TOOLS]),
  circuitBreaker: z.boolean().default(true),
  denyPatterns: z.array(z.string()).default([...DEFAULT_DENY_PATTERNS]),
  allowPatterns: z.array(z.string()).default([]),
  maxCommandBytes: z.number().default(DEFAULT_MAX_COMMAND_BYTES),
  maxContextBytes: z.number().default(DEFAULT_MAX_CONTEXT_BYTES),
  maxRetries: z.number().default(DEFAULT_MAX_RETRIES),
  failClosed: z.boolean().default(false),
  promptSection: z.boolean().default(true),
})

/**
 * The stable system-prompt section text for sessions in the `'auto-review'`
 * policy when `promptSection` is enabled — model-visible and pinned by the
 * package README and snapshot coverage.
 */
export const PROMPT_SECTION_TEXT =
  'Automated approval review is active: sandbox escalations (sandbox_permissions) are decided by a stateless reviewer model instead of a human, and clearly destructive escalations are rejected without review. Questions that truly need the user still reach the user through ask_user_question.'

/** Everything the decision needs besides the request itself. */
export interface DecideDeps {
  /** Reviewer subagent provider name. */
  readonly provider: string
  /** Compiled allowlist (checked before the circuit breaker). */
  readonly allowPatterns: readonly RegExp[]
  /** Whether the circuit breaker is armed. */
  readonly circuitBreaker: boolean
  /** Compiled circuit-breaker patterns. */
  readonly denyPatterns: readonly RegExp[]
  /** The subagent runtime, or `undefined` when not composed (fails closed). */
  readonly subagents: SubagentRuntime | undefined
  /** Retry protection, present only when `maxRetries` is enabled. */
  readonly retry?: {
    /** The shared denial fuse. */
    readonly fuse: DenialFuse
    /** The streak length that trips the fuse. */
    readonly maxRetries: number
    /** The delegating parent session the streak is keyed to. */
    readonly session: Session
    /** The operation's tool+arguments fingerprint (justification excluded). */
    readonly fingerprint: string
  }
}

/**
 * The session's effective approval policy with the deployment default
 * applied — the same read `permission-presets` performs. An absent approval
 * service can never sit in `'auto-review'`, so it degrades to `'ask'`.
 * @param approval - the dispatching approval service, when composed.
 * @param session - the session whose policy applies.
 * @returns the policy in effect for the session right now.
 */
function effectivePolicyOf(approval: ApprovalService | undefined, session: Session): ApprovalPolicy {
  return approval?.overrideOf(session) ?? approval?.config.policy ?? 'ask'
}

/**
 * Decide one claimed ask: allowlist, then circuit breaker, then the denial
 * fuse, then the isolated review. Any reviewer failure (missing runtime, start
 * rejection, run rejection, unusable verdict) becomes `unavailable` — fail
 * closed, because a verdict that cannot be obtained must never become a grant.
 * A `rejected` review records a denial on the fuse; an `allowed-once` resets
 * the streak, so "consecutive" means truly consecutive.
 * @param req - the claimed approval request.
 * @param facts - the review facts already derived from the request.
 * @param deps - the compiled policy and runtime.
 * @returns the outcome this plugin returns for the ask.
 */
export async function decideAsk(req: ApprovalRequest, facts: ReviewFacts, deps: DecideDeps): Promise<ApprovalOutcome> {
  if (deps.allowPatterns.length > 0 && matchesAny(facts.argumentsText, deps.allowPatterns)) return 'allowed-once'
  if (deps.circuitBreaker && matchesAny(facts.argumentsText, deps.denyPatterns)) return 'rejected'
  if (deps.subagents === undefined) return 'unavailable'
  const retry = deps.retry
  // A repeatedly denied operation stops re-reviewing before another round
  // trip: the agent must change the operation, not the justification.
  if (retry !== undefined && retry.fuse.countOf(retry.session, retry.fingerprint) >= retry.maxRetries) return 'rejected'
  try {
    const outcome = await reviewEscalation(deps.subagents, deps.provider, req, facts)
    if (retry !== undefined) {
      if (outcome === 'rejected') retry.fuse.recordDenial(retry.session, retry.fingerprint)
      else if (outcome === 'allowed-once') retry.fuse.reset(retry.session, retry.fingerprint)
    }
    return outcome
  } catch {
    // A review that cannot settle must not become a grant; every failure
    // path (provider absent, child creation rolled back, run rejected) lands
    // here as the fail-closed outcome.
    return 'unavailable'
  }
}

/**
 * Register the answerer and the optional policy section. On sessions whose
 * effective approval policy is `'auto-review'`, claims escalation asks on
 * the configured tools that carry their validated arguments; sessions in
 * any other policy — and non-escalation or argument-less asks — delegate to
 * the composed answerer chain (`next()`), so ordinary permission hooks, the
 * human answerer, and the human question seam stay untouched.
 * @param ctx - the plugin context; registrations are effects scoped to it.
 * @param config - validated plugin config.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = config.provider ?? DEFAULT_PROVIDER
  const answerTools = new Set(config.answerTools ?? DEFAULT_ANSWER_TOOLS)
  const circuitBreaker = config.circuitBreaker ?? true
  const denyPatterns = compilePatterns('denyPatterns', config.denyPatterns ?? DEFAULT_DENY_PATTERNS)
  const allowPatterns = compilePatterns('allowPatterns', config.allowPatterns ?? [])
  const maxCommandBytes = config.maxCommandBytes ?? DEFAULT_MAX_COMMAND_BYTES
  if (maxCommandBytes <= 0) {
    throw new Error('auto-review: maxCommandBytes must be a positive number')
  }
  const maxContextBytes = config.maxContextBytes ?? DEFAULT_MAX_CONTEXT_BYTES
  if (maxContextBytes <= 0) {
    throw new Error('auto-review: maxContextBytes must be a positive number')
  }
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
  if (maxRetries < 0) {
    throw new Error('auto-review: maxRetries must be a non-negative number')
  }
  const failClosed = config.failClosed ?? false

  // Capability detection, load-time: a provider already registered without
  // the isolate capability can never host the isolated reviewer, and the
  // reviewer never runs un-isolated — fail the load loud rather than fail
  // every ask later. A provider registered after this point is caught at
  // ask time (the answerer's runtime check and reviewEscalation's guard).
  const registeredAtLoad = ctx.get('subagents')?.getProvider(provider)
  if (registeredAtLoad !== undefined && !registeredAtLoad.capabilities.isolate) {
    throw new Error(
      `auto-review: reviewer provider "${provider}" does not support the isolate capability `
      + '(compose a provider that supports it, e.g. spawn or fork)',
    )
  }

  ctx.on('approval/request', async (req, next): Promise<ApprovalOutcome> => {
    // The answerer IS the 'auto-review' safety mode: it claims only sessions
    // whose effective approval policy selected that mode (per-session
    // override or the deployment default). 'ask' sessions delegate to the
    // human answerer chain; 'never' never reaches any answerer. The
    // dispatching approval service is always mounted while its own waterfall
    // runs, so the store read resolves; a hand-rolled dispatch without the
    // service degrades to 'ask' and delegates.
    if (effectivePolicyOf(ctx.get('approval'), req.agent.session) !== 'auto-review') return next()
    // Only escalation asks carry the validated arguments (the seam change the
    // bash/fs escalation path supplies); a claim without them could not be
    // reviewed, so it delegates to the human answerer chain.
    if (!answerTools.has(req.toolName) || req.arguments === undefined) return next()
    // An already-aborted ask is the service's own decision; claiming it would
    // only race the abort outcome.
    if (req.signal?.aborted) return 'cancelled'
    const escalation = parseEscalationReason(req.reason ?? '')
    const text = commandTextOf(req.arguments)
    const argumentsText = text.length > maxCommandBytes ? `${text.slice(0, maxCommandBytes)}…` : text
    const trustedContext = selectTrustedUserContext(req.agent.session.deriveMessages(), maxContextBytes)
    const fingerprint = fingerprintOf(req.toolName, text)
    const subagents = ctx.get('subagents')
    // Capability detection, ask-time signal: a provider registered after
    // load without the isolate capability makes every review fail closed
    // (the guard in reviewEscalation); say why once per ask instead of
    // degrading silently. There is no un-isolated fallback.
    const runtimeProvider = subagents?.getProvider(provider)
    if (runtimeProvider !== undefined && !runtimeProvider.capabilities.isolate) {
      ctx.logger.error(
        `auto-review: reviewer provider "${provider}" does not support the isolate capability; `
        + 'failing this ask closed instead of reviewing un-isolated',
      )
    }
    const outcome = await decideAsk(req, {
      toolName: req.toolName,
      mode: escalation?.mode ?? '',
      justification: escalation?.justification ?? req.reason ?? '',
      argumentsText,
      workspaceRoot: req.agent.session.header.cwd,
      trustedContext,
    }, {
      provider,
      allowPatterns,
      circuitBreaker,
      denyPatterns,
      subagents,
      ...maxRetries > 0
        ? { retry: { fuse: denialFuse, maxRetries, session: req.agent.session, fingerprint } }
        : {},
    })
    if (outcome === 'unavailable' && !failClosed) return next()
    const record = {
      toolName: req.toolName,
      ...req.callId !== undefined ? { callId: req.callId } : {},
      outcome,
      session: req.agent.session,
    }
    claims.record(record)
    emitClaim(ctx, record)
    return outcome
  })

  if (config.promptSection ?? true) {
    ctx.inject(['systemPrompt'], (scope: Context) => {
      scope.systemPrompt.context({
        name: 'auto-review:policy',
        order: 116,
        text: (context) => {
          const agent = context.agent
          // A bare assemble() (tests, diagnostics) has no session to state.
          if (agent === undefined) return ''
          // The section narrates the reviewer policy only for sessions that
          // actually selected the 'auto-review' mode; every other session
          // (and a composition without the approval service) renders nothing.
          return effectivePolicyOf(scope.get('approval'), agent.session) === 'auto-review' ? PROMPT_SECTION_TEXT : ''
        },
      })
    })
  }
}
