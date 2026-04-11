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
import { AndroidRobot } from "../android";

export abstract class AbstractTier {
	/** Human-readable name for this Tier (e.g. "text", "uiautomator", "screenshot") */
	abstract readonly name: string;

	/** Execution priority — lower values run first (e.g. 1, 2, 3) */
	abstract readonly priority: number;

	/**
	 * Cached AndroidRobot instance.
	 * Note: Single-threaded assumption — not safe for concurrent multi-device
	 * runs on the same AbstractTier instance. Each TierRunner.run() should use
	 * its own tier instances or target a single device.
	 */
	private _robot: AndroidRobot | null = null;

	/**
	 * Get or create an AndroidRobot for the given device.
	 * Re-creates the robot if the device ID changes.
	 */
	protected getAndroidRobot(context: TierContext): AndroidRobot {
		if (!this._robot || context.deviceId !== this._robot.getDeviceId()) {
			this._robot = new AndroidRobot(context.deviceId);
		}
		return this._robot;
	}

	/**
	 * Check whether this Tier can handle the current test step.
	 *
	 * Return true to proceed with execute(), false to skip to the next Tier.
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
