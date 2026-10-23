const MARK = /<\/?mark>/g;

export function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max).trimEnd()}\n… truncated (${text.length} characters). Read one heading with kiwi_section, or raise the budget.`;
}

export function stripMarks(text: string): string {
	return text.replace(MARK, "").replace(/\s+/g, " ").trim();
}

export function jsonBlock(value: unknown, max = 12_000): string {
	let text: string;
	try {
		text = JSON.stringify(value, null, 2);
	} catch {
		text = String(value);
	}
	return clip(text, max);
}

interface TreeNode {
	name?: string;
	path?: string;
	isDir?: boolean;
	size?: number;
	children?: TreeNode[];
}

export function formatTree(node: unknown, depthLimit = 4): string {
	if (!isRecord(node)) return jsonBlock(node);
	return formatTreeNode(node as TreeNode, 0, depthLimit).replace(/\n$/, "");
}

function formatTreeNode(node: TreeNode, depth: number, depthLimit: number): string {
	const indent = "  ".repeat(depth);
	const name = node.name || node.path || "(root)";
	const suffix = node.isDir ? "/" : "";
	const size = !node.isDir && typeof node.size === "number" ? ` (${formatBytes(node.size)})` : "";
	let out = `${indent}${name}${suffix}${size}\n`;
	if (depth >= depthLimit) {
		if ((node.children?.length ?? 0) > 0) out += `${indent}  …\n`;
		return out;
	}
	for (const child of node.children ?? []) out += formatTreeNode(child, depth + 1, depthLimit);
	return out;
}

export function countTree(node: unknown): { files: number; dirs: number } {
	if (!isRecord(node)) return { files: 0, dirs: 0 };
	return countNode(node as TreeNode);
}

function countNode(node: TreeNode): { files: number; dirs: number } {
	let files = node.isDir ? 0 : 1;
	let dirs = node.isDir ? 1 : 0;
	for (const child of node.children ?? []) {
		const nested = countNode(child);
		files += nested.files;
		dirs += nested.dirs;
	}
	return { files, dirs };
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

interface SearchHit {
	path?: string;
	score?: number;
	snippet?: string;
	matches?: Array<{ line?: number; text?: string }>;
}

export function formatSearch(payload: unknown): string {
	if (!isRecord(payload)) return jsonBlock(payload);
	const results = Array.isArray(payload.results) ? (payload.results as SearchHit[]) : [];
	const query = stringOf(payload.query) || "query";
	if (results.length === 0) {
		const suggestions = Array.isArray(payload.suggestions) ? payload.suggestions : [];
		const hint = suggestions
			.map((item) => (isRecord(item) ? stringOf(item.title) || stringOf(item.query) : ""))
			.filter(Boolean)
			.slice(0, 5);
		return hint.length > 0
			? `No KiwiFS pages match "${query}". Close titles: ${hint.join(", ")}.`
			: `No KiwiFS pages match "${query}".`;
	}
	const mode = stringOf(payload.mode);
	const header = `Found ${results.length} KiwiFS page${results.length === 1 ? "" : "s"} for "${query}"${mode ? ` (${mode})` : ""}.`;
	const lines = results.map((hit, index) => {
		const path = stringOf(hit.path) || "(unknown)";
		const score = typeof hit.score === "number" ? ` score ${hit.score.toFixed(3)}` : "";
		const snippet = stripMarks(stringOf(hit.snippet));
		const match = hit.matches?.find((item) => stringOf(item.text));
		const line = snippet || (match ? stripMarks(stringOf(match.text)) : "");
		return `${index + 1}. ${path}${score}${line ? `\n   ${line}` : ""}`;
	});
	return [header, ...lines].join("\n");
}

interface BriefItem {
	path?: string;
	title?: string;
	heading?: string;
	content?: string;
	tokens?: number;
	partial?: boolean;
}

interface BriefDrop {
	path?: string;
	heading?: string;
	tokens?: number;
	reason?: string;
}

export function formatBrief(payload: unknown): string {
	if (!isRecord(payload)) return jsonBlock(payload);
	const items = Array.isArray(payload.items) ? (payload.items as BriefItem[]) : [];
	const query = stringOf(payload.query);
	if (items.length === 0) return `No KiwiFS pages match "${query}".`;
	const used = typeof payload.used_tokens === "number" ? payload.used_tokens : undefined;
	const budget = typeof payload.budget_tokens === "number" ? payload.budget_tokens : undefined;
	const header = `KiwiFS brief for "${query}" (${items.length} section${items.length === 1 ? "" : "s"}${
		used !== undefined && budget !== undefined ? `, ${used}/${budget} tokens` : ""
	}). Content is verbatim.`;
	const blocks = items.map((item) => {
		const path = stringOf(item.path) || "page";
		const title = stringOf(item.title);
		const heading = stringOf(item.heading);
		const where = [path, title, heading].filter(Boolean).join(" — ");
		const tokens = typeof item.tokens === "number" ? ` (${item.tokens} tokens${item.partial ? ", partial" : ""})` : "";
		return `## ${where}${tokens}\n\n${stringOf(item.content)}`;
	});
	const dropped = Array.isArray(payload.dropped) ? (payload.dropped as BriefDrop[]) : [];
	const omitted = dropped.length
		? `\n\nDid not fit: ${dropped
				.map((item) => {
					const path = stringOf(item.path);
					const reason = stringOf(item.reason);
					const tokens = typeof item.tokens === "number" ? `${item.tokens} tokens` : "";
					return [path, tokens, reason].filter(Boolean).join(" — ");
				})
				.join("; ")}. Call kiwi_read or kiwi_section for one of these, or raise budget_tokens.`
		: "";
	return `${header}\n\n${blocks.join("\n\n")}${omitted}`;
}

