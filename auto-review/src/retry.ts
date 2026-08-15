/**
 * Retry protection for the auto-review answerer: a per-session denial fuse
 * that stops the main agent from re-asking the SAME operation with a
 * reworded justification until it wears the reviewer down. Identity is the
 * tool plus the exact operation text — never the justification, which lives in
 * the reason, not the arguments — so "operation A + reason 1", "operation A +
 * reason 2" all count as one operation. A materially different operation
 * (different tool or arguments) is a fresh fingerprint and starts its own
 * streak; an allow resets the streak. Package-module state, like the claim
 * registry, but keyed weakly by session so entries die with their sessions.
 * @module @deepseek-ai/dsh-auto-review/retry
 */

import type { Session } from '@deepseek-ai/dsh-session'

/**
 * The identity of one operation for retry protection: tool name and the exact
 * operation text, separated by a null byte so the two cannot collide across a
 * boundary (`a\0b` vs `ab`). Justification text never participates.
 * @param toolName - the tool the escalation is about.
 * @param operationText - the full (untruncated) operation text.
 * @returns the collision-free fingerprint.
 */
export function fingerprintOf(toolName: string, operationText: string): string {
  return `${toolName}\u0000${operationText}`
}

/** Per-session consecutive-denial counts keyed by operation fingerprint. */
export class DenialFuse {
  private counts = new WeakMap<Session, Map<string, number>>()

  /**
   * How many consecutive times `fingerprint` was denied on `session`.
   * @param session - the delegating parent session.
   * @param fingerprint - the operation identity.
   * @returns the current denial streak (0 while never denied).
   */
  countOf(session: Session, fingerprint: string): number {
    return this.counts.get(session)?.get(fingerprint) ?? 0
  }

  /**
   * Record one denial and return the new streak.
   * @param session - the delegating parent session.
   * @param fingerprint - the operation identity.
   * @returns the incremented streak.
   */
  recordDenial(session: Session, fingerprint: string): number {
    let perSession = this.counts.get(session)
    if (perSession === undefined) {
      perSession = new Map()
      this.counts.set(session, perSession)
    }
    const next = (perSession.get(fingerprint) ?? 0) + 1
    perSession.set(fingerprint, next)
    return next
  }

  /**
   * Reset one fingerprint's streak (an allow, or a materially different retry).
   * @param session - the delegating parent session.
   * @param fingerprint - the operation identity.
   */
  reset(session: Session, fingerprint: string): void {
    this.counts.get(session)?.delete(fingerprint)
  }

  /** Drop every entry (test isolation). */
  clear(): void {
    // A WeakMap cannot be enumerated; the entries are unreachable by key only
    // after their sessions die. Tests hold no sessions between cases, so this
    // is a fresh-map swap that also severs any live session keys.
    this.counts = new WeakMap<Session, Map<string, number>>()
  }
}

/** The package's shared denial fuse, imported by the answerer and cleared by tests. */
export const denialFuse = new DenialFuse()
