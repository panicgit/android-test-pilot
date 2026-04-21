/**
 * TextTier (Tier 1) — Text-based device state detection
 *
 * Combines dumpsys and logcat to determine app state without screenshots.
 * This is the cheapest and fastest tier — all data is plain text.
 *
 * Data sources:
 * - dumpsys activity: current foreground Activity
 * - dumpsys window: current focused window
 * - logcat (ATP_ tags): screen transitions, View state, API responses
 */
import { AbstractTier } from "./abstract-tier";
import { TierContext, TierResult } from "./types";
export declare class TextTier extends AbstractTier {
    readonly name = "text";
    readonly priority = 1;
    canHandle(context: TierContext): Promise<boolean>;
    execute(context: TierContext): Promise<TierResult>;
    private findSessionForDevice;
}
