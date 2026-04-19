import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SnapshotTier } from "../src/tiers/snapshot-tier";
import { TierContext } from "../src/tiers/types";
import { AndroidRobot } from "../src/android";
import { PNG } from "pngjs";

const makePng = (w: number, h: number, fillRgba: [number, number, number, number]): Buffer => {
	const png = new PNG({ width: w, height: h });
	for (let i = 0; i < w * h; i++) {
		png.data[i * 4]     = fillRgba[0];
		png.data[i * 4 + 1] = fillRgba[1];
		png.data[i * 4 + 2] = fillRgba[2];
		png.data[i * 4 + 3] = fillRgba[3];
	}
	return PNG.sync.write(png);
};

let tmpRoot: string;

beforeEach(() => {
	tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atp-snap-"));
	process.env.ATP_PROJECT_ROOT = tmpRoot;
});

afterEach(() => {
	delete process.env.ATP_PROJECT_ROOT;
	fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const makeContext = (overrides?: Partial<TierContext>): TierContext => ({
	deviceId: "emulator-5554",
	step: { action: "", verification: "" },
	appMap: { navigationMap: "", apiScenarios: [], viewStateMap: [] },
	...overrides,
});

const installScreenshot = (buf: Buffer) => {
	const proto = AndroidRobot.prototype as unknown as Record<string, unknown>;
	proto.getScreenshot = async function () { return buf; };
};

describe("SnapshotTier (S3-5 / C5)", () => {
	it("canHandle returns false without expectedSnapshot", async () => {
		const tier = new SnapshotTier();
		assert.strictEqual(await tier.canHandle(makeContext()), false);
	});

	it("canHandle returns false in act phase even with expectedSnapshot", async () => {
		const tier = new SnapshotTier();
		const ctx = makeContext({
			phase: "act",
			step: { action: "", verification: "", expectedSnapshot: { name: "x" } },
		});
		assert.strictEqual(await tier.canHandle(ctx), false);
	});

	it("creates baseline on first run when missing", async () => {
		const img = makePng(10, 10, [255, 0, 0, 255]);
		installScreenshot(img);
		const tier = new SnapshotTier();
		const ctx = makeContext({
			phase: "verify",
			step: { action: "", verification: "", expectedSnapshot: { name: "home" } },
		});

		const result = await tier.execute(ctx);

		assert.strictEqual(result.status, "SUCCESS");
		const baselinePath = path.join(tmpRoot, ".claude", "baselines", "home.png");
		assert.ok(fs.existsSync(baselinePath));
	});

	it("SUCCEEDS when current matches baseline exactly", async () => {
		const img = makePng(10, 10, [0, 128, 255, 255]);
		fs.mkdirSync(path.join(tmpRoot, ".claude", "baselines"), { recursive: true });
		fs.writeFileSync(path.join(tmpRoot, ".claude", "baselines", "same.png"), img);
		installScreenshot(img);

		const tier = new SnapshotTier();
		const ctx = makeContext({
			phase: "verify",
			step: { action: "", verification: "", expectedSnapshot: { name: "same" } },
		});

		const result = await tier.execute(ctx);
		assert.strictEqual(result.status, "SUCCESS");
		assert.strictEqual(result.verification?.passed, true);
	});

	it("FAILS when current diverges beyond threshold", async () => {
		const baseline = makePng(10, 10, [255, 0, 0, 255]);
		const changed = makePng(10, 10, [0, 255, 0, 255]); // 100% diff
		fs.mkdirSync(path.join(tmpRoot, ".claude", "baselines"), { recursive: true });
		fs.writeFileSync(path.join(tmpRoot, ".claude", "baselines", "diff.png"), baseline);
		installScreenshot(changed);

		const tier = new SnapshotTier();
		const ctx = makeContext({
			phase: "verify",
			step: { action: "", verification: "", expectedSnapshot: { name: "diff", threshold: 0.01 } },
		});

		const result = await tier.execute(ctx);
		assert.strictEqual(result.status, "FAIL");
		assert.strictEqual(result.verification?.passed, false);
	});

	it("FAILS on dimension mismatch", async () => {
		const baseline = makePng(10, 10, [255, 0, 0, 255]);
		const wrongSize = makePng(20, 10, [255, 0, 0, 255]);
		fs.mkdirSync(path.join(tmpRoot, ".claude", "baselines"), { recursive: true });
		fs.writeFileSync(path.join(tmpRoot, ".claude", "baselines", "dim.png"), baseline);
		installScreenshot(wrongSize);

		const tier = new SnapshotTier();
		const ctx = makeContext({
			phase: "verify",
			step: { action: "", verification: "", expectedSnapshot: { name: "dim" } },
		});

		const result = await tier.execute(ctx);
		assert.strictEqual(result.status, "FAIL");
		assert.match(result.observation ?? "", /Dimension mismatch/);
	});

	it("rejects names with path-traversal characters", async () => {
		installScreenshot(makePng(2, 2, [0, 0, 0, 255]));
		const tier = new SnapshotTier();
		const ctx = makeContext({
			phase: "verify",
			step: { action: "", verification: "", expectedSnapshot: { name: "../etc/passwd" } },
		});

		const result = await tier.execute(ctx);
		assert.strictEqual(result.status, "ERROR");
		assert.match(result.error ?? "", /Invalid snapshot name/);
	});
});
