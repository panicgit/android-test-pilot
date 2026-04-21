/**
 * TierRunner — Chain executor for Tier plugins
 *
 * Runs Tiers in priority order:
 * 1. canHandle() → false? skip to next Tier
 * 2. execute() → FALLBACK? pass result to next Tier
 * 3. SUCCESS/FAIL/ERROR → return immediately
 * 4. All Tiers exhausted → return ERROR
 */
import { AbstractTier } from "./abstract-tier";
import { TierContext, TierResult } from "./types";
export declare class TierRunner {
    private readonly tiers;
    constructor(tiers: AbstractTier[]);
    /**
     * Run the Tier chain for a given test step context.
     *
     * Iterates through Tiers in priority order:
     * - Calls canHandle() first; skips if false
     * - Calls execute(); returns on SUCCESS/FAIL/ERROR
     * - On FALLBACK, passes the result as previousTierResult to the next Tier
     * - If all Tiers are exhausted, returns an ERROR result
     */
    run(context: TierContext): Promise<TierResult>;
    /** Return the registered Tiers in priority order (for debugging/testing) */
    getTiers(): readonly AbstractTier[];
}
