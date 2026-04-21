"use strict";
/**
 * AbstractTier — Base class for all Tier plugins
 *
 * Each Tier implements two methods:
 * - canHandle(): checks if this Tier can process the current context
 * - execute(): performs the actual observation/interaction and returns a result
 *
 * Tiers are ordered by priority (lower = runs first).
 * TierRunner calls them in sequence until one returns SUCCESS, FAIL, or ERROR.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbstractTier = void 0;
const android_1 = require("../android");
class AbstractTier {
    /**
     * Construct a fresh AndroidRobot for the given context device.
     *
     * Tiers are stateless (A4) — safe to share across concurrent runs on
     * different devices. AndroidRobot's constructor does no I/O, so the
     * allocation is effectively free.
     */
    getAndroidRobot(context) {
        return new android_1.AndroidRobot(context.deviceId);
    }
}
exports.AbstractTier = AbstractTier;
//# sourceMappingURL=abstract-tier.js.map