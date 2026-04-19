import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TraceContext } from "../src/tracing";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "atp-trace-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
	delete process.env.ATP_TRACE_FILE;
});

describe("TraceContext (A10 / S3-4)", () => {
	it("collects spans across a root + two children", async () => {
		const tracer = new TraceContext();
		await tracer.span("root", { level: 0 }, async () => {
			await tracer.span("child-a", { level: 1 }, async () => {
				await new Promise(resolve => setTimeout(resolve, 5));
			});
			await tracer.span("child-b", { level: 1 }, async () => { /* sync */ });
		});
		const names = tracer.collectedSpans.map(s => s.name);
		assert.deepStrictEqual(names.sort(), ["child-a", "child-b", "root"]);
		for (const s of tracer.collectedSpans) {
			assert.strictEqual(s.status, "OK");
			assert.ok(s.durationMs >= 0);
		}
	});

	it("marks a span ERROR when the wrapped fn throws, still emits the span", async () => {
		const tracer = new TraceContext();
		await assert.rejects(
			tracer.span("crash", {}, async () => { throw new Error("boom"); }),
			/boom/,
		);
		const s = tracer.collectedSpans[0];
		assert.strictEqual(s.status, "ERROR");
		assert.strictEqual(s.attributes["error.message"], "boom");
	});

	it("writes JSONL to ATP_TRACE_FILE when set", async () => {
		const file = path.join(tmpDir, "trace.jsonl");
		process.env.ATP_TRACE_FILE = file;
		const tracer = new TraceContext();
		await tracer.span("probe", { tag: "v" }, async () => { /* noop */ });
		const contents = fs.readFileSync(file, "utf-8").trim().split("\n").map(l => JSON.parse(l));
		assert.strictEqual(contents.length, 1);
		assert.strictEqual(contents[0].name, "probe");
		assert.strictEqual(contents[0].attributes.tag, "v");
		assert.strictEqual(typeof contents[0].traceId, "string");
	});

	it("emits nothing when ATP_TRACE_FILE is unset", async () => {
		const tracer = new TraceContext();
		await tracer.span("x", {}, async () => { /* noop */ });
		// No assertion needed — if the env var is unset, file IO never happens.
		// The test ensures no crash and no unexpected file creation in tmpDir.
		assert.strictEqual(fs.readdirSync(tmpDir).length, 0);
	});

	it("summary() returns same-length array as collectedSpans", async () => {
		const tracer = new TraceContext();
		await tracer.span("a", {}, async () => { /* noop */ });
		await tracer.span("b", {}, async () => { /* noop */ });
		assert.strictEqual(tracer.summary().length, 2);
		assert.strictEqual(tracer.summary()[0].name, "a");
	});
});
