---
description: Use the connected KiwiFS knowledge base for lookup and updates
alwaysApply: true
interruptMode: never
---

When a task depends on project knowledge, prior decisions, or something that should be remembered, use KiwiFS instead of a new notes file.

Never use omp `edit` or `write` on KiwiFS paths. Those tools require a local 4-hex TAG from omp `read`. `kiwi_read` returns `if_match` for `kiwi_write` only — do not build `[path#if_match]` headers.

Call kiwi_context before the first read or write. Look up with kiwi_brief or kiwi_search, skim with kiwi_peek, and read a heading with kiwi_section before kiwi_read. Overwrite a page with kiwi_write and pass if_match from that read. Search before creating a page. Create spaces with kiwi_space_create after kiwi_init_templates. Follow the playbook and schema kiwi_context returns, then kiwi_lint after a write.
