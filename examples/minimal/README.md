# Example: Minimal question answering

The smallest useful ULCS document: an objective, one `system`-authority
instruction, one trusted fact, and a single conversation turn.

Demonstrates:

- The minimum required envelope shape.
- A `Fact` with explicit `trust` marking it as safe to use as data.
- An `Instruction` with explicit `authority` and `trust.providesInstructions: true`.

Try it:

```bash
ulcs validate examples/minimal/context.json
ulcs compile examples/minimal/context.json --target markdown
```
