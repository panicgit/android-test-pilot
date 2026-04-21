"use strict";
/**
 * Tier Plugin System — Type Definitions
 *
 * Defines the data structures shared across all Tier plugins:
 * - TierContext: input context for each Tier execution
 * - TierResult: output from a Tier execution
 * - TierStatus: possible execution outcomes
 * - Supporting types for Step 0 artifacts (ApiScenario, ViewStateScreen)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.flattenTierResult = void 0;
/**
 * Flatten a TierResult to a wire-friendly plain object for the MCP response.
 * Built as an explicit FlatTierResult per branch so the compiler enforces
 * completeness — no unchecked terminal cast (T-R6).
 */
const flattenTierResult = (result) => {
    switch (result.status) {
        case "SUCCESS":
        case "FAIL": {
            const out = { tier: result.tier, status: result.status };
            if (result.observation !== undefined)
                out.observation = result.observation;
            if (result.verification !== undefined)
                out.verification = result.verification;
            if (result.rawData !== undefined)
                out.rawData = result.rawData;
            return out;
        }
        case "FALLBACK": {
            const out = {
                tier: result.tier,
                status: result.status,
                fallbackHint: result.fallbackHint,
            };
            if (result.observation !== undefined)
                out.observation = result.observation;
            if (result.rawData !== undefined)
                out.rawData = result.rawData;
            return out;
        }
        case "ERROR":
            return { tier: result.tier, status: result.status, error: result.error };
    }
};
exports.flattenTierResult = flattenTierResult;
//# sourceMappingURL=types.js.map