import type { KiwiClient } from "./client.js";
import { KiwiError } from "./client.js";
import {
	clip,
	formatAnalytics,
	formatBacklinks,
	formatBrief,
	formatChanges,
	formatContext,
	formatHealth,
	formatLint,
	formatMemoryReport,
	formatPeek,
	formatQuery,
	formatRead,
	formatSearch,
	formatTree,
	formatVersions,
	formatWrite,
	jsonBlock,
} from "./format.js";

const READ_CAP = 32_000;

interface ZodSchema {
	optional(): ZodSchema;
	describe(description: string): ZodSchema;
}

interface Zod {
	string(): ZodSchema;
	number(): ZodSchema;
	boolean(): ZodSchema;
	array(schema: ZodSchema): ZodSchema;
	object(shape: Record<string, ZodSchema>): ZodSchema;
	record(schema: ZodSchema): ZodSchema;
	unknown(): ZodSchema;
}

export interface KiwiTool {
	name: string;
	label: string;
	description: string;
	parameters: unknown;
	approval: "read" | "write";
	loadMode: "essential";
	execute(
		toolCallId: string,
		params: Record<string, any>,
		signal: AbortSignal | undefined,
	): Promise<{ content: Array<{ type: "text"; text: string }>; details?: unknown; isError?: boolean }>;
}

function text(body: string, details?: unknown, isError = false) {
	return {
		content: [{ type: "text" as const, text: body }],
		details,
		isError,
	};
}

function failure(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return text(message, { error: message }, true);
}

