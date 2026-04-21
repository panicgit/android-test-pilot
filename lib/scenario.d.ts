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
import { z } from "zod";
export declare const ScenarioSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    prerequisites: z.ZodOptional<z.ZodArray<z.ZodString>>;
    steps: z.ZodArray<z.ZodObject<{
        action: z.ZodString;
        verification: z.ZodString;
        expectedLogcat: z.ZodOptional<z.ZodArray<z.ZodObject<{
            tag: z.ZodEnum<{
                ATP_SCREEN: "ATP_SCREEN";
                ATP_RENDER: "ATP_RENDER";
                ATP_API: "ATP_API";
            }>;
            pattern: z.ZodString;
        }, z.core.$strip>>>;
        tapTarget: z.ZodOptional<z.ZodObject<{
            resourceId: z.ZodOptional<z.ZodString>;
            x: z.ZodOptional<z.ZodNumber>;
            y: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        skipVerification: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export interface ScenarioValidationResult {
    ok: boolean;
    scenario?: Scenario;
    errors: string[];
    warnings: string[];
}
/**
 * Parse and validate a scenario from a file path. Supports `.json` and
 * `.md` (YAML front-matter). Returns all collected errors — the tool
 * never throws, so a validator UI can present a full list.
 */
export declare const validateScenarioFile: (filePath: string) => ScenarioValidationResult;
