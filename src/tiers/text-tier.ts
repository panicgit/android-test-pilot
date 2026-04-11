/**
 * TextTier (Tier 1) — Text-based device state detection
 *
 * Combines dumpsys and logcat to determine app state without screenshots.
 * This is the cheapest and fastest tier — all data is plain text.
 *
 * Data sources:
 * - dumpsys activity: current foreground Activity
 * - dumpsys window: current focused window
 * - logcat (ATP_ tags): screen transitions, View state, API responses
 */

import { AbstractTier } from "./abstract-tier";
import { TierContext, TierResult } from "./types";
import { AndroidRobot } from "../android";

export class TextTier extends AbstractTier {
	readonly name = "text";
	readonly priority = 1;

	async canHandle(context: TierContext): Promise<boolean> {
		try {
			const robot = this.getAndroidRobot(context);
			// Verify device is reachable by running a lightweight ADB command
			void robot.adb("shell", "echo", "ping");
			return true;
		} catch {
			return false;
		}
	}

	async execute(context: TierContext): Promise<TierResult> {
		const robot = this.getAndroidRobot(context);
		const observations: string[] = [];

		// 1. Collect dumpsys info (FALLBACK on ADB failure)
		let activityInfo: string;
		let windowInfo: string;
		try {
			activityInfo = robot.getDumpsysActivity();
			windowInfo = robot.getDumpsysWindow();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				tier: this.name,
				status: "FALLBACK",
				fallbackHint: `dumpsys failed: ${message}`,
			};
		}
		observations.push(`activity: ${activityInfo}`);
		observations.push(`window: ${windowInfo}`);

		// 2. Check logcat expectations if defined
		const expectedLogcat = context.step.expectedLogcat;
		if (!expectedLogcat || expectedLogcat.length === 0) {
			// No logcat expectations — return dumpsys observations only
			return {
				tier: this.name,
				status: "SUCCESS",
				observation: observations.join("\n"),
				rawData: JSON.stringify({ activityInfo, windowInfo }),
			};
		}

		// 3. Find active logcat session for this device
		// Look through sessions for one matching this device
		const session = this.findSessionForDevice(context.deviceId);
		if (!session) {
			return {
				tier: this.name,
				status: "FALLBACK",
				fallbackHint: "No active logcat session for this device. Start one with atp_logcat_start.",
				observation: observations.join("\n"),
				rawData: JSON.stringify({ activityInfo, windowInfo }),
			};
		}

		// 4. Parse logcat buffer for expected patterns
		const logLines = session.buffer;
		const matchResults: Array<{ tag: string; pattern: string; matched: boolean; line?: string }> = [];

		for (const expected of expectedLogcat) {
			let regex: RegExp;
			try {
				regex = new RegExp(expected.pattern);
			} catch {
				// Invalid regex pattern — treat as unmatched
				matchResults.push({ tag: expected.tag, pattern: expected.pattern, matched: false });
				continue;
			}
			const matchingLine = logLines.find(line =>
				line.includes(expected.tag) && regex.test(line)
			);
			matchResults.push({
				tag: expected.tag,
				pattern: expected.pattern,
				matched: !!matchingLine,
				line: matchingLine,
			});
		}

		const allMatched = matchResults.every(r => r.matched);

		observations.push(`logcat matches: ${matchResults.filter(r => r.matched).length}/${matchResults.length}`);

		if (allMatched) {
			return {
				tier: this.name,
				status: "SUCCESS",
				observation: observations.join("\n"),
				verification: {
					passed: true,
					expected: matchResults.map(r => `${r.tag}: ${r.pattern}`).join(", "),
					actual: matchResults.map(r => r.line || "").join(", "),
				},
				rawData: JSON.stringify({ activityInfo, windowInfo, matchResults }),
			};
		}

		if (logLines.length === 0) {
			// No logs at all — FALLBACK to next tier
			return {
				tier: this.name,
				status: "FALLBACK",
				fallbackHint: "Logcat buffer is empty — ATP logs may not be instrumented",
				observation: observations.join("\n"),
				rawData: JSON.stringify({ activityInfo, windowInfo, matchResults }),
			};
		}

		// Some or no matches with logs present — this is a verification failure
		return {
			tier: this.name,
			status: "FAIL",
			observation: observations.join("\n"),
			verification: {
				passed: false,
				expected: matchResults.map(r => `${r.tag}: ${r.pattern}`).join(", "),
				actual: matchResults.filter(r => !r.matched).map(r => `${r.tag}: NOT FOUND`).join(", "),
			},
			rawData: JSON.stringify({ activityInfo, windowInfo, matchResults }),
		};
	}

	private findSessionForDevice(deviceId: string) {
		return AndroidRobot.getSessionByDevice(deviceId);
	}
}
