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
		"Critical: KiwiFS pages are remote. Never use omp edit or write on them. Those tools need a local 4-hex TAG from omp read. kiwi_read returns if_match for kiwi_write only — it is not an edit TAG and must not appear as [path#if_match].",
		"1. Call kiwi_context before the first read or write in a session. Follow the playbook, schema, and rules it returns.",
		"2. Look up with kiwi_brief (one token-budgeted pack) or kiwi_search. Search before creating a page so you update instead of duplicating.",
		"3. Skim with kiwi_peek. Read a heading with kiwi_section. Call kiwi_read only when you need the whole page. Keep the if_match value.",
		"4. Update with kiwi_write(path, full content, if_match). Use kiwi_append for logs. Use kiwi_patch_frontmatter to change fields without resending the body.",
		"5. After a write, kiwi_lint the page and update the index the playbook names. Link related pages with [[wikilinks]].",
		"6. Record a raw observation with kiwi_remember. Fold it into a durable page later; do not treat an episode as the canonical article.",
		"7. Create another knowledge base with kiwi_init_templates then kiwi_space_create. List spaces with kiwi_spaces_list. Point the extension at a space with KIWIFS_SPACE before writing into it.",
		"The KiwiFS MCP server, when connected, exposes the rest of the product (refactor, drafts, workflows, claims, import). Prefer the kiwi_* tools above for read, update, lookup, and spaces.",
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
