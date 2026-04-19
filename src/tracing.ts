/**
 * Lightweight trace span exporter (S3-4 / A10).
 *
 * Writes structured JSONL spans to `$ATP_TRACE_FILE` when set. Each atp_run_step
 * produces a root span with per-tier child spans, so operators can answer
 * "why did tier 2 fall back on step N?" after the fact without re-running.
 *
 * No OpenTelemetry dependency — JSONL is enough for this project's scale
 * and keeps the dependency graph lean. The span shape deliberately mirrors
 * OTel attribute naming so logs can later be ingested by OTel collectors
 * that understand `span.name`, `span.trace_id`, `span.parent_span_id`,
 * `span.attributes.*`.
 */

import fs from "node:fs";
import crypto from "node:crypto";

export interface Span {
	name: string;
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	startTimeMs: number;
	endTimeMs: number;
	durationMs: number;
	status: "OK" | "ERROR";
	attributes: Record<string, string | number | boolean | undefined>;
}

const traceFile = (): string | null => process.env.ATP_TRACE_FILE?.trim() || null;

const newTraceId = (): string => crypto.randomBytes(16).toString("hex");
const newSpanId = (): string => crypto.randomBytes(8).toString("hex");

const emit = (span: Span): void => {
	const file = traceFile();
	if (!file) return;
	try {
		fs.appendFileSync(file, JSON.stringify(span) + "\n");
	} catch {
		// Tracing must never crash the server. If the file path is bogus we
		// drop silently — operators can verify by checking for the file.
	}
};

export class TraceContext {
	public readonly traceId: string;
	private readonly spans: Span[] = [];

	constructor(traceId?: string) {
		this.traceId = traceId ?? newTraceId();
	}

	public get collectedSpans(): readonly Span[] {
		return this.spans;
	}

	/** Run `fn` inside a span, emit it to the trace file, and return fn's result. */
	public async span<T>(
		name: string,
		attributes: Record<string, string | number | boolean | undefined>,
		fn: () => Promise<T>,
		parentSpanId?: string,
	): Promise<T> {
		const spanId = newSpanId();
		const startTimeMs = Date.now();
		let status: "OK" | "ERROR" = "OK";
		try {
			const result = await fn();
			return result;
		} catch (err: unknown) {
			status = "ERROR";
			const message = err instanceof Error ? err.message : String(err);
			attributes["error.message"] = message;
			throw err;
		} finally {
			const endTimeMs = Date.now();
			const span: Span = {
				name,
				traceId: this.traceId,
				spanId,
				parentSpanId,
				startTimeMs,
				endTimeMs,
				durationMs: endTimeMs - startTimeMs,
				status,
				attributes,
			};
			this.spans.push(span);
			emit(span);
		}
	}

	/** Build a compact summary suitable for inclusion in an MCP response. */
	public summary(): Array<{ name: string; status: string; durationMs: number; attributes: Record<string, string | number | boolean | undefined> }> {
		return this.spans.map(s => ({
			name: s.name,
			status: s.status,
			durationMs: s.durationMs,
			attributes: s.attributes,
		}));
	}
}

/** Test-only helper — resets file writes so unit tests can assert behaviour. */
export const _traceFileForTesting = (): string | null => traceFile();
