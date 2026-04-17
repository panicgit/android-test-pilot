/**
 * Bench harness — offline tier-routing benchmark.
 *
 * Loads scenarios from bench/scenarios/*.json, runs each step through a mocked
 * AndroidRobot, and records which tier resolved the step. Produces a JSON
 * report used as a regression baseline before/after PRs.
 *
 * Run: npm run bench
 *      npm run bench -- --scenario login
 *      npm run bench -- --compare bench/results/baseline.json
 */

import fs from "node:fs";
import path from "node:path";
import { TierRunner } from "../src/tiers/tier-runner";
import { TextTier } from "../src/tiers/text-tier";
import { UiAutomatorTier } from "../src/tiers/uiautomator-tier";
import { ScreenshotTier } from "../src/tiers/screenshot-tier";
import { TierContext, TierResult, ExpectedLogcat, TapTarget } from "../src/tiers/types";
import { AndroidRobot } from "../src/android";

interface BenchStep {
	action: string;
	verification: string;
	expectedLogcat?: ExpectedLogcat[];
	tapTarget?: TapTarget;
	mockLogcatLines: string[];
	mockDumpsysActivity?: string;
	mockDumpsysWindow?: string;
}

interface BenchScenario {
	name: string;
	description: string;
	steps: BenchStep[];
}

interface StepResult {
	stepIndex: number;
	action: string;
	tier: string;
	status: string;
	durationMs: number;
}

interface ScenarioReport {
	name: string;
	totalSteps: number;
	tierBreakdown: Record<string, number>;
	tier1Ratio: number;
	tier2Ratio: number;
	tier3Ratio: number;
	avgStepLatencyMs: number;
	failedSteps: number;
	stepResults: StepResult[];
}

interface BenchReport {
	version: string;
	timestamp: string;
	scenarios: ScenarioReport[];
	totals: {
		tier1Ratio: number;
		tier2Ratio: number;
		tier3Ratio: number;
		avgLatencyMs: number;
	};
}

/**
 * Install a mock AndroidRobot for a single step. Replaces the methods that
 * tiers call so the benchmark runs without a real device.
 */
const installMockRobot = (deviceId: string, step: BenchStep): void => {
	const proto = AndroidRobot.prototype as unknown as Record<string, unknown>;

	proto.adb = function (...args: string[]): Buffer {
		// echo ping for canHandle
		if (args[0] === "shell" && args[1] === "echo") {
			return Buffer.from("ping\n");
		}
		return Buffer.from("");
	};

	proto.getDumpsysActivity = function (): string {
		return step.mockDumpsysActivity ?? JSON.stringify({ resumed: null, focused: null, topResumed: null });
	};

	proto.getDumpsysWindow = function (): string {
		return step.mockDumpsysWindow ?? JSON.stringify({ currentFocus: null, inputMethodTarget: null });
	};

	proto.getElementsOnScreen = async function () {
		// Return one element matching the tapTarget.resourceId if present;
		// otherwise a single generic element so the hierarchy isn't empty
		// (a real device's hierarchy is never empty).
		if (step.tapTarget?.resourceId) {
			return [{
				type: "Button",
				text: "",
				label: "",
				identifier: step.tapTarget.resourceId,
				rect: { x: 100, y: 200, width: 200, height: 80 },
			}];
		}
		return [{
			type: "FrameLayout",
			text: "",
			label: "",
			identifier: "",
			rect: { x: 0, y: 0, width: 1080, height: 2340 },
		}];
	};

	proto.tap = async function () { /* mock */ };
	// Minimal valid PNG (8-byte signature + IHDR + IDAT + IEND) so
	// ScreenshotTier's resize path doesn't fail in the bench.
	const MINIMAL_PNG = Buffer.from([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
		0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
		0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
		0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
		0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
		0x42, 0x60, 0x82,
	]);
	proto.getScreenshot = async function () { return MINIMAL_PNG; };

	// Inject a mock logcat session into the static map
	const session = {
		id: `mock-${Date.now()}`,
		deviceId,
		process: { kill: () => {} } as unknown,
		buffer: step.mockLogcatLines,
		startTime: Date.now(),
		maxDuration: 60_000,
		tags: ["ATP_SCREEN", "ATP_RENDER", "ATP_API"],
		timer: setTimeout(() => {}, 60_000),
	};
	(AndroidRobot as unknown as { _benchSession: typeof session })._benchSession = session;

	// Override getSessionByDevice to return our mock
	(AndroidRobot as unknown as { getSessionByDevice: (id: string) => unknown }).getSessionByDevice =
		(id: string) => (id === deviceId ? session : undefined);
};

