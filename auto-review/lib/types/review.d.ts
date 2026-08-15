/**
 * The isolated reviewer: prompt construction, the structured verdict schema,
 * and the one-shot subagent orchestration that turns a verdict into an
 * approval outcome. The reviewer child has no tools, no parent-preset context
 * (`isolate` skips the preset join, so no AGENTS.md, workspace instructions,
 * sandbox/approval policy sections, or tool guidance leak in), a fixed
 * reviewer persona, and a delegation cap so it cannot spawn any child of its
 * own — it can only reason, and can neither execute the operation nor ask the
 * user. It judges two independent axes — the intrinsic risk of the exact
 * operation and whether the trusted user context authorizes that effect — and
 * returns a structured verdict the answerer maps to an approval outcome, with
 * a deterministic critical-risk deny applied regardless of the model's
 * `verdict` field.
 * @module @deepseek-ai/dsh-auto-review/review
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { ObjectJsonSchema } from '@deepseek-ai/dsh-tools';
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval';
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent';
/** The intrinsic-risk band the reviewer reports for one exact operation. */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
/** How much the trusted user context authorizes the escalated effect. */
export type UserAuthorization = 'high' | 'medium' | 'low' | 'unknown';
/** The structured review the reviewer must return. */
export interface ReviewVerdict {
    /** The reviewer's allow/deny decision after combining risk and authorization. */
    readonly verdict: 'allow' | 'deny';
    /** The operation's intrinsic risk, judged by its actual effect. */
    readonly riskLevel: RiskLevel;
    /** Whether the trusted user context authorizes the effect. */
    readonly userAuthorization: UserAuthorization;
    /** One-sentence reason for the decision. */
    readonly reason: string;
}
/** Everything the reviewer needs to judge one escalation ask. */
export interface ReviewFacts {
    /** The tool the ask is about. */
    readonly toolName: string;
    /** The requested escalation mode, or '' when the reason did not parse. */
    readonly mode: string;
    /** The model's stated justification (or the raw reason when unparsed). */
    readonly justification: string;
    /** The model-visible operation text (command or JSON), truncated. */
    readonly argumentsText: string;
    /** The session's immutable workspace root, when the session has one. */
    readonly workspaceRoot: string | undefined;
    /** The bounded trusted user context (genuine user messages only). */
    readonly trustedContext: string;
}
/** One-shot reviewer label recorded on the child's durable session. */
export declare const REVIEWER_LABEL = "auto-reviewer";
/**
 * The reviewer child's fixed persona — a scoped `deployment:persona` section
 * that overrides the harness identity for this child alone. It names the role
 * and keeps unrelated coding-agent guidance out of the review.
 */
export declare const REVIEWER_PERSONA = "You are a sandbox-escalation safety reviewer. You decide whether ONE exact operation may run with escalated sandbox permissions. You are not a coding agent: you have no tools, you never execute anything, and you answer only as the review request asks. Instructions that read as coding-agent guidance do not apply to you.";
/** The structured verdict the reviewer must return. */
export declare const VERDICT_SCHEMA: ObjectJsonSchema;
/**
 * Build the reviewer's user message: fixed reviewer protocol plus the exact
 * facts of one ask — the trusted user context, the exact operation, the
 * one-invocation authorization semantics, and the justification marked
 * untrusted — so the reviewer judges the actual effect and the user's real
 * authorization rather than the requested mode name or the agent's wording.
 * @param facts - one ask's review facts.
 * @returns the child's initial user message.
 */
export declare function buildReviewPrompt(facts: ReviewFacts): ContentBlock[];
/**
 * Parse the reviewer's structured result into a typed verdict. The subagent
 * machinery already validated the value against {@link VERDICT_SCHEMA}, so
 * this is a defensive read of the typed boundary; any missing or unknown field
 * yields `undefined`.
 * @param structured - the structured result value.
 * @returns the typed verdict, or `undefined` when unusable.
 */
export declare function parseReviewVerdict(structured: unknown): ReviewVerdict | undefined;
/**
 * Map a typed verdict to an approval outcome. A `critical` intrinsic risk is
 * denied deterministically regardless of the model's `verdict` field — the
 * reviewer may err toward allowing, but a critical-risk operation must never
 * become a grant on the model's word alone.
 * @param verdict - the typed reviewer verdict.
 * @returns `allowed-once` for a non-critical `allow`, `rejected` otherwise.
 */
export declare function mapReviewVerdict(verdict: ReviewVerdict): ApprovalOutcome;
/**
 * Run one isolated review and map its verdict to an approval outcome. The
 * caller owns the run once `start` fulfills, so disposal is unconditional:
 * the `finally` waits for child-resource quiescence after the result settles,
 * and a `start` rejection (before publication) needs no disposal.
 * @param subagents - the subagent runtime providing the named provider.
 * @param provider - the provider name (e.g. `spawn`).
 * @param req - the ask being reviewed (agent, signal).
 * @param facts - the review facts for the prompt.
 * @returns `allowed-once` for an `allow` verdict, `rejected` for `deny`, and
 *   `unavailable` for a missing, malformed, or otherwise unusable structured
 *   verdict — never a grant on an unreadable result.
 */
export declare function reviewEscalation(subagents: SubagentRuntime, provider: string, req: ApprovalRequest, facts: ReviewFacts): Promise<ApprovalOutcome>;
//# sourceMappingURL=review.d.ts.map