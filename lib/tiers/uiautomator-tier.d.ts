/**
 * UiAutomatorTier (Tier 2) — UI hierarchy-based detection
 *
 * Dumps the current View hierarchy via uiautomator and searches
 * for elements by resource-id or text. Can also perform tap actions.
 *
 * Used when Tier 1 (text-based) cannot determine the result.
 */
import { AbstractTier } from "./abstract-tier";
import { TierContext, TierResult } from "./types";
export declare class UiAutomatorTier extends AbstractTier {
    readonly name = "uiautomator";
    readonly priority = 2;
    canHandle(context: TierContext): Promise<boolean>;
    execute(context: TierContext): Promise<TierResult>;
}
