import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, mcpArguments, normalizeServerUrl, resolveConfig } from "../bin/config.mjs";
import { KiwiClient, KiwiError, kiwiPath } from "../src/client.js";
import { formatBrief, formatRead, formatSearch } from "../src/format.js";
import { operatingInstructions, promptBlocks } from "../src/prompt.js";
import { createTools } from "../src/tools.js";

describe("server URL", () => {
	test("strips MCP and API suffixes", () => {
		expect(normalizeServerUrl("http://127.0.0.1:3333/")).toBe("http://127.0.0.1:3333");
		expect(normalizeServerUrl("http://127.0.0.1:3333/mcp")).toBe("http://127.0.0.1:3333");
		expect(normalizeServerUrl("http://127.0.0.1:3333/api/kiwi")).toBe("http://127.0.0.1:3333");
	});
});

describe("config", () => {
	test("environment overrides plugin settings", () => {
		const config = resolveConfig({
			home: "/tmp/home",
			settings: { url: "http://settings.example", actor: "agent:settings", apiKey: "from-settings" },
			env: { KIWIFS_URL: "http://env.example/mcp", KIWIFS_ACTOR: "agent:env" },
		});
		expect(config.url).toBe("http://env.example");
		expect(config.actor).toBe("agent:env");
		expect(config.apiKey).toBe("from-settings");
		expect(config.urlExplicit).toBe(true);
	});

	test("auto mode uses root only when no URL was set", () => {
		const rooted = resolveConfig({
			home: "/Users/me",
			settings: { root: "~/knowledge" },
			env: {},
		});
		expect(mcpArguments(rooted)).toEqual({
			mode: "root",
			args: ["mcp", "--root", "/Users/me/knowledge"],
		});

		const remote = resolveConfig({
			settings: { root: "/data/knowledge", url: "http://kiwi.internal" },
			env: {},
		});
		expect(mcpArguments(remote).args).toEqual(["mcp", "--remote", "http://kiwi.internal"]);
	});

	test("adds the API key and space only when they are set", () => {
		const config = resolveConfig({
			settings: { space: "docs" },
			env: { KIWIFS_API_KEY: "kiwi_sk_test" },
		});
		expect(mcpArguments(config).args).toEqual([
			"mcp",
			"--remote",
			"http://127.0.0.1:3333",
			"--api-key",
			"kiwi_sk_test",
			"--space",
			"docs",
		]);
	});

	test("project overrides win over the plugin lock file", () => {
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-home-"));
		const project = fs.mkdtempSync(path.join(os.tmpdir(), "kiwi-project-"));
		fs.mkdirSync(path.join(home, ".omp", "plugins"), { recursive: true });
		fs.writeFileSync(
			path.join(home, ".omp", "plugins", "omp-plugins.lock.json"),
			JSON.stringify({
				settings: { "omp-kiwifs-extension": { actor: "agent:lock", url: "http://lock.example" } },
			}),
		);
		fs.mkdirSync(path.join(project, ".omp"), { recursive: true });
		fs.writeFileSync(
			path.join(project, ".omp", "plugin-overrides.json"),
			JSON.stringify({ settings: { "omp-kiwifs-extension": { actor: "agent:project" } } }),
		);
		const config = loadConfig({ home, cwd: project, env: {} });
		expect(config.actor).toBe("agent:project");
		expect(config.url).toBe("http://lock.example");
	});
});

describe("paths", () => {
	test("rejects traversal and accepts a normal page", () => {
		expect(kiwiPath("pages/auth.md")).toBe("pages/auth.md");
		expect(kiwiPath("/pages/./auth.md")).toBe("pages/auth.md");
		expect(() => kiwiPath("../secret.md")).toThrow(KiwiError);
		expect(() => kiwiPath("pages/../../etc/passwd")).toThrow(KiwiError);
	});
});

