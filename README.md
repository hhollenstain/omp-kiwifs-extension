# omp KiwiFS

KiwiFS for [oh-my-pi](https://omp.sh). After install, omp can load the knowledge-base context, look pages up, and update them the way KiwiFS expects: search before creating, peek before reading, and write with the etag from the last read.

The extension registers the day-to-day `kiwi_*` tools. It also starts the official `kiwifs mcp` server, which exposes the rest of KiwiFS (refactor, drafts, workflows, claims, import, and the other MCP tools).

## Install

From this directory:

```bash
omp install .
```

`omp install` on a local path links the package into your user plugins. A published package or git repo works the same way:

```bash
omp install omp-kiwifs-extension
omp install github:OWNER/omp-kiwifs-extension
```

Start a new omp session after installing. Confirm it with `omp plugin list` and, inside omp, `/kiwi status`.

## Point it at a knowledge base

The default server is `http://127.0.0.1:3333`, which is what `kiwifs serve` listens on.

```bash
kiwifs init --root ~/knowledge
kiwifs serve --root ~/knowledge
```

Settings can live in the environment or in plugin config. Environment variables win.

| Setting | Environment | Default |
| --- | --- | --- |
| `url` | `KIWIFS_URL` | `http://127.0.0.1:3333` |
| `apiKey` | `KIWIFS_API_KEY` | unset |
| `actor` | `KIWIFS_ACTOR` | `agent:omp` |
| `space` | `KIWIFS_SPACE` | primary space |
| `root` | `KIWIFS_ROOT` | unset |
| `mode` | `KIWIFS_MODE` | `auto` |
| `bin` | `KIWIFS_BIN` | `kiwifs` |
| `injectContext` | `KIWIFS_INJECT_CONTEXT` | `true` |

```bash
omp plugin config set omp-kiwifs-extension url http://127.0.0.1:3333
omp plugin config set omp-kiwifs-extension apiKey "$KIWIFS_API_KEY"
omp plugin config set omp-kiwifs-extension actor agent:omp
```

Project overrides go in `.omp/plugin-overrides.json`:

```json
{
  "settings": {
    "omp-kiwifs-extension": {
      "url": "http://127.0.0.1:3333"
    }
  }
}
```

`mode` chooses how the bundled MCP server starts:

- `remote` runs `kiwifs mcp --remote <url>`, so omp shares the running server's index. This is the right mode when the web UI or other agents use the same base.
- `root` runs `kiwifs mcp --root <path>` and opens that directory in-process. No server required. The `kiwi_*` HTTP tools still need `url`.
- `auto` uses root only when a root is set and no URL was set explicitly. Otherwise it proxies the server URL.

The `kiwifs` binary has to be on `PATH` for MCP. The `kiwi_*` tools only need the HTTP server. If MCP fails to spawn, disable that server with `/mcp disable kiwifs` and keep using the tools.

## What the agent does

1. `kiwi_context` loads the schema, playbook, rules, and index. With `injectContext` on, that bundle is also added to the system prompt.
2. `kiwi_brief` or `kiwi_search` looks up a question. `kiwi_search_hybrid` fuses keyword and vector results when a vector index exists.
3. `kiwi_peek` and `kiwi_section` skim a page. `kiwi_read` returns the whole page and its etag.
4. `kiwi_write` updates a page. Pass `if_match` so a concurrent edit is a conflict instead of a silent overwrite. `kiwi_append`, `kiwi_patch_frontmatter`, and `kiwi_bulk_write` cover logs, field updates, and multi-file commits.
5. `kiwi_lint` checks the page afterward. `kiwi_remember` stores an episode; `kiwi_forget` retires one without deleting it.

`/kiwi` runs the same operations from the prompt:

```text
/kiwi status
/kiwi search auth
/kiwi brief how does auth work
/kiwi tree
/kiwi context
/kiwi analytics
/kiwi config
```

A skill at `skills/kiwifs/SKILL.md` and an always-on rule tell the model to follow the playbook that `kiwi_context` returns.

## Develop

```bash
bun test
npx tsc --noEmit
omp --extension .
```

`omp install .` stays pointed at this directory, so the next session picks up edits. Extension code loads at startup; restart omp after changing `src/`.
