---
name: kiwifs
description: Read, update, and look up a KiwiFS knowledge base. Use when the user mentions KiwiFS, the knowledge base, prior decisions, project memory, spaces, or asks to remember or file something for later.
---

# KiwiFS

KiwiFS is the knowledge base. Pages are markdown files with frontmatter, wiki links, and git history. The extension tools and the KiwiFS MCP server talk to the same base.

## Do not use local edit/write

KiwiFS pages are not workspace files. Do not call omp `edit` or `write` on them.

- omp `edit` needs `[PATH#TAG]` where `TAG` is a **4-hex** snapshot from a local omp `read`.
- `kiwi_read` returns a long `if_match` value for optimistic concurrency. That value is **only** for `kiwi_write` / `kiwi_patch_frontmatter` / `kiwi_bulk_write`.
- Building `[job-hunting/strategy.md#9DFB3B4E…]` from a KiwiFS etag will fail. Call `kiwi_write` with `if_match` instead.

## Start of a knowledge task

Call `kiwi_context` once. It returns the schema, playbook, rules, and index. Those files decide where a page goes and which frontmatter it needs. Do not invent a folder layout that contradicts them.

## Spaces

1. `kiwi_init_templates` — see scaffolds (`kb`, `memory`, `wiki`, `research`, `blank`, …).
2. `kiwi_space_create` — create and register a space.
3. `kiwi_spaces_list` / `kiwi_space_get` — inspect spaces.
4. Point the extension at the space (`KIWIFS_SPACE` or `omp plugin config set omp-kiwifs-extension space <name>`), then `kiwi_context` before writing pages into it.

## Lookup

1. `kiwi_brief` for a question. It returns verbatim sections inside a token budget and names what did not fit.
2. `kiwi_search` for keywords. `kiwi_search_hybrid` when the wording is fuzzy.
3. `kiwi_peek` before opening a long page. `kiwi_section` for one heading. `kiwi_read` only for the whole page.
4. `kiwi_query` for frontmatter questions (`TABLE`, `LIST`, `COUNT`, `DISTINCT`).
5. `kiwi_backlinks` before moving or deleting a page.

Search before creating a page. Update the existing page when the topic is already there.

## Update

- `kiwi_write` sends the full file. Pass `if_match` from `kiwi_read` or the previous write. A 409 means someone else saved; read again and merge.
- `kiwi_append` is for logs and other append-only pages.
- `kiwi_patch_frontmatter` changes keys without rewriting the body. `null` removes a key.
- `kiwi_bulk_write` is one commit for several pages. One stale if_match rolls the batch back.
- `kiwi_rename` moves a page and rewrites links. `kiwi_delete` keeps git history.
- After a write, `kiwi_lint` the page and add it to the index the playbook names. Link related pages with `[[wikilinks]]`.

## Memory

`kiwi_remember` stores a raw episode under `episodes/<date>/`. Durable facts belong on a normal page. When you fold episodes in, list them in `merged-from` and retire leftovers with `kiwi_forget`. `kiwi_memory_report` shows what is still unmerged.

## Everything else

Refactoring, drafts, workflows, claims, import, canvas, and widgets are on the KiwiFS MCP server (`kiwifs mcp`). Use those tools when the task needs them. Keep read, update, lookup, and spaces on the `kiwi_*` tools from this extension.
