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
export declare abstract class AbstractTier {
    /** Human-readable name for this Tier (e.g. "text", "uiautomator", "screenshot") */
    abstract readonly name: string;
    /** Execution priority — lower values run first (e.g. 1, 2, 3) */
    abstract readonly priority: number;
    /**
     * Construct a fresh AndroidRobot for the given context device.
     *
     * Tiers are stateless (A4) — safe to share across concurrent runs on
     * different devices. AndroidRobot's constructor does no I/O, so the
     * allocation is effectively free.
     */
    protected getAndroidRobot(context: TierContext): AndroidRobot;
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
