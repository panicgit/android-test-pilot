/**
 * android-test-pilot — MCP tool registrations specific to this fork.
 *
 * Extracted from server.ts so the upstream mobile-mcp surface (mobile_* tools)
 * and the fork-specific surface (atp_* tools) don't live in one 1000-line
 * file (S3-3 / A6 / A8 / A9). See UPSTREAM.md for fork policy.
 */

import { z } from "zod";
import { ActionableError } from "./robot";
import { AndroidRobot } from "./android";
import { TierContext, flattenTierResult } from "./tiers/types";
import { TierRunner } from "./tiers/tier-runner";
import { TextTier } from "./tiers/text-tier";
import { UiAutomatorTier } from "./tiers/uiautomator-tier";
import { ScreenshotTier } from "./tiers/screenshot-tier";
import { loadAppMap } from "./app-map";
import { trace } from "./logger";

// P10 — one runner, three tier instances shared across every atp_run_step
// call. Tiers are stateless after A4, so sharing is safe under concurrency.
export const SHARED_TIER_RUNNER = new TierRunner([
	new TextTier(),
	new UiAutomatorTier(),
	new ScreenshotTier(),
]);

// Generic parameters that mirror server.ts's tool() helper without
// re-exporting it.
type ZodSchemaShape = Record<string, z.ZodType>;
export type AtpToolFactory = <S extends ZodSchemaShape>(
	name: string,
	title: string,
	description: string,
	paramsSchema: S,
	annotations: { readOnlyHint?: boolean; destructiveHint?: boolean },
	cb: (args: z.infer<z.ZodObject<S>>) => Promise<string>,
) => void;

export interface AtpToolsDeps {
	/** The `tool()` helper exposed by createMcpServer(). */
	tool: AtpToolFactory;
	/** Device resolver that guarantees an AndroidRobot or throws. */
	getAndroidRobotFromDevice: (deviceId: string) => Promise<AndroidRobot>;
	/** Shared device-identifier schema. */
	deviceSchema: z.ZodType<string>;
	/** Shared TierRunner instance (defaults to SHARED_TIER_RUNNER; inject in tests). */
	runner?: TierRunner;
}

/** Static-analysis heuristic for catastrophic-backtracking regex patterns (SR-7). */
const isLikelyCatastrophicRegex = (p: string): boolean => {
	if (/\([^)]*[+*][^)]*\)[+*]/.test(p)) return true;
	if (/\(\?:?[^)]*\|[^)]*\)[+*]/.test(p) && /[+*]/.test(p)) return true;
	return false;
};

