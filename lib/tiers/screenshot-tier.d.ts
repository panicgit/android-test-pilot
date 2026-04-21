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
export declare class ScreenshotTier extends AbstractTier {
    readonly name = "screenshot";
    readonly priority = 3;
    canHandle(context: TierContext): Promise<boolean>;
    execute(context: TierContext): Promise<TierResult>;
}
