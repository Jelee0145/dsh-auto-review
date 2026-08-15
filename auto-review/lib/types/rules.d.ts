/**
 * Pure rule engine for the auto-review circuit breaker and allowlist: regex
 * compilation with loud load-time failure, the model-visible command text of
 * a tool call, and pattern matching. No Cordis imports — independently
 * unit-tested.
 * @module @deepseek-ai/dsh-auto-review/rules
 */
import type { JsonValue } from '@deepseek-ai/dsh-session';
/**
 * The default circuit-breaker patterns — regex sources matched against the
 * model-visible command text of a claimed ask. Each entry names a catastrophic
 * operation that must never reach the reviewer (or the machine): recursive
 * deletion of absolute roots and home, raw-device writes, filesystem creation,
 * fork bombs, recursive permission rewrites on roots, shell redirection into
 * devices, and host power control. Everything else that looks risky goes to
 * the reviewer instead; operators can extend or replace this list.
 */
export declare const DEFAULT_DENY_PATTERNS: readonly string[];
/**
 * Compile config-supplied regex sources, failing loud at plugin load on an
 * invalid pattern.
 * @param field - the config field being compiled, named in the error.
 * @param patterns - regex source strings (blank or whitespace-wrapped
 *   entries are rejected like the invariants registry's own list).
 * @returns the compiled patterns, each carrying no state (`g` never set).
 */
export declare function compilePatterns(field: string, patterns: readonly string[]): RegExp[];
/**
 * The model-visible operation text a rule matches against: the `command`
 * argument verbatim when the tool carries one (bash), else the whole
 * arguments record as JSON — the same text the reviewer prompt shows.
 * @param callArguments - the validated call arguments from an approval request.
 * @returns the text rules and the reviewer see.
 */
export declare function commandTextOf(callArguments: Readonly<Record<string, JsonValue>>): string;
/**
 * Whether any compiled pattern matches the text. Patterns are compiled
 * without the `g` flag so `RegExp.test` never advances lastIndex.
 * @param text - the command text (or JSON fallback) to match.
 * @param patterns - compiled patterns.
 * @returns whether at least one pattern matched.
 */
export declare function matchesAny(text: string, patterns: readonly RegExp[]): boolean;
//# sourceMappingURL=rules.d.ts.map