export const registerAtpTools = (deps: AtpToolsDeps): void => {
	const { tool, getAndroidRobotFromDevice, deviceSchema } = deps;
	const runner = deps.runner ?? SHARED_TIER_RUNNER;

	// ─── Tier 1 text-based tools ────────────────────────────────────

	tool(
		"atp_dumpsys",
		"ATP Dumpsys",
		"Get current Activity or Window info via dumpsys. Text-based, fast, no screenshot needed.",
		{
			device: deviceSchema,
			type: z.enum(["activity", "window"]).describe("Type of dumpsys query: 'activity' for current foreground Activity, 'window' for current focused window"),
		},
		{ readOnlyHint: true },
		async ({ device, type }) => {
			const robot = await getAndroidRobotFromDevice(device);
			if (type === "activity") {
				return robot.getDumpsysActivity();
			}
			return robot.getDumpsysWindow();
		},
	);

	tool(
		"atp_logcat_start",
		"ATP Logcat Start",
		"Start a logcat streaming session. Collects ATP_ tagged logs in the background. Returns a session ID for reading/stopping. IMPORTANT: atp_run_step will auto-start one if missing, but calling this explicitly lets you control duration and tag filter.",
		{
			device: deviceSchema,
			tags: z.array(z.string()).default(["ATP_SCREEN", "ATP_RENDER", "ATP_API"])
				.describe("Logcat tags to filter (default: ATP_SCREEN, ATP_RENDER, ATP_API)"),
			durationSeconds: z.coerce.number().int().min(10).max(300).default(60)
				.describe("Max streaming duration in seconds. Auto-stops after this time. Default: 60"),
		},
		{ readOnlyHint: true },
		async ({ device, tags, durationSeconds }) => {
			const robot = await getAndroidRobotFromDevice(device);
			const session = robot.startLogcat(tags, durationSeconds);
			return JSON.stringify({
				sessionId: session.id,
				tags: session.tags,
				maxDurationSeconds: durationSeconds,
				message: "Logcat streaming started. Use atp_logcat_read with sessionId to read logs.",
			});
		},
	);

	tool(
		"atp_logcat_read",
		"ATP Logcat Read",
		"Read collected log lines from an active logcat session. Use 'since' for incremental reads. Secrets (bearer tokens, password/token/api_key values, emails, Luhn-valid card numbers) are redacted before return — override with MOBILEMCP_DISABLE_REDACTION=1.",
		{
			device: deviceSchema,
			sessionId: z.string().describe("Session ID returned by atp_logcat_start"),
			since: z.coerce.number().int().min(0).optional()
				.describe("Return only lines after this index (for incremental reads). Omit to get all lines."),
		},
		{ readOnlyHint: true },
		async ({ device, sessionId, since }) => {
			const robot = await getAndroidRobotFromDevice(device);
			const session = AndroidRobot.getSession(sessionId);
			if (session && session.deviceId !== device) {
				throw new ActionableError(`Logcat session "${sessionId}" belongs to a different device.`);
			}
			const result = robot.readLogcat(sessionId, since);
			return JSON.stringify({
				lines: result.lines,
				lineCount: result.lineCount,
				redactedCount: result.redactedCount,
				readFrom: since ?? 0,
				message: `${result.lines.length} lines returned (total buffer: ${result.lineCount}${result.redactedCount > 0 ? `, ${result.redactedCount} redacted` : ""})`,
			});
		},
	);

	tool(
		"atp_logcat_stop",
		"ATP Logcat Stop",
		"Stop an active logcat streaming session and return summary stats.",
		{
			device: deviceSchema,
			sessionId: z.string().describe("Session ID returned by atp_logcat_start"),
		},
		{ destructiveHint: true },
		async ({ device, sessionId }) => {
			const robot = await getAndroidRobotFromDevice(device);
			const session = AndroidRobot.getSession(sessionId);
			if (session && session.deviceId !== device) {
				throw new ActionableError(`Logcat session "${sessionId}" belongs to a different device.`);
			}
			const stats = robot.stopLogcat(sessionId);
			return JSON.stringify({
				totalLines: stats.totalLines,
				durationMs: stats.durationMs,
				bufferBytes: stats.bufferBytes,
				bytesDropped: stats.bytesDropped,
				message: `Logcat session stopped. Collected ${stats.totalLines} lines (${stats.bufferBytes} bytes${stats.bytesDropped > 0 ? `, dropped ${stats.bytesDropped} bytes due to caps` : ""}) over ${Math.round(stats.durationMs / 1000)}s.`,
			});
		},
	);

	// ─── Tier-based step execution ──────────────────────────────────

	tool(
		"atp_run_step",
		"ATP Run Step",
		"Execute a single test step using the 3-tier strategy (text → uiautomator → screenshot). Automatically falls back through tiers when a tier cannot determine the result. Auto-starts a logcat session if expectedLogcat is supplied.",
		{
			device: deviceSchema,
			action: z.string().describe("The action to perform (e.g., 'tap login button', 'enter email')"),
			verification: z.string().describe("What to verify after the action (e.g., 'home screen appears')"),
			expectedLogcat: z.array(z.object({
				tag: z.enum(["ATP_SCREEN", "ATP_RENDER", "ATP_API"]).describe("ATP log tag to match"),
				pattern: z.string().min(1).max(200).refine(
					(p) => { try { new RegExp(p); return true; } catch { return false; } },
					{ message: "Invalid regex pattern (max 200 chars; must compile)" },
				).refine(
					(p) => !isLikelyCatastrophicRegex(p),
					{ message: "Pattern rejected: catastrophic backtracking likely (nested unbounded quantifiers or alternation)" },
				).describe("Regex pattern to match against log lines (max 200 chars)"),
			})).optional().describe("Expected logcat entries for Tier 1 text-based verification"),
			tapTarget: z.object({
				resourceId: z.string().optional().describe("Android resource-id to tap"),
				x: z.coerce.number().optional().describe("X coordinate to tap"),
				y: z.coerce.number().optional().describe("Y coordinate to tap"),
			}).optional().describe("Element to tap during this step"),
			skipVerification: z.boolean().optional().describe("Accept dumpsys-only success when no expectedLogcat is provided. Default false (FALLBACK to next tier)."),
		},
		{ destructiveHint: true },
		async ({ device, action, verification, expectedLogcat, tapTarget, skipVerification }) => {
			const robot = await getAndroidRobotFromDevice(device);

			if (expectedLogcat && expectedLogcat.length > 0) {
				try {
					robot.ensureLogcatSession();
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);
					trace(`atp_run_step: ensureLogcatSession warning: ${message}`);
				}
			}

			const { appMap, warnings: appMapWarnings } = loadAppMap();

			const context: TierContext = {
				deviceId: device,
				step: {
					action,
					verification,
					expectedLogcat: expectedLogcat?.map(e => ({ tag: e.tag, pattern: e.pattern })),
					tapTarget: tapTarget ? {
						resourceId: tapTarget.resourceId,
						coordinates: (tapTarget.x !== undefined && tapTarget.y !== undefined)
							? { x: tapTarget.x, y: tapTarget.y }
							: undefined,
					} : undefined,
					skipVerification,
				},
				appMap,
			};

			// A5 — split action from verification.
			const hasAction = !!tapTarget;
			const hasVerification = !!(expectedLogcat && expectedLogcat.length > 0);

			if (hasAction && hasVerification) {
				const actResult = await runner.run({ ...context, phase: "act" });
				if (actResult.status === "FAIL" || actResult.status === "ERROR") {
					return JSON.stringify({
						phase: "act",
						...flattenTierResult(actResult),
						appMapWarnings: appMapWarnings.length > 0 ? appMapWarnings : undefined,
					});
				}
				await new Promise(resolve => setTimeout(resolve, 300));
				const verifyResult = await runner.run({ ...context, phase: "verify" });
				return JSON.stringify({
					actResult: flattenTierResult(actResult),
					verifyResult: flattenTierResult(verifyResult),
					...flattenTierResult(verifyResult),
					appMapWarnings: appMapWarnings.length > 0 ? appMapWarnings : undefined,
				});
			}

			const phase: "act" | "verify" = hasAction && !hasVerification ? "act" : "verify";
			const result = await runner.run({ ...context, phase });

			return JSON.stringify({
				phase,
				...flattenTierResult(result),
				appMapWarnings: appMapWarnings.length > 0 ? appMapWarnings : undefined,
			});
		},
	);
};
