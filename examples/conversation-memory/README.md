# Example: Long-term conversation memory

Three `MemoryItem`s (`episodic`, `profile`, `semantic`) recalled into a
conversation, alongside the live conversation transcript. Note `memory`
items carry `importance` and `decay` for a memory system's own retention
logic — separate from the compiler's `priority`/`relevance` fields, which
control what makes it into _this_ compiled context.

Try it:

```bash
ulcs validate examples/conversation-memory/context.json
ulcs compile examples/conversation-memory/context.json --target anthropic
```
