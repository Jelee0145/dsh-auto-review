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
import type { Context } from '@deepseek-ai/cordis';
/** Cordis companion plugin name. */
export declare const name = "auto-review-invariant";
/** Service required before the companion can reserve package ownership. */
export declare const inject: string[];
/**
 * Register the auto-review invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export declare const apply: (ctx: Context) => Promise<() => void>;
//# sourceMappingURL=invariant.d.ts.map