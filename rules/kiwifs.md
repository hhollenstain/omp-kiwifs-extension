---
description: Use the connected KiwiFS knowledge base for lookup and updates
alwaysApply: true
interruptMode: never
---

When a task depends on project knowledge, prior decisions, or something that should be remembered, use KiwiFS instead of a new notes file.

Call kiwi_context before the first read or write. Look up with kiwi_brief or kiwi_search, skim with kiwi_peek, and read a heading with kiwi_section before kiwi_read. Overwrite a page with kiwi_write only when you pass if_match from the etag you just read. Search before creating a page. Follow the playbook and schema kiwi_context returns, then kiwi_lint after a write.