const runStep = async (deviceId: string, step: BenchStep): Promise<StepResult> => {
	installMockRobot(deviceId, step);

	const runner = new TierRunner([new TextTier(), new UiAutomatorTier(), new ScreenshotTier()]);
	const context: TierContext = {
		deviceId,
		step: {
			action: step.action,
			verification: step.verification,
			expectedLogcat: step.expectedLogcat,
			tapTarget: step.tapTarget,
		},
		appMap: { navigationMap: "", apiScenarios: [], viewStateMap: [] },
	};

	const start = Date.now();
	let result: TierResult;
	try {
		result = await runner.run(context);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		result = { tier: "error", status: "ERROR", error: message };
	}
	const durationMs = Date.now() - start;

	return {
		stepIndex: 0,
		action: step.action,
		tier: result.tier,
		status: result.status,
		durationMs,
	};
};

const runScenario = async (scenario: BenchScenario): Promise<ScenarioReport> => {
	const stepResults: StepResult[] = [];
	for (let i = 0; i < scenario.steps.length; i++) {
		const r = await runStep("emulator-5554", scenario.steps[i]);
		r.stepIndex = i;
		stepResults.push(r);
	}

	const breakdown: Record<string, number> = {};
	for (const r of stepResults) {
		breakdown[r.tier] = (breakdown[r.tier] ?? 0) + 1;
	}

	const total = stepResults.length;
	const failed = stepResults.filter(r => r.status !== "SUCCESS").length;
	const avgLatency = total > 0 ? stepResults.reduce((s, r) => s + r.durationMs, 0) / total : 0;

	return {
		name: scenario.name,
		totalSteps: total,
		tierBreakdown: breakdown,
		tier1Ratio: total > 0 ? (breakdown.text ?? 0) / total : 0,
		tier2Ratio: total > 0 ? (breakdown.uiautomator ?? 0) / total : 0,
		tier3Ratio: total > 0 ? (breakdown.screenshot ?? 0) / total : 0,
		avgStepLatencyMs: Math.round(avgLatency),
		failedSteps: failed,
		stepResults,
	};
};

const loadScenarios = (filter?: string): BenchScenario[] => {
	const dir = path.join(__dirname, "scenarios");
	const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));
	const scenarios: BenchScenario[] = [];
	for (const f of files) {
		const data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as BenchScenario;
		if (!filter || data.name === filter) scenarios.push(data);
	}
	return scenarios;
};

const compareReports = (current: BenchReport, baselinePath: string): void => {
	if (!fs.existsSync(baselinePath)) {
		console.error(`Baseline not found: ${baselinePath}`);
		process.exit(1);
	}
	const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8")) as BenchReport;

	console.log("\n─── Comparison vs baseline ───────────────────────");
	console.log(`Tier1 ratio:  ${baseline.totals.tier1Ratio.toFixed(2)} → ${current.totals.tier1Ratio.toFixed(2)}`);
	console.log(`Tier2 ratio:  ${baseline.totals.tier2Ratio.toFixed(2)} → ${current.totals.tier2Ratio.toFixed(2)}`);
	console.log(`Tier3 ratio:  ${baseline.totals.tier3Ratio.toFixed(2)} → ${current.totals.tier3Ratio.toFixed(2)}`);
	console.log(`Avg latency:  ${baseline.totals.avgLatencyMs}ms → ${current.totals.avgLatencyMs}ms`);

	const tier1Drop = baseline.totals.tier1Ratio - current.totals.tier1Ratio;
	const latencyRise = current.totals.avgLatencyMs - baseline.totals.avgLatencyMs;
	const latencyRisePct = baseline.totals.avgLatencyMs > 0 ? latencyRise / baseline.totals.avgLatencyMs : 0;

	if (tier1Drop > 0.05) {
		console.error(`\n❌ REGRESSION: Tier 1 ratio dropped by ${(tier1Drop * 100).toFixed(1)}% (>5% threshold)`);
		process.exit(1);
	}
	if (latencyRisePct > 0.20) {
		console.error(`\n❌ REGRESSION: Avg latency rose by ${(latencyRisePct * 100).toFixed(1)}% (>20% threshold)`);
		process.exit(1);
	}
	console.log("\n✅ No regression detected.");
};

