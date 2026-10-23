import type { KiwiConfig } from "../bin/config.mjs";

export class KiwiError extends Error {
	readonly status: number | undefined;

	constructor(message: string, status?: number) {
		super(message);
		this.name = "KiwiError";
		this.status = status;
	}
}

export interface FileResult {
	path: string;
	content: string;
	etag?: string;
	metadataOnly: boolean;
	notModified: boolean;
}

export interface WriteResult {
	path: string;
	etag?: string;
	raw: unknown;
}

/** Keep a knowledge-base path relative and reject traversal. */
export function kiwiPath(input: string): string {
	const raw = String(input ?? "").trim().replace(/\\/g, "/");
	if (!raw || raw === "/") throw new KiwiError("path is required");
	const parts: string[] = [];
	for (const part of raw.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") throw new KiwiError(`path escapes the knowledge base: ${input}`);
		parts.push(part);
	}
	if (parts.length === 0) throw new KiwiError("path is required");
	return parts.join("/");
}

function quoteEtag(etag: string): string {
	const trimmed = etag.trim();
	if (trimmed.startsWith("W/") || trimmed.startsWith('"')) return trimmed;
	return `"${trimmed}"`;
}

function stripEtag(header: string | null): string | undefined {
	if (!header) return undefined;
	return header.trim().replace(/^W\//, "").replace(/^"/, "").replace(/"$/, "");
}

function errorMessage(status: number, body: string, path: string): string {
	let detail = body.trim();
	try {
		const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
		if (typeof parsed.error === "string" && parsed.error.trim()) detail = parsed.error.trim();
		else if (typeof parsed.message === "string" && parsed.message.trim()) detail = parsed.message.trim();
	} catch {
		// The body is not JSON.
	}
	const clipped = detail.replace(/\s+/g, " ").slice(0, 400);
	return `KiwiFS ${status} for ${path}${clipped ? `: ${clipped}` : ""}`;
}

export class KiwiClient {
	constructor(private readonly config: KiwiConfig) {}

	origin(): string {
		return this.config.url.replace(/\/+$/, "");
	}

	private api(pathname: string): string {
		const space = this.config.space ? `/${encodeURIComponent(this.config.space)}` : "";
		const suffix = pathname.startsWith("/") ? pathname : `/${pathname}`;
		return `${this.origin()}/api/kiwi${space}${suffix}`;
	}

	private headers(extra?: Record<string, string>, actor?: string): Record<string, string> {
		const headers: Record<string, string> = {
			"X-Actor": actor?.trim() || this.config.actor,
			"X-Kiwi-Source": "omp",
			...extra,
		};
		if (this.config.apiKey) {
			const token = this.config.apiKey.toLowerCase().startsWith("bearer ")
				? this.config.apiKey
				: `Bearer ${this.config.apiKey}`;
			headers.Authorization = token;
		}
		return headers;
	}

	private async send(
		url: string,
		init: { method: string; body?: string; headers?: Record<string, string>; actor?: string },
		signal?: AbortSignal,
	): Promise<{ status: number; headers: Headers; text: string }> {
		const timeout = AbortSignal.timeout(this.config.timeoutMs);
		const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
		let response: Response;
		try {
			response = await fetch(url, {
				method: init.method,
				body: init.body,
				headers: this.headers(init.headers, init.actor),
				signal: combined,
			});
		} catch (error) {
			if (signal?.aborted) throw new KiwiError("cancelled");
			const message = error instanceof Error ? error.message : String(error);
			throw new KiwiError(`KiwiFS at ${this.origin()} is not reachable (${message})`);
		}
		const text = await response.text();
		if (response.status === 304) {
			return { status: 304, headers: response.headers, text: "" };
		}
		if (!response.ok) {
			const target = new URL(url).pathname;
			throw new KiwiError(errorMessage(response.status, text, target), response.status);
		}
		return { status: response.status, headers: response.headers, text };
	}

	private async getJson<T>(pathname: string, signal?: AbortSignal): Promise<T> {
		const response = await this.send(this.api(pathname), { method: "GET" }, signal);
		return this.parseJson<T>(response.text, pathname);
	}

	private async sendJson<T>(
		method: string,
		pathname: string,
		body: unknown,
		signal?: AbortSignal,
		headers?: Record<string, string>,
		actor?: string,
	): Promise<T> {
		const response = await this.send(
			this.api(pathname),
			{
				method,
				body: JSON.stringify(body),
				headers: { "Content-Type": "application/json", ...headers },
				actor,
			},
			signal,
		);
		return this.parseJson<T>(response.text, pathname);
	}

	private parseJson<T>(text: string, pathname: string): T {
		if (!text.trim()) return {} as T;
		try {
			return JSON.parse(text) as T;
		} catch {
			throw new KiwiError(`KiwiFS returned a non-JSON body for ${pathname}`);
		}
	}

	private admin(pathname: string): string {
		const suffix = pathname.startsWith("/") ? pathname : `/${pathname}`;
		return `${this.origin()}/api${suffix}`;
	}

	async health(signal?: AbortSignal): Promise<{ status: string; version?: string }> {
		const response = await this.send(`${this.origin()}/healthz`, { method: "GET" }, signal);
		const parsed = this.parseJson<{ status?: string; version?: string }>(response.text, "/healthz");
		return { status: parsed.status ?? "ok", version: parsed.version };
	}

	async listSpaces(signal?: AbortSignal): Promise<unknown> {
		const response = await this.send(this.admin("/spaces"), { method: "GET" }, signal);
		return this.parseJson(response.text, "/spaces");
	}

	async getSpace(name: string, signal?: AbortSignal): Promise<unknown> {
		const cleaned = spaceName(name);
		const response = await this.send(this.admin(`/spaces/${encodeURIComponent(cleaned)}`), { method: "GET" }, signal);
		return this.parseJson(response.text, `/spaces/${cleaned}`);
	}

	async createSpace(
		name: string,
		options?: { root?: string; template?: string },
		signal?: AbortSignal,
	): Promise<unknown> {
		const body: Record<string, string> = { name: spaceName(name) };
		if (options?.root?.trim()) body.root = options.root.trim();
		if (options?.template?.trim()) body.template = options.template.trim();
		const response = await this.send(
			this.admin("/spaces"),
			{ method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } },
			signal,
		);
		return this.parseJson(response.text, "/spaces");
	}

	async deleteSpace(name: string, signal?: AbortSignal): Promise<unknown> {
		const cleaned = spaceName(name);
		const response = await this.send(
			this.admin(`/spaces/${encodeURIComponent(cleaned)}`),
			{ method: "DELETE" },
			signal,
		);
		return this.parseJson(response.text, `/spaces/${cleaned}`);
	}

	async initTemplates(signal?: AbortSignal): Promise<unknown> {
		const response = await this.send(this.admin("/init-templates"), { method: "GET" }, signal);
		return this.parseJson(response.text, "/init-templates");
	}

	async context(signal?: AbortSignal): Promise<{ schema: string; playbook: string; index: string; rules: string }> {
		const payload = await this.getJson<Record<string, unknown>>("/context", signal);
		return {
			schema: stringField(payload.schema),
			playbook: stringField(payload.playbook),
			index: stringField(payload.index),
			rules: stringField(payload.rules),
		};
	}

	async read(
		path: string,
		options?: { resolveLinks?: boolean; metadataOnly?: boolean; ifNoneMatch?: string },
		signal?: AbortSignal,
	): Promise<FileResult> {
		const rel = kiwiPath(path);
		const params = new URLSearchParams({ path: rel });
		if (options?.resolveLinks) params.set("resolve_links", "true");
		if (options?.metadataOnly) params.set("metadata_only", "true");
		const headers: Record<string, string> = {};
		if (options?.ifNoneMatch) headers["If-None-Match"] = quoteEtag(options.ifNoneMatch);
		const response = await this.send(this.api(`/file?${params}`), { method: "GET", headers }, signal);
		if (response.status === 304) {
			return {
				path: rel,
				content: "",
				etag: options?.ifNoneMatch,
				metadataOnly: Boolean(options?.metadataOnly),
				notModified: true,
			};
		}
		return {
			path: rel,
			content: response.text,
			etag: stripEtag(response.headers.get("etag")),
			metadataOnly: Boolean(options?.metadataOnly),
			notModified: false,
		};
	}

	async write(
		path: string,
		content: string,
		options?: { ifMatch?: string; provenance?: string; actor?: string },
		signal?: AbortSignal,
	): Promise<WriteResult> {
		const rel = kiwiPath(path);
		const headers: Record<string, string> = { "Content-Type": "text/markdown; charset=utf-8" };
		if (options?.ifMatch) headers["If-Match"] = quoteEtag(options.ifMatch);
		if (options?.provenance) headers["X-Provenance"] = options.provenance;
		const response = await this.send(
			this.api(`/file?${new URLSearchParams({ path: rel })}`),
			{ method: "PUT", body: content, headers, actor: options?.actor },
			signal,
		);
		const raw = this.parseJson<{ path?: string; etag?: string }>(response.text, "/file");
		return {
			path: raw.path ?? rel,
			etag: raw.etag ?? stripEtag(response.headers.get("etag")),
			raw,
		};
	}

	async append(
		path: string,
		content: string,
		options?: { separator?: string; actor?: string },
		signal?: AbortSignal,
	): Promise<WriteResult> {
		const rel = kiwiPath(path);
		const params = new URLSearchParams({ path: rel });
		if (options?.separator !== undefined) params.set("separator", options.separator);
		const response = await this.send(
			this.api(`/file/append?${params}`),
			{
				method: "POST",
				body: content,
				headers: { "Content-Type": "text/markdown; charset=utf-8" },
				actor: options?.actor,
			},
			signal,
		);
		const raw = this.parseJson<{ path?: string; etag?: string }>(response.text, "/file/append");
		return { path: raw.path ?? rel, etag: raw.etag ?? stripEtag(response.headers.get("etag")), raw };
	}

	async patchFrontmatter(
		path: string,
		fields: Record<string, unknown>,
		options?: { ifMatch?: string; force?: boolean; actor?: string },
		signal?: AbortSignal,
	): Promise<WriteResult> {
		const rel = kiwiPath(path);
		const params = new URLSearchParams({ path: rel });
		if (options?.force) params.set("force", "true");
		const headers: Record<string, string> = { "X-Field-Manager": options?.actor?.trim() || this.config.actor };
		if (options?.ifMatch) headers["If-Match"] = quoteEtag(options.ifMatch);
		const raw = await this.sendJson<{ path?: string; etag?: string }>(
			"PATCH",
			`/file/frontmatter?${params}`,
			{ fields },
			signal,
			headers,
			options?.actor,
		);
		return { path: raw.path ?? rel, etag: raw.etag, raw };
	}

	async remove(path: string, actor: string | undefined, signal?: AbortSignal): Promise<unknown> {
		const rel = kiwiPath(path);
		const response = await this.send(
			this.api(`/file?${new URLSearchParams({ path: rel })}`),
			{ method: "DELETE", actor },
			signal,
		);
		return this.parseJson(response.text, "/file");
	}

	async rename(
		from: string,
		to: string,
		updateLinks: boolean,
		actor: string | undefined,
		signal?: AbortSignal,
	): Promise<unknown> {
		return this.sendJson(
			"POST",
			"/rename",
			{ from: kiwiPath(from), to: kiwiPath(to), update_links: updateLinks },
			signal,
			undefined,
			actor,
		);
	}

	async bulkWrite(
		files: Array<{ path: string; content: string; if_match?: string }>,
		options?: { provenance?: string; message?: string; actor?: string },
		signal?: AbortSignal,
	): Promise<unknown> {
		const headers: Record<string, string> = {};
		if (options?.provenance) headers["X-Provenance"] = options.provenance;
		return this.sendJson(
			"POST",
			"/bulk",
			{
				actor: options?.actor?.trim() || this.config.actor,
				message: options?.message,
				files: files.map((file) => ({
					path: kiwiPath(file.path),
					content: file.content,
					if_match: file.if_match,
				})),
			},
			signal,
			headers,
			options?.actor,
		);
	}

	async search(
		query: string,
		options?: {
			limit?: number;
			offset?: number;
			pathPrefix?: string;
			scope?: string;
			mode?: "fts" | "hybrid";
			recencyWeight?: number;
		},
		signal?: AbortSignal,
	): Promise<unknown> {
		const params = new URLSearchParams({ q: query });
		if (options?.limit !== undefined) params.set("limit", String(options.limit));
		if (options?.offset !== undefined) params.set("offset", String(options.offset));
		if (options?.pathPrefix) params.set("path_prefix", kiwiPath(options.pathPrefix).replace(/\/$/, "") + "/");
		if (options?.scope) params.set("scope", options.scope);
		if (options?.mode) params.set("mode", options.mode);
		if (options?.recencyWeight !== undefined) params.set("recency_weight", String(options.recencyWeight));
		return this.getJson(`/search?${params}`, signal);
	}

	async brief(
		query: string,
		options?: { budgetTokens?: number; maxPages?: number; pathPrefix?: string },
		signal?: AbortSignal,
	): Promise<unknown> {
		const body: Record<string, unknown> = { query };
		if (options?.budgetTokens !== undefined) body.budget_tokens = options.budgetTokens;
		if (options?.maxPages !== undefined) body.max_pages = options.maxPages;
		if (options?.pathPrefix) body.path_prefix = kiwiPath(options.pathPrefix);
		return this.sendJson("POST", "/brief", body, signal);
	}

	async peek(path: string, signal?: AbortSignal): Promise<unknown> {
		return this.getJson(`/peek?${new URLSearchParams({ path: kiwiPath(path) })}`, signal);
	}

	async section(path: string, heading: string | undefined, index: number | undefined, signal?: AbortSignal): Promise<unknown> {
		const params = new URLSearchParams({ path: kiwiPath(path) });
		if (heading) params.set("heading", heading);
		if (index !== undefined) params.set("index", String(index));
		return this.getJson(`/section?${params}`, signal);
	}

	async tree(path: string | undefined, signal?: AbortSignal): Promise<unknown> {
		const params = path ? `?${new URLSearchParams({ path: kiwiPath(path) })}` : "";
		return this.getJson(`/tree${params}`, signal);
	}

	async toc(path: string, signal?: AbortSignal): Promise<unknown> {
		return this.getJson(`/toc?${new URLSearchParams({ path: kiwiPath(path) })}`, signal);
	}

	async backlinks(path: string, signal?: AbortSignal): Promise<unknown> {
		return this.getJson(`/backlinks?${new URLSearchParams({ path: kiwiPath(path) })}`, signal);
	}

	async query(dql: string, signal?: AbortSignal): Promise<unknown> {
		return this.getJson(`/query?${new URLSearchParams({ q: dql })}`, signal);
	}

	async lint(input: { path?: string; content?: string }, signal?: AbortSignal): Promise<unknown> {
		const body: Record<string, string> = {};
		if (input.path) body.path = kiwiPath(input.path);
		if (input.content !== undefined) body.content = input.content;
		return this.sendJson("POST", "/lint", body, signal);
	}

	async analytics(scope: string | undefined, signal?: AbortSignal): Promise<unknown> {
		const params = scope ? `?${new URLSearchParams({ scope })}` : "";
		return this.getJson(`/analytics${params}`, signal);
	}

	async healthCheck(path: string, signal?: AbortSignal): Promise<unknown> {
		return this.getJson(`/health-check?${new URLSearchParams({ path: kiwiPath(path) })}`, signal);
	}

	async versions(path: string, signal?: AbortSignal): Promise<unknown> {
		return this.getJson(`/versions?${new URLSearchParams({ path: kiwiPath(path) })}`, signal);
	}

	async diff(path: string, from: string, to: string, signal?: AbortSignal): Promise<string> {
		const params = new URLSearchParams({ path: kiwiPath(path), from, to });
		const response = await this.send(this.api(`/diff?${params}`), { method: "GET" }, signal);
		return response.text;
	}

	async changes(since: string | undefined, limit: number | undefined, signal?: AbortSignal): Promise<unknown> {
		const params = new URLSearchParams();
		if (since) params.set("since", since);
		if (limit !== undefined) params.set("limit", String(limit));
		const query = params.toString();
		return this.getJson(`/changes${query ? `?${query}` : ""}`, signal);
	}

	async memoryReport(signal?: AbortSignal): Promise<unknown> {
		return this.getJson("/memory/report", signal);
	}

	async remember(
		content: string,
		options?: { scope?: string; episodeId?: string; tags?: string[] },
		signal?: AbortSignal,
	): Promise<WriteResult> {
		if (!content.trim()) throw new KiwiError("content is required");
		const now = new Date();
		const day = now.toISOString().slice(0, 10);
		const episodeId = options?.episodeId?.trim() || `${day.replace(/-/g, "")}-${randomId()}`;
		const path = `episodes/${day}/${kiwiPath(episodeId).split("/").pop()}.md`;
		const lines = ["---", "memory_kind: episodic", `episode_id: ${yamlScalar(episodeId)}`, `created: ${yamlScalar(now.toISOString())}`];
		if (options?.scope) lines.push(`scope: ${yamlScalar(options.scope)}`);
		if (options?.tags && options.tags.length > 0) {
			lines.push(`tags: [${options.tags.map((tag) => yamlScalar(tag)).join(", ")}]`);
		}
		lines.push("---", "", content.trim(), "");
		return this.write(path, lines.join("\n"), { provenance: `run:${episodeId}`, actor: this.config.actor }, signal);
	}

	async forget(path: string, reason: string | undefined, signal?: AbortSignal): Promise<WriteResult> {
		const fields: Record<string, unknown> = {
			memory_status: "superseded",
			valid_until: new Date().toISOString(),
		};
		if (reason?.trim()) fields.superseded_reason = reason.trim();
		return this.patchFrontmatter(path, fields, { actor: this.config.actor }, signal);
	}
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function spaceName(input: string): string {
	const name = String(input ?? "").trim();
	if (!name) throw new KiwiError("space name is required");
	if (/[./\\\s]/.test(name)) {
		throw new KiwiError(`invalid space name "${input}": cannot contain /, \\, spaces, or dots`);
	}
	return name;
}

function yamlScalar(value: string): string {
	return JSON.stringify(value);
}

function randomId(): string {
	const bytes = new Uint8Array(4);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
