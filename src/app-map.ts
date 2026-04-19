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

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AppMap } from "./tiers/types";
import { trace } from "./logger";

const ApiCallerSchema = z.object({
	file: z.string(),
	successHandler: z.string(),
	errorHandler: z.string(),
});

const ApiScenariosFileSchema = z.object({
	apis: z.array(z.object({
		endpoint: z.string(),
		interfaceFile: z.string(),
		callers: z.array(ApiCallerSchema),
	})),
});

const ViewStateFileSchema = z.object({
	screens: z.array(z.object({
		name: z.string(),
		file: z.string(),
		states: z.array(z.object({
			viewId: z.string(),
			visibilityCondition: z.string(),
			dataSource: z.string(),
			sourceFile: z.string(),
		})),
	})),
});

export interface AppMapLoadResult {
	appMap: AppMap;
	warnings: string[];
	source: string;
}

let cached: { mtime: number; result: AppMapLoadResult } | null = null;

/**
 * Resolve the app-map directory from ATP_PROJECT_ROOT or cwd, then realpath
 * the result and ensure it is contained inside the resolved root. Prevents
 * symlink traversal when ATP_PROJECT_ROOT is set in a multi-tenant harness
 * (SR-5).
 */
export const resolveAppMapDir = (): string => {
	const raw = process.env.ATP_PROJECT_ROOT?.trim();
	const root = raw ? path.resolve(raw) : path.resolve(process.cwd());
	const target = path.join(root, ".claude", "app-map");

	try {
		const realRoot = fs.realpathSync(root);
		if (fs.existsSync(target)) {
			const realTarget = fs.realpathSync(target);
			const containment = path.relative(realRoot, realTarget);
			if (containment.startsWith("..") || path.isAbsolute(containment)) {
				throw new Error(
					`ATP_PROJECT_ROOT symlink escapes project root: ${realTarget} is outside ${realRoot}`,
				);
			}
		}
	} catch (err: unknown) {
		// Missing directory on a fresh checkout is fine — the caller surfaces it
		// as a "Missing artifact" warning. Only rethrow containment violations.
		if (err instanceof Error && err.message.startsWith("ATP_PROJECT_ROOT symlink escapes")) {
			throw err;
		}
	}

	return target;
};

/**
 * Read + parse + validate an artifact in a single try/catch — no
 * existsSync-then-readFileSync TOCTOU window (T-R4). ENOENT is treated
 * as "missing", anything else as a warning.
 */
const safeParseJson = <T>(filePath: string, schema: z.ZodType<T>, warnings: string[]): T | null => {
	let raw: string;
	try {
		raw = fs.readFileSync(filePath, "utf-8");
	} catch (err: unknown) {
		const code = (err as { code?: string })?.code;
		if (code === "ENOENT") {
			warnings.push(`Missing artifact: ${path.basename(filePath)} at ${filePath}. Run /atp:analyze-app first.`);
		} else {
			const msg = err instanceof Error ? err.message : String(err);
			warnings.push(`Failed reading ${path.basename(filePath)}: ${msg}`);
		}
		return null;
	}
	let parsedJson: unknown;
	try {
		parsedJson = JSON.parse(raw);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		warnings.push(`Invalid JSON in ${path.basename(filePath)}: ${msg}`);
		return null;
	}
	const result = schema.safeParse(parsedJson);
	if (!result.success) {
		warnings.push(`Schema validation failed for ${path.basename(filePath)}: ${result.error.issues.slice(0, 3).map(i => i.message).join("; ")}`);
		return null;
	}
	return result.data;
};

const fileMtime = (p: string): number => {
	try {
		return fs.statSync(p).mtimeMs;
	} catch {
		return 0;
	}
};

export const loadAppMap = (): AppMapLoadResult => {
	const dir = resolveAppMapDir();
	const navPath = path.join(dir, "navigation_map.mermaid");
	const apiPath = path.join(dir, "api_scenarios.json");
	const viewPath = path.join(dir, "view_state_map.json");

	const latestMtime = Math.max(fileMtime(navPath), fileMtime(apiPath), fileMtime(viewPath));
	if (cached && cached.mtime === latestMtime && cached.result.source === dir) {
		return cached.result;
	}

	const warnings: string[] = [];
	let navigationMap = "";
	try {
		navigationMap = fs.readFileSync(navPath, "utf-8");
	} catch (err: unknown) {
		const code = (err as { code?: string })?.code;
		if (code === "ENOENT") {
			warnings.push(`Missing artifact: navigation_map.mermaid at ${navPath}. Run /atp:analyze-app first.`);
		} else {
			const msg = err instanceof Error ? err.message : String(err);
			warnings.push(`Failed reading navigation_map.mermaid: ${msg}`);
		}
	}

	const apis = safeParseJson(apiPath, ApiScenariosFileSchema, warnings);
	const views = safeParseJson(viewPath, ViewStateFileSchema, warnings);

	const result: AppMapLoadResult = {
		appMap: {
			navigationMap,
			apiScenarios: apis?.apis ?? [],
			viewStateMap: views?.screens ?? [],
		},
		warnings,
		source: dir,
	};

	if (warnings.length > 0) {
		trace(`AppMap load warnings (${dir}): ${warnings.join(" | ")}`);
	}

	cached = { mtime: latestMtime, result };
	return result;
};

/** Test/dev hook to force a cache clear. */
export const _resetAppMapCache = (): void => {
	cached = null;
};
