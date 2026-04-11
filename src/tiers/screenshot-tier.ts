/**
 * ScreenshotTier (Tier 3) — Screenshot-based visual verification
 *
 * Last resort tier. Captures a screenshot and returns it as base64
 * for LLM visual analysis. Always available (canHandle = true).
 *
 * Use cases:
 * - Image rendering verification
 * - Unexpected popup detection
 * - Visual layout validation
 */

import { AbstractTier } from "./abstract-tier";
import { TierContext, TierResult } from "./types";
import { AndroidRobot } from "../android";

export class ScreenshotTier extends AbstractTier {
	readonly name = "screenshot";
	readonly priority = 3;

	private robot: AndroidRobot | null = null;

	private getAndroidRobot(context: TierContext): AndroidRobot {
		if (!this.robot || context.deviceId !== (this.robot as any).deviceId) {
			this.robot = new AndroidRobot(context.deviceId);
		}
		return this.robot;
	}

	async canHandle(_context: TierContext): Promise<boolean> {
		// Screenshot is always available as last resort
		return true;
	}

	async execute(context: TierContext): Promise<TierResult> {
		const robot = this.getAndroidRobot(context);

		try {
			const screenshot = await robot.getScreenshot();
			const base64 = screenshot.toString("base64");

			return {
				tier: this.name,
				status: "SUCCESS",
				observation: `Screenshot captured (${screenshot.length} bytes). Visual analysis required for verification: "${context.step.verification}"`,
				rawData: base64,
			};
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				tier: this.name,
				status: "ERROR",
				error: `Screenshot capture failed: ${message}`,
			};
		}
	}
}
