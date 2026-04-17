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
import { isScalingAvailable, Image } from "../image-utils";
import { trace } from "../logger";

/**
 * Target width used when downscaling a screenshot before base64 encoding.
 * 540px wide fits most Android phones' information density while keeping the
 * vision-token cost ~15-30x lower than a full-resolution PNG (P8).
 */
const SCREENSHOT_TARGET_WIDTH = 540;
const SCREENSHOT_JPEG_QUALITY = 75;

export class ScreenshotTier extends AbstractTier {
	readonly name = "screenshot";
	readonly priority = 3;

	async canHandle(context: TierContext): Promise<boolean> {
		// Screenshot tier is always "handleable" for the verify phase. It
		// cannot drive the UI, so skip the act phase (A5).
		return context.phase !== "act";
	}

	async execute(context: TierContext): Promise<TierResult> {
		const robot = this.getAndroidRobot(context);

		try {
			let screenshot = await robot.getScreenshot();
			let mimeType = "image/png";
			const originalBytes = screenshot.length;

			if (isScalingAvailable() && originalBytes > 0) {
				try {
					const resized = Image.fromBuffer(screenshot)
						.resize(SCREENSHOT_TARGET_WIDTH)
						.jpeg({ quality: SCREENSHOT_JPEG_QUALITY })
						.toBuffer();
					if (resized && resized.length > 0) {
						screenshot = resized;
						mimeType = "image/jpeg";
						trace(`ScreenshotTier resize: ${originalBytes} -> ${screenshot.length} bytes (${SCREENSHOT_TARGET_WIDTH}px JPEG q${SCREENSHOT_JPEG_QUALITY})`);
					} else {
						trace(`ScreenshotTier resize returned empty buffer, sending raw PNG`);
					}
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					trace(`ScreenshotTier resize failed, sending raw PNG: ${message}`);
				}
			}

			const base64 = screenshot.toString("base64");
			return {
				tier: this.name,
				status: "SUCCESS",
				observation: `Screenshot captured (${screenshot.length} bytes, ${mimeType}${originalBytes !== screenshot.length ? `, downscaled from ${originalBytes}B` : ""}). Visual analysis required for verification: "${context.step.verification}"`,
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
