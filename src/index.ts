#!/usr/bin/env node
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer, getAgentVersion } from "./server";
import { error } from "./logger";
import express from "express";
import { program } from "commander";

const startSseServer = async (host: string, port: number) => {
	const app = express();
	const server = createMcpServer();

	const authToken = process.env.MOBILEMCP_AUTH;
	const allowInsecure = process.env.MOBILEMCP_ALLOW_INSECURE_LISTEN === "1";

	if (!authToken && !allowInsecure) {
		console.error(`
[FATAL] SSE server requires authentication. Set MOBILEMCP_AUTH:

  export MOBILEMCP_AUTH=$(openssl rand -hex 32)

Or, only for trusted local development, override:

  export MOBILEMCP_ALLOW_INSECURE_LISTEN=1

Refusing to start. See SECURITY in IMPROVEMENT_PLAN.md (S3).
`);
		process.exit(1);
	}

	if (!authToken && allowInsecure) {
		error("WARNING: SSE server running WITHOUT authentication (MOBILEMCP_ALLOW_INSECURE_LISTEN=1). Anyone reachable on the bound interface can invoke any tool.");
	}

	if (authToken) {
		app.use((req, res, next) => {
			if (req.headers.authorization !== `Bearer ${authToken}`) {
				res.status(401).json({ error: "Unauthorized" });
				return;
			}

			next();
		});
	}

	let transport: SSEServerTransport | null = null;

	app.post("/mcp", (req, res) => {
		if (transport) {
			transport.handlePostMessage(req, res);
		}
	});

	app.get("/mcp", (req, res) => {
		if (transport) {
			transport.close();
		}

		transport = new SSEServerTransport("/mcp", res);
		server.connect(transport);
	});

	app.listen(port, host, () => {
		error(`android-test-pilot ${getAgentVersion()} sse server listening on http://${host}:${port}/mcp`);
	});
};

const startStdioServer = async () => {
	try {
		const transport = new StdioServerTransport();

		const server = createMcpServer();
		await server.connect(transport);

		error("android-test-pilot server running on stdio");
	} catch (err: unknown) {
		console.error("Fatal error in main():", err);
		const stack = err instanceof Error ? err.stack : String(err);
		error("Fatal error in main(): " + JSON.stringify(stack));
		process.exit(1);
	}
};

const main = async () => {
	program
		.version(getAgentVersion())
		.option("--listen <listen>", "Start SSE server on [host:]port")
		.option("--stdio", "Start stdio server (default)")
		.parse(process.argv);

	const options = program.opts();

	if (options.listen) {
		const listen = (options.listen as string).trim();
		const lastColon = listen.lastIndexOf(":");
		let host = "localhost";
		let rawPort: string;

		if (lastColon > 0) {
			host = listen.substring(0, lastColon);
			rawPort = listen.substring(lastColon + 1);
		} else {
			rawPort = listen;
		}

		const port = Number.parseInt(rawPort, 10);
		if (!host || !rawPort || !Number.isInteger(port) || port < 1 || port > 65535) {
			error(`Invalid --listen value "${listen}". Expected [host:]port with port 1-65535.`);
			process.exit(1);
		}

		await startSseServer(host, port);
	} else {
		await startStdioServer();
	}
};

main().catch(err => {
	console.error("Fatal:", err);
	process.exit(1);
});
