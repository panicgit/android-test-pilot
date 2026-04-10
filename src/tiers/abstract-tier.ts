/**
 * AbstractTier — Base class for all Tier plugins
 *
 * Each Tier implements two methods:
 * - canHandle(): checks if this Tier can process the current context
 * - execute(): performs the actual observation/interaction and returns a result
 *
 * Tiers are ordered by priority (lower = runs first).
 * TierRunner calls them in sequence until one returns SUCCESS, FAIL, or ERROR.
 */

import { TierContext, TierResult } from "./types";

export abstract class AbstractTier {
	/** Human-readable name for this Tier (e.g. "logcat", "uiautomator", "screenshot") */
	abstract readonly name: string;

	/** Execution priority — lower values run first (e.g. 1, 2, 3) */
	abstract readonly priority: number;

	/**
	 * Check whether this Tier can handle the current test step.
	 *
	 * Return true to proceed with execute(), false to skip to the next Tier.
	 *
	 * Examples:
	 * - LogcatTier: returns true if ATP_ tag logs are being emitted
	 * - UiAutomatorTier: returns true if device is connected and responsive
	 * - ScreenshotTier: always returns true (last resort)
	 */
	abstract canHandle(context: TierContext): Promise<boolean>;

	/**
	 * Execute the Tier's strategy for the current test step.
	 *
	 * Must return a TierResult with one of these statuses:
	 * - SUCCESS: step verified successfully
	 * - FAIL: step verification failed
	 * - FALLBACK: this Tier couldn't determine the result, try next Tier
	 * - ERROR: a runtime error occurred
	 *
	 * On FALLBACK, include fallbackHint explaining why this Tier couldn't handle it.
	 */
	abstract execute(context: TierContext): Promise<TierResult>;
}
