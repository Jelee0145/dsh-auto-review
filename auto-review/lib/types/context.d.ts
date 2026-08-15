/**
 * Trusted user-context extraction for the reviewer prompt. The reviewer must
 * judge whether the USER authorized the escalated effect, so only genuine user
 * messages (`source.kind === 'user'`) count as authorization evidence.
 * Assistant reasoning, tool results, plugin-injected notices (AGENTS.md,
 * approval-policy switches), and other source kinds are deliberately excluded:
 * they are untrusted or irrelevant and must never expand authorization. The
 * extracted text is bounded by UTF-8 bytes, newest user messages preferred, so
 * a long session cannot bloat the reviewer request.
 * @module @deepseek-ai/dsh-auto-review/context
 */
import type { Message } from '@deepseek-ai/dsh-llm';
/**
 * The trusted user context for one review: the text of the user's genuine
 * messages, newest first-preferred and bounded to `maxBytes` UTF-8 bytes.
 * Non-text blocks (images, tool calls) inside a user message are skipped; a
 * message with no text contributes nothing.
 * @param messages - the session's derived messages in chronological order.
 * @param maxBytes - the total UTF-8 byte budget for the extracted context.
 * @returns the bounded context text (empty when the session has no user text).
 */
export declare function selectTrustedUserContext(messages: readonly Message[], maxBytes: number): string;
//# sourceMappingURL=context.d.ts.map