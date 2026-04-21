"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_REGISTRY = exports.LogcatSessionRegistry = void 0;
const logger_1 = require("./logger");
const DEFAULT_MAX_SESSIONS_PER_DEVICE = 3;
const DEFAULT_MAX_GLOBAL_SESSIONS = 50;
class LogcatSessionRegistry {
    sessions = new Map();
    maxPerDevice;
    maxGlobal;
    constructor(options = {}) {
        this.maxPerDevice = options.maxSessionsPerDevice ?? DEFAULT_MAX_SESSIONS_PER_DEVICE;
        this.maxGlobal = options.maxGlobalSessions ?? DEFAULT_MAX_GLOBAL_SESSIONS;
    }
    /** Throws if the caller would exceed either cap by adding another session. */
    assertCapacity(deviceId) {
        const perDevice = [...this.sessions.values()].filter(s => s.deviceId === deviceId).length;
        if (perDevice >= this.maxPerDevice) {
            throw new Error(`Device "${deviceId}" already has ${this.maxPerDevice} active logcat sessions. Stop one with atp_logcat_stop before starting another.`);
        }
        if (this.sessions.size >= this.maxGlobal) {
            throw new Error(`Global logcat session cap (${this.maxGlobal}) reached. Stop existing sessions before starting new ones.`);
        }
    }
    add(session) {
        this.sessions.set(session.id, session);
    }
    get(sessionId) {
        return this.sessions.get(sessionId);
    }
    delete(sessionId) {
        this.sessions.delete(sessionId);
    }
    size() {
        return this.sessions.size;
    }
    /** Return the most recent live session for a device (TextTier lookup). */
    latestForDevice(deviceId) {
        let latest;
        for (const session of this.sessions.values()) {
            if (session.deviceId === deviceId) {
                if (!latest || session.startTime > latest.startTime) {
                    latest = session;
                }
            }
        }
        return latest;
    }
    /** Synchronous best-effort cleanup — for the `exit` event. */
    cleanupAllSync() {
        for (const session of this.sessions.values()) {
            clearTimeout(session.timer);
            session.process.kill("SIGTERM");
        }
        this.sessions.clear();
    }
    /**
     * Graceful cleanup — signal each child and await its exit event with a
     * bounded timeout per child so the tail of the log buffer drains.
     */
    async cleanupAllGraceful(drainTimeoutMs = 2000) {
        const pending = [];
        for (const session of this.sessions.values()) {
            clearTimeout(session.timer);
            session.process.kill("SIGTERM");
            pending.push(new Promise(resolve => {
                const timer = setTimeout(resolve, drainTimeoutMs);
                session.process.once("exit", () => {
                    clearTimeout(timer);
                    resolve();
                });
            }));
        }
        await Promise.all(pending);
        this.sessions.clear();
    }
    /** Remove a session by id and log its shutdown stats. */
    stopAndRemove(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return null;
        clearTimeout(session.timer);
        session.process.kill("SIGTERM");
        this.sessions.delete(sessionId);
        const durationMs = Date.now() - session.startTime;
        (0, logger_1.trace)(`Logcat session ${sessionId} stopped: ${session.buffer.length} lines, ${session.bufferBytes}B (dropped ${session.bytesDropped}B), ${durationMs}ms`);
        return { session, durationMs };
    }
}
exports.LogcatSessionRegistry = LogcatSessionRegistry;
/**
 * Default registry used when no explicit one is passed to AndroidRobot.
 * Signal handlers are installed once against this singleton.
 */
exports.DEFAULT_REGISTRY = new LogcatSessionRegistry();
process.on("exit", () => exports.DEFAULT_REGISTRY.cleanupAllSync());
process.on("SIGTERM", () => {
    exports.DEFAULT_REGISTRY.cleanupAllGraceful().finally(() => process.exit(0));
});
process.on("SIGINT", () => {
    exports.DEFAULT_REGISTRY.cleanupAllGraceful().finally(() => process.exit(0));
});
//# sourceMappingURL=logcat-registry.js.map