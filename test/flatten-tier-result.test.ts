import assert from "node:assert";
import { describe, it } from "node:test";
import { flattenTierResult, TierResult } from "../src/tiers/types";

describe("flattenTierResult (T-R6)", () => {
	it("preserves SUCCESS fields and omits absent ones", () => {
		const r: TierResult = {
			tier: "text",
			status: "SUCCESS",
			observation: "ok",
			rawData: "raw",
		};
		const f = flattenTierResult(r);
		assert.deepStrictEqual(f, {
			tier: "text",
			status: "SUCCESS",
			observation: "ok",
			rawData: "raw",
		});
		assert.strictEqual("fallbackHint" in f, false);
		assert.strictEqual("error" in f, false);
	});

	it("requires fallbackHint in FALLBACK output", () => {
		const r: TierResult = {
			tier: "text",
			status: "FALLBACK",
			fallbackHint: "empty buffer",
		};
		const f = flattenTierResult(r);
		assert.strictEqual(f.fallbackHint, "empty buffer");
		assert.strictEqual(f.status, "FALLBACK");
	});

	it("requires error in ERROR output and omits observation/rawData", () => {
		const r: TierResult = {
			tier: "none",
			status: "ERROR",
			error: "all tiers exhausted",
		};
		const f = flattenTierResult(r);
		assert.strictEqual(f.error, "all tiers exhausted");
		assert.strictEqual("observation" in f, false);
		assert.strictEqual("rawData" in f, false);
	});

	it("preserves verification in FAIL output", () => {
		const r: TierResult = {
			tier: "text",
			status: "FAIL",
			observation: "o",
			verification: { passed: false, expected: "x", actual: "y" },
		};
		const f = flattenTierResult(r);
		assert.deepStrictEqual(f.verification, { passed: false, expected: "x", actual: "y" });
	});
});
