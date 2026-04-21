/**
 * SnapshotTier — visual-regression tier (C5 / S3-5).
 *
 * Runs in the verify phase when a step declares `expectedSnapshot`.
 * Captures a PNG, pixel-diffs it against a stored baseline via pixelmatch,
 * and returns SUCCESS if the difference ratio is below the step's threshold.
 *
 * Priority 0 — runs BEFORE TextTier when `expectedSnapshot` is present,
 * because the snapshot is the primary assertion and we don't want TextTier
 * to shortcut on dumpsys.
 *
 * Baselines live at `.claude/baselines/{name}.png` (or
 * `$ATP_PROJECT_ROOT/.claude/baselines/...`). Missing baseline on first
 * run writes the current capture as the baseline and returns SUCCESS.
 *
 * Depends on `pixelmatch` and `pngjs` — listed in optionalDependencies.
 * Gracefully FALLBACK if either is missing.
 */
import { AbstractTier } from "./abstract-tier";
import { TierContext, TierResult } from "./types";
export declare class SnapshotTier extends AbstractTier {
    readonly name = "snapshot";
    readonly priority = 0;
    canHandle(context: TierContext): Promise<boolean>;
    execute(context: TierContext): Promise<TierResult>;
}
