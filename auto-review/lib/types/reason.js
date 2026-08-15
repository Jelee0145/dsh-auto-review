/**
 * Parser for the escalation reason format owned by `@deepseek-ai/dsh-sandbox`:
 * `escalate sandbox to <mode>: <justification>`. The approval answerer needs
 * the requested mode and the model's own justification separately for the
 * reviewer prompt; the format is stable and unit-tested against drift.
 * @module @deepseek-ai/dsh-auto-review/reason
 */
/** The reason prefix shared by every escalation ask (`approveEscalation` in dsh-sandbox). */
const PREFIX = 'escalate sandbox to ';
/**
 * Parse the escalation reason format. Returns `undefined` for any other
 * reason shape — the caller then reviews with the raw reason instead.
 * @param reason - the approval request's `reason` field.
 * @returns the mode and justification, or `undefined` when the reason is not
 *   an escalation ask in the shared format.
 */
export function parseEscalationReason(reason) {
    if (!reason.startsWith(PREFIX))
        return undefined;
    const rest = reason.slice(PREFIX.length);
    const separator = rest.indexOf(': ');
    if (separator <= 0)
        return undefined;
    return { mode: rest.slice(0, separator), justification: rest.slice(separator + 2) };
}
//# sourceMappingURL=reason.js.map