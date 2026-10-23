import type { KiwiConfig } from "../bin/config.mjs";
import { clip, formatContext } from "./format.js";

const LIVE_CONTEXT_CAP = 12_000;

export function operatingInstructions(config: Pick<KiwiConfig, "url" | "actor" | "space" | "root" | "mode">): string {
	const where = config.mode === "root" && config.root
		? `local root ${config.root}`
		: config.url + (config.space ? ` space ${config.space}` : "");
	return [
		"## KiwiFS",
		`A KiwiFS knowledge base is connected (${where}). Writes are committed as ${config.actor}.`,
		"Use it for project knowledge, decisions, and anything the user asks you to remember. Do not invent a second notes file when KiwiFS is the store.",
		"1. Call kiwi_context before the first read or write in a session. Follow the playbook, schema, and rules it returns.",
		"2. Look up with kiwi_brief (one token-budgeted pack) or kiwi_search. Search before creating a page so you update instead of duplicating.",
		"3. Skim with kiwi_peek. Read a heading with kiwi_section. Call kiwi_read only when you need the whole page. Keep the etag.",
		"4. Update with kiwi_write and pass if_match from that etag. Use kiwi_append for logs. Use kiwi_patch_frontmatter to change fields without resending the body.",
		"5. After a write, kiwi_lint the page and update the index the playbook names. Link related pages with [[wikilinks]].",
		"6. Record a raw observation with kiwi_remember. Fold it into a durable page later; do not treat an episode as the canonical article.",
		"The KiwiFS MCP server, when connected, exposes the rest of the product (refactor, drafts, workflows, claims, import). Prefer the kiwi_* tools above for read, update, and lookup.",
	].join("\n");
}

export function liveContextInstructions(context: { schema: string; playbook: string; index: string; rules: string }): string {
	const body = formatContext(context, LIVE_CONTEXT_CAP);
	return ["## KiwiFS workspace context", "Loaded from kiwi_context. Call kiwi_context again if you need a section that was truncated.", body].join("\n\n");
}

export function promptBlocks(base: string[], addition: string): string[] {
	if (base.some((part) => part.includes("## KiwiFS"))) return base;
	return [...base, clip(addition, 16_000)];
}
