import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawn, ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";

import * as xml from "fast-xml-parser";

import { ActionableError, Button, InstalledApp, Robot, ScreenElement, ScreenElementRect, ScreenSize, SwipeDirection, Orientation } from "./robot";
import { validatePackageName, validateLocale } from "./utils";
import { trace } from "./logger";

// ─── Logcat Session Management ──────────────────────────────────────

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

/** Global store for active logcat sessions across all devices */
const activeSessions = new Map<string, LogcatSession>();

/** Max lines to keep in a logcat session buffer to prevent memory exhaustion */
const MAX_LOGCAT_LINES = 50_000;

/** Max bytes per session buffer — defense against very long log lines (H2). */
const MAX_LOGCAT_BYTES = 64 * 1024 * 1024;

/** Max concurrent logcat sessions for a single device (S2 + H8). */
const MAX_SESSIONS_PER_DEVICE = 3;

/** Global cap on logcat sessions across all devices (S2). */
const MAX_GLOBAL_SESSIONS = 50;

/**
 * Best-effort synchronous cleanup — used on 'exit' where the process is
 * already tearing down and we cannot await anything.
 */
const cleanupAllSessionsSync = (): void => {
	for (const [, session] of activeSessions) {
		clearTimeout(session.timer);
		session.process.kill("SIGTERM");
	}
	activeSessions.clear();
};

/**
 * Graceful cleanup — signal each child then wait (bounded) for it to exit so
 * the last batch of logcat lines can drain. Used on SIGTERM/SIGINT where the
 * server is alive long enough to await. See H1 in IMPROVEMENT_PLAN.md.
 */
