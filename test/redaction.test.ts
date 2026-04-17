import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import { redactLogcatLines } from "../src/android";

describe("redactLogcatLines (S8)", () => {
	beforeEach(() => {
		delete process.env.MOBILEMCP_DISABLE_REDACTION;
	});

	afterEach(() => {
		delete process.env.MOBILEMCP_DISABLE_REDACTION;
	});

	it("strips Bearer tokens", () => {
		const { lines, redactedCount } = redactLogcatLines([
			"ATP_API apiResponse: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc123.xyz",
		]);
		assert.ok(!lines[0].includes("eyJhbGc"));
		assert.ok(lines[0].includes("[REDACTED]"));
		assert.strictEqual(redactedCount, 1);
	});

	it("strips password/token/api_key key=value pairs", () => {
		const { lines } = redactLogcatLines([
			"ATP_API apiResponse: password=hunter2, status=200",
			"ATP_API apiResponse: api_key=sk-abc123xyz456",
			"ATP_API apiResponse: session_id=abc-def-ghi",
		]);
		for (const line of lines) {
			assert.ok(line.includes("[REDACTED]"), `expected redaction in: ${line}`);
			assert.ok(!line.includes("hunter2"));
			assert.ok(!line.includes("sk-abc123xyz456"));
			assert.ok(!line.includes("abc-def-ghi"));
		}
	});

	it("strips email addresses", () => {
		const { lines, redactedCount } = redactLogcatLines([
			"ATP_API userEmail=alice@example.com",
		]);
		assert.ok(lines[0].includes("[EMAIL-REDACTED]"));
		assert.ok(!lines[0].includes("alice@example.com"));
		assert.strictEqual(redactedCount, 1);
	});

	it("strips long digit strings that look like card numbers", () => {
		const { lines } = redactLogcatLines([
			"ATP_API cardNumber=4111111111111111",
			"ATP_API tokenizedCard=4242 4242 4242 4242",
		]);
		for (const line of lines) {
			assert.ok(line.includes("[CARD-REDACTED]"));
		}
	});

	it("leaves regular logcat lines untouched", () => {
		const { lines, redactedCount } = redactLogcatLines([
			"ATP_SCREEN enter: LoginActivity",
			"ATP_RENDER renderState: screen=Login, btnEnabled=true",
			"ATP_API apiResponse: endpoint=POST /auth, status=200, bodyLength=143",
		]);
		assert.strictEqual(redactedCount, 0);
		assert.strictEqual(lines[0], "ATP_SCREEN enter: LoginActivity");
	});

	it("respects MOBILEMCP_DISABLE_REDACTION=1 opt-out", () => {
		process.env.MOBILEMCP_DISABLE_REDACTION = "1";
		const input = ["ATP_API Bearer eyJsecret12345"];
		const { lines, redactedCount } = redactLogcatLines(input);
		assert.strictEqual(lines[0], input[0]);
		assert.strictEqual(redactedCount, 0);
	});
});
