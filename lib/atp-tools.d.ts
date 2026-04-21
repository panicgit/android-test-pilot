/**
 * android-test-pilot — MCP tool registrations specific to this fork.
 *
 * Extracted from server.ts so the upstream mobile-mcp surface (mobile_* tools)
 * and the fork-specific surface (atp_* tools) don't live in one 1000-line
 * file (S3-3 / A6 / A8 / A9). See UPSTREAM.md for fork policy.
 */
import { z } from "zod";
import { AndroidRobot } from "./android";
import { TierRunner } from "./tiers/tier-runner";
export declare const SHARED_TIER_RUNNER: TierRunner;
type ZodSchemaShape = Record<string, z.ZodType>;
export type AtpToolFactory = <S extends ZodSchemaShape>(name: string, title: string, description: string, paramsSchema: S, annotations: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
}, cb: (args: z.infer<z.ZodObject<S>>) => Promise<string>) => void;
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
export declare const registerAtpTools: (deps: AtpToolsDeps) => void;
export {};
