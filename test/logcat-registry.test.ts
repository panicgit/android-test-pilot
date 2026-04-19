import assert from "node:assert";
import { describe, it } from "node:test";
import { LogcatSessionRegistry, LogcatSession } from "../src/logcat-registry";

const fakeSession = (id: string, deviceId: string): LogcatSession => ({
	id,
	deviceId,
	process: { kill: () => { /* noop */ }, once: () => { /* noop */ } } as unknown as LogcatSession["process"],
	buffer: [],
	bufferBytes: 0,
	startTime: Date.now(),
	maxDuration: 60_000,
	tags: ["ATP_SCREEN"],
	timer: setTimeout(() => { /* noop */ }, 60_000),
	bytesDropped: 0,
});

describe("LogcatSessionRegistry (A3)", () => {
	it("add/get/delete round-trip works", () => {
		const reg = new LogcatSessionRegistry();
		const s = fakeSession("sid-1", "emulator-5554");
		reg.add(s);
		assert.strictEqual(reg.get("sid-1"), s);
		assert.strictEqual(reg.size(), 1);
		reg.delete("sid-1");
		assert.strictEqual(reg.get("sid-1"), undefined);
		assert.strictEqual(reg.size(), 0);
	});

	it("assertCapacity refuses once per-device cap reached", () => {
		const reg = new LogcatSessionRegistry({ maxSessionsPerDevice: 2, maxGlobalSessions: 100 });
		reg.add(fakeSession("a", "dev-1"));
		reg.add(fakeSession("b", "dev-1"));
		assert.throws(() => reg.assertCapacity("dev-1"), /already has 2 active/);
		// Other device still accepts.
		assert.doesNotThrow(() => reg.assertCapacity("dev-2"));
	});

	it("assertCapacity refuses once global cap reached", () => {
		const reg = new LogcatSessionRegistry({ maxSessionsPerDevice: 100, maxGlobalSessions: 3 });
		reg.add(fakeSession("a", "dev-1"));
		reg.add(fakeSession("b", "dev-2"));
		reg.add(fakeSession("c", "dev-3"));
		assert.throws(() => reg.assertCapacity("dev-4"), /Global logcat session cap/);
	});

	it("latestForDevice returns most recent session for that device", () => {
		const reg = new LogcatSessionRegistry();
		const older = fakeSession("a", "dev");
		older.startTime = 1_000;
		const newer = fakeSession("b", "dev");
		newer.startTime = 2_000;
		reg.add(older);
		reg.add(newer);
		reg.add(fakeSession("c", "other-dev"));
		assert.strictEqual(reg.latestForDevice("dev"), newer);
	});

	it("isolation — two registries do not share state", () => {
		const a = new LogcatSessionRegistry();
		const b = new LogcatSessionRegistry();
		a.add(fakeSession("x", "dev"));
		assert.strictEqual(a.size(), 1);
		assert.strictEqual(b.size(), 0);
	});

	it("stopAndRemove clears timers and returns stats", () => {
		const reg = new LogcatSessionRegistry();
		const s = fakeSession("s", "dev");
		reg.add(s);
		const stopped = reg.stopAndRemove("s");
		assert.ok(stopped !== null);
		assert.strictEqual(stopped?.session.id, "s");
		assert.strictEqual(reg.size(), 0);
	});

	it("stopAndRemove returns null for unknown id", () => {
		const reg = new LogcatSessionRegistry();
		assert.strictEqual(reg.stopAndRemove("nope"), null);
	});
});
