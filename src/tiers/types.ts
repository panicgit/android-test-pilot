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

/** Result returned by a Tier's execute() method */
export interface TierResult {
	/** Name of the Tier that produced this result */
	tier: string;
	/** Execution status */
	status: TierStatus;
	/** What the Tier observed (on SUCCESS or FAIL) */
	observation?: string;
	/** Verification details (on SUCCESS or FAIL) */
	verification?: TierVerification;
	/** Hint for the next Tier (on FALLBACK) */
	fallbackHint?: string;
	/** Error message (on ERROR) */
	error?: string;
	/** Raw data collected (logs, XML dump, etc.) */
	rawData?: string;
}
