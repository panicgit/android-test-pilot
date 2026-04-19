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
import { trace } from "./logger";

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

const DEFAULT_MAX_SESSIONS_PER_DEVICE = 3;
const DEFAULT_MAX_GLOBAL_SESSIONS = 50;

export class LogcatSessionRegistry {
	private readonly sessions = new Map<string, LogcatSession>();
	private readonly maxPerDevice: number;
	private readonly maxGlobal: number;

	constructor(options: LogcatRegistryOptions = {}) {
		this.maxPerDevice = options.maxSessionsPerDevice ?? DEFAULT_MAX_SESSIONS_PER_DEVICE;
		this.maxGlobal = options.maxGlobalSessions ?? DEFAULT_MAX_GLOBAL_SESSIONS;
	}

	/** Throws if the caller would exceed either cap by adding another session. */
	public assertCapacity(deviceId: string): void {
		const perDevice = [...this.sessions.values()].filter(s => s.deviceId === deviceId).length;
		if (perDevice >= this.maxPerDevice) {
			throw new Error(
				`Device "${deviceId}" already has ${this.maxPerDevice} active logcat sessions. Stop one with atp_logcat_stop before starting another.`,
			);
		}
		if (this.sessions.size >= this.maxGlobal) {
			throw new Error(
				`Global logcat session cap (${this.maxGlobal}) reached. Stop existing sessions before starting new ones.`,
			);
		}
	}

	public add(session: LogcatSession): void {
		this.sessions.set(session.id, session);
	}

	public get(sessionId: string): LogcatSession | undefined {
		return this.sessions.get(sessionId);
	}

	public delete(sessionId: string): void {
		this.sessions.delete(sessionId);
	}

	public size(): number {
		return this.sessions.size;
	}

	/** Return the most recent live session for a device (TextTier lookup). */
	public latestForDevice(deviceId: string): LogcatSession | undefined {
		let latest: LogcatSession | undefined;
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
	public cleanupAllSync(): void {
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
	public async cleanupAllGraceful(drainTimeoutMs = 2000): Promise<void> {
		const pending: Promise<void>[] = [];
		for (const session of this.sessions.values()) {
			clearTimeout(session.timer);
			session.process.kill("SIGTERM");
			pending.push(new Promise<void>(resolve => {
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
	public stopAndRemove(sessionId: string): { session: LogcatSession; durationMs: number } | null {
		const session = this.sessions.get(sessionId);
		if (!session) return null;
		clearTimeout(session.timer);
		session.process.kill("SIGTERM");
		this.sessions.delete(sessionId);
		const durationMs = Date.now() - session.startTime;
		trace(`Logcat session ${sessionId} stopped: ${session.buffer.length} lines, ${session.bufferBytes}B (dropped ${session.bytesDropped}B), ${durationMs}ms`);
		return { session, durationMs };
	}
}

/**
 * Default registry used when no explicit one is passed to AndroidRobot.
 * Signal handlers are installed once against this singleton.
 */
export const DEFAULT_REGISTRY = new LogcatSessionRegistry();

process.on("exit", () => DEFAULT_REGISTRY.cleanupAllSync());
process.on("SIGTERM", () => {
	DEFAULT_REGISTRY.cleanupAllGraceful().finally(() => process.exit(0));
});
process.on("SIGINT", () => {
	DEFAULT_REGISTRY.cleanupAllGraceful().finally(() => process.exit(0));
});
