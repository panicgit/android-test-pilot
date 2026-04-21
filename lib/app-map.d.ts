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
import { AppMap } from "./tiers/types";
export interface AppMapLoadResult {
    appMap: AppMap;
    warnings: string[];
    source: string;
}
/**
 * Resolve the app-map directory from ATP_PROJECT_ROOT or cwd, then realpath
 * the result and ensure it is contained inside the resolved root. Prevents
 * symlink traversal when ATP_PROJECT_ROOT is set in a multi-tenant harness
 * (SR-5).
 */
export declare const resolveAppMapDir: () => string;
export declare const loadAppMap: () => AppMapLoadResult;
/** Test/dev hook to force a cache clear. */
export declare const _resetAppMapCache: () => void;