describe("KiwiFS client", () => {
	test("reads, writes with If-Match, searches, and briefs", async () => {
		const seen: string[] = [];
		const server = Bun.serve({
			port: 0,
			async fetch(request) {
				const url = new URL(request.url);
				seen.push(`${request.method} ${url.pathname}`);
				if (url.pathname === "/healthz") return Response.json({ status: "ok", version: "test" });
				if (url.pathname === "/api/kiwi/docs/file" && request.method === "GET") {
					return new Response("# Auth\n", { headers: { ETag: '"abc"', "Content-Type": "text/markdown" } });
				}
				if (url.pathname === "/api/kiwi/docs/file" && request.method === "PUT") {
					expect(request.headers.get("if-match")).toBe('"abc"');
					expect(request.headers.get("authorization")).toBe("Bearer secret");
					expect(request.headers.get("x-actor")).toBe("agent:test");
					return Response.json({ path: "pages/auth.md", etag: "def" });
				}
				if (url.pathname === "/api/kiwi/docs/search") {
					return Response.json({
						query: "auth",
						results: [{ path: "pages/auth.md", score: 1.2, snippet: "token <mark>auth</mark>" }],
					});
				}
				if (url.pathname === "/api/kiwi/docs/brief" && request.method === "POST") {
					return Response.json({
						query: "auth",
						budget_tokens: 4000,
						used_tokens: 10,
						items: [{ path: "pages/auth.md", title: "Auth", content: "# Auth", tokens: 10 }],
						dropped: [],
					});
				}
				return new Response(JSON.stringify({ error: "missing" }), { status: 404 });
			},
		});

		try {
			const client = new KiwiClient({
				url: `http://127.0.0.1:${server.port}`,
				urlExplicit: true,
				root: "",
				rootExplicit: false,
				apiKey: "secret",
				actor: "agent:test",
				space: "docs",
				mode: "remote",
				bin: "kiwifs",
				injectContext: true,
				timeoutMs: 5_000,
			});
			const file = await client.read("pages/auth.md");
			expect(file.content).toContain("# Auth");
			expect(file.etag).toBe("abc");
			const written = await client.write("pages/auth.md", "# Auth\n\nupdated\n", { ifMatch: "abc" });
			expect(written.etag).toBe("def");
			expect(formatSearch(await client.search("auth", { limit: 5 }))).toContain("pages/auth.md");
			expect(formatSearch(await client.search("auth", { limit: 5 }))).not.toContain("<mark>");
			expect(formatBrief(await client.brief("auth"))).toContain("# Auth");
			expect(seen).toContain("GET /api/kiwi/docs/file");
			expect(seen).toContain("PUT /api/kiwi/docs/file");
		} finally {
			server.stop(true);
		}
	});
});

describe("tools and prompt", () => {
	test("registers the read, update, and lookup tools once each", () => {
		const schema = () => {
			const chain = { optional: () => chain, describe: () => chain };
			return chain;
		};
		const z = {
			string: schema,
			number: schema,
			boolean: schema,
			array: schema,
			object: () => schema(),
			record: schema,
			unknown: schema,
		};
		const names = createTools({} as KiwiClient, z).map((tool) => tool.name);
		expect(new Set(names).size).toBe(names.length);
		for (const required of ["kiwi_context", "kiwi_brief", "kiwi_read", "kiwi_write", "kiwi_search", "kiwi_remember"]) {
			expect(names).toContain(required);
		}
	});

	test("the extension factory registers tools and the /kiwi command", async () => {
		const { default: extension } = await import("../src/index.js");
		const schema = () => {
			const chain = { optional: () => chain, describe: () => chain };
			return chain;
		};
		const names: string[] = [];
		let command = "";
		extension({
			zod: {
				string: schema,
				number: schema,
				boolean: schema,
				array: schema,
				object: () => schema(),
				record: schema,
				unknown: schema,
			},
			logger: { warn() {} },
			registerTool(tool: { name: string }) {
				names.push(tool.name);
			},
			registerCommand(name: string) {
				command = name;
			},
			on() {},
			sendMessage() {},
		} as never);
		expect(command).toBe("kiwi");
		expect(names).toContain("kiwi_write");
		expect(names).toContain("kiwi_context");
	});

	test("appends KiwiFS instructions without duplicating them", () => {
		const addition = operatingInstructions({
			url: "http://127.0.0.1:3333",
			actor: "agent:omp",
			space: "",
			root: "",
			mode: "remote",
		});
		const once = promptBlocks(["You are a coding agent. ".repeat(20)], addition);
		expect(once.at(-1)).toContain("kiwi_context");
		expect(once.at(-1)).toContain("if_match");
		expect(promptBlocks(once, addition)).toBe(once);
		expect(formatRead("pages/auth.md", "hello", "abc", false, 100)).toContain("etag abc");
	});
});
