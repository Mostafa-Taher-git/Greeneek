# Documentation quality

## Summary

This page is the canonical quality reference for Greeneek documentation. It defines five reviewable outcomes — brief, intuitive, friendly, accurate, and agent-readable — by document job. Standing orders in [AGENTS.md](AGENTS.md) link here instead of restating these criteria.

## Table of Contents

- [Five definitions](#five-definitions)
- [Criteria by document job](#criteria-by-document-job)
- [Generated-reference entry and detail layers](#generated-reference-entry-and-detail-layers)

## Five definitions

- **Brief** means the common path contains only the facts needed for its outcome. Exhaustive contracts remain available through a direct link or generated detail; brevity never deletes required behavior, failures, ownership, or limitations.
- **Intuitive** means the page states the reader's starting state, introduces prerequisites before dependent concepts, offers one obvious next action, and uses the product or domain terms a reader will search for.
- **Friendly** means a reader can recognize success, understand material risk before acting, recover from the likely failure, and reach the next relevant depth without first learning unrelated architecture.
- **Accurate** means every durable claim has one owner and a verification path appropriate to its risk. Generated facts derive from source; hand-written workflow values link to or consume their owner instead of copying enums and paths.
- **Agent-readable** means headings, anchors, terminology, ownership, and current-versus-proposed status are explicit enough to retrieve the needed section without loading an entire corpus or reconstructing review history.

## Criteria by document job

| Job | Primary outcome | Required entry information | Verification |
|---|---|---|---|
| Product quick start | Complete one representative task | Prerequisites, one launch path, first success, safety boundary, next step | Built or packaged smoke for the documented path plus link and site checks |
| User task guide | Complete or recover one user task | Starting UI or API state, ordered actions, observable result, likely failure and recovery | Behavior test, screenshot review when visual state matters, or a named manual owner |
| Contributor tutorial | Reach a checked development state | Supported runtime, setup commands, expected result, narrow follow-up commands | Clean-checkout command smoke on a supported environment |
| Architecture overview | Reconstruct the system from one page | Product composition, owners, dependency direction, extension points, links to detail | Source-backed package or graph checks plus focused human review |
| Package or subsystem reference | Look up one contract without reading implementation | Scope, owned types or behavior, failures, lifecycle, limitations, related owners | Existing JSDoc, type-equivalence, generated-region, README, and link checks |
| Generated reference | Locate one exact item and trust its completeness | Scope, generation owner, grouping and index, stable anchors, related conceptual guide | Deterministic `--check`, completeness fixture, site build, and retrieval-size report |
| Agent instruction or skill | Apply one workflow without stale copied values | Scope, authority links, required decisions, exact commands only when owned here | Metadata and link checks and focused tests for copied machine values |
| Proposed or implemented Agent Note | Understand a decision, trade-off, and state | Problem, proposal or decision, alternatives, acceptance or consequences | Existing lifecycle, format, pairing, and supersession checks; review owns semantic currency |

## Generated-reference entry and detail layers

Every generated reference exposes a compact entry layer before exhaustive output: scope, intended lookup, grouping or index, direct links to conceptual guidance, and the generator and check commands. Generators report page words, entry count, heading count, and largest section. A page crosses a review threshold when one lookup requires scanning unrelated groups or when one page dominates agent context; the owner then splits it by a stable domain already present in source metadata rather than by an arbitrary word slice. Moved routes keep aliases.

The `config-catalog` and `core` subsystem page demonstrate this entry layer. Their generators emit the entry layer deterministically so the exhaustive detail remains freshness-gated while the lookup path stays compact.
