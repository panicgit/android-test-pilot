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
export declare class TraceContext {
    readonly traceId: string;
    private readonly spans;
    constructor(traceId?: string);
    get collectedSpans(): readonly Span[];
    /** Run `fn` inside a span, emit it to the trace file, and return fn's result. */
    span<T>(name: string, attributes: Record<string, string | number | boolean | undefined>, fn: () => Promise<T>, parentSpanId?: string): Promise<T>;
    /** Build a compact summary suitable for inclusion in an MCP response. */
    summary(): Array<{
        name: string;
        status: string;
        durationMs: number;
        attributes: Record<string, string | number | boolean | undefined>;
    }>;
}
/** Test-only helper — resets file writes so unit tests can assert behaviour. */
export declare const _traceFileForTesting: () => string | null;
