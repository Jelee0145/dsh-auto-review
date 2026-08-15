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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Session } from '@deepseek-ai/dsh-session';
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent';
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval';
import { type DenialFuse } from './retry.ts';
import { type ReviewFacts } from './review.ts';
export { DEFAULT_DENY_PATTERNS } from './rules.ts';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "auto-review";
/** Tools whose escalation asks this answerer claims (any other ask delegates). */
export declare const DEFAULT_ANSWER_TOOLS: readonly string[];
/** The reviewer subagent provider name when none is configured. */
export declare const DEFAULT_PROVIDER = "spawn";
/** The reviewer prompt's operation-text cap. */
export declare const DEFAULT_MAX_COMMAND_BYTES = 8192;
/** The reviewer prompt's trusted-user-context UTF-8 byte cap. */
export declare const DEFAULT_MAX_CONTEXT_BYTES = 4096;
/** Consecutive denials of one operation before the fuse stops re-reviewing it. */
export declare const DEFAULT_MAX_RETRIES = 3;
/** Plugin config. Every key optional — `static Config` supplies the defaults. */
export interface Config {
    /** Reviewer subagent provider name on `ctx.subagents` (default `spawn`). */
    readonly provider?: string;
    /** Tool names whose escalation asks this answerer claims (default bash/write/edit). */
    readonly answerTools?: string[];
    /** Hard-deny the `denyPatterns` list without a review round (default true). */
    readonly circuitBreaker?: boolean;
    /** Regex sources matched against the operation text; built-in catastrophic list by default. */
    readonly denyPatterns?: string[];
    /** Regex sources that allow a claim outright, before the circuit breaker (default empty). */
    readonly allowPatterns?: string[];
    /** Cap on the operation text that reaches the reviewer prompt (default 8192). */
    readonly maxCommandBytes?: number;
    /** UTF-8 byte cap on the trusted user context in the reviewer prompt (default 4096). */
    readonly maxContextBytes?: number;
    /** Consecutive denials of one operation before the fuse stops re-reviewing it (default 3; 0 disables). */
    readonly maxRetries?: number;
    /** Delegate to the human answerer chain when a review cannot run (default false = fail closed). */
    readonly failClosed?: boolean;
    /** Register the reviewer-policy system-prompt section for 'auto-review' sessions (default true). */
    readonly promptSection?: boolean;
}
/** Runtime configuration schema for the auto-review plugin. */
export declare const Config: z<Config>;
/**
 * The stable system-prompt section text for sessions in the `'auto-review'`
 * policy when `promptSection` is enabled — model-visible and pinned by the
 * package README and snapshot coverage.
 */
export declare const PROMPT_SECTION_TEXT = "Automated approval review is active: sandbox escalations (sandbox_permissions) are decided by a stateless reviewer model instead of a human, and clearly destructive escalations are rejected without review. Questions that truly need the user still reach the user through ask_user_question.";
/** Everything the decision needs besides the request itself. */
export interface DecideDeps {
    /** Reviewer subagent provider name. */
    readonly provider: string;
    /** Compiled allowlist (checked before the circuit breaker). */
    readonly allowPatterns: readonly RegExp[];
    /** Whether the circuit breaker is armed. */
    readonly circuitBreaker: boolean;
    /** Compiled circuit-breaker patterns. */
    readonly denyPatterns: readonly RegExp[];
    /** The subagent runtime, or `undefined` when not composed (fails closed). */
    readonly subagents: SubagentRuntime | undefined;
    /** Retry protection, present only when `maxRetries` is enabled. */
    readonly retry?: {
        /** The shared denial fuse. */
        readonly fuse: DenialFuse;
        /** The streak length that trips the fuse. */
        readonly maxRetries: number;
        /** The delegating parent session the streak is keyed to. */
        readonly session: Session;
        /** The operation's tool+arguments fingerprint (justification excluded). */
        readonly fingerprint: string;
    };
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
export declare function decideAsk(req: ApprovalRequest, facts: ReviewFacts, deps: DecideDeps): Promise<ApprovalOutcome>;
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
export declare function apply(ctx: Context, config?: Config): void;
//# sourceMappingURL=index.d.ts.map