export function formatPeek(payload: unknown): string {
	if (!isRecord(payload)) return jsonBlock(payload);
	const path = stringOf(payload.path);
	const title = stringOf(payload.title);
	const front = isRecord(payload.frontmatter) ? payload.frontmatter : {};
	const kind = stringOf(front.type);
	const status = stringOf(front.status);
	const words = typeof payload.word_count === "number" ? `${payload.word_count} words` : "";
	const meta = [kind, status, words].filter(Boolean).join(" · ");
	const headings = Array.isArray(payload.headings) ? payload.headings.map((item) => String(item)).filter(Boolean) : [];
	const lines = [`${path}${title ? ` — ${title}` : ""}`];
	if (meta) lines.push(meta);
	const snippet = stripMarks(stringOf(payload.snippet));
	if (snippet) lines.push(snippet);
	if (headings.length > 0) lines.push(`headings: ${headings.slice(0, 12).join(", ")}`);
	const linksOut = Array.isArray(payload.links_out) ? payload.links_out.map(String) : [];
	const linksIn = Array.isArray(payload.links_in) ? payload.links_in.map(String) : [];
	if (linksOut.length > 0) lines.push(`links: ${linksOut.slice(0, 12).join(", ")}`);
	if (linksIn.length > 0) lines.push(`backlinks: ${linksIn.slice(0, 12).join(", ")}`);
	return lines.join("\n");
}

export function formatContext(context: { schema: string; playbook: string; index: string; rules: string }, max = 60_000): string {
	const parts = [
		section("SCHEMA.md", context.schema),
		section(".kiwi/playbook.md", context.playbook),
		section(".kiwi/rules.md", context.rules),
		section("index.md", context.index),
	].filter(Boolean);
	const text = parts.join("\n\n");
	return text ? clip(text, max) : "KiwiFS context is empty. Initialize the knowledge base with `kiwifs init`.";
}

function section(title: string, body: string): string {
	const trimmed = body.trim();
	if (!trimmed) return "";
	return `# ${title}\n\n${trimmed}`;
}

export function formatVersions(payload: unknown): string {
	if (!isRecord(payload) || !Array.isArray(payload.versions)) return jsonBlock(payload);
	const path = stringOf(payload.path);
	const versions = payload.versions.filter(isRecord);
	if (versions.length === 0) return `${path} has no KiwiFS history.`;
	const lines = versions.slice(0, 20).map((version) => {
		const hash = stringOf(version.hash).slice(0, 12);
		const date = stringOf(version.date);
		const author = stringOf(version.author);
		const message = stringOf(version.message);
		return `- ${hash} ${date} ${author} ${message}`.trim();
	});
	return [`History for ${path}`, ...lines].join("\n");
}

export function formatChanges(payload: unknown): string {
	if (!isRecord(payload) || !Array.isArray(payload.changes)) return jsonBlock(payload);
	const changes = payload.changes.filter(isRecord);
	if (changes.length === 0) return "No KiwiFS changes.";
	const lines = changes.slice(0, 40).map((change) => {
		const action = stringOf(change.action) || "write";
		const path = stringOf(change.path) || "(bulk)";
		const actor = stringOf(change.actor);
		const when = stringOf(change.timestamp);
		return `- ${action} ${path}${actor ? ` by ${actor}` : ""}${when ? ` at ${when}` : ""}`;
	});
	const last = stringOf(payload.last_seq);
	return [`Recent KiwiFS changes`, ...lines, last ? `\nPass since=${last} next time.` : ""].filter(Boolean).join("\n");
}

