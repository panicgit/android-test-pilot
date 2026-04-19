/**
 * Tier Plugin System — Type Definitions
 *
 * Defines the data structures shared across all Tier plugins:
 * - TierContext: input context for each Tier execution
 * - TierResult: output from a Tier execution
 * - TierStatus: possible execution outcomes
 * - Supporting types for Step 0 artifacts (ApiScenario, ViewStateScreen)
 */

// ─── Step 0 artifact types ──────────────────────────────────────────

/** API scenario extracted by Step 0-B */
export interface ApiScenario {
	endpoint: string;
	interfaceFile: string;
	callers: Array<{
		file: string;
		successHandler: string;
		errorHandler: string;
	}>;
}

/** View state mapping extracted by Step 0-C */
export interface ViewStateScreen {
	name: string;
	file: string;
	states: Array<{
		viewId: string;
		visibilityCondition: string;
		dataSource: string;
		sourceFile: string;
	}>;
}

// ─── Log tag types ──────────────────────────────────────────────────

/** ATP log tags inserted by Step 1 */
export type AtpLogTag = "ATP_SCREEN" | "ATP_RENDER" | "ATP_API";

// ─── Tier execution types ───────────────────────────────────────────

/** Expected logcat entry in a test step */
export interface ExpectedLogcat {
	tag: AtpLogTag;
	pattern: string;
}

/** Tap target for UI interaction */
export interface TapTarget {
	resourceId?: string;
	coordinates?: { x: number; y: number };
}

/**
 * Visual-regression assertion for a step. When present, the SnapshotTier
 * captures a screenshot and pixel-diffs it against a stored baseline.
 * Baselines live at `.claude/baselines/{name}.png`.
 */
export interface ExpectedSnapshot {
	/** Stable identifier — used as the baseline filename. */
	name: string;
	/**
	 * Maximum allowed share of differing pixels (0-1). Defaults to 0.01
	 * (1%). Lower = stricter.
	 */
	threshold?: number;
	/**
	 * If true and no baseline exists, capture the current screenshot as
	 * the baseline and return SUCCESS. Defaults to true on first run.
	 */
	createIfMissing?: boolean;
}

/** A single test step parsed from a scenario file */
export interface TestStep {
	action: string;
	expectedLogcat?: ExpectedLogcat[];
	tapTarget?: TapTarget;
	verification: string;
	/**
	 * Visual-regression contract. When set, SnapshotTier runs in the
	 * verify phase and pixel-diffs against a stored baseline.
	 */
	expectedSnapshot?: ExpectedSnapshot;
	/**
	 * If true, TextTier accepts the step on dumpsys alone when expectedLogcat is
	 * absent. Default false — TextTier falls back to UiAutomatorTier so the action
	 * (e.g. tap) can actually be performed and verified. See C2 (no-op SUCCESS).
	 */
	skipVerification?: boolean;
}

/** Step 0 artifacts loaded from .claude/app-map/ */
export interface AppMap {
	navigationMap: string;
	apiScenarios: ApiScenario[];
	viewStateMap: ViewStateScreen[];
}

/**
 * Which half of a test step the tier chain is working on.
 *
 * - `act`:    perform the action (tap / swipe / launch). Tiers that cannot
 *             drive UI (e.g. TextTier) must FALLBACK.
 * - `verify`: check the post-condition against expectedLogcat / observed
 *             state. Tiers that only act (e.g. UiAutomatorTier when there
 *             is no observation contract) must FALLBACK.
 *
 * Splitting act from verify fixes A5 — previously a single-tier execution
 * could "succeed" by tapping, without ever verifying that the action
 * produced the expected state.
 */
export type TierPhase = "act" | "verify";

/** Context passed to each Tier's canHandle() and execute() */
export interface TierContext {
	/** ADB device ID */
	deviceId: string;
	/** Current test step */
	step: TestStep;
	/** Step 0 artifacts */
	appMap: AppMap;
	/** Result from the previous Tier (if any, on FALLBACK) */
	previousTierResult?: TierResult;
	/** Which half of the step is being executed. Defaults to "verify". */
	phase?: TierPhase;
}

/**
 * Tier execution status:
 * - SUCCESS:  Tier resolved the step, verification passed
 * - FAIL:     Tier resolved the step, verification failed
 * - FALLBACK: Tier cannot handle this step, delegate to next Tier
 * - ERROR:    Tier encountered a runtime error
 */
export type TierStatus = "SUCCESS" | "FAIL" | "FALLBACK" | "ERROR";

/** Verification outcome within a TierResult */
export interface TierVerification {
	passed: boolean;
	expected: string;
	actual: string;
}

/**
 * Result returned by a Tier's execute() method.
 *
 * Discriminated union by `status` (T4) — narrowing on status gives callers
 * compile-time guarantees that the fields they need are present:
 * - `FALLBACK` always carries a `fallbackHint`
 * - `ERROR` always carries an `error` message
 * - `FAIL` always carries a `verification` record
 *
 * `observation`, `rawData`, `verification` are intentionally optional on
 * SUCCESS because not every tier produces all three (screenshot has no
 * verification; text with no expectedLogcat has no verification record).
 */
export type TierResult =
	| { tier: string; status: "SUCCESS"; observation?: string; verification?: TierVerification; rawData?: string }
	| { tier: string; status: "FAIL"; observation?: string; verification: TierVerification; rawData?: string }
	| { tier: string; status: "FALLBACK"; fallbackHint: string; observation?: string; rawData?: string }
	| { tier: string; status: "ERROR"; error: string };

/** Wire-friendly flat shape of a TierResult. */
export interface FlatTierResult {
	tier: string;
	status: TierStatus;
	observation?: string;
	verification?: TierVerification;
	fallbackHint?: string;
	error?: string;
	rawData?: string;
}

/**
 * Flatten a TierResult to a wire-friendly plain object for the MCP response.
 * Built as an explicit FlatTierResult per branch so the compiler enforces
 * completeness — no unchecked terminal cast (T-R6).
 */
export const flattenTierResult = (result: TierResult): FlatTierResult => {
	switch (result.status) {
		case "SUCCESS":
		case "FAIL": {
			const out: FlatTierResult = { tier: result.tier, status: result.status };
			if (result.observation !== undefined) out.observation = result.observation;
			if (result.verification !== undefined) out.verification = result.verification;
			if (result.rawData !== undefined) out.rawData = result.rawData;
			return out;
		}
		case "FALLBACK": {
			const out: FlatTierResult = {
				tier: result.tier,
				status: result.status,
				fallbackHint: result.fallbackHint,
			};
			if (result.observation !== undefined) out.observation = result.observation;
			if (result.rawData !== undefined) out.rawData = result.rawData;
			return out;
		}
		case "ERROR":
			return { tier: result.tier, status: result.status, error: result.error };
	}
};
