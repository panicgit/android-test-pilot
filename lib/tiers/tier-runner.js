"use strict";
/**
 * TierRunner — Chain executor for Tier plugins
 *
 * Runs Tiers in priority order:
 * 1. canHandle() → false? skip to next Tier
 * 2. execute() → FALLBACK? pass result to next Tier
 * 3. SUCCESS/FAIL/ERROR → return immediately
 * 4. All Tiers exhausted → return ERROR
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TierRunner = void 0;
const logger_1 = require("../logger");
class TierRunner {
    tiers;
    constructor(tiers) {
        // Sort by priority (lower = runs first)
        this.tiers = [...tiers].sort((a, b) => a.priority - b.priority);
    }
    /**
     * Run the Tier chain for a given test step context.
     *
     * Iterates through Tiers in priority order:
     * - Calls canHandle() first; skips if false
     * - Calls execute(); returns on SUCCESS/FAIL/ERROR
     * - On FALLBACK, passes the result as previousTierResult to the next Tier
     * - If all Tiers are exhausted, returns an ERROR result
     */
    async run(context) {
        let currentContext = { ...context };
        for (const tier of this.tiers) {
            (0, logger_1.trace)(`TierRunner: checking ${tier.name} (priority=${tier.priority})`);
            let canHandle;
            try {
                canHandle = await tier.canHandle(currentContext);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                (0, logger_1.trace)(`TierRunner: ${tier.name}.canHandle() threw: ${message}`);
                return {
                    tier: tier.name,
                    status: "ERROR",
                    error: `canHandle() failed: ${message}`,
                };
            }
            if (!canHandle) {
                (0, logger_1.trace)(`TierRunner: ${tier.name} cannot handle, skipping`);
                continue;
            }
            (0, logger_1.trace)(`TierRunner: executing ${tier.name}`);
            let result;
            try {
                result = await tier.execute(currentContext);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                (0, logger_1.trace)(`TierRunner: ${tier.name}.execute() threw: ${message}`);
                return {
                    tier: tier.name,
                    status: "ERROR",
                    error: `execute() failed: ${message}`,
                };
            }
            if (result.status === "FALLBACK") {
                (0, logger_1.trace)(`TierRunner: ${tier.name} returned FALLBACK — ${result.fallbackHint || "no hint"}`);
                // Pass this result to the next Tier as context
                currentContext = {
                    ...currentContext,
                    previousTierResult: result,
                };
                continue;
            }
            // SUCCESS, FAIL, or ERROR — return immediately
            (0, logger_1.trace)(`TierRunner: ${tier.name} returned ${result.status}`);
            return result;
        }
        // All Tiers exhausted
        (0, logger_1.trace)("TierRunner: all tiers exhausted");
        return {
            tier: "none",
            status: "ERROR",
            error: "All tiers exhausted — no tier could handle this step",
        };
    }
    /** Return the registered Tiers in priority order (for debugging/testing) */
    getTiers() {
        return this.tiers;
    }
}
exports.TierRunner = TierRunner;
//# sourceMappingURL=tier-runner.js.map