const cleanupAllSessionsGraceful = async (drainTimeoutMs = 2000): Promise<void> => {
	const pending: Promise<void>[] = [];
	for (const [, session] of activeSessions) {
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
	activeSessions.clear();
};

process.on("exit", cleanupAllSessionsSync);
process.on("SIGTERM", () => {
	cleanupAllSessionsGraceful().finally(() => process.exit(0));
});
process.on("SIGINT", () => {
	cleanupAllSessionsGraceful().finally(() => process.exit(0));
});

export interface AndroidDevice {
	deviceId: string;
	deviceType: "tv" | "mobile";
}

interface UiAutomatorXmlNode {
	node: UiAutomatorXmlNode[];
	class?: string;
	text?: string;
	bounds?: string;
	hint?: string;
	focused?: string;
	checkable?: string;
	"content-desc"?: string;
	"resource-id"?: string;
}

interface UiAutomatorXml {
	hierarchy: {
		node: UiAutomatorXmlNode;
	};
}

const getAdbPath = (): string => {
	const exeName = process.env.platform === "win32" ? "adb.exe" : "adb";
	if (process.env.ANDROID_HOME) {
		return path.join(process.env.ANDROID_HOME, "platform-tools", exeName);
	}

	if (process.platform === "win32" && process.env.LOCALAPPDATA) {
		const windowsAdbPath = path.join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe");
		if (existsSync(windowsAdbPath)) {
			return windowsAdbPath;
		}
	}

	if (process.platform === "darwin" && process.env.HOME) {
		const defaultAndroidSdk = path.join(process.env.HOME, "Library", "Android", "sdk", "platform-tools", "adb");
		if (existsSync(defaultAndroidSdk)) {
			return defaultAndroidSdk;
		}
	}

	// fallthrough, hope for the best
	return exeName;
};

/**
 * Patterns that we strip from logcat output before returning it to the MCP
 * client. These are conservative — we'd rather keep a line readable than
 * leak a secret. See S8 in IMPROVEMENT_PLAN.md.
 */
const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
	{ pattern: /Bearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, replacement: "Bearer [REDACTED]" },
	{ pattern: /(token|password|passwd|secret|api[_-]?key|auth|authorization|refresh[_-]?token|access[_-]?token|session[_-]?id|cookie)\s*[:=]\s*([^\s,;"}]+)/gi, replacement: "$1=[REDACTED]" },
	{ pattern: /[\w.+\-]+@[\w\-]+\.[A-Za-z]{2,}/g, replacement: "[EMAIL-REDACTED]" },
	{ pattern: /\b(?:\d[ -]?){13,19}\b/g, replacement: "[CARD-REDACTED]" },
];

/** Redact obvious secrets from an array of logcat lines. */
export const redactLogcatLines = (lines: string[]): { lines: string[]; redactedCount: number } => {
	if (process.env.MOBILEMCP_DISABLE_REDACTION === "1") {
		return { lines, redactedCount: 0 };
	}
	let redactedCount = 0;
	const out = lines.map(line => {
		let redacted = line;
		for (const { pattern, replacement } of REDACTION_PATTERNS) {
			redacted = redacted.replace(pattern, replacement);
		}
		if (redacted !== line) redactedCount++;
		return redacted;
	});
	return { lines: out, redactedCount };
};

/** Extract a readable message from an execFileSync throw (has stdout/stderr buffers). */
const formatAdbError = (error: unknown): string => {
	const err = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
	const stdout = err.stdout ? err.stdout.toString() : "";
	const stderr = err.stderr ? err.stderr.toString() : "";
	const output = (stdout + stderr).trim();
	return output || err.message || String(error);
};

const BUTTON_MAP: Record<Button, string> = {
	"BACK": "KEYCODE_BACK",
	"HOME": "KEYCODE_HOME",
	"VOLUME_UP": "KEYCODE_VOLUME_UP",
	"VOLUME_DOWN": "KEYCODE_VOLUME_DOWN",
	"ENTER": "KEYCODE_ENTER",
	"DPAD_CENTER": "KEYCODE_DPAD_CENTER",
	"DPAD_UP": "KEYCODE_DPAD_UP",
	"DPAD_DOWN": "KEYCODE_DPAD_DOWN",
	"DPAD_LEFT": "KEYCODE_DPAD_LEFT",
	"DPAD_RIGHT": "KEYCODE_DPAD_RIGHT",
};

const TIMEOUT = 30000;
const MAX_BUFFER_SIZE = 1024 * 1024 * 8;

type AndroidDeviceType = "tv" | "mobile";

export class AndroidRobot implements Robot {

	public constructor(private deviceId: string) {
	}

	public getDeviceId(): string {
		return this.deviceId;
	}

	public adb(...args: string[]): Buffer {
		return execFileSync(getAdbPath(), ["-s", this.deviceId, ...args], {
			maxBuffer: MAX_BUFFER_SIZE,
			timeout: TIMEOUT,
		});
	}

	public silentAdb(...args: string[]): Buffer {
		return execFileSync(getAdbPath(), ["-s", this.deviceId, ...args], {
			maxBuffer: MAX_BUFFER_SIZE,
			timeout: TIMEOUT,
			stdio: ["pipe", "pipe", "pipe"],
		});
	}

	public getSystemFeatures(): string[] {
		return this.adb("shell", "pm", "list", "features")
			.toString()
			.split("\n")
			.map(line => line.trim())
			.filter(line => line.startsWith("feature:"))
			.map(line => line.substring("feature:".length));
	}

	public async getScreenSize(): Promise<ScreenSize> {
		const screenSize = this.adb("shell", "wm", "size")
			.toString()
			.split(" ")
			.pop();

		if (!screenSize) {
			throw new Error("Failed to get screen size");
		}

		const scale = 1;
		const [width, height] = screenSize.split("x").map(Number);
		return { width, height, scale };
	}

	public async listApps(): Promise<InstalledApp[]> {
		// only apps that have a launcher activity are returned
		return this.adb("shell", "cmd", "package", "query-activities", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER")
			.toString()
			.split("\n")
			.map(line => line.trim())
			.filter(line => line.startsWith("packageName="))
			.map(line => line.substring("packageName=".length))
			.filter((value, index, self) => self.indexOf(value) === index)
			.map(packageName => ({
				packageName,
				appName: packageName,
			}));
	}

	private async listPackages(): Promise<string[]> {
		return this.adb("shell", "pm", "list", "packages")
			.toString()
			.split("\n")
			.map(line => line.trim())
			.filter(line => line.startsWith("package:"))
			.map(line => line.substring("package:".length));
	}

	public async launchApp(packageName: string, locale?: string): Promise<void> {
		validatePackageName(packageName);

		if (locale) {
			validateLocale(locale);
			try {
				this.silentAdb("shell", "cmd", "locale", "set-app-locales", packageName, "--locales", locale);
			} catch (error) {
				// set-app-locales requires Android 13+ (API 33), silently ignore on older versions
			}
		}

		try {
			this.silentAdb("shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1");
		} catch (error) {
			throw new ActionableError(`Failed launching app with package name "${packageName}", please make sure it exists`);
		}
	}

	public async listRunningProcesses(): Promise<string[]> {
		return this.adb("shell", "ps", "-e")
			.toString()
			.split("\n")
			.map(line => line.trim())
			.filter(line => line.startsWith("u")) // non-system processes
			.map(line => line.split(/\s+/)[8]); // get process name
	}

	public async swipe(direction: SwipeDirection): Promise<void> {
		const screenSize = await this.getScreenSize();
		const centerX = screenSize.width >> 1;

		let x0: number, y0: number, x1: number, y1: number;

		switch (direction) {
			case "up":
				x0 = x1 = centerX;
				y0 = Math.floor(screenSize.height * 0.80);
				y1 = Math.floor(screenSize.height * 0.20);
				break;
			case "down":
				x0 = x1 = centerX;
				y0 = Math.floor(screenSize.height * 0.20);
				y1 = Math.floor(screenSize.height * 0.80);
				break;
			case "left":
				x0 = Math.floor(screenSize.width * 0.80);
				x1 = Math.floor(screenSize.width * 0.20);
				y0 = y1 = Math.floor(screenSize.height * 0.50);
				break;
			case "right":
				x0 = Math.floor(screenSize.width * 0.20);
				x1 = Math.floor(screenSize.width * 0.80);
				y0 = y1 = Math.floor(screenSize.height * 0.50);
				break;
			default:
				throw new ActionableError(`Swipe direction "${direction}" is not supported`);
		}

		this.adb("shell", "input", "swipe", `${x0}`, `${y0}`, `${x1}`, `${y1}`, "1000");
	}

	public async swipeFromCoordinate(x: number, y: number, direction: SwipeDirection, distance?: number): Promise<void> {
		const screenSize = await this.getScreenSize();

		let x0: number, y0: number, x1: number, y1: number;

		// Use provided distance or default to 30% of screen dimension
		const defaultDistanceY = Math.floor(screenSize.height * 0.3);
		const defaultDistanceX = Math.floor(screenSize.width * 0.3);
		const swipeDistanceY = distance || defaultDistanceY;
		const swipeDistanceX = distance || defaultDistanceX;

		switch (direction) {
			case "up":
				x0 = x1 = x;
				y0 = y;
				y1 = Math.max(0, y - swipeDistanceY);
				break;
			case "down":
				x0 = x1 = x;
				y0 = y;
				y1 = Math.min(screenSize.height, y + swipeDistanceY);
				break;
			case "left":
				x0 = x;
				x1 = Math.max(0, x - swipeDistanceX);
				y0 = y1 = y;
				break;
			case "right":
				x0 = x;
				x1 = Math.min(screenSize.width, x + swipeDistanceX);
				y0 = y1 = y;
				break;
			default:
				throw new ActionableError(`Swipe direction "${direction}" is not supported`);
		}

		this.adb("shell", "input", "swipe", `${x0}`, `${y0}`, `${x1}`, `${y1}`, "1000");
	}

	private getDisplayCount(): number {
		return this.adb("shell", "dumpsys", "SurfaceFlinger", "--display-id")
			.toString()
			.split("\n")
			.filter(s => s.startsWith("Display "))
			.length;
	}

	private getFirstDisplayId(): string | null {
		try {
			// Try using cmd display get-displays (Android 11+)
			const displays = this.adb("shell", "cmd", "display", "get-displays")
				.toString()
				.split("\n")
				.filter(s => s.startsWith("Display id "))
				// filter for state ON even though get-displays only returns turned on displays
				.filter(s => s.indexOf(", state ON,") >= 0)
				// another paranoia check
				.filter(s => s.indexOf(", uniqueId ") >= 0);

			if (displays.length > 0) {
				const m = displays[0].match(/uniqueId \"([^\"]+)\"/);
				if (m !== null) {
					let displayId = m[1];
					if (displayId.startsWith("local:")) {
						displayId = displayId.substring("local:".length);
					}

					return displayId;
				}
			}
		} catch (error) {
			// cmd display get-displays not available on this device
		}

		// fallback: parse dumpsys display for display info (compatible with older Android versions)
		try {
			const dumpsys = this.adb("shell", "dumpsys", "display")
				.toString();

			// look for DisplayViewport entries with isActive=true and type=INTERNAL
			const viewportMatch = dumpsys.match(/DisplayViewport\{type=INTERNAL[^}]*isActive=true[^}]*uniqueId='([^']+)'/);
			if (viewportMatch) {
				let uniqueId = viewportMatch[1];
				if (uniqueId.startsWith("local:")) {
					uniqueId = uniqueId.substring("local:".length);
				}

				return uniqueId;
			}

			// fallback: look for active display with state ON
			const displayStateMatch = dumpsys.match(/Display Id=(\d+)[\s\S]*?Display State=ON/);
			if (displayStateMatch) {
				return displayStateMatch[1];
			}
		} catch (error) {
			// dumpsys display also failed
		}

		return null;
	}

	public async getScreenshot(): Promise<Buffer> {
		if (this.getDisplayCount() <= 1) {
			// backward compatibility for android 10 and below, and for single display devices
			return this.adb("exec-out", "screencap", "-p");
		}

		// find the first display that is turned on, and capture that one
		const displayId = this.getFirstDisplayId();
		if (displayId === null) {
			// no idea why, but we have displayCount >= 2, yet we failed to parse
			// let's go with screencap's defaults and hope for the best
			return this.adb("exec-out", "screencap", "-p");
		}

		return this.adb("exec-out", "screencap", "-p", "-d", `${displayId}`);
	}

	private collectElements(node: UiAutomatorXmlNode): ScreenElement[] {
		const elements: Array<ScreenElement> = [];

		if (node.node) {
			if (Array.isArray(node.node)) {
				for (const childNode of node.node) {
					elements.push(...this.collectElements(childNode));
				}
			} else {
				elements.push(...this.collectElements(node.node));
			}
		}

		if (node.text || node["content-desc"] || node.hint || node["resource-id"] || node.checkable === "true") {
			const element: ScreenElement = {
				type: node.class || "text",
				text: node.text,
				label: node["content-desc"] || node.hint || "",
				rect: this.getScreenElementRect(node),
			};

			if (node.focused === "true") {
				// only provide it if it's true, otherwise don't confuse llm
				element.focused = true;
			}

			const resourceId = node["resource-id"];
			if (resourceId !== null && resourceId !== "") {
				element.identifier = resourceId;
			}

			if (element.rect.width > 0 && element.rect.height > 0) {
				elements.push(element);
			}
		}

		return elements;
	}

	public async getElementsOnScreen(): Promise<ScreenElement[]> {
		const parsedXml = await this.getUiAutomatorXml();
		const hierarchy = parsedXml.hierarchy;
		const elements = this.collectElements(hierarchy.node);
		return elements;
	}

	public async terminateApp(packageName: string): Promise<void> {
		validatePackageName(packageName);
		this.adb("shell", "am", "force-stop", packageName);
	}

	public async installApp(path: string): Promise<void> {
		try {
			this.adb("install", "-r", path);
		} catch (error: unknown) {
			throw new ActionableError(formatAdbError(error));
		}
	}

	public async uninstallApp(bundleId: string): Promise<void> {
		try {
			this.adb("uninstall", bundleId);
		} catch (error: unknown) {
			throw new ActionableError(formatAdbError(error));
		}
	}

	public async openUrl(url: string): Promise<void> {
		this.adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", this.escapeShellText(url));
	}

	private isAscii(text: string): boolean {
		return /^[\x00-\x7F]*$/.test(text);
	}

	private escapeShellText(text: string): string {
		// escape all shell special characters that could be used for injection
		return text.replace(/[\\'"` \t\n\r|&;()<>{}[\]$*?]/g, "\\$&");
	}

	private async isDeviceKitInstalled(): Promise<boolean> {
		const packages = await this.listPackages();
		return packages.includes("com.mobilenext.devicekit");
	}

	public async sendKeys(text: string): Promise<void> {
		if (text === "") {
			// bailing early, so we don't run adb shell with empty string.
			// this happens when you prompt with a simple "submit".
			return;
		}

		if (this.isAscii(text)) {
			// adb shell input only supports ascii characters. and
			// some of the keys have to be escaped.
			const _text = this.escapeShellText(text);
			this.adb("shell", "input", "text", _text);
		} else if (await this.isDeviceKitInstalled()) {
			// try sending over clipboard
			const base64 = Buffer.from(text).toString("base64");

			// send clipboard over and immediately paste it
			this.adb("shell", "am", "broadcast", "-a", "devicekit.clipboard.set", "-e", "encoding", "base64", "-e", "text", base64, "-n", "com.mobilenext.devicekit/.ClipboardBroadcastReceiver");
			this.adb("shell", "input", "keyevent", "KEYCODE_PASTE");

			// clear clipboard when we're done
			this.adb("shell", "am", "broadcast", "-a", "devicekit.clipboard.clear", "-n", "com.mobilenext.devicekit/.ClipboardBroadcastReceiver");
		} else {
			throw new ActionableError("Non-ASCII text is not supported on Android, please install mobilenext devicekit, see https://github.com/mobile-next/devicekit-android");
		}
	}

	public async pressButton(button: Button) {
		if (!BUTTON_MAP[button]) {
			throw new ActionableError(`Button "${button}" is not supported`);
		}

		const mapped = BUTTON_MAP[button];
		this.adb("shell", "input", "keyevent", mapped);
	}

	public async tap(x: number, y: number): Promise<void> {
		this.adb("shell", "input", "tap", `${x}`, `${y}`);
	}

	public async longPress(x: number, y: number, duration: number): Promise<void> {
		// a long press is a swipe with no movement and a long duration
		this.adb("shell", "input", "swipe", `${x}`, `${y}`, `${x}`, `${y}`, `${duration}`);
	}

	public async doubleTap(x: number, y: number): Promise<void> {
		await this.tap(x, y);
		await new Promise(r => setTimeout(r, 100)); // short delay
		await this.tap(x, y);
	}

	public async setOrientation(orientation: Orientation): Promise<void> {
		const value = orientation === "portrait" ? 0 : 1;

		// disable auto-rotation prior to setting the orientation
		this.adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
		this.adb("shell", "content", "insert", "--uri", "content://settings/system", "--bind", "name:s:user_rotation", "--bind", `value:i:${value}`);
	}

	public async getOrientation(): Promise<Orientation> {
		const rotation = this.adb("shell", "settings", "get", "system", "user_rotation").toString().trim();
		return rotation === "0" ? "portrait" : "landscape";
	}

	private async getUiAutomatorDump(): Promise<string> {
		for (let tries = 0; tries < 10; tries++) {
			const dump = this.adb("exec-out", "uiautomator", "dump", "/dev/tty").toString();
			// note: we're not catching other errors here. maybe we should check for <?xml
			if (dump.includes("null root node returned by UiTestAutomationBridge")) {
				// uncomment for debugging
				// const screenshot = await this.getScreenshot();
				// console.error("Failed to get UIAutomator XML. Here's a screenshot: " + screenshot.toString("base64"));
				continue;
			}

			return dump.substring(dump.indexOf("<?xml"));
		}

		throw new ActionableError("Failed to get UIAutomator XML");
	}

	private async getUiAutomatorXml(): Promise<UiAutomatorXml> {
		const dump = await this.getUiAutomatorDump();
		const parser = new xml.XMLParser({
			ignoreAttributes: false,
			attributeNamePrefix: "",
		});

		return parser.parse(dump) as UiAutomatorXml;
	}

	private getScreenElementRect(node: UiAutomatorXmlNode): ScreenElementRect {
		const bounds = String(node.bounds);

		const [, left, top, right, bottom] = bounds.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)?.map(Number) || [];
		return {
			x: left,
			y: top,
			width: right - left,
			height: bottom - top,
		};
	}

	// ─── Dumpsys Methods (Tier 1: text-based) ───────────────────────

	/**
	 * Get the current foreground Activity via dumpsys.
	 * Returns parsed activity info as text.
	 */
	public getDumpsysActivity(): string {
		try {
			const output = this.adb("shell", "dumpsys", "activity", "activities")
				.toString();
			// Extract the focused activity line
			const lines = output.split("\n");
			const resumedLine = lines.find(l => l.includes("mResumedActivity") || l.includes("ResumedActivity"));
			const focusedLine = lines.find(l => l.includes("mFocusedActivity"));
			const topLine = lines.find(l => l.includes("topResumedActivity"));
			return JSON.stringify({
				resumed: resumedLine?.trim() || null,
				focused: focusedLine?.trim() || null,
				topResumed: topLine?.trim() || null,
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return JSON.stringify({ error: message });
		}
	}

	/**
	 * Get the current focused window via dumpsys.
	 */
	public getDumpsysWindow(): string {
		try {
			const output = this.adb("shell", "dumpsys", "window", "windows")
				.toString();
			const lines = output.split("\n");
			const focusedLine = lines.find(l => l.includes("mCurrentFocus") || l.includes("mFocusedWindow"));
			const inputLine = lines.find(l => l.includes("mInputMethodTarget"));
			return JSON.stringify({
				currentFocus: focusedLine?.trim() || null,
				inputMethodTarget: inputLine?.trim() || null,
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return JSON.stringify({ error: message });
		}
	}

	// ─── Logcat Session Methods (Tier 1: text-based) ────────────────

	/**
	 * Start a logcat streaming session.
	 * Spawns `adb logcat` as a background process and buffers output.
	 */
	public startLogcat(tags: string[], durationSeconds: number): LogcatSession {
		// Cap concurrent sessions to prevent memory/fd exhaustion (S2 + H8).
		const perDevice = [...activeSessions.values()].filter(s => s.deviceId === this.deviceId).length;
		if (perDevice >= MAX_SESSIONS_PER_DEVICE) {
			throw new ActionableError(
				`Device "${this.deviceId}" already has ${MAX_SESSIONS_PER_DEVICE} active logcat sessions. Stop one with atp_logcat_stop before starting another.`,
			);
		}
		if (activeSessions.size >= MAX_GLOBAL_SESSIONS) {
			throw new ActionableError(
				`Global logcat session cap (${MAX_GLOBAL_SESSIONS}) reached. Stop existing sessions before starting new ones.`,
			);
		}

		const sessionId = crypto.randomUUID();

		// Validate tags to prevent filter manipulation (e.g. "*" would capture all logs)
		const TAG_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
		for (const tag of tags) {
			if (!TAG_PATTERN.test(tag)) {
				throw new ActionableError(`Invalid logcat tag "${tag}". Tags must be alphanumeric/underscore, 1-64 chars, starting with a letter or underscore.`);
			}
		}

		// Build logcat filter args: TAG:D for each tag, *:S to silence others
		const filterArgs = tags.map(tag => `${tag}:D`);
		filterArgs.push("*:S");

		const adbPath = getAdbPath();
		const args = ["-s", this.deviceId, "logcat", "-v", "time", ...filterArgs];

		trace(`Logcat start: ${adbPath} ${args.join(" ")}`);
		const proc = spawn(adbPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});

		const session: LogcatSession = {
			id: sessionId,
			deviceId: this.deviceId,
			process: proc,
			buffer: [],
			bufferBytes: 0,
			startTime: Date.now(),
			maxDuration: durationSeconds * 1000,
			tags,
			bytesDropped: 0,
			timer: setTimeout(() => {
				trace(`Logcat session ${sessionId} auto-stopped (timeout ${durationSeconds}s)`);
				this.stopLogcat(sessionId);
			}, durationSeconds * 1000),
		};

		const pushLine = (line: string): void => {
			if (!line.trim()) return;
			const lineBytes = Buffer.byteLength(line, "utf8");
			if (session.buffer.length >= MAX_LOGCAT_LINES || session.bufferBytes + lineBytes > MAX_LOGCAT_BYTES) {
				session.bytesDropped += lineBytes;
				return;
			}
			session.buffer.push(line);
			session.bufferBytes += lineBytes;
		};

		// Buffer stdout line by line (capped at MAX_LOGCAT_LINES + MAX_LOGCAT_BYTES)
		let partial = "";
		proc.stdout?.on("data", (chunk: Buffer) => {
			partial += chunk.toString();
			const lines = partial.split("\n");
			partial = lines.pop() || "";
			for (const line of lines) pushLine(line);
		});

		// Flush remaining partial line on stream end
		proc.stdout?.on("end", () => {
			if (partial.trim()) pushLine(partial);
		});

		// Log stderr for debugging (ADB errors, device disconnects)
		proc.stderr?.on("data", (chunk: Buffer) => {
			trace(`Logcat session ${sessionId} stderr: ${chunk.toString().trim()}`);
		});

		proc.on("error", (err) => {
			trace(`Logcat session ${sessionId} error: ${err.message}`);
		});

		proc.on("exit", () => {
			clearTimeout(session.timer);
			activeSessions.delete(sessionId);
		});

		activeSessions.set(sessionId, session);
		return session;
	}

	/**
	 * Read collected log lines from an active session.
	 * @param since - If provided, only return lines after this index (for incremental reads)
	 *
	 * Lines are passed through a redaction filter (S8) that strips obvious
	 * secrets (Bearer tokens, token/password/api_key key=value pairs, email
	 * addresses). Opt out with `MOBILEMCP_DISABLE_REDACTION=1` when debugging.
	 */
	public readLogcat(sessionId: string, since?: number): { lines: string[]; lineCount: number; redactedCount: number } {
		const session = activeSessions.get(sessionId);
		if (!session) {
			throw new ActionableError(`Logcat session "${sessionId}" not found. It may have expired or been stopped.`);
		}

		const startIndex = Math.max(0, since ?? 0);
		const rawLines = session.buffer.slice(startIndex);
		const { lines, redactedCount } = redactLogcatLines(rawLines);
		return {
			lines,
			lineCount: session.buffer.length,
			redactedCount,
		};
	}

	/**
	 * Stop a logcat streaming session and return stats.
	 */
	public stopLogcat(sessionId: string): { totalLines: number; durationMs: number; bufferBytes: number; bytesDropped: number } {
		const session = activeSessions.get(sessionId);
		if (!session) {
			throw new ActionableError(`Logcat session "${sessionId}" not found.`);
		}

		clearTimeout(session.timer);
		session.process.kill("SIGTERM");
		activeSessions.delete(sessionId);

		const durationMs = Date.now() - session.startTime;
		trace(`Logcat session ${sessionId} stopped: ${session.buffer.length} lines, ${session.bufferBytes}B (dropped ${session.bytesDropped}B), ${durationMs}ms`);

		return {
			totalLines: session.buffer.length,
			durationMs,
			bufferBytes: session.bufferBytes,
			bytesDropped: session.bytesDropped,
		};
	}

	/**
	 * Idempotent session bootstrap — return the existing live session for this
	 * device if one exists and has time left, otherwise start a new one with the
	 * default ATP_* tags. Used by atp_run_step to remove the "must remember to
	 * call atp_logcat_start first" foot-gun. See C8 in IMPROVEMENT_PLAN.md.
	 */
	public ensureLogcatSession(
		tags: string[] = ["ATP_SCREEN", "ATP_RENDER", "ATP_API"],
		durationSeconds = 300,
	): LogcatSession {
		const existing = AndroidRobot.getSessionByDevice(this.deviceId);
		if (existing) {
			const elapsed = Date.now() - existing.startTime;
			if (elapsed < existing.maxDuration) {
				return existing;
			}
		}
		return this.startLogcat(tags, durationSeconds);
	}

	/** Get an active logcat session by ID (for server.ts to check existence) */
	public static getSession(sessionId: string): LogcatSession | undefined {
		return activeSessions.get(sessionId);
	}

	/** Get the most recent active logcat session for a device (for TextTier) */
	public static getSessionByDevice(deviceId: string): LogcatSession | undefined {
		let latest: LogcatSession | undefined;
		for (const session of activeSessions.values()) {
			if (session.deviceId === deviceId) {
				if (!latest || session.startTime > latest.startTime) {
					latest = session;
				}
			}
		}
		return latest;
	}
}

export class AndroidDeviceManager {

	private getDeviceType(name: string): AndroidDeviceType {
		try {
			const device = new AndroidRobot(name);
			const features = device.getSystemFeatures();
			if (features.includes("android.software.leanback") || features.includes("android.hardware.type.television")) {
				return "tv";
			}
			return "mobile";
		} catch (error) {
			// Fallback to mobile if we cannot determine device type
			return "mobile";
		}
	}

	private getDeviceVersion(deviceId: string): string {
		try {
			const output = execFileSync(getAdbPath(), ["-s", deviceId, "shell", "getprop", "ro.build.version.release"], {
				timeout: 5000,
			}).toString().trim();
			return output;
		} catch (error) {
			return "unknown";
		}
	}

	private getDeviceName(deviceId: string): string {
		try {
			// Try getting AVD name first (for emulators)
			const avdName = execFileSync(getAdbPath(), ["-s", deviceId, "shell", "getprop", "ro.boot.qemu.avd_name"], {
				timeout: 5000,
			}).toString().trim();

			if (avdName !== "") {
				// Replace underscores with spaces (e.g., "Pixel_9_Pro" -> "Pixel 9 Pro")
				return avdName.replace(/_/g, " ");
			}

			// Fall back to product model
			const output = execFileSync(getAdbPath(), ["-s", deviceId, "shell", "getprop", "ro.product.model"], {
				timeout: 5000,
			}).toString().trim();
			return output;
		} catch (error) {
			return deviceId;
		}
	}

	public getConnectedDevices(): AndroidDevice[] {
		try {
			const names = execFileSync(getAdbPath(), ["devices"])
				.toString()
				.split("\n")
				.map(line => line.trim())
				.filter(line => line !== "")
				.filter(line => !line.startsWith("List of devices attached"))
				.filter(line => line.split("\t")[1]?.trim() === "device")  // Only include devices that are online and ready
				.map(line => line.split("\t")[0]);

			return names.map(name => ({
				deviceId: name,
				deviceType: this.getDeviceType(name),
			}));
		} catch (error) {
			console.error("Could not execute adb command, maybe ANDROID_HOME is not set?");
			return [];
		}
	}

	public getConnectedDevicesWithDetails(): Array<AndroidDevice & { version: string, name: string }> {
		try {
			const names = execFileSync(getAdbPath(), ["devices"])
				.toString()
				.split("\n")
				.map(line => line.trim())
				.filter(line => line !== "")
				.filter(line => !line.startsWith("List of devices attached"))
				.filter(line => line.split("\t")[1]?.trim() === "device")  // Only include devices that are online and ready
				.map(line => line.split("\t")[0]);

			return names.map(deviceId => ({
				deviceId,
				deviceType: this.getDeviceType(deviceId),
				version: this.getDeviceVersion(deviceId),
				name: this.getDeviceName(deviceId),
			}));
		} catch (error) {
			console.error("Could not execute adb command, maybe ANDROID_HOME is not set?");
			return [];
		}
	}
}
