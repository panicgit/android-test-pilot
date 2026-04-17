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
		// Defer reachability to execute() — getDumpsysActivity will throw fast
		// on an unreachable device and the tier will FALLBACK. Skipping a
		// dedicated ADB ping saves one round-trip per step (P1).
		try {
			this.getAndroidRobot(context);
			return true;
		} catch {
			return false;
		}
	}

	async execute(context: TierContext): Promise<TierResult> {
		const robot = this.getAndroidRobot(context);
		const observations: string[] = [];

		// 1. Collect dumpsys info in parallel (P6) — FALLBACK on ADB failure.
		let activityInfo: string;
		let windowInfo: string;
		try {
			[activityInfo, windowInfo] = await Promise.all([
				robot.getDumpsysActivity(),
				robot.getDumpsysWindow(),
			]);
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
			// No logcat expectations — TextTier cannot verify and cannot tap. Fall
			// back so a downstream tier can actually act/verify. Opt out with
			// step.skipVerification = true to accept dumpsys-only success.
			if (context.step.skipVerification) {
				return {
					tier: this.name,
					status: "SUCCESS",
					observation: observations.join("\n") + " (skipVerification=true; dumpsys-only)",
					rawData: JSON.stringify({ activityInfo, windowInfo }),
				};
			}
			return {
				tier: this.name,
				status: "FALLBACK",
				fallbackHint: "No expectedLogcat assertions; TextTier cannot verify or act. Set step.skipVerification=true to accept dumpsys-only.",
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

		// 4. Parse logcat buffer for expected patterns.
		// Pre-compile all regexes up front so we pay O(1) construction cost per
		// pattern regardless of how many log lines we scan (P9).
		const logLines = session.buffer;
		const compiled: Array<{ tag: string; pattern: string; regex: RegExp | null }> = expectedLogcat.map(e => {
			try {
				return { tag: e.tag, pattern: e.pattern, regex: new RegExp(e.pattern) };
			} catch {
				return { tag: e.tag, pattern: e.pattern, regex: null };
			}
		});

		const matchResults: Array<{ tag: string; pattern: string; matched: boolean; line?: string }> = [];
		for (const c of compiled) {
			if (c.regex === null) {
				matchResults.push({ tag: c.tag, pattern: c.pattern, matched: false });
				continue;
			}
			const regex = c.regex;
			const matchingLine = logLines.find(line => line.includes(c.tag) && regex.test(line));
			matchResults.push({
				tag: c.tag,
				pattern: c.pattern,
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
