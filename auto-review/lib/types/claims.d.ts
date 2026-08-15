/**
 * The claim registry shared between the auto-review answerer and its
 * invariant companion: every ask this plugin answered, matched against the
 * session's durable `approval/asked` / `approval/decided` audit pair by
 * (toolName, callId). Package-module state by design: the companion's seeding
 * reads it, so a claim recorded before the companion mounted still pairs.
 * Live claims additionally travel as the cordis event `auto-review/claim` so
 * the companion's listener is disposed with its fiber.
 * @module @deepseek-ai/dsh-auto-review/claims
 */
import type { Session } from '@deepseek-ai/dsh-session';
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval';
import type { Context } from '@deepseek-ai/cordis';
declare module '@deepseek-ai/cordis' {
    interface Events {
        /**
         * One ask this plugin just answered — the live delivery of a recorded
         * {@link ClaimRecord} to the invariant companion. Global listeners pair it
         * with the session's audit stream; the payload is a typed same-process
         * value, never serialized.
         * @mode emit
         * @param record - the recorded claim (toolName, optional callId, outcome, session).
         */
        'auto-review/claim'(record: ClaimRecord): void;
    }
}
/** One ask this plugin claimed: it returned {@link ClaimRecord.outcome} for it. */
export interface ClaimRecord {
    /** The tool the ask was about. */
    readonly toolName: string;
    /** The exact tool call, when the asker had one. */
    readonly callId?: string;
    /** The outcome the answerer returned (the durable audit must match it). */
    readonly outcome: ApprovalOutcome;
    /** The session whose log carries the audit pair. */
    readonly session: Session;
}
/**
 * Flat registry of answered claims. Recorded AFTER the answerer decides, so
 * the durable `approval/asked` event (appended before the answerer chain
 * runs) is always already observable when a claim is paired.
 */
export declare class ClaimRegistry {
    private readonly records;
    /**
     * Record one answered claim.
     * @param record - the claim (toolName, optional callId, outcome, session).
     */
    record(record: ClaimRecord): void;
    /**
     * List every recorded claim in record order.
     * @returns the recorded claims.
     */
    list(): readonly ClaimRecord[];
    /**
     * Drop every recorded claim. The invariant companion re-pairs from the
     * durable audit stream alone, so clearing is safe after a plugin reload;
     * tests use it for isolation.
     */
    clear(): void;
}
/** The package's shared registry instance, imported by the answerer and the invariant. */
export declare const claims: ClaimRegistry;
/**
 * Publish one recorded claim to the invariant companions.
 * @param ctx - the emitting context (the answerer's fiber).
 * @param record - the claim just recorded.
 */
export declare function emitClaim(ctx: Context, record: ClaimRecord): void;
//# sourceMappingURL=claims.d.ts.map