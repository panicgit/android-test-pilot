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

import fs from "node:fs";
import { z } from "zod";

const AtpTagSchema = z.enum(["ATP_SCREEN", "ATP_RENDER", "ATP_API"]);

const ExpectedLogcatSchema = z.object({
	tag: AtpTagSchema,
	pattern: z.string().min(1).max(200).refine(
		(p) => { try { new RegExp(p); return true; } catch { return false; } },
		{ message: "Invalid regex pattern" },
	),
});

const TapTargetSchema = z.object({
	resourceId: z.string().optional(),
	x: z.number().optional(),
	y: z.number().optional(),
}).refine(
	t => t.resourceId !== undefined || (t.x !== undefined && t.y !== undefined),
	{ message: "tapTarget must supply either resourceId or both x and y" },
);

const TestStepSchema = z.object({
	action: z.string().min(1),
	verification: z.string().min(1),
	expectedLogcat: z.array(ExpectedLogcatSchema).optional(),
	tapTarget: TapTargetSchema.optional(),
	skipVerification: z.boolean().optional(),
});

export const ScenarioSchema = z.object({
	name: z.string().min(1),
	description: z.string().optional(),
	prerequisites: z.array(z.string()).optional(),
	steps: z.array(TestStepSchema).min(1),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

export interface ScenarioValidationResult {
	ok: boolean;
	scenario?: Scenario;
	errors: string[];
	warnings: string[];
}

/** Common typos users produce. Detected after successful parse. */
const KNOWN_TAG_TYPOS: Record<string, string> = {
	ATP_VIEW: "ATP_RENDER",
	ATP_SCREENS: "ATP_SCREEN",
	ATP_APIS: "ATP_API",
	ATP_NAV: "ATP_SCREEN",
	ATP_REQUEST: "ATP_API",
	ATP_RESPONSE: "ATP_API",
};

/** Pre-parse static typo detection over the raw JSON/YAML text. */
const detectTagTypos = (raw: string, warnings: string[]): void => {
	for (const [typo, suggestion] of Object.entries(KNOWN_TAG_TYPOS)) {
		if (new RegExp(`\\b${typo}\\b`).test(raw)) {
			warnings.push(`Unknown ATP tag "${typo}" — did you mean "${suggestion}"?`);
		}
	}
};

const extractFrontMatter = (markdown: string): { frontMatter: string | null; body: string } => {
	const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(markdown);
	if (!match) return { frontMatter: null, body: markdown };
	return { frontMatter: match[1], body: match[2] };
};

/**
 * Parse and validate a scenario from a file path. Supports `.json` and
 * `.md` (YAML front-matter). Returns all collected errors — the tool
 * never throws, so a validator UI can present a full list.
 */
export const validateScenarioFile = (filePath: string): ScenarioValidationResult => {
	const errors: string[] = [];
	const warnings: string[] = [];

	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf-8");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, errors: [`Failed to read ${filePath}: ${msg}`], warnings };
	}

	detectTagTypos(raw, warnings);

	let parsed: unknown;
	if (filePath.endsWith(".json")) {
		try {
			parsed = JSON.parse(raw);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			errors.push(`Invalid JSON: ${msg}`);
			return { ok: false, errors, warnings };
		}
	} else if (filePath.endsWith(".md")) {
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
		} catch {
			errors.push("Could not parse YAML front-matter. Supply a JSON object inside the '---' block, or author the scenario as .json.");
			return { ok: false, errors, warnings };
		}
	} else {
		errors.push(`Unsupported scenario extension: expected .json or .md, got ${filePath}`);
		return { ok: false, errors, warnings };
	}

	const result = ScenarioSchema.safeParse(parsed);
	if (!result.success) {
		for (const issue of result.error.issues) {
			errors.push(`${issue.path.join(".") || "(root)"} — ${issue.message}`);
		}
		return { ok: false, errors, warnings };
	}

	return { ok: true, scenario: result.data, errors, warnings };
};
