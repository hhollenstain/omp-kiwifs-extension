import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { loadConfig, mcpArguments, type KiwiConfig } from "../bin/config.mjs";
import { KiwiClient, KiwiError } from "./client.js";
import { countTree, formatAnalytics, formatBrief, formatContext, formatSearch, formatTree } from "./format.js";
import { liveContextInstructions, operatingInstructions, promptBlocks } from "./prompt.js";
import { createTools } from "./tools.js";

const CONTEXT_TTL_MS = 10 * 60_000;

export default function kiwiFsExtension(pi: ExtensionAPI) {
	const config = loadConfig();
	const client = new KiwiClient(config);
	let contextCache: { at: number; text: string } | undefined;

	for (const tool of createTools(client, pi.zod)) {
		pi.registerTool(tool as Parameters<ExtensionAPI["registerTool"]>[0]);
	}

	pi.registerCommand("kiwi", {
		description: "KiwiFS knowledge base: status, search, context, and connection settings",
		getArgumentCompletions(prefix: string) {
			const actions = ["status", "search", "brief", "tree", "context", "analytics", "config", "help"];
			return actions.filter((action) => action.startsWith(prefix)).map((action) => ({ value: action, label: action }));
		},
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const [action = "status", ...rest] = trimmed.split(/\s+/);
			const tail = rest.join(" ").trim();
			try {
				switch (action) {
					case "status":
						ctx.ui.notify(await statusLine(client, config), "info");
						return;
					case "config":
						ctx.ui.notify(configLine(config), "info");
						return;
					case "search":
						await showText(pi, ctx, tail ? formatSearch(await client.search(tail, { limit: 8 })) : "Usage: /kiwi search <query>");
						return;
					case "brief":
						await showText(pi, ctx, tail ? formatBrief(await client.brief(tail, { budgetTokens: 1200, maxPages: 6 })) : "Usage: /kiwi brief <question>");
						return;
					case "tree":
						await showText(pi, ctx, formatTree(await client.tree(tail || undefined), 4));
						return;
					case "context":
						await showText(pi, ctx, formatContext(await client.context()));
						return;
					case "analytics":
						await showText(pi, ctx, formatAnalytics(await client.analytics(undefined)));
						return;
					case "help":
					default:
						await showText(pi, ctx, helpText(config));
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(message, "error");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		try {
			ctx.ui.notify(await statusLine(client, config, AbortSignal.timeout(2_000)), "info");
		} catch (error) {
			const message = error instanceof KiwiError ? error.message : "KiwiFS is not reachable";
			ctx.ui.notify(`${message}. Tools still call ${config.url}.`, "warning");
		}
	});

	pi.on("before_agent_start", async (event) => {
		const base = Array.isArray(event.systemPrompt) ? event.systemPrompt.filter((part) => typeof part === "string") : [];
		// A short stub means the host prompt is not ready. Returning systemPrompt replaces it, so wait.
		if (base.join("\n").trim().length < 200) return;
		const live = config.injectContext ? await cachedContext(client, pi, () => contextCache, (value) => {
			contextCache = value;
		}) : "";
		const addition = [operatingInstructions(config), live].filter(Boolean).join("\n\n");
		return { systemPrompt: promptBlocks(base, addition) };
	});
}

async function cachedContext(
	client: KiwiClient,
	pi: ExtensionAPI,
	read: () => { at: number; text: string } | undefined,
	write: (value: { at: number; text: string } | undefined) => void,
): Promise<string> {
	const current = read();
	if (current && Date.now() - current.at < CONTEXT_TTL_MS) return current.text;
	try {
		const text = liveContextInstructions(await client.context(AbortSignal.timeout(3_000)));
		write({ at: Date.now(), text });
		return text;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		pi.logger.warn(`KiwiFS context was not injected: ${message}`);
		return "";
	}
}

async function statusLine(client: KiwiClient, config: KiwiConfig, signal?: AbortSignal): Promise<string> {
	const health = await client.health(signal);
	let counts = "";
	try {
		const tree = await client.tree(undefined, signal);
		const counted = countTree(tree);
		counts = ` · ${counted.files} files`;
	} catch {
		counts = "";
	}
	const version = health.version ? ` ${health.version}` : "";
	return `KiwiFS${version} at ${config.url}${config.space ? ` (${config.space})` : ""}${counts}`;
}

function configLine(config: KiwiConfig): string {
	let mcp = "mcp unavailable";
	try {
		const spec = mcpArguments(config);
		const args = spec.args.map((arg, index) => (spec.args[index - 1] === "--api-key" ? "********" : arg));
		mcp = `mcp ${spec.mode}: kiwifs ${args.join(" ")}`;
	} catch (error) {
		mcp = error instanceof Error ? error.message : String(error);
	}
	return [
		`url: ${config.url}${config.urlExplicit ? "" : " (default)"}`,
		`root: ${config.root || "(not set)"}`,
		`space: ${config.space || "(primary)"}`,
		`actor: ${config.actor}`,
		`mode: ${config.mode}`,
		`api key: ${config.apiKey ? "set" : "not set"}`,
		`inject context: ${config.injectContext ? "on" : "off"}`,
		mcp,
	].join("\n");
}

function helpText(config: KiwiConfig): string {
	return [
		"KiwiFS commands",
		"/kiwi status",
		"/kiwi search <query>",
		"/kiwi brief <question>",
		"/kiwi tree [folder]",
		"/kiwi context",
		"/kiwi analytics",
		"/kiwi config",
		"",
		"Agent tools: kiwi_context, kiwi_brief, kiwi_search, kiwi_search_hybrid, kiwi_peek,",
		"kiwi_read, kiwi_section, kiwi_tree, kiwi_toc, kiwi_backlinks, kiwi_query,",
		"kiwi_write, kiwi_append, kiwi_patch_frontmatter, kiwi_bulk_write, kiwi_delete,",
		"kiwi_rename, kiwi_remember, kiwi_forget, kiwi_lint, kiwi_analytics,",
		"kiwi_health_check, kiwi_memory_report, kiwi_versions, kiwi_diff, kiwi_changes.",
		"",
		configLine(config),
		"",
		"Set KIWIFS_URL, KIWIFS_ROOT, KIWIFS_API_KEY, and KIWIFS_ACTOR, or run",
		"`omp plugin config set omp-kiwifs-extension <key> <value>`.",
	].join("\n");
}

async function showText(
	pi: ExtensionAPI,
	ctx: { ui: { notify: (message: string, level: "info" | "warning" | "error") => void } },
	body: string,
): Promise<void> {
	if (body.length < 240) {
		ctx.ui.notify(body, "info");
		return;
	}
	pi.sendMessage({ customType: "kiwifs", content: body, display: true }, { triggerTurn: false });
}
