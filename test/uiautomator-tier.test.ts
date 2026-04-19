import assert from "node:assert";
import { describe, it, beforeEach } from "node:test";
import { UiAutomatorTier } from "../src/tiers/uiautomator-tier";
import { TierContext } from "../src/tiers/types";
import { AndroidRobot } from "../src/android";

const makeContext = (overrides?: Partial<TierContext>): TierContext => ({
	deviceId: "emulator-5554",
	step: { action: "", verification: "" },
	appMap: { navigationMap: "", apiScenarios: [], viewStateMap: [] },
	...overrides,
});

const installMockRobot = (opts: { elements?: Array<{ identifier?: string; rect: { x: number; y: number; width: number; height: number } }>; onTap?: (x: number, y: number) => void }) => {
	const proto = AndroidRobot.prototype as unknown as Record<string, unknown>;
	proto.adb = async function () { return Buffer.from(""); };
	proto.getElementsOnScreen = async function () {
		return (opts.elements ?? []).map(e => ({
			type: "Button",
			text: "",
			label: "",
			identifier: e.identifier,
			rect: e.rect,
		}));
	};
	let lastTap: { x: number; y: number } | null = null;
	proto.tap = async function (x: number, y: number) {
		lastTap = { x, y };
		opts.onTap?.(x, y);
	};
	return { lastTap: () => lastTap };
};

describe("UiAutomatorTier — phase handling (A5)", () => {
	beforeEach(() => {
		// reset state
	});

	it("act phase with matching resourceId taps at element center and returns SUCCESS", async () => {
		installMockRobot({
			elements: [{ identifier: "btn_login", rect: { x: 100, y: 200, width: 200, height: 80 } }],
		});
		const tier = new UiAutomatorTier();
		const ctx = makeContext({
			phase: "act",
			step: { action: "tap login", verification: "", tapTarget: { resourceId: "btn_login" } },
		});

		const result = await tier.execute(ctx);

		assert.strictEqual(result.status, "SUCCESS");
		assert.match(result.observation ?? "", /Tapped btn_login at \(200, 240\)/);
	});

	it("act phase with unknown resourceId returns FAIL", async () => {
		installMockRobot({
			elements: [{ identifier: "something_else", rect: { x: 0, y: 0, width: 10, height: 10 } }],
		});
		const tier = new UiAutomatorTier();
		const ctx = makeContext({
			phase: "act",
			step: { action: "tap", verification: "", tapTarget: { resourceId: "missing_id" } },
		});

		const result = await tier.execute(ctx);

		assert.strictEqual(result.status, "FAIL");
		assert.strictEqual(result.verification?.passed, false);
	});

	it("act phase without tapTarget falls back", async () => {
		installMockRobot({
			elements: [{ rect: { x: 0, y: 0, width: 10, height: 10 } }],
		});
		const tier = new UiAutomatorTier();
		const ctx = makeContext({ phase: "act" });

		const result = await tier.execute(ctx);

		assert.strictEqual(result.status, "FALLBACK");
		assert.match(result.fallbackHint ?? "", /no tapTarget/);
	});

	it("verify phase with tapTarget AND expectedLogcat defers to TextTier", async () => {
		installMockRobot({
			elements: [{ identifier: "btn_x", rect: { x: 0, y: 0, width: 10, height: 10 } }],
		});
		const tier = new UiAutomatorTier();
		const ctx = makeContext({
			phase: "verify",
			step: {
				action: "",
				verification: "",
				tapTarget: { resourceId: "btn_x" },
				expectedLogcat: [{ tag: "ATP_API", pattern: "status=200" }],
			},
		});

		const result = await tier.execute(ctx);

		assert.strictEqual(result.status, "FALLBACK");
		assert.match(result.fallbackHint ?? "", /TextTier/);
	});

	it("verify phase without tap observes hierarchy and returns SUCCESS", async () => {
		installMockRobot({
			elements: [{ rect: { x: 0, y: 0, width: 10, height: 10 } }],
		});
		const tier = new UiAutomatorTier();
		const ctx = makeContext({ phase: "verify" });

		const result = await tier.execute(ctx);

		assert.strictEqual(result.status, "SUCCESS");
		assert.match(result.observation ?? "", /elements found/);
	});

	it("empty hierarchy falls back in both phases", async () => {
		installMockRobot({ elements: [] });
		const tier = new UiAutomatorTier();
		const resultAct = await tier.execute(makeContext({ phase: "act" }));
		const resultVerify = await tier.execute(makeContext({ phase: "verify" }));
		assert.strictEqual(resultAct.status, "FALLBACK");
		assert.strictEqual(resultVerify.status, "FALLBACK");
	});
});

describe("UiAutomatorTier — canHandle", () => {
	it("handles both phases (act + verify)", async () => {
		const tier = new UiAutomatorTier();
		assert.strictEqual(await tier.canHandle(makeContext({ phase: "act" })), true);
		assert.strictEqual(await tier.canHandle(makeContext({ phase: "verify" })), true);
	});
});