const main = async (): Promise<void> => {
	const args = process.argv.slice(2);
	const scenarioIdx = args.indexOf("--scenario");
	const compareIdx = args.indexOf("--compare");
	const scenarioFilter = scenarioIdx >= 0 ? args[scenarioIdx + 1] : undefined;
	const comparePath = compareIdx >= 0 ? args[compareIdx + 1] : undefined;

	const scenarios = loadScenarios(scenarioFilter);
	if (scenarios.length === 0) {
		console.error("No scenarios found.");
		process.exit(1);
	}

	const reports: ScenarioReport[] = [];
	for (const scenario of scenarios) {
		console.log(`\n▶ Running scenario: ${scenario.name} (${scenario.steps.length} steps)`);
		const report = await runScenario(scenario);
		reports.push(report);
		console.log(`  Tier breakdown: ${JSON.stringify(report.tierBreakdown)}`);
		console.log(`  Tier1 ratio:    ${report.tier1Ratio.toFixed(2)}`);
		console.log(`  Avg latency:    ${report.avgStepLatencyMs}ms`);
		console.log(`  Failed steps:   ${report.failedSteps}/${report.totalSteps}`);
	}

	const totalSteps = reports.reduce((s, r) => s + r.totalSteps, 0);
	const totalText = reports.reduce((s, r) => s + (r.tierBreakdown.text ?? 0), 0);
	const totalUi = reports.reduce((s, r) => s + (r.tierBreakdown.uiautomator ?? 0), 0);
	const totalScreen = reports.reduce((s, r) => s + (r.tierBreakdown.screenshot ?? 0), 0);
	const totalLatency = reports.reduce((s, r) => s + r.avgStepLatencyMs * r.totalSteps, 0);

	const fullReport: BenchReport = {
		version: JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")).version,
		timestamp: new Date().toISOString(),
		scenarios: reports,
		totals: {
			tier1Ratio: totalSteps > 0 ? totalText / totalSteps : 0,
			tier2Ratio: totalSteps > 0 ? totalUi / totalSteps : 0,
			tier3Ratio: totalSteps > 0 ? totalScreen / totalSteps : 0,
			avgLatencyMs: totalSteps > 0 ? Math.round(totalLatency / totalSteps) : 0,
		},
	};

	const outDir = path.join(__dirname, "results");
	fs.mkdirSync(outDir, { recursive: true });
	const outPath = path.join(outDir, `run-${Date.now()}.json`);
	fs.writeFileSync(outPath, JSON.stringify(fullReport, null, 2));
	console.log(`\n📄 Saved report: ${outPath}`);
	console.log(`\n─── Totals ───────────────────────────────────────`);
	console.log(`Tier1 ratio:  ${fullReport.totals.tier1Ratio.toFixed(2)}`);
	console.log(`Tier2 ratio:  ${fullReport.totals.tier2Ratio.toFixed(2)}`);
	console.log(`Tier3 ratio:  ${fullReport.totals.tier3Ratio.toFixed(2)}`);
	console.log(`Avg latency:  ${fullReport.totals.avgLatencyMs}ms`);

	if (comparePath) compareReports(fullReport, comparePath);
};

main().catch(err => {
	console.error("Bench failed:", err);
	process.exit(1);
});
