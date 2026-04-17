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

/** A single test step parsed from a scenario file */
export interface TestStep {
	action: string;
	expectedLogcat?: ExpectedLogcat[];
	tapTarget?: TapTarget;
	verification: string;
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

/**
 * Flatten a TierResult to a wire-friendly plain object for the MCP response.
 * All variant-specific fields appear as undefined when absent.
 */
export const flattenTierResult = (result: TierResult): {
	tier: string;
	status: TierStatus;
	observation?: string;
	verification?: TierVerification;
	fallbackHint?: string;
	error?: string;
	rawData?: string;
} => {
	const out = { tier: result.tier, status: result.status } as Record<string, unknown>;
	if (result.status === "SUCCESS" || result.status === "FAIL") {
		if (result.observation !== undefined) out.observation = result.observation;
		if (result.verification !== undefined) out.verification = result.verification;
		if (result.rawData !== undefined) out.rawData = result.rawData;
	} else if (result.status === "FALLBACK") {
		out.fallbackHint = result.fallbackHint;
		if (result.observation !== undefined) out.observation = result.observation;
		if (result.rawData !== undefined) out.rawData = result.rawData;
	} else {
		out.error = result.error;
	}
	return out as ReturnType<typeof flattenTierResult>;
};
