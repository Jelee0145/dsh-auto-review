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

import type { Message, TextBlock } from '@deepseek-ai/dsh-llm'

/** Truncate text to at most `maxBytes` UTF-8 bytes without splitting a code point. */
function truncateBytes(text: string, maxBytes: number): string {
  let result = ''
  let used = 0
  for (const char of text) {
    const bytes = Buffer.byteLength(char, 'utf8')
    if (used + bytes > maxBytes) break
    result += char
    used += bytes
  }
  return result
}

/**
 * The trusted user context for one review: the text of the user's genuine
 * messages, newest first-preferred and bounded to `maxBytes` UTF-8 bytes.
 * Non-text blocks (images, tool calls) inside a user message are skipped; a
 * message with no text contributes nothing.
 * @param messages - the session's derived messages in chronological order.
 * @param maxBytes - the total UTF-8 byte budget for the extracted context.
 * @returns the bounded context text (empty when the session has no user text).
 */
export function selectTrustedUserContext(messages: readonly Message[], maxBytes: number): string {
  const texts: string[] = []
  for (const message of messages) {
    if (message.source.kind !== 'user') continue
    const text = message.content
      .filter((block): block is TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim()
    if (text.length > 0) texts.push(text)
  }
  // Keep the newest user messages, spending the byte budget from the most
  // recent backward. Separators cost 2 bytes each ("\n\n").
  const selected: string[] = []
  let used = 0
  for (const text of [...texts].reverse()) {
    const separator = selected.length > 0 ? 2 : 0
    const full = Buffer.byteLength(text, 'utf8')
    if (full + separator <= maxBytes - used) {
      selected.push(text)
      used += full + separator
      continue
    }
    const room = maxBytes - used - separator
    if (room > 0) selected.push(truncateBytes(text, room))
    break
  }
  return selected.reverse().join('\n\n')
}
