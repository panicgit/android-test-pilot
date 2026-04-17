/**
 * UiAutomatorTier (Tier 2) — UI hierarchy-based detection
 *
 * Dumps the current View hierarchy via uiautomator and searches
 * for elements by resource-id or text. Can also perform tap actions.
 *
 * Used when Tier 1 (text-based) cannot determine the result.
 */

import { AbstractTier } from "./abstract-tier";
import { TierContext, TierResult } from "./types";

export class UiAutomatorTier extends AbstractTier {
	readonly name = "uiautomator";
	readonly priority = 2;

	async canHandle(context: TierContext): Promise<boolean> {
		// Defer reachability to execute() — getElementsOnScreen will throw if
		// the device is unreachable and the tier will FALLBACK (P1).
		try {
			this.getAndroidRobot(context);
			return true;
		} catch {
			return false;
		}
	}

	async execute(context: TierContext): Promise<TierResult> {
		const robot = this.getAndroidRobot(context);
		const phase = context.phase ?? "verify";

		// 1. Dump UI hierarchy
		const elements = await robot.getElementsOnScreen();

		if (elements.length === 0) {
			return {
				tier: this.name,
				status: "FALLBACK",
				fallbackHint: "UI hierarchy dump returned zero elements",
			};
		}

		const tapTarget = context.step.tapTarget;

		// ── ACT PHASE ──────────────────────────────────────────────
		// Only perform the tap; do not claim verification. The orchestrator
		// runs a separate verify phase afterwards to check expectedLogcat (A5).
		if (phase === "act") {
			if (!tapTarget) {
				return {
					tier: this.name,
					status: "FALLBACK",
					fallbackHint: "Act phase requested but step has no tapTarget",
				};
			}
			if (tapTarget.resourceId) {
				const target = elements.find(el => el.identifier === tapTarget.resourceId);
				if (target) {
					const centerX = target.rect.x + Math.floor(target.rect.width / 2);
					const centerY = target.rect.y + Math.floor(target.rect.height / 2);
					await robot.tap(centerX, centerY);
					return {
						tier: this.name,
						status: "SUCCESS",
						observation: `Tapped ${tapTarget.resourceId} at (${centerX}, ${centerY})`,
						rawData: JSON.stringify({ target, elementsCount: elements.length }),
					};
				}
				return {
					tier: this.name,
					status: "FAIL",
					observation: `Element with resource-id "${tapTarget.resourceId}" not found in ${elements.length} elements`,
					verification: {
						passed: false,
						expected: `resource-id: ${tapTarget.resourceId}`,
						actual: `Not found. Available IDs: ${elements.filter(e => e.identifier).map(e => e.identifier).slice(0, 10).join(", ")}`,
					},
					rawData: JSON.stringify({ elementsCount: elements.length }),
				};
			}
			if (tapTarget.coordinates) {
				await robot.tap(tapTarget.coordinates.x, tapTarget.coordinates.y);
				return {
					tier: this.name,
					status: "SUCCESS",
					observation: `Tapped coordinates (${tapTarget.coordinates.x}, ${tapTarget.coordinates.y})`,
				};
			}
			return {
				tier: this.name,
				status: "FALLBACK",
				fallbackHint: "tapTarget provided but neither resourceId nor coordinates resolved",
			};
		}

		// ── VERIFY PHASE ───────────────────────────────────────────
		// No tap — just report UI state for downstream consumption or to
		// confirm the expected element appeared. If the step had a tapTarget
		// AND expectedLogcat, we FALLBACK to let TextTier make the call on
		// logcat evidence (A5) — returning SUCCESS here would be the old bug.
		if (tapTarget && (context.step.expectedLogcat?.length ?? 0) > 0) {
			return {
				tier: this.name,
				status: "FALLBACK",
				fallbackHint: "Step declares expectedLogcat — defer verification to TextTier",
				observation: `UI hierarchy: ${elements.length} elements found`,
			};
		}

		const summary = elements.slice(0, 20).map(el => ({
			type: el.type,
			text: el.text,
			id: el.identifier,
		}));

		return {
			tier: this.name,
			status: "SUCCESS",
			observation: `UI hierarchy: ${elements.length} elements found`,
			rawData: JSON.stringify(summary),
		};
	}
}
