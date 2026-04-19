import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveAppMapDir, _resetAppMapCache } from "../src/app-map";

describe("AppMap symlink containment (SR-5)", () => {
	let realRoot: string;
	let escapeRoot: string;

	beforeEach(() => {
		realRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atp-real-"));
		escapeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "atp-escape-"));
		_resetAppMapCache();
	});

	afterEach(() => {
		delete process.env.ATP_PROJECT_ROOT;
		fs.rmSync(realRoot, { recursive: true, force: true });
		fs.rmSync(escapeRoot, { recursive: true, force: true });
		_resetAppMapCache();
	});

	it("allows a normal (non-symlinked) app-map dir", () => {
		fs.mkdirSync(path.join(realRoot, ".claude", "app-map"), { recursive: true });
		process.env.ATP_PROJECT_ROOT = realRoot;
		const dir = resolveAppMapDir();
		assert.ok(dir.startsWith(realRoot));
	});

	it("throws when .claude/app-map is a symlink pointing outside the project root", () => {
		// Create a malicious setup: target is an unrelated directory
		fs.mkdirSync(path.join(escapeRoot, "stolen"), { recursive: true });
		fs.mkdirSync(path.join(realRoot, ".claude"), { recursive: true });
		fs.symlinkSync(path.join(escapeRoot, "stolen"), path.join(realRoot, ".claude", "app-map"));

		process.env.ATP_PROJECT_ROOT = realRoot;
		assert.throws(
			() => resolveAppMapDir(),
			/symlink escapes project root/,
		);
	});

	it("allows an internal symlink that stays inside the project root", () => {
		fs.mkdirSync(path.join(realRoot, ".claude", "inner"), { recursive: true });
		fs.symlinkSync(path.join(realRoot, ".claude", "inner"), path.join(realRoot, ".claude", "app-map"));
		process.env.ATP_PROJECT_ROOT = realRoot;
		const dir = resolveAppMapDir();
		assert.ok(dir.endsWith("app-map"));
	});
});