function limit(value: unknown, fallback: number, max: number, min = 1): number {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.max(min, Math.min(max, Math.trunc(number)));
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function createTools(client: KiwiClient, z: Zod): KiwiTool[] {
	const path = () => z.string().describe("Knowledge-base path relative to the root, such as pages/auth.md");
	const query = () => z.string().describe("Search or question. Plain words are AND; quotes, AND, OR, and NOT are passed through.");

	return [
		tool(z, {
			name: "kiwi_context",
			label: "KiwiFS Context",
			description:
				"Load SCHEMA.md, the agent playbook, rules, and index.md in one call. Call this before the first KiwiFS read or write in a session, and follow what it returns.",
			approval: "read",
			parameters: {},
			async run(_params, signal) {
				const context = await client.context(signal);
				return text(formatContext(context), context);
			},
		}),
		tool(z, {
			name: "kiwi_brief",
			label: "KiwiFS Brief",
			description:
				"Look up a question and return a token-budgeted pack of verbatim page sections. Prefer this over reading the knowledge base page by page. Nothing is summarized; dropped sections are listed.",
			approval: "read",
			parameters: {
				query: query(),
				budget_tokens: z.number().optional().describe("Token ceiling. Default 4000."),
				max_pages: z.number().optional().describe("Candidate pages to consider. Default 20."),
				path_prefix: z.string().optional().describe("Only pages under this folder."),
			},
			async run(params, signal) {
				try {
					const payload = await client.brief(
						String(params.query ?? ""),
						{
							budgetTokens: params.budget_tokens === undefined ? undefined : limit(params.budget_tokens, 4000, 20_000),
							maxPages: params.max_pages === undefined ? undefined : limit(params.max_pages, 20, 50),
							pathPrefix: optionalString(params.path_prefix),
						},
						signal,
					);
					return text(clip(formatBrief(payload), 48_000), payload);
				} catch (error) {
					if (!(error instanceof KiwiError) || error.status !== 404) throw error;
					const payload = await client.search(String(params.query ?? ""), { limit: 5 }, signal);
					return text(`${formatSearch(payload)}\n\nThis server has no /brief endpoint. Peek a path, then read one heading.`, payload);
				}
			},
		}),
		tool(z, {
			name: "kiwi_search",
			label: "KiwiFS Search",
			description:
				"BM25 keyword search with snippets. Search before creating a page. Use kiwi_brief when you want the relevant sections packed into one result.",
			approval: "read",
			parameters: {
				query: query(),
				limit: z.number().optional().describe("Max results. Default 10, max 50."),
				offset: z.number().optional().describe("Results to skip."),
				path_prefix: z.string().optional().describe("Only pages under this folder."),
				scope: z.string().optional().describe("Only pages whose frontmatter scope equals this value."),
				recency_weight: z.number().optional().describe("0 relevance only, 1 recency only."),
			},
			async run(params, signal) {
				const payload = await client.search(
					String(params.query ?? ""),
					{
						limit: limit(params.limit ?? 10, 10, 50),
						offset: params.offset === undefined ? undefined : limit(params.offset, 0, 500, 0),
						pathPrefix: optionalString(params.path_prefix),
						scope: optionalString(params.scope),
						recencyWeight: typeof params.recency_weight === "number" ? params.recency_weight : undefined,
					},
					signal,
				);
				return text(formatSearch(payload), payload);
			},
		}),
		tool(z, {
			name: "kiwi_search_hybrid",
			label: "KiwiFS Hybrid Search",
			description:
				"Fuse keyword and vector search. Falls back to keywords when the knowledge base has no vector index. Use for a natural-language lookup when kiwi_brief is too wide.",
			approval: "read",
			parameters: {
				query: query(),
				limit: z.number().optional().describe("Max results. Default 10."),
				path_prefix: z.string().optional().describe("Only pages under this folder."),
			},
			async run(params, signal) {
				const payload = await client.search(
					String(params.query ?? ""),
					{
						mode: "hybrid",
						limit: limit(params.limit ?? 10, 10, 50),
						pathPrefix: optionalString(params.path_prefix),
					},
					signal,
				);
				return text(formatSearch(payload), payload);
			},
		}),
		tool(z, {
			name: "kiwi_peek",
			label: "KiwiFS Peek",
			description: "Skim one page: title, frontmatter, opening paragraph, headings, links, and backlinks. Use this before paying for kiwi_read.",
			approval: "read",
			parameters: { path: path() },
			async run(params, signal) {
				const payload = await client.peek(String(params.path), signal);
				return text(formatPeek(payload), payload);
			},
		}),
		tool(z, {
			name: "kiwi_read",
			label: "KiwiFS Read",
			description:
				"Read one page and its etag. Pass if_match back to kiwi_write. Prefer kiwi_peek or kiwi_section unless you need the whole page.",
			approval: "read",
			parameters: {
				path: path(),
				resolve_links: z.boolean().optional().describe("Rewrite wiki links to absolute URLs when a public URL is configured."),
				metadata_only: z.boolean().optional().describe("Return parsed frontmatter instead of the body."),
				if_not_etag: z.string().optional().describe("ETag from an earlier read. Returns unchanged when it still matches."),
			},
			async run(params, signal) {
				const file = await client.read(
					String(params.path),
					{
						resolveLinks: params.resolve_links === true,
						metadataOnly: params.metadata_only === true,
						ifNoneMatch: optionalString(params.if_not_etag),
					},
					signal,
				);
				return text(formatRead(file.path, file.content, file.etag, file.notModified, READ_CAP), {
					path: file.path,
					etag: file.etag,
				});
			},
		}),
		tool(z, {
			name: "kiwi_section",
			label: "KiwiFS Section",
			description: "Read one heading section by name (Parent > Child for a nested heading) or by 0-based index.",
			approval: "read",
			parameters: {
				path: path(),
				heading: z.string().optional().describe("Heading text, matched case-insensitively."),
				index: z.number().optional().describe("0-based section index, used when heading is omitted."),
			},
			async run(params, signal) {
				const payload = await client.section(
					String(params.path),
					optionalString(params.heading),
					typeof params.index === "number" ? params.index : undefined,
					signal,
				);
				if (payload && typeof payload === "object" && "content" in payload) {
					const section = payload as { path?: string; heading?: string; content?: string };
					const title = [section.path, section.heading].filter(Boolean).join(" # ");
					return text(clip(`${title}\n\n${section.content ?? ""}`, 24_000), payload);
				}
				return text(clip(jsonBlock(payload, 24_000), 24_000), payload);
			},
		}),
		tool(z, {
			name: "kiwi_tree",
			label: "KiwiFS Tree",
			description: "List files and folders. Use it to see where a new page belongs before writing.",
			approval: "read",
			parameters: {
				path: z.string().optional().describe("Folder to start from. Omit for the knowledge root."),
				depth: z.number().optional().describe("How many levels to show. Default 3, max 8."),
			},
			async run(params, signal) {
				const payload = await client.tree(optionalString(params.path), signal);
				return text(formatTree(payload, limit(params.depth ?? 3, 3, 8)), payload);
			},
		}),
		tool(z, {
			name: "kiwi_toc",
			label: "KiwiFS TOC",
			description: "List a page's headings so you can kiwi_section the one you need.",
			approval: "read",
			parameters: { path: path() },
			async run(params, signal) {
				const payload = await client.toc(String(params.path), signal);
				return text(jsonBlock(payload, 8_000), payload);
			},
		}),
		tool(z, {
			name: "kiwi_backlinks",
			label: "KiwiFS Backlinks",
			description: "Pages that link to this one. Check before renaming or deleting.",
			approval: "read",
			parameters: { path: path() },
			async run(params, signal) {
				const payload = await client.backlinks(String(params.path), signal);
				return text(formatBacklinks(payload), payload);
			},
		}),
		tool(z, {
			name: "kiwi_query",
			label: "KiwiFS Query",
			description:
				"Run a DQL query over frontmatter. Examples: TABLE title, status WHERE status = \"draft\"; LIST FROM \"guides\"; COUNT WHERE status = \"verified\".",
			approval: "read",
			parameters: { query: z.string().describe("DQL query.") },
			async run(params, signal) {
				const payload = await client.query(String(params.query ?? ""), signal);
				return text(formatQuery(payload), payload);
			},
		}),
		tool(z, {
			name: "kiwi_write",
			label: "KiwiFS Write",
			description:
				"Create or overwrite one page as a single git commit. When the page already exists, pass if_match from kiwi_read so a concurrent edit returns 409 instead of being lost. Include the frontmatter the schema requires.",
			approval: "write",
			parameters: {
				path: path(),
				content: z.string().describe("Full markdown file, including frontmatter."),
				if_match: z.string().optional().describe("ETag the page must still have."),
				provenance: z.string().optional().describe("type:id recorded on derived-from, such as run:42 or ingest:rfc-6749."),
				actor: z.string().optional().describe("Commit author. Defaults to the extension actor."),
			},
			async run(params, signal) {
				const result = await client.write(
					String(params.path),
					String(params.content ?? ""),
					{
						ifMatch: optionalString(params.if_match),
						provenance: optionalString(params.provenance),
						actor: optionalString(params.actor),
					},
					signal,
				);
				return text(formatWrite(result.path, result.etag, "Wrote"), result);
			},
		}),
		tool(z, {
			name: "kiwi_append",
			label: "KiwiFS Append",
			description: "Append to a page without a read-modify-write race. Use it for log.md and other append-only notes.",
			approval: "write",
			parameters: {
				path: path(),
				content: z.string().describe("Markdown to append."),
				separator: z.string().optional().describe("Inserted between the existing page and the new text. Default newline."),
			},
			async run(params, signal) {
				const result = await client.append(
					String(params.path),
					String(params.content ?? ""),
					{ separator: typeof params.separator === "string" ? params.separator : undefined },
					signal,
				);
				return text(formatWrite(result.path, result.etag, "Appended to"), result);
			},
		}),
		tool(z, {
			name: "kiwi_patch_frontmatter",
			label: "KiwiFS Patch Frontmatter",
			description:
				"Set or clear frontmatter keys without resending the body. Null removes a key. Pass if_match when another agent may be editing the page. Use force only to take over a key another field manager owns.",
			approval: "write",
			parameters: {
				path: path(),
				fields: z.record(z.unknown()).describe("Frontmatter keys to set. Null removes a key."),
				if_match: z.string().optional().describe("ETag the page must still have."),
				force: z.boolean().optional().describe("Take over keys owned by another field manager."),
			},
			async run(params, signal) {
				const fields = params.fields && typeof params.fields === "object" ? (params.fields as Record<string, unknown>) : {};
				const result = await client.patchFrontmatter(
					String(params.path),
					fields,
					{ ifMatch: optionalString(params.if_match), force: params.force === true },
					signal,
				);
				return text(formatWrite(result.path, result.etag, "Updated frontmatter on"), result);
			},
		}),
		tool(z, {
			name: "kiwi_bulk_write",
			label: "KiwiFS Bulk Write",
			description: "Write several pages in one atomic commit. One stale if_match fails the whole batch and nothing is written.",
			approval: "write",
			parameters: {
				files: z.array(
					z.object({
						path: z.string().describe("Destination path."),
						content: z.string().describe("Full markdown content."),
						if_match: z.string().optional().describe("ETag this file must still have."),
					}),
				).describe("Pages to write together."),
				provenance: z.string().optional().describe("type:id added to every page's derived-from list."),
				message: z.string().optional().describe("Commit message."),
			},
			async run(params, signal) {
				const files = Array.isArray(params.files) ? params.files : [];
				const payload = await client.bulkWrite(files, {
					provenance: optionalString(params.provenance),
					message: optionalString(params.message),
				}, signal);
				return text(jsonBlock(payload), payload);
			},
		}),
		tool(z, {
			name: "kiwi_delete",
			label: "KiwiFS Delete",
			description: "Delete one page. History stays in git. Check kiwi_backlinks first and update links that pointed here.",
			approval: "write",
			parameters: { path: path() },
			async run(params, signal) {
				const payload = await client.remove(String(params.path), undefined, signal);
				return text(`Deleted ${String(params.path)}. History remains in git.`, payload);
			},
		}),
		tool(z, {
			name: "kiwi_rename",
			label: "KiwiFS Rename",
			description: "Move one page and rewrite wiki links that point at it, in one commit. The destination must not already exist.",
			approval: "write",
			parameters: {
				from: z.string().describe("Current path."),
				to: z.string().describe("New path."),
				update_links: z.boolean().optional().describe("Rewrite incoming links. Default true."),
			},
			async run(params, signal) {
				const payload = await client.rename(
					String(params.from),
					String(params.to),
					params.update_links !== false,
					undefined,
					signal,
				);
				return text(jsonBlock(payload), payload);
			},
		}),
		tool(z, {
			name: "kiwi_remember",
			label: "KiwiFS Remember",
			description:
				"Save a raw observation as an episode under episodes/<date>/<id>.md. Use this for session notes. Promote durable facts into a normal page with kiwi_write and merged-from.",
			approval: "write",
			parameters: {
				content: z.string().describe("What to remember, as markdown."),
				scope: z.string().optional().describe("Partition such as user:alice or project:billing."),
				episode_id: z.string().optional().describe("Stable id. Generated when omitted."),
				tags: z.array(z.string()).optional().describe("Short tags."),
			},
			async run(params, signal) {
				const result = await client.remember(
					String(params.content ?? ""),
					{
						scope: optionalString(params.scope),
						episodeId: optionalString(params.episode_id),
						tags: Array.isArray(params.tags) ? params.tags.map(String) : undefined,
					},
					signal,
				);
				return text(formatWrite(result.path, result.etag, "Remembered"), result);
			},
		}),
		tool(z, {
			name: "kiwi_forget",
			label: "KiwiFS Forget",
			description:
				"Retire a memory without deleting it. Sets memory_status to superseded so search hides it unless include_superseded is requested.",
			approval: "write",
			parameters: {
				path: path(),
				reason: z.string().optional().describe("Why this memory was retired."),
			},
			async run(params, signal) {
				const result = await client.forget(String(params.path), optionalString(params.reason), signal);
				return text(formatWrite(result.path, result.etag, "Retired"), result);
			},
		}),
		tool(z, {
			name: "kiwi_lint",
			label: "KiwiFS Lint",
			description: "Check a saved page, or markdown you have not saved yet, for frontmatter, headings, tables, fences, and broken structure. Run it after kiwi_write.",
			approval: "read",
			parameters: {
				path: z.string().optional().describe("Saved page to lint."),
				content: z.string().optional().describe("Unsaved markdown to lint. Used instead of path when both are set."),
			},
			async run(params, signal) {
				const payload = await client.lint(
					{ path: optionalString(params.path), content: typeof params.content === "string" ? params.content : undefined },
					signal,
				);
				return text(formatLint(payload), payload);
			},
		}),
		tool(z, {
			name: "kiwi_analytics",
			label: "KiwiFS Analytics",
			description: "Knowledge-base health: page counts, orphans, broken links, stale pages, and link coverage.",
			approval: "read",
			parameters: { scope: z.string().optional().describe("Only pages under this path prefix.") },
			async run(params, signal) {
				const payload = await client.analytics(optionalString(params.scope), signal);
				return text(formatAnalytics(payload), payload);
			},
		}),
		tool(z, {
			name: "kiwi_health_check",
			label: "KiwiFS Health Check",
			description: "Size, links, freshness, and open issues for one page.",
			approval: "read",
			parameters: { path: path() },
			async run(params, signal) {
				const payload = await client.healthCheck(String(params.path), signal);
				return text(formatHealth(payload), payload);
			},
		}),
		tool(z, {
			name: "kiwi_memory_report",
			label: "KiwiFS Memory Report",
			description: "Which episodes have not been folded into a durable page. Use the unmerged list as the consolidation queue.",
			approval: "read",
			parameters: {},
			async run(_params, signal) {
				const payload = await client.memoryReport(signal);
				return text(formatMemoryReport(payload), payload);
			},
		}),
		tool(z, {
			name: "kiwi_versions",
			label: "KiwiFS Versions",
			description: "Git history for one page, newest first. Use kiwi_diff with two hashes to see what changed.",
			approval: "read",
			parameters: { path: path() },
			async run(params, signal) {
				const payload = await client.versions(String(params.path), signal);
				return text(formatVersions(payload), payload);
			},
		}),
		tool(z, {
			name: "kiwi_diff",
			label: "KiwiFS Diff",
			description: "Unified diff of one page between two commit hashes from kiwi_versions.",
			approval: "read",
			parameters: {
				path: path(),
				from: z.string().describe("Older commit hash."),
				to: z.string().describe("Newer commit hash."),
			},
			async run(params, signal) {
				const body = await client.diff(String(params.path), String(params.from), String(params.to), signal);
				return text(clip(body, 24_000));
			},
		}),
		tool(z, {
			name: "kiwi_changes",
			label: "KiwiFS Changes",
			description: "Recent writes, deletes, and renames across the knowledge base. Pass since from the previous last_seq to see only newer commits.",
			approval: "read",
			parameters: {
				since: z.string().optional().describe("Commit hash. Returns only commits after it."),
				limit: z.number().optional().describe("Max changes. Default 20, max 100."),
			},
			async run(params, signal) {
				const payload = await client.changes(optionalString(params.since), limit(params.limit ?? 20, 20, 100), signal);
				return text(formatChanges(payload), payload);
			},
		}),
	];
}

function tool(
	z: Zod,
	spec: {
		name: string;
		label: string;
		description: string;
		approval: "read" | "write";
		parameters: Record<string, ZodSchema>;
		run: KiwiTool["execute"] extends (...args: infer _A) => infer R
			? (params: Record<string, any>, signal: AbortSignal | undefined) => Promise<Awaited<R>>
			: never;
	},
): KiwiTool {
	return {
		name: spec.name,
		label: spec.label,
		description: spec.description,
		parameters: z.object(spec.parameters),
		approval: spec.approval,
		loadMode: "essential",
		async execute(_toolCallId, params, signal) {
			try {
				return await spec.run(params ?? {}, signal);
			} catch (error) {
				return failure(error);
			}
		},
	};
}
