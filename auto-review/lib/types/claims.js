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
/**
 * Flat registry of answered claims. Recorded AFTER the answerer decides, so
 * the durable `approval/asked` event (appended before the answerer chain
 * runs) is always already observable when a claim is paired.
 */
export class ClaimRegistry {
    records = [];
    /**
     * Record one answered claim.
     * @param record - the claim (toolName, optional callId, outcome, session).
     */
    record(record) {
        this.records.push(record);
    }
    /**
     * List every recorded claim in record order.
     * @returns the recorded claims.
     */
    list() {
        return this.records;
    }
    /**
     * Drop every recorded claim. The invariant companion re-pairs from the
     * durable audit stream alone, so clearing is safe after a plugin reload;
     * tests use it for isolation.
     */
    clear() {
        this.records.length = 0;
    }
}
/** The package's shared registry instance, imported by the answerer and the invariant. */
export const claims = new ClaimRegistry();
/**
 * Publish one recorded claim to the invariant companions.
 * @param ctx - the emitting context (the answerer's fiber).
 * @param record - the claim just recorded.
 */
export function emitClaim(ctx, record) {
    ctx.emit('auto-review/claim', record);
}
//# sourceMappingURL=claims.js.map