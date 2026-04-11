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
		try {
			const robot = this.getAndroidRobot(context);
			// Verify uiautomator is responsive
			robot.adb("shell", "echo", "ping");
			return true;
		} catch {
			return false;
		}
	}

	async execute(context: TierContext): Promise<TierResult> {
		const robot = this.getAndroidRobot(context);

		// 1. Dump UI hierarchy
		const elements = await robot.getElementsOnScreen();

		if (elements.length === 0) {
			return {
				tier: this.name,
				status: "FALLBACK",
				fallbackHint: "UI hierarchy dump returned zero elements",
			};
		}

		// 2. If there's a tap target, find and tap it
		const tapTarget = context.step.tapTarget;
		if (tapTarget) {
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
				// resource-id not found
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
		}

		// 3. No tap target — return UI hierarchy as observation
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
