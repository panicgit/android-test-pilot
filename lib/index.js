#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const sse_js_1 = require("@modelcontextprotocol/sdk/server/sse.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const server_1 = require("./server");
const logger_1 = require("./logger");
const express_1 = __importDefault(require("express"));
const commander_1 = require("commander");
const node_crypto_1 = __importDefault(require("node:crypto"));
/**
 * Constant-time comparison of an incoming Authorization header against the
 * expected `Bearer <token>` string. Short-circuiting `!==` would leak the
 * token length and first differing byte via response timing (SR-4).
 */
const bearerMatches = (headerValue, expected) => {
    if (!headerValue)
        return false;
    const received = Buffer.from(headerValue);
    const want = Buffer.from(expected);
    // Lengths compared in the open; crypto.timingSafeEqual throws if they
    // differ, so we return false early to avoid exposing that branch timing
    // difference beyond what an attacker can already infer from response size.
    if (received.length !== want.length)
        return false;
    return node_crypto_1.default.timingSafeEqual(received, want);
};
const startSseServer = async (host, port) => {
    const app = (0, express_1.default)();
    const server = (0, server_1.createMcpServer)();
    const authToken = process.env.MOBILEMCP_AUTH;
    const allowInsecure = process.env.MOBILEMCP_ALLOW_INSECURE_LISTEN === "1";
    if (!authToken && !allowInsecure) {
        console.error(`
[FATAL] SSE server requires authentication. Set MOBILEMCP_AUTH:

  export MOBILEMCP_AUTH=$(openssl rand -hex 32)

Or, only for trusted local development, override:

  export MOBILEMCP_ALLOW_INSECURE_LISTEN=1

Refusing to start.
`);
        process.exit(1);
    }
    // SR-6 — MOBILEMCP_ALLOW_INSECURE_LISTEN must not bind a public interface.
    // Only loopback (127.0.0.1, ::1, localhost) is permitted without auth.
    if (!authToken && allowInsecure) {
        const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
        if (!loopbackHosts.has(host.toLowerCase())) {
            console.error(`
[FATAL] MOBILEMCP_ALLOW_INSECURE_LISTEN=1 is only valid on loopback.
Refusing to bind "${host}" without MOBILEMCP_AUTH. Either:
  - Bind localhost:PORT, or
  - Set MOBILEMCP_AUTH for the remote interface.
`);
            process.exit(1);
        }
        (0, logger_1.error)(`WARNING: SSE server running WITHOUT authentication (MOBILEMCP_ALLOW_INSECURE_LISTEN=1) on loopback ${host}.`);
    }
    if (authToken) {
        const expected = `Bearer ${authToken}`;
        app.use((req, res, next) => {
            const header = req.headers.authorization;
            if (!bearerMatches(Array.isArray(header) ? header[0] : header, expected)) {
                res.status(401).json({ error: "Unauthorized" });
                return;
            }
            next();
        });
    }
    let transport = null;
    app.post("/mcp", (req, res) => {
        if (transport) {
            transport.handlePostMessage(req, res);
        }
    });
    app.get("/mcp", (req, res) => {
        if (transport) {
            transport.close();
        }
        transport = new sse_js_1.SSEServerTransport("/mcp", res);
        server.connect(transport);
    });
    app.listen(port, host, () => {
        (0, logger_1.error)(`android-test-pilot ${(0, server_1.getAgentVersion)()} sse server listening on http://${host}:${port}/mcp`);
    });
};
const startStdioServer = async () => {
    try {
        const transport = new stdio_js_1.StdioServerTransport();
        const server = (0, server_1.createMcpServer)();
        await server.connect(transport);
        (0, logger_1.error)("android-test-pilot server running on stdio");
    }
    catch (err) {
        console.error("Fatal error in main():", err);
        const stack = err instanceof Error ? err.stack : String(err);
        (0, logger_1.error)("Fatal error in main(): " + JSON.stringify(stack));
        process.exit(1);
    }
};
const main = async () => {
    commander_1.program
        .version((0, server_1.getAgentVersion)())
        .option("--listen <listen>", "Start SSE server on [host:]port")
        .option("--stdio", "Start stdio server (default)")
        .parse(process.argv);
    const options = commander_1.program.opts();
    if (options.listen) {
        const listen = options.listen.trim();
        const lastColon = listen.lastIndexOf(":");
        let host = "localhost";
        let rawPort;
        if (lastColon > 0) {
            host = listen.substring(0, lastColon);
            rawPort = listen.substring(lastColon + 1);
        }
        else {
            rawPort = listen;
        }
        const port = Number.parseInt(rawPort, 10);
        if (!host || !rawPort || !Number.isInteger(port) || port < 1 || port > 65535) {
            (0, logger_1.error)(`Invalid --listen value "${listen}". Expected [host:]port with port 1-65535.`);
            process.exit(1);
        }
        await startSseServer(host, port);
    }
    else {
        await startStdioServer();
    }
};
main().catch(err => {
    console.error("Fatal:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map