import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateScenarioFile, ScenarioSchema } from "../src/scenario";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atp-scenario-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

const write = (name: string, content: string): string => {
	const p = path.join(tmpDir, name);
	fs.writeFileSync(p, content);
	return p;
};

describe("validateScenarioFile (A7)", () => {
	it("accepts a minimal valid JSON scenario", () => {
		const p = write("ok.json", JSON.stringify({
			name: "login",
			steps: [{
				action: "launch",
				verification: "login shown",
				expectedLogcat: [{ tag: "ATP_SCREEN", pattern: "enter: LoginActivity" }],
			}],
		}));
		const r = validateScenarioFile(p);
		assert.strictEqual(r.ok, true);
		assert.strictEqual(r.scenario?.steps.length, 1);
		assert.strictEqual(r.errors.length, 0);
	});

	it("flags ATP_VIEW as a typo for ATP_RENDER", () => {
		const p = write("typo.json", JSON.stringify({
			name: "typo",
			steps: [{
				action: "x",
				verification: "y",
				expectedLogcat: [{ tag: "ATP_RENDER", pattern: "x" }],
			}],
		}).replace("ATP_RENDER", "ATP_VIEW"));
		const r = validateScenarioFile(p);
		assert.strictEqual(r.ok, false);
		// Either the raw-text typo check or the enum validation should catch it
		const joined = [...r.warnings, ...r.errors].join("\n");
		assert.match(joined, /ATP_VIEW|ATP_RENDER/);
	});

	it("rejects a scenario with zero steps", () => {
		const p = write("empty.json", JSON.stringify({ name: "x", steps: [] }));
		const r = validateScenarioFile(p);
		assert.strictEqual(r.ok, false);
	});

	it("rejects a step with neither resourceId nor coords in tapTarget", () => {
		const p = write("bad-tap.json", JSON.stringify({
			name: "x",
			steps: [{
				action: "tap",
				verification: "y",
				tapTarget: { /* empty */ },
			}],
		}));
		const r = validateScenarioFile(p);
		assert.strictEqual(r.ok, false);
		assert.ok(r.errors.some(e => /resourceId or both x and y/.test(e)));
	});

	it("rejects a regex pattern that will not compile", () => {
		const p = write("bad-regex.json", JSON.stringify({
			name: "x",
			steps: [{
				action: "y",
				verification: "z",
				expectedLogcat: [{ tag: "ATP_API", pattern: "status=200[" }],
			}],
		}));
		const r = validateScenarioFile(p);
		assert.strictEqual(r.ok, false);
		assert.ok(r.errors.some(e => /Invalid regex pattern/.test(e)));
	});

	it("rejects a non-.json / non-.md extension", () => {
		const p = write("scenario.txt", "anything");
		const r = validateScenarioFile(p);
		assert.strictEqual(r.ok, false);
		assert.ok(r.errors.some(e => /Unsupported scenario extension/.test(e)));
	});

	it("accepts a markdown scenario with JSON front-matter", () => {
		const p = write("ok.md", [
			"---",
			JSON.stringify({
				name: "md-scenario",
				steps: [{ action: "a", verification: "v" }],
			}),
			"---",
			"",
			"Human-readable body follows.",
			"",
		].join("\n"));
		const r = validateScenarioFile(p);
		assert.strictEqual(r.ok, true);
		assert.strictEqual(r.scenario?.name, "md-scenario");
	});

	it("ScenarioSchema is exported for reuse", () => {
		const r = ScenarioSchema.safeParse({ name: "x", steps: [{ action: "a", verification: "v" }] });
		assert.strictEqual(r.success, true);
	});
});
