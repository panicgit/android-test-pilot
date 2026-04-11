import assert from "node:assert";
import { describe, it } from "node:test";
import { AbstractTier } from "../src/tiers/abstract-tier";
import { TierRunner } from "../src/tiers/tier-runner";
import { TierContext, TierResult } from "../src/tiers/types";

// ─── Test helpers ───────────────────────────────────────────────────

const makeContext = (overrides?: Partial<TierContext>): TierContext => ({
	deviceId: "emulator-5554",
	step: {
		action: "tap login button",
		verification: "login screen appears",
	},
	appMap: {
		navigationMap: "",
		apiScenarios: [],
		viewStateMap: [],
	},
	...overrides,
});

class MockTier extends AbstractTier {
	readonly name: string;
	readonly priority: number;
	private _canHandle: boolean;
	private _result: TierResult;
	public canHandleCalled = false;
	public executeCalled = false;

	constructor(name: string, priority: number, canHandle: boolean, result: TierResult) {
		super();
		this.name = name;
		this.priority = priority;
		this._canHandle = canHandle;
		this._result = result;
	}

	async canHandle(_context: TierContext): Promise<boolean> {
		this.canHandleCalled = true;
		return this._canHandle;
	}

	async execute(_context: TierContext): Promise<TierResult> {
		this.executeCalled = true;
		return this._result;
	}
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("TierRunner", () => {

	it("returns SUCCESS from the first capable Tier", async () => {
		const tier1 = new MockTier("logcat", 1, true, {
			tier: "logcat",
			status: "SUCCESS",
			observation: "screen entered",
		});
		const tier2 = new MockTier("uiautomator", 2, true, {
			tier: "uiautomator",
			status: "SUCCESS",
		});

		const runner = new TierRunner([tier1, tier2]);
		const result = await runner.run(makeContext());

		assert.strictEqual(result.status, "SUCCESS");
		assert.strictEqual(result.tier, "logcat");
		assert.ok(tier1.executeCalled);
		assert.ok(!tier2.executeCalled, "tier2 should not be called");
	});

	it("skips Tiers that cannot handle and runs the next", async () => {
		const tier1 = new MockTier("logcat", 1, false, {
			tier: "logcat",
			status: "SUCCESS",
		});
		const tier2 = new MockTier("uiautomator", 2, true, {
			tier: "uiautomator",
			status: "SUCCESS",
			observation: "element found",
		});

		const runner = new TierRunner([tier1, tier2]);
		const result = await runner.run(makeContext());

		assert.strictEqual(result.status, "SUCCESS");
		assert.strictEqual(result.tier, "uiautomator");
		assert.ok(tier1.canHandleCalled);
		assert.ok(!tier1.executeCalled, "tier1 execute should not be called");
		assert.ok(tier2.executeCalled);
	});

	it("falls back from Tier 1 to Tier 2 on FALLBACK status", async () => {
		const tier1 = new MockTier("logcat", 1, true, {
			tier: "logcat",
			status: "FALLBACK",
			fallbackHint: "no ATP logs found",
		});
		const tier2 = new MockTier("uiautomator", 2, true, {
			tier: "uiautomator",
			status: "SUCCESS",
			observation: "found via UI tree",
		});

		const runner = new TierRunner([tier1, tier2]);
		const result = await runner.run(makeContext());

		assert.strictEqual(result.status, "SUCCESS");
		assert.strictEqual(result.tier, "uiautomator");
		assert.ok(tier1.executeCalled);
		assert.ok(tier2.executeCalled);
	});

	it("returns FAIL when a Tier verifies but fails", async () => {
		const tier1 = new MockTier("logcat", 1, true, {
			tier: "logcat",
			status: "FAIL",
			verification: { passed: false, expected: "hasData=true", actual: "hasData=false" },
		});
		const tier2 = new MockTier("uiautomator", 2, true, {
			tier: "uiautomator",
			status: "SUCCESS",
		});

		const runner = new TierRunner([tier1, tier2]);
		const result = await runner.run(makeContext());

		assert.strictEqual(result.status, "FAIL");
		assert.strictEqual(result.tier, "logcat");
		assert.ok(!tier2.executeCalled, "should not fall through on FAIL");
	});

	it("returns ERROR when all Tiers are exhausted", async () => {
		const tier1 = new MockTier("logcat", 1, false, {
			tier: "logcat",
			status: "SUCCESS",
		});
		const tier2 = new MockTier("uiautomator", 2, false, {
			tier: "uiautomator",
			status: "SUCCESS",
		});

		const runner = new TierRunner([tier1, tier2]);
		const result = await runner.run(makeContext());

		assert.strictEqual(result.status, "ERROR");
		assert.strictEqual(result.tier, "none");
		assert.ok(result.error?.includes("All tiers exhausted"));
	});

	it("returns ERROR with empty Tier list", async () => {
		const runner = new TierRunner([]);
		const result = await runner.run(makeContext());

		assert.strictEqual(result.status, "ERROR");
		assert.strictEqual(result.tier, "none");
	});

	it("catches exceptions from canHandle() and returns ERROR", async () => {
		const badTier = new MockTier("broken", 1, true, {
			tier: "broken",
			status: "SUCCESS",
		});
		badTier.canHandle = async () => { throw new Error("device disconnected"); };

		const runner = new TierRunner([badTier]);
		const result = await runner.run(makeContext());

		assert.strictEqual(result.status, "ERROR");
		assert.ok(result.error?.includes("device disconnected"));
	});

	it("catches exceptions from execute() and returns ERROR", async () => {
		const badTier = new MockTier("broken", 1, true, {
			tier: "broken",
			status: "SUCCESS",
		});
		badTier.execute = async () => { throw new Error("ADB timeout"); };

		const runner = new TierRunner([badTier]);
		const result = await runner.run(makeContext());

		assert.strictEqual(result.status, "ERROR");
		assert.ok(result.error?.includes("ADB timeout"));
	});

	it("sorts Tiers by priority regardless of insertion order", async () => {
		const tier3 = new MockTier("screenshot", 3, true, {
			tier: "screenshot",
			status: "SUCCESS",
		});
		const tier1 = new MockTier("logcat", 1, true, {
			tier: "logcat",
			status: "SUCCESS",
		});
		const tier2 = new MockTier("uiautomator", 2, true, {
			tier: "uiautomator",
			status: "SUCCESS",
		});

		// Insert in wrong order
		const runner = new TierRunner([tier3, tier1, tier2]);
		const tiers = runner.getTiers();

		assert.strictEqual(tiers[0].name, "logcat");
		assert.strictEqual(tiers[1].name, "uiautomator");
		assert.strictEqual(tiers[2].name, "screenshot");
	});

	it("passes previousTierResult through FALLBACK chain", async () => {
		let capturedContext: TierContext | null = null;

		const tier1 = new MockTier("logcat", 1, true, {
			tier: "logcat",
			status: "FALLBACK",
			fallbackHint: "no logs",
			rawData: "partial logcat data",
		});
		const tier2 = new MockTier("uiautomator", 2, true, {
			tier: "uiautomator",
			status: "SUCCESS",
		});
		tier2.execute = async (ctx: TierContext) => {
			capturedContext = ctx;
			return { tier: "uiautomator", status: "SUCCESS" as const };
		};

		const runner = new TierRunner([tier1, tier2]);
		await runner.run(makeContext());

		assert.ok(capturedContext !== null);
		if (capturedContext === null) throw new Error("unreachable");
		assert.strictEqual(capturedContext.previousTierResult?.tier, "logcat");
		assert.strictEqual(capturedContext.previousTierResult?.fallbackHint, "no logs");
	});

	it("handles full chain: FALLBACK → FALLBACK → SUCCESS", async () => {
		const tier1 = new MockTier("logcat", 1, true, {
			tier: "logcat",
			status: "FALLBACK",
			fallbackHint: "no ATP logs",
		});
		const tier2 = new MockTier("uiautomator", 2, true, {
			tier: "uiautomator",
			status: "FALLBACK",
			fallbackHint: "element not found",
		});
		const tier3 = new MockTier("screenshot", 3, true, {
			tier: "screenshot",
			status: "SUCCESS",
			observation: "verified via screenshot",
		});

		const runner = new TierRunner([tier1, tier2, tier3]);
		const result = await runner.run(makeContext());

		assert.strictEqual(result.status, "SUCCESS");
		assert.strictEqual(result.tier, "screenshot");
		assert.ok(tier1.executeCalled);
		assert.ok(tier2.executeCalled);
		assert.ok(tier3.executeCalled);
	});
});
