"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports._traceFileForTesting = exports.TraceContext = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const traceFile = () => process.env.ATP_TRACE_FILE?.trim() || null;
const newTraceId = () => node_crypto_1.default.randomBytes(16).toString("hex");
const newSpanId = () => node_crypto_1.default.randomBytes(8).toString("hex");
const emit = (span) => {
    const file = traceFile();
    if (!file)
        return;
    try {
        node_fs_1.default.appendFileSync(file, JSON.stringify(span) + "\n");
    }
    catch {
        // Tracing must never crash the server. If the file path is bogus we
        // drop silently — operators can verify by checking for the file.
    }
};
class TraceContext {
    traceId;
    spans = [];
    constructor(traceId) {
        this.traceId = traceId ?? newTraceId();
    }
    get collectedSpans() {
        return this.spans;
    }
    /** Run `fn` inside a span, emit it to the trace file, and return fn's result. */
    async span(name, attributes, fn, parentSpanId) {
        const spanId = newSpanId();
        const startTimeMs = Date.now();
        let status = "OK";
        try {
            const result = await fn();
            return result;
        }
        catch (err) {
            status = "ERROR";
            const message = err instanceof Error ? err.message : String(err);
            attributes["error.message"] = message;
            throw err;
        }
        finally {
            const endTimeMs = Date.now();
            const span = {
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
    summary() {
        return this.spans.map(s => ({
            name: s.name,
            status: s.status,
            durationMs: s.durationMs,
            attributes: s.attributes,
        }));
    }
}
exports.TraceContext = TraceContext;
/** Test-only helper — resets file writes so unit tests can assert behaviour. */
const _traceFileForTesting = () => traceFile();
exports._traceFileForTesting = _traceFileForTesting;
//# sourceMappingURL=tracing.js.map