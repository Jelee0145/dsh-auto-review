import { t as claims } from "./claims-BN4GfVhw.js";
//#region lib/types/invariant.js
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
const PACKAGE_NAME = "@deepseek-ai/dsh-auto-review";
/** Cordis companion plugin name. */
const name = "auto-review-invariant";
/** Service required before the companion can reserve package ownership. */
const inject = ["invariants"];
/** The pairing key shared by a claim and its asked event. */
function keyOf(toolName, callId) {
	return callId === void 0 ? toolName : `${toolName}:${callId}`;
}
/** Validate one decided outcome against its claim (the abort race permits `cancelled`). */
function checkOutcome(claim, outcome, fail) {
	if (outcome !== claim.outcome && outcome !== "cancelled") fail(`claimed ask decided ${JSON.stringify(outcome)} but this plugin returned ${JSON.stringify(claim.outcome)}`);
}
/**
* Pair one claim with its matching asked event. Runs outside contained
* observers (the claim-record callback and seeding), so a violation throws at
* the recording call.
* @param trace - the session trace.
* @param claim - the claim to pair.
* @param fail - the package-attributed failure reporter.
*/
function pairClaim(trace, claim, fail) {
	const key = keyOf(claim.toolName, claim.callId);
	for (const [id, asked] of trace.askedById) {
		if (keyOf(asked.toolName, asked.callId) !== key) continue;
		if (trace.claimedById.has(id)) fail(`ask ${JSON.stringify(key)} claimed more than once`);
		trace.claimedById.set(id, claim);
		trace.unmatchedClaims.delete(claim);
		return;
	}
	fail(`claimed ask ${JSON.stringify(key)} has no approval/asked audit on its session`);
}
/** Whether the trace still owes the durable closure of a claimed ask. */
function hasUnresolvedClaims(trace) {
	return trace.claimedById.size > 0 || trace.unmatchedClaims.size > 0;
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
function validateEvent(trace, event, fail) {
	if (event.type === "turn/end") {
		if (hasUnresolvedClaims(trace)) fail("claimed asks have no approval/decided before turn/end");
		return;
	}
	if (event.type === "approval/asked") {
		if (trace.askedById.has(event.data.id)) fail(`approval/asked repeated id ${JSON.stringify(event.data.id)}`);
		const asked = {
			toolName: event.data.toolName,
			...event.data.callId !== void 0 ? { callId: event.data.callId } : {}
		};
		return () => {
			trace.askedById.set(event.data.id, asked);
		};
	}
	if (event.type === "approval/decided") {
		const claim = trace.claimedById.get(event.data.id);
		if (claim === void 0) return void 0;
		checkOutcome(claim, event.data.outcome, fail);
		return () => {
			trace.claimedById.delete(event.data.id);
		};
	}
}
/** Apply every transition of one existing log during seeding (throws on violations). */
function seedTrace(trace, session, fail) {
	for (const event of session.events) {
		const transition = validateEvent(trace, event, fail);
		if (transition !== void 0) transition();
	}
	for (const record of claims.list()) if (record.session === session) trace.unmatchedClaims.add(record);
	for (const record of [...trace.unmatchedClaims]) pairClaim(trace, record, fail);
	for (const event of session.events) {
		if (event.type !== "approval/decided") continue;
		const claim = trace.claimedById.get(event.data.id);
		if (claim === void 0) continue;
		trace.claimedById.delete(event.data.id);
		checkOutcome(claim, event.data.outcome, fail);
	}
}
/** Install pairing and outcome-match checks over every session's audit stream. */
const install = Object.assign((ctx, fail) => {
	const traces = /* @__PURE__ */ new WeakMap();
	const staged = /* @__PURE__ */ new WeakMap();
	const seed = (session) => {
		const trace = {
			askedById: /* @__PURE__ */ new Map(),
			claimedById: /* @__PURE__ */ new Map(),
			unmatchedClaims: /* @__PURE__ */ new Set()
		};
		traces.set(session, trace);
		seedTrace(trace, session, fail);
		return trace;
	};
	const traceFor = (session) => traces.get(session) ?? seed(session);
	for (const session of ctx.sessions.list()) seed(session);
	ctx.on("session/created", (session) => {
		seed(session);
	}, { global: true });
	ctx.on("session/event", (session, event) => {
		const candidate = staged.get(event);
		/* v8 ignore next -- internal/dispatch stages every package-owned pair event */
		if (candidate === void 0 || candidate.session !== session) return;
		staged.delete(event);
		candidate.transition();
	}, { global: true });
	ctx.on("internal/dispatch", (_mode, eventName, args) => {
		if (eventName !== "session/event") return;
		const [session, event] = args;
		const transition = validateEvent(traceFor(session), event, fail);
		if (transition !== void 0) staged.set(event, {
			session,
			transition
		});
	}, { global: true });
	ctx.on("auto-review/claim", (record) => {
		const trace = traceFor(record.session);
		trace.unmatchedClaims.add(record);
		pairClaim(trace, record, fail);
	}, { global: true });
}, { inject: ["sessions"] });
/**
* Register the auto-review invariant companion.
* @param ctx - Cordis context carrying the invariant service.
* @returns the installed registration's disposer after setup succeeds.
*/
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };
