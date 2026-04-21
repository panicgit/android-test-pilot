"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AndroidDeviceManager = exports.AndroidRobot = exports.redactLogcatLines = void 0;
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const node_fs_1 = require("node:fs");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
const xml = __importStar(require("fast-xml-parser"));
const robot_1 = require("./robot");
const utils_1 = require("./utils");
const logger_1 = require("./logger");
const logcat_registry_1 = require("./logcat-registry");
/** Max lines to keep in a logcat session buffer to prevent memory exhaustion */
const MAX_LOGCAT_LINES = 50_000;
/** Max bytes per session buffer — defense against very long log lines (H2). */
const MAX_LOGCAT_BYTES = 64 * 1024 * 1024;
const getAdbPath = () => {
    const exeName = process.env.platform === "win32" ? "adb.exe" : "adb";
    if (process.env.ANDROID_HOME) {
        return node_path_1.default.join(process.env.ANDROID_HOME, "platform-tools", exeName);
    }
    if (process.platform === "win32" && process.env.LOCALAPPDATA) {
        const windowsAdbPath = node_path_1.default.join(process.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", "adb.exe");
        if ((0, node_fs_1.existsSync)(windowsAdbPath)) {
            return windowsAdbPath;
        }
    }
    if (process.platform === "darwin" && process.env.HOME) {
        const defaultAndroidSdk = node_path_1.default.join(process.env.HOME, "Library", "Android", "sdk", "platform-tools", "adb");
        if ((0, node_fs_1.existsSync)(defaultAndroidSdk)) {
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
const REDACTION_PATTERNS = [
    // Authorization: Bearer <token>  — covers JWTs and opaque tokens.
    { pattern: /Bearer\s+[A-Za-z0-9._~%:\-+/=]{8,}/gi, replacement: "Bearer [REDACTED]" },
    // Authorization: Basic <base64>  (SR-1).
    { pattern: /Basic\s+[A-Za-z0-9+/=]{8,}/gi, replacement: "Basic [REDACTED]" },
    // key=value / key: value / "key":"value" — matches plain, single-quoted,
    // and double-quoted variants. Consumes any surrounding quotes around the
    // key AND the value so JSON-encoded payloads like `"password":"hunter2"`
    // don't leak either half after replacement (SR-3).
    { pattern: /["']?(token|password|passwd|secret|api[_-]?key|auth|authorization|refresh[_-]?token|access[_-]?token|session[_-]?id|cookie)["']?\s*[:=]\s*["']?[^"'\s,;}\]]+["']?/gi, replacement: "$1=[REDACTED]" },
    // Email addresses.
    { pattern: /[\w.+\-]+@[\w\-]+\.[A-Za-z]{2,}/g, replacement: "[EMAIL-REDACTED]" },
    // Card-shaped digit runs are redacted via redactCardShapes() below; Luhn
    // check reduces false positives on timestamps and trace IDs (SR-2).
];
/**
 * Luhn check for card-shape digit strings. Reduces false positives on
 * timestamps, phone numbers, trace IDs that happen to be 13-19 digits
 * (SR-2).
 */
const passesLuhn = (digits) => {
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let n = digits.charCodeAt(i) - 48;
        if (n < 0 || n > 9)
            return false;
        if (alt) {
            n *= 2;
            if (n > 9)
                n -= 9;
        }
        sum += n;
        alt = !alt;
    }
    return sum % 10 === 0;
};
const CARD_SHAPE = /\b(?:\d[ -]?){13,19}\b/g;
const redactCardShapes = (line) => line.replace(CARD_SHAPE, (match) => {
    const digits = match.replace(/[ -]/g, "");
    return passesLuhn(digits) ? "[CARD-REDACTED]" : match;
});
/** Redact obvious secrets from an array of logcat lines. */
const redactLogcatLines = (lines) => {
    if (process.env.MOBILEMCP_DISABLE_REDACTION === "1") {
        return { lines, redactedCount: 0 };
    }
    let redactedCount = 0;
    const out = lines.map(line => {
        let redacted = line;
        for (const { pattern, replacement } of REDACTION_PATTERNS) {
            redacted = redacted.replace(pattern, replacement);
        }
        redacted = redactCardShapes(redacted);
        if (redacted !== line)
            redactedCount++;
        return redacted;
    });
    return { lines: out, redactedCount };
};
exports.redactLogcatLines = redactLogcatLines;
/** Type predicate narrowing unknown to ChildProcessError (T-R2). */
const isChildProcessError = (e) => {
    return typeof e === "object" && e !== null &&
        ("stdout" in e || "stderr" in e || "message" in e);
};
/** Extract a readable message from a child-process throw. */
const formatAdbError = (error) => {
    if (!isChildProcessError(error))
        return String(error);
    const stdout = error.stdout ? error.stdout.toString() : "";
    const stderr = error.stderr ? error.stderr.toString() : "";
    const output = (stdout + stderr).trim();
    return output || error.message || String(error);
};
const BUTTON_MAP = {
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
class AndroidRobot {
    deviceId;
    registry;
    constructor(deviceId, 
    /** Injectable session registry — tests pass a fresh one for isolation. */
    registry = logcat_registry_1.DEFAULT_REGISTRY) {
        this.deviceId = deviceId;
        this.registry = registry;
    }
    getDeviceId() {
        return this.deviceId;
    }
    /**
     * Run an adb command asynchronously against this device and return the
     * combined stdout as a Buffer. Never blocks the event loop (S3-1).
     * Throws on non-zero exit; the thrown object carries `.stdout`/`.stderr`
     * for `formatAdbError()` to unwrap.
     */
    async adb(...args) {
        const { stdout } = await execFileAsync(getAdbPath(), ["-s", this.deviceId, ...args], {
            maxBuffer: MAX_BUFFER_SIZE,
            timeout: TIMEOUT,
            encoding: "buffer",
        });
        return stdout;
    }
    /** Like adb() but suppresses stdout/stderr streaming when the caller
     * doesn't care about output (e.g. fire-and-forget setters). */
    async silentAdb(...args) {
        const { stdout } = await execFileAsync(getAdbPath(), ["-s", this.deviceId, ...args], {
            maxBuffer: MAX_BUFFER_SIZE,
            timeout: TIMEOUT,
            encoding: "buffer",
        });
        return stdout;
    }
    async getSystemFeatures() {
        const output = (await this.adb("shell", "pm", "list", "features")).toString();
        return output
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.startsWith("feature:"))
            .map(line => line.substring("feature:".length));
    }
    async getScreenSize() {
        const screenSize = (await this.adb("shell", "wm", "size"))
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
    async listApps() {
        // only apps that have a launcher activity are returned
        const output = (await this.adb("shell", "cmd", "package", "query-activities", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER")).toString();
        return output
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
    async listPackages() {
        const output = (await this.adb("shell", "pm", "list", "packages")).toString();
        return output
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.startsWith("package:"))
            .map(line => line.substring("package:".length));
    }
    async launchApp(packageName, locale) {
        (0, utils_1.validatePackageName)(packageName);
        if (locale) {
            (0, utils_1.validateLocale)(locale);
            try {
                await this.silentAdb("shell", "cmd", "locale", "set-app-locales", packageName, "--locales", locale);
            }
            catch {
                // set-app-locales requires Android 13+ (API 33), silently ignore on older versions
            }
        }
        try {
            await this.silentAdb("shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1");
        }
        catch {
            throw new robot_1.ActionableError(`Failed launching app with package name "${packageName}", please make sure it exists`);
        }
    }
    async listRunningProcesses() {
        const output = (await this.adb("shell", "ps", "-e")).toString();
        return output
            .split("\n")
            .map(line => line.trim())
            .filter(line => line.startsWith("u")) // non-system processes
            .map(line => line.split(/\s+/)[8]); // get process name
    }
    async swipe(direction) {
        const screenSize = await this.getScreenSize();
        const centerX = screenSize.width >> 1;
        let x0, y0, x1, y1;
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
                throw new robot_1.ActionableError(`Swipe direction "${direction}" is not supported`);
        }
        await this.adb("shell", "input", "swipe", `${x0}`, `${y0}`, `${x1}`, `${y1}`, "1000");
    }
    async swipeFromCoordinate(x, y, direction, distance) {
        const screenSize = await this.getScreenSize();
        let x0, y0, x1, y1;
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
                throw new robot_1.ActionableError(`Swipe direction "${direction}" is not supported`);
        }
        await this.adb("shell", "input", "swipe", `${x0}`, `${y0}`, `${x1}`, `${y1}`, "1000");
    }
    async getDisplayCount() {
        const output = (await this.adb("shell", "dumpsys", "SurfaceFlinger", "--display-id")).toString();
        return output
            .split("\n")
            .filter(s => s.startsWith("Display "))
            .length;
    }
    async getFirstDisplayId() {
        try {
            // Try using cmd display get-displays (Android 11+)
            const displays = (await this.adb("shell", "cmd", "display", "get-displays"))
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
        }
        catch {
            // cmd display get-displays not available on this device
        }
        // fallback: parse dumpsys display for display info (compatible with older Android versions)
        try {
            const dumpsys = (await this.adb("shell", "dumpsys", "display")).toString();
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
        }
        catch {
            // dumpsys display also failed
        }
        return null;
    }
    async getScreenshot() {
        if ((await this.getDisplayCount()) <= 1) {
            // backward compatibility for android 10 and below, and for single display devices
            return this.adb("exec-out", "screencap", "-p");
        }
        // find the first display that is turned on, and capture that one
        const displayId = await this.getFirstDisplayId();
        if (displayId === null) {
            // no idea why, but we have displayCount >= 2, yet we failed to parse
            // let's go with screencap's defaults and hope for the best
            return this.adb("exec-out", "screencap", "-p");
        }
        return this.adb("exec-out", "screencap", "-p", "-d", `${displayId}`);
    }
    collectElements(node) {
        const elements = [];
        if (node.node) {
            if (Array.isArray(node.node)) {
                for (const childNode of node.node) {
                    elements.push(...this.collectElements(childNode));
                }
            }
            else {
                elements.push(...this.collectElements(node.node));
            }
        }
        if (node.text || node["content-desc"] || node.hint || node["resource-id"] || node.checkable === "true") {
            const element = {
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
    async getElementsOnScreen() {
        const parsedXml = await this.getUiAutomatorXml();
        const hierarchy = parsedXml.hierarchy;
        const elements = this.collectElements(hierarchy.node);
        return elements;
    }
    async terminateApp(packageName) {
        (0, utils_1.validatePackageName)(packageName);
        await this.adb("shell", "am", "force-stop", packageName);
    }
    async installApp(path) {
        try {
            await this.adb("install", "-r", path);
        }
        catch (error) {
            throw new robot_1.ActionableError(formatAdbError(error));
        }
    }
    async uninstallApp(bundleId) {
        try {
            await this.adb("uninstall", bundleId);
        }
        catch (error) {
            throw new robot_1.ActionableError(formatAdbError(error));
        }
    }
    async openUrl(url) {
        await this.adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", this.escapeShellText(url));
    }
    isAscii(text) {
        return /^[\x00-\x7F]*$/.test(text);
    }
    escapeShellText(text) {
        // escape all shell special characters that could be used for injection
        return text.replace(/[\\'"` \t\n\r|&;()<>{}[\]$*?]/g, "\\$&");
    }
    async isDeviceKitInstalled() {
        const packages = await this.listPackages();
        return packages.includes("com.mobilenext.devicekit");
    }
    async sendKeys(text) {
        if (text === "") {
            // bailing early, so we don't run adb shell with empty string.
            // this happens when you prompt with a simple "submit".
            return;
        }
        if (this.isAscii(text)) {
            // adb shell input only supports ascii characters. and
            // some of the keys have to be escaped.
            const _text = this.escapeShellText(text);
            await this.adb("shell", "input", "text", _text);
        }
        else if (await this.isDeviceKitInstalled()) {
            // try sending over clipboard
            const base64 = Buffer.from(text).toString("base64");
            // send clipboard over and immediately paste it
            await this.adb("shell", "am", "broadcast", "-a", "devicekit.clipboard.set", "-e", "encoding", "base64", "-e", "text", base64, "-n", "com.mobilenext.devicekit/.ClipboardBroadcastReceiver");
            await this.adb("shell", "input", "keyevent", "KEYCODE_PASTE");
            // clear clipboard when we're done
            await this.adb("shell", "am", "broadcast", "-a", "devicekit.clipboard.clear", "-n", "com.mobilenext.devicekit/.ClipboardBroadcastReceiver");
        }
        else {
            throw new robot_1.ActionableError("Non-ASCII text is not supported on Android, please install mobilenext devicekit, see https://github.com/mobile-next/devicekit-android");
        }
    }
    async pressButton(button) {
        if (!BUTTON_MAP[button]) {
            throw new robot_1.ActionableError(`Button "${button}" is not supported`);
        }
        const mapped = BUTTON_MAP[button];
        await this.adb("shell", "input", "keyevent", mapped);
    }
    async tap(x, y) {
        await this.adb("shell", "input", "tap", `${x}`, `${y}`);
    }
    async longPress(x, y, duration) {
        // a long press is a swipe with no movement and a long duration
        await this.adb("shell", "input", "swipe", `${x}`, `${y}`, `${x}`, `${y}`, `${duration}`);
    }
    async doubleTap(x, y) {
        await this.tap(x, y);
        await new Promise(r => setTimeout(r, 100)); // short delay
        await this.tap(x, y);
    }
    async setOrientation(orientation) {
        const value = orientation === "portrait" ? 0 : 1;
        // disable auto-rotation prior to setting the orientation
        await this.adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
        await this.adb("shell", "content", "insert", "--uri", "content://settings/system", "--bind", "name:s:user_rotation", "--bind", `value:i:${value}`);
    }
    async getOrientation() {
        const rotation = (await this.adb("shell", "settings", "get", "system", "user_rotation")).toString().trim();
        return rotation === "0" ? "portrait" : "landscape";
    }
    async getUiAutomatorDump() {
        for (let tries = 0; tries < 10; tries++) {
            const dump = (await this.adb("exec-out", "uiautomator", "dump", "/dev/tty")).toString();
            // note: we're not catching other errors here. maybe we should check for <?xml
            if (dump.includes("null root node returned by UiTestAutomationBridge")) {
                // uncomment for debugging
                // const screenshot = await this.getScreenshot();
                // console.error("Failed to get UIAutomator XML. Here's a screenshot: " + screenshot.toString("base64"));
                continue;
            }
            return dump.substring(dump.indexOf("<?xml"));
        }
        throw new robot_1.ActionableError("Failed to get UIAutomator XML");
    }
    async getUiAutomatorXml() {
        const dump = await this.getUiAutomatorDump();
        const parser = new xml.XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "",
        });
        return parser.parse(dump);
    }
    getScreenElementRect(node) {
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
    async getDumpsysActivity() {
        try {
            const output = (await this.adb("shell", "dumpsys", "activity", "activities")).toString();
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
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return JSON.stringify({ error: message });
        }
    }
    /**
     * Get the current focused window via dumpsys.
     */
    async getDumpsysWindow() {
        try {
            const output = (await this.adb("shell", "dumpsys", "window", "windows")).toString();
            const lines = output.split("\n");
            const focusedLine = lines.find(l => l.includes("mCurrentFocus") || l.includes("mFocusedWindow"));
            const inputLine = lines.find(l => l.includes("mInputMethodTarget"));
            return JSON.stringify({
                currentFocus: focusedLine?.trim() || null,
                inputMethodTarget: inputLine?.trim() || null,
            });
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return JSON.stringify({ error: message });
        }
    }
    // ─── Logcat Session Methods (Tier 1: text-based) ────────────────
    /**
     * Start a logcat streaming session.
     * Spawns `adb logcat` as a background process and buffers output.
     */
    startLogcat(tags, durationSeconds) {
        // Cap concurrent sessions to prevent memory/fd exhaustion (S2 + H8).
        try {
            this.registry.assertCapacity(this.deviceId);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            throw new robot_1.ActionableError(msg);
        }
        const sessionId = node_crypto_1.default.randomUUID();
        // Validate tags to prevent filter manipulation (e.g. "*" would capture all logs)
        const TAG_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
        for (const tag of tags) {
            if (!TAG_PATTERN.test(tag)) {
                throw new robot_1.ActionableError(`Invalid logcat tag "${tag}". Tags must be alphanumeric/underscore, 1-64 chars, starting with a letter or underscore.`);
            }
        }
        // Build logcat filter args: TAG:D for each tag, *:S to silence others
        const filterArgs = tags.map(tag => `${tag}:D`);
        filterArgs.push("*:S");
        const adbPath = getAdbPath();
        const args = ["-s", this.deviceId, "logcat", "-v", "time", ...filterArgs];
        (0, logger_1.trace)(`Logcat start: ${adbPath} ${args.join(" ")}`);
        const proc = (0, node_child_process_1.spawn)(adbPath, args, {
            stdio: ["ignore", "pipe", "pipe"],
        });
        const session = {
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
                (0, logger_1.trace)(`Logcat session ${sessionId} auto-stopped (timeout ${durationSeconds}s)`);
                this.stopLogcat(sessionId);
            }, durationSeconds * 1000),
        };
        const pushLine = (line) => {
            if (!line.trim())
                return;
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
        proc.stdout?.on("data", (chunk) => {
            partial += chunk.toString();
            const lines = partial.split("\n");
            partial = lines.pop() || "";
            for (const line of lines)
                pushLine(line);
        });
        // Flush remaining partial line on stream end
        proc.stdout?.on("end", () => {
            if (partial.trim())
                pushLine(partial);
        });
        // Log stderr for debugging (ADB errors, device disconnects)
        proc.stderr?.on("data", (chunk) => {
            (0, logger_1.trace)(`Logcat session ${sessionId} stderr: ${chunk.toString().trim()}`);
        });
        proc.on("error", (err) => {
            (0, logger_1.trace)(`Logcat session ${sessionId} error: ${err.message}`);
        });
        proc.on("exit", () => {
            clearTimeout(session.timer);
            this.registry.delete(sessionId);
        });
        this.registry.add(session);
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
    readLogcat(sessionId, since) {
        const session = this.registry.get(sessionId);
        if (!session) {
            throw new robot_1.ActionableError(`Logcat session "${sessionId}" not found. It may have expired or been stopped. Next step: call atp_logcat_start to begin a fresh session.`);
        }
        const startIndex = Math.max(0, since ?? 0);
        const rawLines = session.buffer.slice(startIndex);
        const { lines, redactedCount } = (0, exports.redactLogcatLines)(rawLines);
        return {
            lines,
            lineCount: session.buffer.length,
            redactedCount,
        };
    }
    /**
     * Stop a logcat streaming session and return stats.
     */
    stopLogcat(sessionId) {
        const stopped = this.registry.stopAndRemove(sessionId);
        if (!stopped) {
            throw new robot_1.ActionableError(`Logcat session "${sessionId}" not found. It may have already been stopped.`);
        }
        return {
            totalLines: stopped.session.buffer.length,
            durationMs: stopped.durationMs,
            bufferBytes: stopped.session.bufferBytes,
            bytesDropped: stopped.session.bytesDropped,
        };
    }
    /**
     * Idempotent session bootstrap — return the existing live session for this
     * device if one exists and has time left, otherwise start a new one with the
     * default ATP_* tags. Used by atp_run_step to remove the "must remember to
     * call atp_logcat_start first" foot-gun. See C8 in IMPROVEMENT_PLAN.md.
     */
    ensureLogcatSession(tags = ["ATP_SCREEN", "ATP_RENDER", "ATP_API"], durationSeconds = 300) {
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
    static getSession(sessionId, registry = logcat_registry_1.DEFAULT_REGISTRY) {
        return registry.get(sessionId);
    }
    /** Get the most recent active logcat session for a device (for TextTier) */
    static getSessionByDevice(deviceId, registry = logcat_registry_1.DEFAULT_REGISTRY) {
        return registry.latestForDevice(deviceId);
    }
}
exports.AndroidRobot = AndroidRobot;
class AndroidDeviceManager {
    async getDeviceType(name) {
        try {
            const device = new AndroidRobot(name);
            const features = await device.getSystemFeatures();
            if (features.includes("android.software.leanback") || features.includes("android.hardware.type.television")) {
                return "tv";
            }
            return "mobile";
        }
        catch {
            // Fallback to mobile if we cannot determine device type
            return "mobile";
        }
    }
    async getDeviceVersion(deviceId) {
        try {
            const { stdout } = await execFileAsync(getAdbPath(), ["-s", deviceId, "shell", "getprop", "ro.build.version.release"], {
                timeout: 5000,
                encoding: "buffer",
            });
            return stdout.toString().trim();
        }
        catch {
            return "unknown";
        }
    }
    async getDeviceName(deviceId) {
        try {
            // Try getting AVD name first (for emulators)
            const { stdout: avdStdout } = await execFileAsync(getAdbPath(), ["-s", deviceId, "shell", "getprop", "ro.boot.qemu.avd_name"], {
                timeout: 5000,
                encoding: "buffer",
            });
            const avdName = avdStdout.toString().trim();
            if (avdName !== "") {
                // Replace underscores with spaces (e.g., "Pixel_9_Pro" -> "Pixel 9 Pro")
                return avdName.replace(/_/g, " ");
            }
            // Fall back to product model
            const { stdout } = await execFileAsync(getAdbPath(), ["-s", deviceId, "shell", "getprop", "ro.product.model"], {
                timeout: 5000,
                encoding: "buffer",
            });
            return stdout.toString().trim();
        }
        catch {
            return deviceId;
        }
    }
    async getConnectedDevices() {
        try {
            const { stdout } = await execFileAsync(getAdbPath(), ["devices"], {
                encoding: "buffer",
            });
            const names = stdout.toString()
                .split("\n")
                .map(line => line.trim())
                .filter(line => line !== "")
                .filter(line => !line.startsWith("List of devices attached"))
                .filter(line => line.split("\t")[1]?.trim() === "device") // Only include devices that are online and ready
                .map(line => line.split("\t")[0]);
            return Promise.all(names.map(async (name) => ({
                deviceId: name,
                deviceType: await this.getDeviceType(name),
            })));
        }
        catch {
            console.error("Could not execute adb command, maybe ANDROID_HOME is not set?");
            return [];
        }
    }
    async getConnectedDevicesWithDetails() {
        try {
            const { stdout } = await execFileAsync(getAdbPath(), ["devices"], {
                encoding: "buffer",
            });
            const names = stdout.toString()
                .split("\n")
                .map(line => line.trim())
                .filter(line => line !== "")
                .filter(line => !line.startsWith("List of devices attached"))
                .filter(line => line.split("\t")[1]?.trim() === "device") // Only include devices that are online and ready
                .map(line => line.split("\t")[0]);
            return Promise.all(names.map(async (deviceId) => ({
                deviceId,
                deviceType: await this.getDeviceType(deviceId),
                version: await this.getDeviceVersion(deviceId),
                name: await this.getDeviceName(deviceId),
            })));
        }
        catch {
            console.error("Could not execute adb command, maybe ANDROID_HOME is not set?");
            return [];
        }
    }
}
exports.AndroidDeviceManager = AndroidDeviceManager;
//# sourceMappingURL=android.js.map