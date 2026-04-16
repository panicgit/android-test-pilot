import assert from "node:assert";
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import { TextTier } from "../src/tiers/text-tier";
import { TierContext } from "../src/tiers/types";
import { AndroidRobot } from "../src/android";

// ─── Test helpers ───────────────────────────────────────────────────

const makeContext = (overrides?: Partial<TierContext>): TierContext => ({
	deviceId: "emulator-5554",
	step: {
		action: "noop",
		verification: "noop",
	},
	appMap: {
		navigationMap: "",
		apiScenarios: [],
		viewStateMap: [],
	},
	...overrides,
});

const installMockAdb = () => {
	const proto = AndroidRobot.prototype as unknown as Record<string, unknown>;
	proto.adb = function () { return Buffer.from("ping\n"); };
	proto.getDumpsysActivity = function () {
		return JSON.stringify({ resumed: "ActivityRecord{... LoginActivity}", focused: null, topResumed: null });
	};
	proto.getDumpsysWindow = function () {
		return JSON.stringify({ currentFocus: null, inputMethodTarget: null });
	};
};

const installMockSession = (deviceId: string, lines: string[]) => {
	const session = {
		id: "mock-session",
		deviceId,
		process: { kill: () => { /* noop */ } } as unknown,
		buffer: lines,
		startTime: Date.now(),
		maxDuration: 60_000,
		tags: ["ATP_SCREEN", "ATP_RENDER", "ATP_API"],
		timer: setTimeout(() => { /* noop */ }, 60_000),
	};
	(AndroidRobot as unknown as { getSessionByDevice: (id: string) => unknown }).getSessionByDevice =
		(id: string) => (id === deviceId ? session : undefined);
};

// ─── Tests ──────────────────────────────────────────────────────────

describe("TextTier — C2 no-op SUCCESS removal", () => {
	beforeEach(() => {
		installMockAdb();
	});

	afterEach(() => {
		mock.restoreAll();
	});

	it("falls back when expectedLogcat is undefined and skipVerification is not set", async () => {
		const tier = new TextTier();
		const ctx = makeContext({ step: { action: "tap", verification: "x", expectedLogcat: undefined } });

		const result = await tier.execute(ctx);

		assert.strictEqual(result.status, "FALLBACK");
		assert.match(result.fallbackHint ?? "", /TextTier cannot verify or act/);
	});

	it("falls back when expectedLogcat is empty array and skipVerification is not set", async () => {
		const tier = new TextTier();
		const ctx = makeContext({ step: { action: "tap", verification: "x", expectedLogcat: [] } });

		const result = await tier.execute(ctx);

		assert.strictEqual(result.status, "FALLBACK");
	});

	it("succeeds on dumpsys-only when skipVerification is explicitly true", async () => {
		const tier = new TextTier();
		const ctx = makeContext({ step: { action: "tap", verification: "x", expectedLogcat: undefined, skipVerification: true } });

		const result = await tier.execute(ctx);

		assert.strictEqual(result.status, "SUCCESS");
		assert.match(result.observation ?? "", /skipVerification=true/);
	});

	it("matches expectedLogcat against active session and returns SUCCESS on full match", async () => {
		installMockSession("emulator-5554", [
			"04-17 12:00:00.000 D/ATP_SCREEN(1234): enter: LoginActivity",
		]);
		const tier = new TextTier();
		const ctx = makeContext({
			step: {
				action: "launch",
				verification: "login screen",
				expectedLogcat: [{ tag: "ATP_SCREEN", pattern: "enter: LoginActivity" }],
			},
		});

		const result = await tier.execute(ctx);

		assert.strictEqual(result.status, "SUCCESS");
		assert.strictEqual(result.verification?.passed, true);
	});

	it("returns FALLBACK when no logcat session exists for the device", async () => {
		(AndroidRobot as unknown as { getSessionByDevice: (id: string) => unknown }).getSessionByDevice = () => undefined;
		const tier = new TextTier();
		const ctx = makeContext({
			step: {
				action: "launch",
				verification: "x",
				expectedLogcat: [{ tag: "ATP_SCREEN", pattern: "enter: X" }],
			},
		});

		const result = await tier.execute(ctx);

		assert.strictEqual(result.status, "FALLBACK");
		assert.match(result.fallbackHint ?? "", /No active logcat session/);
	});
});
