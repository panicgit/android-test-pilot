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

import fs from "node:fs";
import path from "node:path";
import { AbstractTier } from "./abstract-tier";
import { TierContext, TierResult } from "./types";
import { trace } from "../logger";

const DEFAULT_THRESHOLD = 0.01; // 1% of pixels may differ

const resolveBaselineDir = (): string => {
	const root = process.env.ATP_PROJECT_ROOT?.trim() ?? process.cwd();
	return path.join(path.resolve(root), ".claude", "baselines");
};

interface PngJs {
	PNG: new (opts?: { width: number; height: number }) => {
		parse: (buf: Buffer, cb: (err: Error | null, data: { width: number; height: number; data: Buffer }) => void) => void;
		width: number;
		height: number;
		data: Buffer;
	};
}

const loadPixelmatch = (): ((...args: unknown[]) => number) | null => {
	try {
		const mod = require("pixelmatch");
		return mod.default ?? mod;
	} catch {
		return null;
	}
};

const loadPngjs = (): PngJs | null => {
	try {
		return require("pngjs");
	} catch {
		return null;
	}
};

const decodePng = (buf: Buffer, pngjs: PngJs): Promise<{ width: number; height: number; data: Buffer }> =>
	new Promise((resolve, reject) => {
		const png = new pngjs.PNG();
		png.parse(buf, (err, data) => {
			if (err) reject(err);
			else resolve({ width: data.width, height: data.height, data: data.data });
		});
	});

export class SnapshotTier extends AbstractTier {
	readonly name = "snapshot";
	// Priority 0 — SnapshotTier preempts TextTier when the step declares a
	// visual assertion. It sits in front of the runner for steps whose
	// contract is "the pixels must look right", where a TextTier pass would
	// be a false green.
	readonly priority = 0;

	async canHandle(context: TierContext): Promise<boolean> {
		if (context.phase === "act") return false;
		if (!context.step.expectedSnapshot) return false;
		// Require the optional deps; if missing, let the chain fall through.
		if (loadPixelmatch() === null || loadPngjs() === null) {
			trace("SnapshotTier: pixelmatch/pngjs not installed — FALLBACK");
			return false;
		}
		return true;
	}

