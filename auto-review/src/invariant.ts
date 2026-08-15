/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-auto-review`: every
 * ask this plugin claimed (recorded in the shared claim registry) must be
 * paired with a durable `approval/asked` audit on its session and must see a
 * matching `approval/decided` — whose outcome equals the decision this plugin
 * returned (or `cancelled` when the request aborted before the answer landed)
 * — all inside the open turn. This is the model-visible ⟺ logged relation for
 * decisions: a claim without its audit pair is a decision the log cannot
 * reconstruct. Violations surface at the appending call (pre-commit
 * validation), never swallowed by contained observers.
 * @module @deepseek-ai/dsh-auto-review/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import { claims, type ClaimRecord } from './claims.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-auto-review'

/** Cordis companion plugin name. */
export const name = 'auto-review-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** The audit facts of one `approval/asked` event that matter for pairing. */
interface AskedInfo {
  readonly toolName: string
  readonly callId?: string
}

/** Per-session pairing state over the durable audit stream. */
interface SessionTrace {
  /** Every seen `approval/asked`, keyed by its audit id. */
  readonly askedById: Map<ApprovalRequestId, AskedInfo>
  /** Asked ids paired to a claim, awaiting their `approval/decided`. */
  readonly claimedById: Map<ApprovalRequestId, ClaimRecord>
  /** Claims not yet paired with an asked event (violations at turn/end). */
  readonly unmatchedClaims: Set<ClaimRecord>
}

/** The pairing key shared by a claim and its asked event. */
function keyOf(toolName: string, callId: string | undefined): string {
  return callId === undefined ? toolName : `${toolName}:${callId}`
}

/** Validate one decided outcome against its claim (the abort race permits `cancelled`). */
function checkOutcome(claim: ClaimRecord, outcome: string, fail: InvariantFailure): void {
  if (outcome !== claim.outcome && outcome !== 'cancelled') {
    fail(`claimed ask decided ${JSON.stringify(outcome)} but this plugin returned ${JSON.stringify(claim.outcome)}`)
  }
}

/**
 * Pair one claim with its matching asked event. Runs outside contained
 * observers (the claim-record callback and seeding), so a violation throws at
 * the recording call.
 * @param trace - the session trace.
 * @param claim - the claim to pair.
 * @param fail - the package-attributed failure reporter.
 */
function pairClaim(trace: SessionTrace, claim: ClaimRecord, fail: InvariantFailure): void {
  const key = keyOf(claim.toolName, claim.callId)
  for (const [id, asked] of trace.askedById) {
    if (keyOf(asked.toolName, asked.callId) !== key) continue
    if (trace.claimedById.has(id)) fail(`ask ${JSON.stringify(key)} claimed more than once`)
    trace.claimedById.set(id, claim)
    trace.unmatchedClaims.delete(claim)
    return
  }
  // The asked event is appended before the answerer chain runs, so a claim
  // that never pairs means the audit is missing from the log.
  fail(`claimed ask ${JSON.stringify(key)} has no approval/asked audit on its session`)
}

/** Whether the trace still owes the durable closure of a claimed ask. */
function hasUnresolvedClaims(trace: SessionTrace): boolean {
  return trace.claimedById.size > 0 || trace.unmatchedClaims.size > 0
}

/**
 * Validate one event BEFORE it commits and return the transition to apply
 * post-commit. Every failure throws here through `fail`, so the appending
 * call surfaces it; the transition itself never fails.
 * @param trace - the session trace.
 * @param event - the session event being appended.
 * @param fail - the package-attributed failure reporter.
 * @returns the state transition to apply, or undefined for no-op events.
 */
function validateEvent(trace: SessionTrace, event: SessionEvent, fail: InvariantFailure): (() => void) | undefined {
  if (event.type === 'turn/end') {
    // The audit pair is turn-enclosed: a claim unresolved here is a decision
    // the log cannot reconstruct.
    if (hasUnresolvedClaims(trace)) fail('claimed asks have no approval/decided before turn/end')
    return undefined
  }
  if (event.type === 'approval/asked') {
    if (trace.askedById.has(event.data.id)) fail(`approval/asked repeated id ${JSON.stringify(event.data.id)}`)
    const asked: AskedInfo = {
      toolName: event.data.toolName,
      ...event.data.callId !== undefined ? { callId: event.data.callId } : {},
    }
    return () => {
      trace.askedById.set(event.data.id, asked)
    }
  }
  if (event.type === 'approval/decided') {
    const claim = trace.claimedById.get(event.data.id)
    if (claim === undefined) return undefined
    // The outcome check must surface at the append, so it lives pre-commit.
    checkOutcome(claim, event.data.outcome, fail)
    return () => {
      trace.claimedById.delete(event.data.id)
    }
  }
  return undefined
}

/** Apply every transition of one existing log during seeding (throws on violations). */
function seedTrace(trace: SessionTrace, session: Session, fail: InvariantFailure): void {
  for (const event of session.events) {
    const transition = validateEvent(trace, event, fail)
    if (transition !== undefined) transition()
  }
  // Claims recorded before this installer existed still pair with seeded asks.
  for (const record of claims.list()) {
    if (record.session === session) trace.unmatchedClaims.add(record)
  }
  for (const record of [...trace.unmatchedClaims]) pairClaim(trace, record, fail)
  // History may already contain the decided event of a seeded claim.
  for (const event of session.events) {
    if (event.type !== 'approval/decided') continue
    const claim = trace.claimedById.get(event.data.id)
    if (claim === undefined) continue
    trace.claimedById.delete(event.data.id)
    checkOutcome(claim, event.data.outcome, fail)
  }
}

/** Install pairing and outcome-match checks over every session's audit stream. */
// Event owners keep precommit staging local so their vocabularies never move into a central helper.
/* jscpd:ignore-start */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const traces = new WeakMap<Session, SessionTrace>()
  const staged = new WeakMap<SessionEvent, { session: Session; transition: () => void }>()
  const seed = (session: Session): SessionTrace => {
    const trace: SessionTrace = { askedById: new Map(), claimedById: new Map(), unmatchedClaims: new Set() }
    traces.set(session, trace)
    seedTrace(trace, session, fail)
    return trace
  }
  const traceFor = (session: Session): SessionTrace => traces.get(session) ?? seed(session)

  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('session/event', (session, event) => {
    const candidate = staged.get(event)
    /* v8 ignore next -- internal/dispatch stages every package-owned pair event */
    if (candidate === undefined || candidate.session !== session) return
    staged.delete(event)
    candidate.transition()
  }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const transition = validateEvent(traceFor(session), event, fail)
    if (transition !== undefined) staged.set(event, { session, transition })
  }, { global: true })
  ctx.on('auto-review/claim', (record) => {
    const trace = traceFor(record.session)
    trace.unmatchedClaims.add(record)
    pairClaim(trace, record, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the auto-review invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
