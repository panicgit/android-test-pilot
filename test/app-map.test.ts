import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAppMap, _resetAppMapCache, resolveAppMapDir } from "../src/app-map";

describe("AppMap loader (A1 + T9)", () => {
	let tmpRoot: string;

	beforeEach(() => {
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atp-appmap-"));
		fs.mkdirSync(path.join(tmpRoot, ".claude", "app-map"), { recursive: true });
		process.env.ATP_PROJECT_ROOT = tmpRoot;
		_resetAppMapCache();
	});

	afterEach(() => {
		delete process.env.ATP_PROJECT_ROOT;
		fs.rmSync(tmpRoot, { recursive: true, force: true });
		_resetAppMapCache();
	});

	it("uses ATP_PROJECT_ROOT env var to resolve the artifact directory", () => {
		const dir = resolveAppMapDir();
		assert.strictEqual(dir, path.join(tmpRoot, ".claude", "app-map"));
	});

	it("returns warnings for each missing artifact instead of silent empty", () => {
		const { appMap, warnings } = loadAppMap();
		assert.strictEqual(appMap.apiScenarios.length, 0);
		assert.strictEqual(appMap.viewStateMap.length, 0);
		assert.strictEqual(warnings.length, 3);
		assert.ok(warnings.some(w => w.includes("navigation_map.mermaid")));
		assert.ok(warnings.some(w => w.includes("api_scenarios.json")));
		assert.ok(warnings.some(w => w.includes("view_state_map.json")));
	});

	it("loads valid api_scenarios.json with schema validation", () => {
		const apiPath = path.join(tmpRoot, ".claude", "app-map", "api_scenarios.json");
		fs.writeFileSync(apiPath, JSON.stringify({
			apis: [{
				endpoint: "GET /api/users",
				interfaceFile: "UserApi.kt:15",
				callers: [{ file: "UserViewModel.kt:42", successHandler: "UserViewModel.kt:45-50", errorHandler: "UserViewModel.kt:51-55" }],
			}],
		}));
		const { appMap } = loadAppMap();
		assert.strictEqual(appMap.apiScenarios.length, 1);
		assert.strictEqual(appMap.apiScenarios[0].endpoint, "GET /api/users");
	});

	it("rejects invalid JSON with a warning instead of throwing", () => {
		const apiPath = path.join(tmpRoot, ".claude", "app-map", "api_scenarios.json");
		fs.writeFileSync(apiPath, "{ this is not json");
		const { appMap, warnings } = loadAppMap();
		assert.strictEqual(appMap.apiScenarios.length, 0);
		assert.ok(warnings.some(w => w.includes("Invalid JSON in api_scenarios.json")));
	});

	it("rejects schema mismatch with a warning", () => {
		const apiPath = path.join(tmpRoot, ".claude", "app-map", "api_scenarios.json");
		fs.writeFileSync(apiPath, JSON.stringify({ wrongKey: "value" }));
		const { appMap, warnings } = loadAppMap();
		assert.strictEqual(appMap.apiScenarios.length, 0);
		assert.ok(warnings.some(w => w.includes("Schema validation failed for api_scenarios.json")));
	});

	it("caches results based on mtime and re-reads when files change", () => {
		const apiPath = path.join(tmpRoot, ".claude", "app-map", "api_scenarios.json");
		fs.writeFileSync(apiPath, JSON.stringify({ apis: [] }));
		const first = loadAppMap();
		assert.strictEqual(first.appMap.apiScenarios.length, 0);

		// Mutate file with new content + bump mtime explicitly
		fs.writeFileSync(apiPath, JSON.stringify({
			apis: [{ endpoint: "POST /x", interfaceFile: "X.kt:1", callers: [] }],
		}));
		const future = new Date(Date.now() + 1000);
		fs.utimesSync(apiPath, future, future);

		const second = loadAppMap();
		assert.strictEqual(second.appMap.apiScenarios.length, 1);
		assert.strictEqual(second.appMap.apiScenarios[0].endpoint, "POST /x");
	});
});
