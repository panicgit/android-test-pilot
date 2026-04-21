"use strict";
/**
 * AppMap loader — reads Step 0 artifacts from .claude/app-map/ with mtime-cache,
 * Zod validation, and structured warnings instead of silent empties.
 *
 * Resolution order for the artifact directory:
 *   1. process.env.ATP_PROJECT_ROOT (if set) → joined with .claude/app-map
 *   2. process.cwd() → joined with .claude/app-map
 *
 * See A1 + T9 in IMPROVEMENT_PLAN.md.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports._resetAppMapCache = exports.loadAppMap = exports.resolveAppMapDir = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const zod_1 = require("zod");
const logger_1 = require("./logger");
const ApiCallerSchema = zod_1.z.object({
    file: zod_1.z.string(),
    successHandler: zod_1.z.string(),
    errorHandler: zod_1.z.string(),
});
const ApiScenariosFileSchema = zod_1.z.object({
    apis: zod_1.z.array(zod_1.z.object({
        endpoint: zod_1.z.string(),
        interfaceFile: zod_1.z.string(),
        callers: zod_1.z.array(ApiCallerSchema),
    })),
});
const ViewStateFileSchema = zod_1.z.object({
    screens: zod_1.z.array(zod_1.z.object({
        name: zod_1.z.string(),
        file: zod_1.z.string(),
        states: zod_1.z.array(zod_1.z.object({
            viewId: zod_1.z.string(),
            visibilityCondition: zod_1.z.string(),
            dataSource: zod_1.z.string(),
            sourceFile: zod_1.z.string(),
        })),
    })),
});
let cached = null;
/**
 * Resolve the app-map directory from ATP_PROJECT_ROOT or cwd, then realpath
 * the result and ensure it is contained inside the resolved root. Prevents
 * symlink traversal when ATP_PROJECT_ROOT is set in a multi-tenant harness
 * (SR-5).
 */
const resolveAppMapDir = () => {
    const raw = process.env.ATP_PROJECT_ROOT?.trim();
    const root = raw ? node_path_1.default.resolve(raw) : node_path_1.default.resolve(process.cwd());
    const target = node_path_1.default.join(root, ".claude", "app-map");
    try {
        const realRoot = node_fs_1.default.realpathSync(root);
        if (node_fs_1.default.existsSync(target)) {
            const realTarget = node_fs_1.default.realpathSync(target);
            const containment = node_path_1.default.relative(realRoot, realTarget);
            if (containment.startsWith("..") || node_path_1.default.isAbsolute(containment)) {
                throw new Error(`ATP_PROJECT_ROOT symlink escapes project root: ${realTarget} is outside ${realRoot}`);
            }
        }
    }
    catch (err) {
        // Missing directory on a fresh checkout is fine — the caller surfaces it
        // as a "Missing artifact" warning. Only rethrow containment violations.
        if (err instanceof Error && err.message.startsWith("ATP_PROJECT_ROOT symlink escapes")) {
            throw err;
        }
    }
    return target;
};
exports.resolveAppMapDir = resolveAppMapDir;
/**
 * Read + parse + validate an artifact in a single try/catch — no
 * existsSync-then-readFileSync TOCTOU window (T-R4). ENOENT is treated
 * as "missing", anything else as a warning.
 */
const safeParseJson = (filePath, schema, warnings) => {
    let raw;
    try {
        raw = node_fs_1.default.readFileSync(filePath, "utf-8");
    }
    catch (err) {
        const code = err?.code;
        if (code === "ENOENT") {
            warnings.push(`Missing artifact: ${node_path_1.default.basename(filePath)} at ${filePath}. Run /atp:analyze-app first.`);
        }
        else {
            const msg = err instanceof Error ? err.message : String(err);
            warnings.push(`Failed reading ${node_path_1.default.basename(filePath)}: ${msg}`);
        }
        return null;
    }
    let parsedJson;
    try {
        parsedJson = JSON.parse(raw);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`Invalid JSON in ${node_path_1.default.basename(filePath)}: ${msg}`);
        return null;
    }
    const result = schema.safeParse(parsedJson);
    if (!result.success) {
        warnings.push(`Schema validation failed for ${node_path_1.default.basename(filePath)}: ${result.error.issues.slice(0, 3).map(i => i.message).join("; ")}`);
        return null;
    }
    return result.data;
};
const fileMtime = (p) => {
    try {
        return node_fs_1.default.statSync(p).mtimeMs;
    }
    catch {
        return 0;
    }
};
const loadAppMap = () => {
    const dir = (0, exports.resolveAppMapDir)();
    const navPath = node_path_1.default.join(dir, "navigation_map.mermaid");
    const apiPath = node_path_1.default.join(dir, "api_scenarios.json");
    const viewPath = node_path_1.default.join(dir, "view_state_map.json");
    const latestMtime = Math.max(fileMtime(navPath), fileMtime(apiPath), fileMtime(viewPath));
    if (cached && cached.mtime === latestMtime && cached.result.source === dir) {
        return cached.result;
    }
    const warnings = [];
    let navigationMap = "";
    try {
        navigationMap = node_fs_1.default.readFileSync(navPath, "utf-8");
    }
    catch (err) {
        const code = err?.code;
        if (code === "ENOENT") {
            warnings.push(`Missing artifact: navigation_map.mermaid at ${navPath}. Run /atp:analyze-app first.`);
        }
        else {
            const msg = err instanceof Error ? err.message : String(err);
            warnings.push(`Failed reading navigation_map.mermaid: ${msg}`);
        }
    }
    const apis = safeParseJson(apiPath, ApiScenariosFileSchema, warnings);
    const views = safeParseJson(viewPath, ViewStateFileSchema, warnings);
    const result = {
        appMap: {
            navigationMap,
            apiScenarios: apis?.apis ?? [],
            viewStateMap: views?.screens ?? [],
        },
        warnings,
        source: dir,
    };
    if (warnings.length > 0) {
        (0, logger_1.trace)(`AppMap load warnings (${dir}): ${warnings.join(" | ")}`);
    }
    cached = { mtime: latestMtime, result };
    return result;
};
exports.loadAppMap = loadAppMap;
/** Test/dev hook to force a cache clear. */
const _resetAppMapCache = () => {
    cached = null;
};
exports._resetAppMapCache = _resetAppMapCache;
//# sourceMappingURL=app-map.js.map