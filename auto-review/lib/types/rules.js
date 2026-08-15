/**
 * Pure rule engine for the auto-review circuit breaker and allowlist: regex
 * compilation with loud load-time failure, the model-visible command text of
 * a tool call, and pattern matching. No Cordis imports — independently
 * unit-tested.
 * @module @deepseek-ai/dsh-auto-review/rules
 */
/**
 * The default circuit-breaker patterns — regex sources matched against the
 * model-visible command text of a claimed ask. Each entry names a catastrophic
 * operation that must never reach the reviewer (or the machine): recursive
 * deletion of absolute roots and home, raw-device writes, filesystem creation,
 * fork bombs, recursive permission rewrites on roots, shell redirection into
 * devices, and host power control. Everything else that looks risky goes to
 * the reviewer instead; operators can extend or replace this list.
 */
export const DEFAULT_DENY_PATTERNS = [
    'rm\\s+(-[a-zA-Z]+\\s+)*(\\/|~|\\$HOME)(\\/|\\s|$)',
    '\\bdd\\b[^|;&\\n]*\\bof=\\/dev\\/',
    '\\bmkfs(\\.\\w+)?\\b',
    ':\\(\\)\\s*\\{',
    '\\bchmod\\s+-R\\s+777\\s+(\\/|~)',
    '(^|[;&|\\s])[^|;&\\n]*>\\s*\\/dev\\/',
    '\\b(reboot|shutdown|halt|poweroff)\\b',
];
/**
 * Compile config-supplied regex sources, failing loud at plugin load on an
 * invalid pattern.
 * @param field - the config field being compiled, named in the error.
 * @param patterns - regex source strings (blank or whitespace-wrapped
 *   entries are rejected like the invariants registry's own list).
 * @returns the compiled patterns, each carrying no state (`g` never set).
 */
export function compilePatterns(field, patterns) {
    return patterns.map((source) => {
        if (source.length === 0 || source.trim() !== source) {
            throw new Error(`auto-review: ${field} entries must be non-blank and have no surrounding whitespace`);
        }
        try {
            return new RegExp(source);
        }
        catch (cause) {
            throw new Error(`auto-review: ${field} contains invalid regex ${JSON.stringify(source)}`, { cause });
        }
    });
}
/**
 * The model-visible operation text a rule matches against: the `command`
 * argument verbatim when the tool carries one (bash), else the whole
 * arguments record as JSON — the same text the reviewer prompt shows.
 * @param callArguments - the validated call arguments from an approval request.
 * @returns the text rules and the reviewer see.
 */
export function commandTextOf(callArguments) {
    const command = callArguments['command'];
    return typeof command === 'string' ? command : JSON.stringify(callArguments);
}
/**
 * Whether any compiled pattern matches the text. Patterns are compiled
 * without the `g` flag so `RegExp.test` never advances lastIndex.
 * @param text - the command text (or JSON fallback) to match.
 * @param patterns - compiled patterns.
 * @returns whether at least one pattern matched.
 */
export function matchesAny(text, patterns) {
    return patterns.some(pattern => pattern.test(text));
}
//# sourceMappingURL=rules.js.map