/**
 * LogcatSessionRegistry — owns active adb-logcat child processes across
 * the MCP server's lifetime. Extracted from a module-level Map so tests
 * can inject a fresh registry and multiple server instances don't
 * accidentally share lifecycle state (A3).
 *
 * The registry is responsible for:
 * - storing sessions keyed by sessionId
 * - enforcing per-device and global concurrent-session caps
 * - wiring process signal handlers that flush sessions on shutdown
 *
 * AndroidRobot constructs LogcatSession objects and adds them to the
 * registry; actual child-process I/O stays on AndroidRobot.
 */
import { ChildProcess } from "node:child_process";
export interface LogcatSession {
    id: string;
    deviceId: string;
    process: ChildProcess;
    buffer: string[];
    bufferBytes: number;
    startTime: number;
    maxDuration: number;
    tags: string[];
    timer: NodeJS.Timeout;
    bytesDropped: number;
}
export interface LogcatRegistryOptions {
    maxSessionsPerDevice?: number;
    maxGlobalSessions?: number;
}
export declare class LogcatSessionRegistry {
    private readonly sessions;
    private readonly maxPerDevice;
    private readonly maxGlobal;
    constructor(options?: LogcatRegistryOptions);
    /** Throws if the caller would exceed either cap by adding another session. */
    assertCapacity(deviceId: string): void;
    add(session: LogcatSession): void;
    get(sessionId: string): LogcatSession | undefined;
    delete(sessionId: string): void;
    size(): number;
    /** Return the most recent live session for a device (TextTier lookup). */
    latestForDevice(deviceId: string): LogcatSession | undefined;
    /** Synchronous best-effort cleanup — for the `exit` event. */
    cleanupAllSync(): void;
    /**
     * Graceful cleanup — signal each child and await its exit event with a
     * bounded timeout per child so the tail of the log buffer drains.
     */
    cleanupAllGraceful(drainTimeoutMs?: number): Promise<void>;
    /** Remove a session by id and log its shutdown stats. */
    stopAndRemove(sessionId: string): {
        session: LogcatSession;
        durationMs: number;
    } | null;
}
/**
 * Default registry used when no explicit one is passed to AndroidRobot.
 * Signal handlers are installed once against this singleton.
 */
export declare const DEFAULT_REGISTRY: LogcatSessionRegistry;
