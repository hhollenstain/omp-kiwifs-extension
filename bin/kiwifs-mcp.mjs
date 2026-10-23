#!/usr/bin/env node
/**
 * stdio MCP entry omp launches from .mcp.json.
 * stdout is the MCP protocol. Diagnostics go to stderr only.
 */
import { spawn } from "node:child_process";
import { loadConfig, mcpArguments } from "./config.mjs";

let spec;
let bin = "kiwifs";
try {
	const config = loadConfig();
	bin = config.bin;
	spec = mcpArguments(config);
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`kiwifs: ${message}\n`);
	process.exit(1);
}

const child = spawn(bin, spec.args, {
	stdio: "inherit",
	env: process.env,
});

child.on("error", (error) => {
	process.stderr.write(`kiwifs: failed to start "${bin}": ${error.message}\n`);
	process.stderr.write("Install the kiwifs binary and put it on PATH, or set KIWIFS_BIN.\n");
	process.stderr.write("The extension's kiwi_* tools still work over HTTP when `kiwifs serve` is running.\n");
	process.exit(1);
});

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal);
		return;
	}
	process.exit(code ?? 1);
});
