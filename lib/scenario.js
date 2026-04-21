"use strict";
/**
 * Scenario schema + loader.
 *
 * A scenario describes a sequence of test steps. It may be authored as
 * either:
 *
 * 1. JSON (`scenarios/*.json`) — fully structured, easiest to validate.
 * 2. Markdown with YAML front-matter (`scenarios/*.md`) — human-readable
 *    prose plus a typed `steps:` list in the front-matter. The body text
 *    is preserved for LLM context but only the front-matter drives
 *    execution.
 *
 * This module centralises parsing, schema validation, and known-typo
 * diagnostics (`ATP_VIEW` vs `ATP_RENDER`, unknown tags, etc.) so
 * scenarios can be linted before any MCP call (A7 + DX6 pair).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateScenarioFile = exports.ScenarioSchema = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const zod_1 = require("zod");
const AtpTagSchema = zod_1.z.enum(["ATP_SCREEN", "ATP_RENDER", "ATP_API"]);
const ExpectedLogcatSchema = zod_1.z.object({
    tag: AtpTagSchema,
    pattern: zod_1.z.string().min(1).max(200).refine((p) => { try {
        new RegExp(p);
        return true;
    }
    catch {
        return false;
    } }, { message: "Invalid regex pattern" }),
});
const TapTargetSchema = zod_1.z.object({
    resourceId: zod_1.z.string().optional(),
    x: zod_1.z.number().optional(),
    y: zod_1.z.number().optional(),
}).refine(t => t.resourceId !== undefined || (t.x !== undefined && t.y !== undefined), { message: "tapTarget must supply either resourceId or both x and y" });
const TestStepSchema = zod_1.z.object({
    action: zod_1.z.string().min(1),
    verification: zod_1.z.string().min(1),
    expectedLogcat: zod_1.z.array(ExpectedLogcatSchema).optional(),
    tapTarget: TapTargetSchema.optional(),
    skipVerification: zod_1.z.boolean().optional(),
});
exports.ScenarioSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    description: zod_1.z.string().optional(),
    prerequisites: zod_1.z.array(zod_1.z.string()).optional(),
    steps: zod_1.z.array(TestStepSchema).min(1),
});
/** Common typos users produce. Detected after successful parse. */
const KNOWN_TAG_TYPOS = {
    ATP_VIEW: "ATP_RENDER",
    ATP_SCREENS: "ATP_SCREEN",
    ATP_APIS: "ATP_API",
    ATP_NAV: "ATP_SCREEN",
    ATP_REQUEST: "ATP_API",
    ATP_RESPONSE: "ATP_API",
};
/** Pre-parse static typo detection over the raw JSON/YAML text. */
const detectTagTypos = (raw, warnings) => {
    for (const [typo, suggestion] of Object.entries(KNOWN_TAG_TYPOS)) {
        if (new RegExp(`\\b${typo}\\b`).test(raw)) {
            warnings.push(`Unknown ATP tag "${typo}" — did you mean "${suggestion}"?`);
        }
    }
};
const extractFrontMatter = (markdown) => {
    const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(markdown);
    if (!match)
        return { frontMatter: null, body: markdown };
    return { frontMatter: match[1], body: match[2] };
};
/**
 * Parse and validate a scenario from a file path. Supports `.json` and
 * `.md` (YAML front-matter). Returns all collected errors — the tool
 * never throws, so a validator UI can present a full list.
 */
const validateScenarioFile = (filePath) => {
    const errors = [];
    const warnings = [];
    let raw;
    try {
        raw = node_fs_1.default.readFileSync(filePath, "utf-8");
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, errors: [`Failed to read ${filePath}: ${msg}`], warnings };
    }
    detectTagTypos(raw, warnings);
    let parsed;
    if (filePath.endsWith(".json")) {
        try {
            parsed = JSON.parse(raw);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`Invalid JSON: ${msg}`);
            return { ok: false, errors, warnings };
        }
    }
    else if (filePath.endsWith(".md")) {
        const { frontMatter } = extractFrontMatter(raw);
        if (!frontMatter) {
            errors.push("Markdown scenario must have YAML front-matter (between '---' markers) containing name/steps.");
            return { ok: false, errors, warnings };
        }
        // Minimal YAML → JSON transform — we only accept scenarios whose
        // front-matter is actually valid JSON-with-YAML-syntax, i.e. a JSON
        // object with unquoted keys. Full YAML support would bring in a
        // dependency; for now, fail clearly and point the user at JSON.
        try {
            const yaml = require("node:util").types?.isAsyncFunction; // placeholder to keep bundlers from tree-shaking
            void yaml;
            // Attempt 1: front matter is already valid JSON (preferred).
            parsed = JSON.parse(frontMatter);
        }
        catch {
            errors.push("Could not parse YAML front-matter. Supply a JSON object inside the '---' block, or author the scenario as .json.");
            return { ok: false, errors, warnings };
        }
    }
    else {
        errors.push(`Unsupported scenario extension: expected .json or .md, got ${filePath}`);
        return { ok: false, errors, warnings };
    }
    const result = exports.ScenarioSchema.safeParse(parsed);
    if (!result.success) {
        for (const issue of result.error.issues) {
            errors.push(`${issue.path.join(".") || "(root)"} — ${issue.message}`);
        }
        return { ok: false, errors, warnings };
    }
    return { ok: true, scenario: result.data, errors, warnings };
};
exports.validateScenarioFile = validateScenarioFile;
//# sourceMappingURL=scenario.js.map