"use strict";
/**
 * android-test-pilot — MCP tool registrations specific to this fork.
 *
 * Extracted from server.ts so the upstream mobile-mcp surface (mobile_* tools)
 * and the fork-specific surface (atp_* tools) don't live in one 1000-line
 * file (S3-3 / A6 / A8 / A9). See UPSTREAM.md for fork policy.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAtpTools = exports.SHARED_TIER_RUNNER = void 0;
const zod_1 = require("zod");
const robot_1 = require("./robot");
const android_1 = require("./android");
const types_1 = require("./tiers/types");
const tier_runner_1 = require("./tiers/tier-runner");
const text_tier_1 = require("./tiers/text-tier");
const uiautomator_tier_1 = require("./tiers/uiautomator-tier");
const screenshot_tier_1 = require("./tiers/screenshot-tier");
const snapshot_tier_1 = require("./tiers/snapshot-tier");
const app_map_1 = require("./app-map");
const scenario_1 = require("./scenario");
const logger_1 = require("./logger");
const tracing_1 = require("./tracing");
const node_path_1 = __importDefault(require("node:path"));
// P10 — one runner, three tier instances shared across every atp_run_step
// call. Tiers are stateless after A4, so sharing is safe under concurrency.
exports.SHARED_TIER_RUNNER = new tier_runner_1.TierRunner([
    new snapshot_tier_1.SnapshotTier(), // priority 0 — only runs when expectedSnapshot is set
    new text_tier_1.TextTier(), // priority 1
    new uiautomator_tier_1.UiAutomatorTier(), // priority 2
    new screenshot_tier_1.ScreenshotTier(), // priority 3 — last-resort visual fallback
]);
/** Static-analysis heuristic for catastrophic-backtracking regex patterns (SR-7). */
const isLikelyCatastrophicRegex = (p) => {
    if (/\([^)]*[+*][^)]*\)[+*]/.test(p))
        return true;
    if (/\(\?:?[^)]*\|[^)]*\)[+*]/.test(p) && /[+*]/.test(p))
        return true;
    return false;
};
const registerAtpTools = (deps) => {
    const { tool, getAndroidRobotFromDevice, deviceSchema } = deps;
    const runner = deps.runner ?? exports.SHARED_TIER_RUNNER;
    // ─── Tier 1 text-based tools ────────────────────────────────────
    tool("atp_dumpsys", "ATP Dumpsys", "Get current Activity or Window info via dumpsys. Text-based, fast, no screenshot needed.", {
        device: deviceSchema,
        type: zod_1.z.enum(["activity", "window"]).describe("Type of dumpsys query: 'activity' for current foreground Activity, 'window' for current focused window"),
    }, { readOnlyHint: true }, async ({ device, type }) => {
        const robot = await getAndroidRobotFromDevice(device);
        if (type === "activity") {
            return robot.getDumpsysActivity();
        }
        return robot.getDumpsysWindow();
    });
    tool("atp_logcat_start", "ATP Logcat Start", "Start a logcat streaming session. Collects ATP_ tagged logs in the background. Returns a session ID for reading/stopping. IMPORTANT: atp_run_step will auto-start one if missing, but calling this explicitly lets you control duration and tag filter.", {
        device: deviceSchema,
        tags: zod_1.z.array(zod_1.z.string()).default(["ATP_SCREEN", "ATP_RENDER", "ATP_API"])
            .describe("Logcat tags to filter (default: ATP_SCREEN, ATP_RENDER, ATP_API)"),
        durationSeconds: zod_1.z.coerce.number().int().min(10).max(300).default(60)
            .describe("Max streaming duration in seconds. Auto-stops after this time. Default: 60"),
    }, { readOnlyHint: true }, async ({ device, tags, durationSeconds }) => {
        const robot = await getAndroidRobotFromDevice(device);
        const session = robot.startLogcat(tags, durationSeconds);
        return JSON.stringify({
            sessionId: session.id,
            tags: session.tags,
            maxDurationSeconds: durationSeconds,
            message: "Logcat streaming started. Use atp_logcat_read with sessionId to read logs.",
        });
    });
    tool("atp_logcat_read", "ATP Logcat Read", "Read collected log lines from an active logcat session. Use 'since' for incremental reads. Secrets (bearer tokens, password/token/api_key values, emails, Luhn-valid card numbers) are redacted before return — override with MOBILEMCP_DISABLE_REDACTION=1.", {
        device: deviceSchema,
        sessionId: zod_1.z.string().describe("Session ID returned by atp_logcat_start"),
        since: zod_1.z.coerce.number().int().min(0).optional()
            .describe("Return only lines after this index (for incremental reads). Omit to get all lines."),
    }, { readOnlyHint: true }, async ({ device, sessionId, since }) => {
        const robot = await getAndroidRobotFromDevice(device);
        const session = android_1.AndroidRobot.getSession(sessionId);
        if (session && session.deviceId !== device) {
            throw new robot_1.ActionableError(`Logcat session "${sessionId}" belongs to a different device.`);
        }
        const result = robot.readLogcat(sessionId, since);
        return JSON.stringify({
            lines: result.lines,
            lineCount: result.lineCount,
            redactedCount: result.redactedCount,
            readFrom: since ?? 0,
            message: `${result.lines.length} lines returned (total buffer: ${result.lineCount}${result.redactedCount > 0 ? `, ${result.redactedCount} redacted` : ""})`,
        });
    });
    tool("atp_logcat_stop", "ATP Logcat Stop", "Stop an active logcat streaming session and return summary stats.", {
        device: deviceSchema,
        sessionId: zod_1.z.string().describe("Session ID returned by atp_logcat_start"),
    }, { destructiveHint: true }, async ({ device, sessionId }) => {
        const robot = await getAndroidRobotFromDevice(device);
        const session = android_1.AndroidRobot.getSession(sessionId);
        if (session && session.deviceId !== device) {
            throw new robot_1.ActionableError(`Logcat session "${sessionId}" belongs to a different device.`);
        }
        const stats = robot.stopLogcat(sessionId);
        return JSON.stringify({
            totalLines: stats.totalLines,
            durationMs: stats.durationMs,
            bufferBytes: stats.bufferBytes,
            bytesDropped: stats.bytesDropped,
            message: `Logcat session stopped. Collected ${stats.totalLines} lines (${stats.bufferBytes} bytes${stats.bytesDropped > 0 ? `, dropped ${stats.bytesDropped} bytes due to caps` : ""}) over ${Math.round(stats.durationMs / 1000)}s.`,
        });
    });
    // ─── Scenario validator ────────────────────────────────────────
    tool("atp_validate_scenario", "ATP Validate Scenario", "Validate a scenario file (.json or .md with YAML front-matter) against the android-test-pilot schema. Catches known ATP tag typos (ATP_VIEW vs ATP_RENDER) and bad regex patterns BEFORE they reach atp_run_step. Returns { ok, errors[], warnings[] }.", {
        path: zod_1.z.string().describe("Absolute or project-relative path to the scenario file. Must end in .json or .md."),
    }, { readOnlyHint: true }, async ({ path: scenarioPath }) => {
        const resolved = node_path_1.default.isAbsolute(scenarioPath)
            ? scenarioPath
            : node_path_1.default.resolve(process.cwd(), scenarioPath);
        const result = (0, scenario_1.validateScenarioFile)(resolved);
        return JSON.stringify({
            path: resolved,
            ok: result.ok,
            errors: result.errors,
            warnings: result.warnings,
            stepCount: result.scenario?.steps.length,
        });
    });
    // ─── Tier-based step execution ──────────────────────────────────
    tool("atp_run_step", "ATP Run Step", "Execute a single test step using the 3-tier strategy (text → uiautomator → screenshot). Automatically falls back through tiers when a tier cannot determine the result. Auto-starts a logcat session if expectedLogcat is supplied.", {
        device: deviceSchema,
        action: zod_1.z.string().describe("The action to perform (e.g., 'tap login button', 'enter email')"),
        verification: zod_1.z.string().describe("What to verify after the action (e.g., 'home screen appears')"),
        expectedLogcat: zod_1.z.array(zod_1.z.object({
            tag: zod_1.z.enum(["ATP_SCREEN", "ATP_RENDER", "ATP_API"]).describe("ATP log tag to match"),
            pattern: zod_1.z.string().min(1).max(200).refine((p) => { try {
                new RegExp(p);
                return true;
            }
            catch {
                return false;
            } }, { message: "Invalid regex pattern (max 200 chars; must compile)" }).refine((p) => !isLikelyCatastrophicRegex(p), { message: "Pattern rejected: catastrophic backtracking likely (nested unbounded quantifiers or alternation)" }).describe("Regex pattern to match against log lines (max 200 chars)"),
        })).optional().describe("Expected logcat entries for Tier 1 text-based verification"),
        tapTarget: zod_1.z.object({
            resourceId: zod_1.z.string().optional().describe("Android resource-id to tap"),
            x: zod_1.z.coerce.number().optional().describe("X coordinate to tap"),
            y: zod_1.z.coerce.number().optional().describe("Y coordinate to tap"),
        }).optional().describe("Element to tap during this step"),
        expectedSnapshot: zod_1.z.object({
            name: zod_1.z.string().regex(/^[A-Za-z0-9._-]+$/).describe("Baseline identifier. Stored at .claude/baselines/{name}.png"),
            threshold: zod_1.z.number().min(0).max(1).optional().describe("Max share of differing pixels (0-1). Default 0.01."),
            createIfMissing: zod_1.z.boolean().optional().describe("Auto-capture the baseline on first run. Default true."),
        }).optional().describe("Visual-regression assertion. When set, SnapshotTier pixel-diffs against a stored baseline. Intentionally preempts TextTier so a pixel regression can't pass on logcat alone."),
        skipVerification: zod_1.z.boolean().optional().describe("Accept dumpsys-only success when no expectedLogcat is provided. Default false (FALLBACK to next tier)."),
    }, { destructiveHint: true }, async ({ device, action, verification, expectedLogcat, tapTarget, expectedSnapshot, skipVerification }) => {
        const robot = await getAndroidRobotFromDevice(device);
        if (expectedLogcat && expectedLogcat.length > 0) {
            try {
                robot.ensureLogcatSession();
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                (0, logger_1.trace)(`atp_run_step: ensureLogcatSession warning: ${message}`);
            }
        }
        const { appMap, warnings: appMapWarnings } = (0, app_map_1.loadAppMap)();
        const context = {
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
                expectedSnapshot: expectedSnapshot ? {
                    name: expectedSnapshot.name,
                    threshold: expectedSnapshot.threshold,
                    createIfMissing: expectedSnapshot.createIfMissing,
                } : undefined,
                skipVerification,
            },
            appMap,
        };
        // A5 — split action from verification. Wrapped in a trace so the
        // agent (and operators reading $ATP_TRACE_FILE) can see tier
        // decisions and per-phase latency (A10 / S3-4).
        const tracer = new tracing_1.TraceContext();
        const hasAction = !!tapTarget;
        const hasVerification = !!(expectedLogcat && expectedLogcat.length > 0);
        const runPhase = (phase) => tracer.span(`atp.tier_runner.${phase}`, {
            "atp.phase": phase,
            "atp.device_id": device,
        }, () => runner.run({ ...context, phase }));
        if (hasAction && hasVerification) {
            const actResult = await runPhase("act");
            if (actResult.status === "FAIL" || actResult.status === "ERROR") {
                return JSON.stringify({
                    phase: "act",
                    ...(0, types_1.flattenTierResult)(actResult),
                    appMapWarnings: appMapWarnings.length > 0 ? appMapWarnings : undefined,
                    traceSummary: tracer.summary(),
                });
            }
            await tracer.span("atp.settle_delay", { "atp.settle_ms": 300 }, async () => {
                await new Promise(resolve => setTimeout(resolve, 300));
            });
            const verifyResult = await runPhase("verify");
            return JSON.stringify({
                actResult: (0, types_1.flattenTierResult)(actResult),
                verifyResult: (0, types_1.flattenTierResult)(verifyResult),
                ...(0, types_1.flattenTierResult)(verifyResult),
                appMapWarnings: appMapWarnings.length > 0 ? appMapWarnings : undefined,
                traceSummary: tracer.summary(),
            });
        }
        const phase = hasAction && !hasVerification ? "act" : "verify";
        const result = await runPhase(phase);
        return JSON.stringify({
            phase,
            ...(0, types_1.flattenTierResult)(result),
            appMapWarnings: appMapWarnings.length > 0 ? appMapWarnings : undefined,
            traceSummary: tracer.summary(),
        });
    });
};
exports.registerAtpTools = registerAtpTools;
//# sourceMappingURL=atp-tools.js.map