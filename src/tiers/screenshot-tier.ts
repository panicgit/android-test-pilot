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

export class ScreenshotTier extends AbstractTier {
	readonly name = "screenshot";
	readonly priority = 3;

	async canHandle(context: TierContext): Promise<boolean> {
		// Verify device is reachable before attempting screenshot
		try {
			const robot = this.getAndroidRobot(context);
			void robot.adb("shell", "echo", "ping");
			return true;
		} catch {
			return false;
		}
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
