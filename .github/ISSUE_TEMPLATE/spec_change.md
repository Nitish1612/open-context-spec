---
name: Specification change proposal
about: Propose a new field, type, vocabulary value, or changed semantics in the OCS spec
title: "[spec] "
labels: specification
assignees: ""
---

<!--
This template is for changes to specification/, schemas/v1/*.schema.json,
or the JSON-LD context — i.e. changes to the spec itself, not to the SDK.
SDK-only changes (bug fixes, new adapter, CLI flag) should use the
"Feature request" or "Bug report" template instead.

Fill in every section below. A proposal missing sections (especially
compatibility/security impact) will get sent back for more detail before
review starts — that's not a rejection, just sequencing.
-->

## Problem statement

<!--
What can't be represented, or what's ambiguous/wrong today? Describe the
gap in terms of what a real context document or provider adapter needs to
do, not just "add field X".
-->

## Proposed vocabulary/schema change

<!--
The specific field/type/vocabulary value/semantic change, precise enough
to turn into a schema diff (schemas/v1/*.schema.json) and, if it's a
TypeScript-surface change, a packages/core/src/types.ts diff.
-->

## Use cases

<!-- Concrete scenarios this unblocks or fixes. Link an example context
document under examples/ if you can, even a rough one. -->

## Alternatives considered

<!--
Other ways to solve the same problem (a different field shape, an
extension namespace instead of a core field, doing nothing) and why this
proposal is better.
-->

## Compatibility impact

<!--
Classify this change (see CONTRIBUTING.md's "Classifying a specification
change" section for definitions):

- [ ] Editorial (spec prose clarification, no schema/behavior change)
- [ ] Backward-compatible (new optional field/value, existing documents
      remain valid and mean the same thing)
- [ ] Breaking (changes what an existing document validates as or means)
- [ ] Security-sensitive (touches trust/provenance/sensitivity/precedence
      semantics)
- [ ] Experimental extension (namespaced extension, not a core field)

If breaking: what existing valid documents would stop validating or
change meaning?
-->

## Security/privacy impact

<!--
Does this touch trust levels, provenance, instruction-following
precedence, or sensitivity/redaction semantics (see
specification/v1/security.md, specification/v1/provenance.md)? Could it
let untrusted content gain instruction-following weight it shouldn't
have, or leak data that should be redacted? "None" is a fine answer if
you've actually checked.
-->

## Provider-adapter impact

<!--
Does packages/adapters/ need to change for any target (OpenAI, Anthropic,
Gemini, generic, markdown, MCP)? Would the new field be silently dropped
by an adapter that doesn't know about it (check the information-loss
table in specification/v1/interoperability.md), and if so, is that
acceptable or does the adapter need updating in the same change?
-->

## Migration path

<!--
For breaking changes: how do documents/consumers written against the
current version adapt? Is there a transition period, a compatibility
shim, or a hard cutover at the next major/minor version? For
backward-compatible changes, say "none needed" explicitly.
-->

## Test/conformance impact

<!--
What new positive/negative fixtures does this need under tests/fixtures/?
Does any existing fixture's expected result change? Conformance and
interoperability tests must still pass (or be deliberately, visibly
updated) after this change.
-->

## Proposed community review period

<!--
Suggest how long this should stay open for comment before a maintainer
decides (e.g. "1 week" for an editorial change, "2-4 weeks" for a
breaking or security-sensitive change to core semantics). Longer for
higher-impact changes.
-->

## Draft ADR

<!--
Significant spec changes (anything not purely Editorial) need an ADR
under specification/decisions/ before merging — see CONTRIBUTING.md.
Sketch one here if you can: Status, Context, Decision, Consequences,
Alternatives considered.
-->