	async execute(context: TierContext): Promise<TierResult> {
		const expected = context.step.expectedSnapshot!;
		const threshold = expected.threshold ?? DEFAULT_THRESHOLD;
		const createIfMissing = expected.createIfMissing ?? true;

		const pixelmatch = loadPixelmatch();
		const pngjs = loadPngjs();
		if (!pixelmatch || !pngjs) {
			return {
				tier: this.name,
				status: "FALLBACK",
				fallbackHint: "pixelmatch and pngjs are required for snapshot verification. Install them or remove expectedSnapshot from the step.",
			};
		}

		// Filename hardening — refuse anything that could escape the
		// baselines directory.
		if (!/^[A-Za-z0-9._-]+$/.test(expected.name)) {
			return {
				tier: this.name,
				status: "ERROR",
				error: `Invalid snapshot name "${expected.name}". Allowed: alphanumerics, dot, underscore, hyphen.`,
			};
		}

		const baselineDir = resolveBaselineDir();
		const baselinePath = path.join(baselineDir, `${expected.name}.png`);
		const diffPath = path.join(baselineDir, `${expected.name}.diff.png`);

		const robot = this.getAndroidRobot(context);
		let currentBuf: Buffer;
		try {
			currentBuf = await robot.getScreenshot();
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return { tier: this.name, status: "ERROR", error: `Screenshot capture failed: ${msg}` };
		}

		if (!currentBuf || currentBuf.length === 0) {
			return { tier: this.name, status: "ERROR", error: "Screenshot capture returned empty buffer" };
		}

		let baselineBuf: Buffer | null = null;
		try {
			baselineBuf = fs.readFileSync(baselinePath);
		} catch (err: unknown) {
			if ((err as { code?: string })?.code === "ENOENT") {
				if (!createIfMissing) {
					return {
						tier: this.name,
						status: "FAIL",
						observation: `No baseline at ${baselinePath} and createIfMissing is false.`,
						verification: {
							passed: false,
							expected: `baseline "${expected.name}"`,
							actual: "missing baseline",
						},
					};
				}
				fs.mkdirSync(baselineDir, { recursive: true });
				fs.writeFileSync(baselinePath, currentBuf);
				trace(`SnapshotTier: created baseline ${baselinePath}`);
				return {
					tier: this.name,
					status: "SUCCESS",
					observation: `Baseline created at ${baselinePath} (${currentBuf.length} bytes). Subsequent runs will diff against this.`,
					verification: {
						passed: true,
						expected: `baseline "${expected.name}" (auto-created)`,
						actual: "captured",
					},
				};
			}
			const msg = err instanceof Error ? err.message : String(err);
			return { tier: this.name, status: "ERROR", error: `Baseline read failed: ${msg}` };
		}

		// Decode both PNGs.
		const [current, baseline] = await Promise.all([
			decodePng(currentBuf, pngjs),
			decodePng(baselineBuf, pngjs),
		]);

		if (current.width !== baseline.width || current.height !== baseline.height) {
			return {
				tier: this.name,
				status: "FAIL",
				observation: `Dimension mismatch: baseline ${baseline.width}x${baseline.height}, current ${current.width}x${current.height}`,
				verification: {
					passed: false,
					expected: `${baseline.width}x${baseline.height}`,
					actual: `${current.width}x${current.height}`,
				},
			};
		}

		const diffData = Buffer.alloc(current.width * current.height * 4);
		const diffPixels = pixelmatch(
			baseline.data,
			current.data,
			diffData,
			current.width,
			current.height,
			{ threshold: 0.1 },
		);
		const totalPixels = current.width * current.height;
		const diffRatio = diffPixels / totalPixels;

		if (diffRatio <= threshold) {
			return {
				tier: this.name,
				status: "SUCCESS",
				observation: `Snapshot match: ${diffPixels}/${totalPixels} pixels differ (${(diffRatio * 100).toFixed(3)}%, threshold ${(threshold * 100).toFixed(2)}%)`,
				verification: {
					passed: true,
					expected: `<= ${(threshold * 100).toFixed(2)}% pixel diff`,
					actual: `${(diffRatio * 100).toFixed(3)}%`,
				},
			};
		}

		// Fail — persist the diff image for the user to inspect.
		try {
			const pngOut = new pngjs.PNG({ width: current.width, height: current.height });
			// pngjs instance accepts data + dimensions; it doesn't expose the
			// encoder directly here, so we hand the diff bytes to fs via a
			// separate write of the raw PNG data captured by pixelmatch.
			// For simplicity, write a new PNG using pngjs.
			const PNGCtor = pngjs.PNG as unknown as { sync: { write: (png: { width: number; height: number; data: Buffer }) => Buffer } };
			if (PNGCtor.sync?.write) {
				const encoded = PNGCtor.sync.write({ width: current.width, height: current.height, data: diffData });
				fs.writeFileSync(diffPath, encoded);
			} else {
				// Fallback — write the raw RGBA bytes as a marker so the user sees something.
				fs.writeFileSync(diffPath + ".rgba", diffData);
			}
			void pngOut;
		} catch (err: unknown) {
			trace(`SnapshotTier: failed to persist diff image: ${err instanceof Error ? err.message : String(err)}`);
		}

		return {
			tier: this.name,
			status: "FAIL",
			observation: `Snapshot regression: ${diffPixels}/${totalPixels} pixels differ (${(diffRatio * 100).toFixed(3)}%) above threshold ${(threshold * 100).toFixed(2)}%. Diff image: ${diffPath}`,
			verification: {
				passed: false,
				expected: `<= ${(threshold * 100).toFixed(2)}% pixel diff`,
				actual: `${(diffRatio * 100).toFixed(3)}%`,
			},
		};
	}
}
