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
import { trace } from "../logger";

export class TierRunner {
	private readonly tiers: AbstractTier[];

	constructor(tiers: AbstractTier[]) {
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
	async run(context: TierContext): Promise<TierResult> {
		let currentContext = { ...context };

		for (const tier of this.tiers) {
			trace(`TierRunner: checking ${tier.name} (priority=${tier.priority})`);

			let canHandle: boolean;
			try {
				canHandle = await tier.canHandle(currentContext);
			} catch (err: any) {
				trace(`TierRunner: ${tier.name}.canHandle() threw: ${err.message}`);
				return {
					tier: tier.name,
					status: "ERROR",
					error: `canHandle() failed: ${err.message}`,
				};
			}

			if (!canHandle) {
				trace(`TierRunner: ${tier.name} cannot handle, skipping`);
				continue;
			}

			trace(`TierRunner: executing ${tier.name}`);
			let result: TierResult;
			try {
				result = await tier.execute(currentContext);
			} catch (err: any) {
				trace(`TierRunner: ${tier.name}.execute() threw: ${err.message}`);
				return {
					tier: tier.name,
					status: "ERROR",
					error: `execute() failed: ${err.message}`,
				};
			}

			if (result.status === "FALLBACK") {
				trace(`TierRunner: ${tier.name} returned FALLBACK — ${result.fallbackHint || "no hint"}`);
				// Pass this result to the next Tier as context
				currentContext = {
					...currentContext,
					previousTierResult: result,
				};
				continue;
			}

			// SUCCESS, FAIL, or ERROR — return immediately
			trace(`TierRunner: ${tier.name} returned ${result.status}`);
			return result;
		}

		// All Tiers exhausted
		trace("TierRunner: all tiers exhausted");
		return {
			tier: "none",
			status: "ERROR",
			error: "All tiers exhausted — no tier could handle this step",
		};
	}

	/** Return the registered Tiers in priority order (for debugging/testing) */
	getTiers(): readonly AbstractTier[] {
		return this.tiers;
	}
}
