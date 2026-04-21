"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScreenshotTier = void 0;
const abstract_tier_1 = require("./abstract-tier");
const image_utils_1 = require("../image-utils");
const logger_1 = require("../logger");
/**
 * Target width used when downscaling a screenshot before base64 encoding.
 * 540px wide fits most Android phones' information density while keeping the
 * vision-token cost ~15-30x lower than a full-resolution PNG (P8).
 */
const SCREENSHOT_TARGET_WIDTH = 540;
const SCREENSHOT_JPEG_QUALITY = 75;
class ScreenshotTier extends abstract_tier_1.AbstractTier {
    name = "screenshot";
    priority = 3;
    async canHandle(context) {
        // Screenshot tier is always "handleable" for the verify phase. It
        // cannot drive the UI, so skip the act phase (A5).
        return context.phase !== "act";
    }
    async execute(context) {
        const robot = this.getAndroidRobot(context);
        try {
            let screenshot = await robot.getScreenshot();
            let mimeType = "image/png";
            const originalBytes = screenshot.length;
            if ((0, image_utils_1.isScalingAvailable)() && originalBytes > 0) {
                try {
                    const resized = image_utils_1.Image.fromBuffer(screenshot)
                        .resize(SCREENSHOT_TARGET_WIDTH)
                        .jpeg({ quality: SCREENSHOT_JPEG_QUALITY })
                        .toBuffer();
                    if (resized && resized.length > 0) {
                        screenshot = resized;
                        mimeType = "image/jpeg";
                        (0, logger_1.trace)(`ScreenshotTier resize: ${originalBytes} -> ${screenshot.length} bytes (${SCREENSHOT_TARGET_WIDTH}px JPEG q${SCREENSHOT_JPEG_QUALITY})`);
                    }
                    else {
                        (0, logger_1.trace)(`ScreenshotTier resize returned empty buffer, sending raw PNG`);
                    }
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    (0, logger_1.trace)(`ScreenshotTier resize failed, sending raw PNG: ${message}`);
                }
            }
            const base64 = screenshot.toString("base64");
            return {
                tier: this.name,
                status: "SUCCESS",
                observation: `Screenshot captured (${screenshot.length} bytes, ${mimeType}${originalBytes !== screenshot.length ? `, downscaled from ${originalBytes}B` : ""}). Visual analysis required for verification: "${context.step.verification}"`,
                rawData: base64,
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                tier: this.name,
                status: "ERROR",
                error: `Screenshot capture failed: ${message}`,
            };
        }
    }
}
exports.ScreenshotTier = ScreenshotTier;
//# sourceMappingURL=screenshot-tier.js.map