export function formatAnalytics(payload: unknown): string {
	if (!isRecord(payload) || typeof payload.total_pages !== "number") return jsonBlock(payload);
	const health = isRecord(payload.health) ? payload.health : {};
	const coverage = isRecord(payload.coverage) ? payload.coverage : {};
	const issue = (key: string) => {
		const group = health[key];
		return isRecord(group) && typeof group.count === "number" ? group.count : 0;
	};
	const avg = typeof coverage.avg_links_per_page === "number" ? coverage.avg_links_per_page.toFixed(1) : "?";
	return [
		`${payload.total_pages} pages · ${typeof payload.total_words === "number" ? payload.total_words.toLocaleString("en-US") : "?"} words · ${avg} links/page`,
		`orphans ${issue("orphans")} · broken links ${issue("broken_links")} · stale ${issue("stale")} · empty ${issue("empty")} · no frontmatter ${issue("no_frontmatter")}`,
	].join("\n");
}

export function formatHealth(payload: unknown): string {
	if (!isRecord(payload) || !stringOf(payload.path)) return jsonBlock(payload);
	const issues = Array.isArray(payload.issues) ? payload.issues.map((item) => `- ${typeof item === "string" ? item : jsonBlock(item, 300)}`) : [];
	const words = typeof payload.word_count === "number" ? `${payload.word_count} words` : "";
	const links = typeof payload.link_count === "number" ? `${payload.link_count} links` : "";
	const back = typeof payload.backlink_count === "number" ? `${payload.backlink_count} backlinks` : "";
	const age = typeof payload.days_since_update === "number" ? `${payload.days_since_update} days since update` : "";
	const meta = [words, links, back, age].filter(Boolean).join(" · ");
	return [`${stringOf(payload.path)}${meta ? `\n${meta}` : ""}`, issues.length > 0 ? issues.join("\n") : "No health issues."]
		.filter(Boolean)
		.join("\n");
}

export function formatBacklinks(payload: unknown): string {
	const entries = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.backlinks) ? payload.backlinks : null;
	if (!entries) return jsonBlock(payload);
	if (entries.length === 0) return "No backlinks.";
	return entries
		.slice(0, 40)
		.map((entry) => {
			if (!isRecord(entry)) return `- ${String(entry)}`;
			const path = stringOf(entry.path);
			const title = stringOf(entry.title);
			const context = stripMarks(stringOf(entry.context));
			return `- ${path}${title ? ` — ${title}` : ""}${context ? `\n  ${context}` : ""}`;
		})
		.join("\n");
}

export function formatQuery(payload: unknown): string {
	if (!isRecord(payload)) return jsonBlock(payload);
	if (Array.isArray(payload.headers) && Array.isArray(payload.rows)) {
		const headers = payload.headers.map(String);
		const rows = payload.rows
			.slice(0, 50)
			.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")).join(" | ") : String(row)));
		return [headers.join(" | "), ...rows, payload.rows.length > 50 ? `… ${payload.rows.length - 50} more rows` : ""]
			.filter(Boolean)
			.join("\n");
	}
	return jsonBlock(payload);
}

export function formatLint(payload: unknown): string {
	if (!isRecord(payload) || !Array.isArray(payload.issues)) return jsonBlock(payload);
	if (payload.issues.length === 0) return "Lint clean.";
	return payload.issues
		.slice(0, 40)
		.map((issue) => {
			if (!isRecord(issue)) return `- ${String(issue)}`;
			const at = typeof issue.line === "number" && issue.line > 0 ? `:${issue.line}` : "";
			return `- ${stringOf(issue.severity) || "info"} ${stringOf(issue.rule)}${at} ${stringOf(issue.message)}`.trim();
		})
		.join("\n");
}

export function formatMemoryReport(payload: unknown): string {
	if (!isRecord(payload) || typeof payload.coverage_pct !== "number") return jsonBlock(payload);
	const unmerged = typeof payload.total_unmerged === "number" ? payload.total_unmerged : 0;
	const total = typeof payload.total_episodic === "number" ? payload.total_episodic : 0;
	const lines = [`Memory coverage ${payload.coverage_pct}% · ${unmerged} unmerged of ${total} episodes`];
	const list = Array.isArray(payload.unmerged) ? payload.unmerged.filter(isRecord).slice(0, 20) : [];
	for (const item of list) {
		lines.push(`- ${stringOf(item.path) || stringOf(item.episode_id) || stringOf(item.id)}`);
	}
	return lines.join("\n");
}

export function formatRead(path: string, content: string, etag: string | undefined, unchanged: boolean, max: number): string {
	if (unchanged) return `${path} is unchanged (etag ${etag ?? "unknown"}).`;
	const header = `${path}${etag ? ` etag ${etag}` : ""}`;
	return `${header}\n\n${clip(content, max)}`;
}

export function formatWrite(path: string, etag: string | undefined, verb: string): string {
	return `${verb} ${path}${etag ? ` (etag ${etag})` : ""}. Pass that etag as if_match before overwriting.`;
}

function isRecord(value: unknown): value is Record<string, any> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOf(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}
