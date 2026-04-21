import { Button, InstalledApp, Robot, ScreenElement, ScreenSize, SwipeDirection, Orientation } from "./robot";
import { LogcatSession, LogcatSessionRegistry } from "./logcat-registry";
export { LogcatSession };
export interface AndroidDevice {
    deviceId: string;
    deviceType: "tv" | "mobile";
}
/** Redact obvious secrets from an array of logcat lines. */
export declare const redactLogcatLines: (lines: string[]) => {
    lines: string[];
    redactedCount: number;
};
export declare class AndroidRobot implements Robot {
    private deviceId;
    /** Injectable session registry — tests pass a fresh one for isolation. */
    private readonly registry;
    constructor(deviceId: string, 
    /** Injectable session registry — tests pass a fresh one for isolation. */
    registry?: LogcatSessionRegistry);
    getDeviceId(): string;
    /**
     * Run an adb command asynchronously against this device and return the
     * combined stdout as a Buffer. Never blocks the event loop (S3-1).
     * Throws on non-zero exit; the thrown object carries `.stdout`/`.stderr`
     * for `formatAdbError()` to unwrap.
     */
    adb(...args: string[]): Promise<Buffer>;
    /** Like adb() but suppresses stdout/stderr streaming when the caller
     * doesn't care about output (e.g. fire-and-forget setters). */
    silentAdb(...args: string[]): Promise<Buffer>;
    getSystemFeatures(): Promise<string[]>;
    getScreenSize(): Promise<ScreenSize>;
    listApps(): Promise<InstalledApp[]>;
    private listPackages;
    launchApp(packageName: string, locale?: string): Promise<void>;
    listRunningProcesses(): Promise<string[]>;
    swipe(direction: SwipeDirection): Promise<void>;
    swipeFromCoordinate(x: number, y: number, direction: SwipeDirection, distance?: number): Promise<void>;
    private getDisplayCount;
    private getFirstDisplayId;
    getScreenshot(): Promise<Buffer>;
    private collectElements;
    getElementsOnScreen(): Promise<ScreenElement[]>;
    terminateApp(packageName: string): Promise<void>;
    installApp(path: string): Promise<void>;
    uninstallApp(bundleId: string): Promise<void>;
    openUrl(url: string): Promise<void>;
    private isAscii;
    private escapeShellText;
    private isDeviceKitInstalled;
    sendKeys(text: string): Promise<void>;
    pressButton(button: Button): Promise<void>;
    tap(x: number, y: number): Promise<void>;
    longPress(x: number, y: number, duration: number): Promise<void>;
    doubleTap(x: number, y: number): Promise<void>;
    setOrientation(orientation: Orientation): Promise<void>;
    getOrientation(): Promise<Orientation>;
    private getUiAutomatorDump;
    private getUiAutomatorXml;
    private getScreenElementRect;
    /**
     * Get the current foreground Activity via dumpsys.
     * Returns parsed activity info as text.
     */
    getDumpsysActivity(): Promise<string>;
    /**
     * Get the current focused window via dumpsys.
     */
    getDumpsysWindow(): Promise<string>;
    /**
     * Start a logcat streaming session.
     * Spawns `adb logcat` as a background process and buffers output.
     */
    startLogcat(tags: string[], durationSeconds: number): LogcatSession;
    /**
     * Read collected log lines from an active session.
     * @param since - If provided, only return lines after this index (for incremental reads)
     *
     * Lines are passed through a redaction filter (S8) that strips obvious
     * secrets (Bearer tokens, token/password/api_key key=value pairs, email
     * addresses). Opt out with `MOBILEMCP_DISABLE_REDACTION=1` when debugging.
     */
    readLogcat(sessionId: string, since?: number): {
        lines: string[];
        lineCount: number;
        redactedCount: number;
    };
    /**
     * Stop a logcat streaming session and return stats.
     */
    stopLogcat(sessionId: string): {
        totalLines: number;
        durationMs: number;
        bufferBytes: number;
        bytesDropped: number;
    };
    /**
     * Idempotent session bootstrap — return the existing live session for this
     * device if one exists and has time left, otherwise start a new one with the
     * default ATP_* tags. Used by atp_run_step to remove the "must remember to
     * call atp_logcat_start first" foot-gun. See C8 in IMPROVEMENT_PLAN.md.
     */
    ensureLogcatSession(tags?: string[], durationSeconds?: number): LogcatSession;
    /** Get an active logcat session by ID (for server.ts to check existence) */
    static getSession(sessionId: string, registry?: LogcatSessionRegistry): LogcatSession | undefined;
    /** Get the most recent active logcat session for a device (for TextTier) */
    static getSessionByDevice(deviceId: string, registry?: LogcatSessionRegistry): LogcatSession | undefined;
}
export declare class AndroidDeviceManager {
    private getDeviceType;
    private getDeviceVersion;
    private getDeviceName;
    getConnectedDevices(): Promise<AndroidDevice[]>;
    getConnectedDevicesWithDetails(): Promise<Array<AndroidDevice & {
        version: string;
        name: string;
    }>>;
}
