# RLM Alignment Mapping

This document maps [RLM_ALIGNMENT.md](/home/oscar/GitHub/librarian/docs/RLM_ALIGNMENT.md) to the constitutional artifacts in `docs/`.

## Summary

The alignment feedback mostly changes the **Architecture** and **Tech Spec** layers. The **PRD** only needed limited product-level reinforcement around recursive research correctness, metadata-first exploration, stable symbolic repository access, and environment-owned completion semantics.

The constitutional source of truth remains the progression:

1. [PRD.md](/home/oscar/GitHub/librarian/docs/PRD.md)
2. [Architecture.md](/home/oscar/GitHub/librarian/docs/Architecture.md)
3. [TechSpec.md](/home/oscar/GitHub/librarian/docs/TechSpec.md)

[RLM_ALIGNMENT.md](/home/oscar/GitHub/librarian/docs/RLM_ALIGNMENT.md) is now a supporting analysis note in `docs/`, not a separate top-level dependency.

## Mapping

### A. Split root-model and sub-model prompts completely

- **PRD:** no stack-level change required.
- **Architecture:** non-CLI recursive exploration is now modeled as a direct root recursive controller with separate child recursive analysis semantics.
- **TechSpec:** adds `ADR-006`, a dedicated root-model query factory, a dedicated sub-model query factory, and an implementation rule that the root prompt must never be reused for `llm_query()` or child runs.

### B. Replace fake REPL persistence with real REPL persistence

- **PRD:** adds a P1 expectation that recursive research modes preserve intermediate working state across steps and produce final responses from active session state.
- **Architecture:** renames the pattern to include a persistent REPL runtime, adds a Persistent Runtime Context, and updates the single-tech and group explore flows to use a long-lived REPL.
- **TechSpec:** updates `ADR-004`, introduces `persistent-worker-session.ts` in the target structure, and adds a coding standard that preserving only exported buffers is insufficient.

### C. Redefine `sub_rlm()` around prompt/context, not script eval

- **PRD:** no direct product-surface change beyond recursive correctness.
- **Architecture:** adds a Recursive Analysis Context and states that child recursion must create child recursive runs over transformed prompt/context pairs.
- **TechSpec:** requires `sub_rlm({ prompt, context, rootHint? })` semantics and forbids raw script eval as the primary recursive contract.

### D. Treat the repository as the environment, not as a prebuilt mega-string

- **PRD:** adds a P1 expectation that non-CLI recursive research modes inspect repository metadata first and materialize only relevant repository slices during exploration.
- **Architecture:** adds a root control mechanism based on metadata rather than a prebuilt repository digest.
- **TechSpec:** requires metadata-only root prompts and a symbolic repository environment contract.

### E. Make the root prompt truthful

- **PRD:** adds a non-functional correctness constraint around truthful runtime behavior.
- **Architecture:** adds a Truthful-runtime risk and makes the execution flow explicit enough to anchor a truthful prompt contract.
- **TechSpec:** requires separate root/sub prompts and states exactly what the root prompt may and may not receive.

### F. Choose one repo API contract and keep it stable

- **PRD:** adds a P1 expectation that repository-access and environment contracts remain stable enough for symbolic recursive manipulation.
- **Architecture:** adds an Environment contract mechanism.
- **TechSpec:** adds `ADR-007`, mandates structured `repo.*` returns, and restricts human-friendly summaries to separate helper methods.

### G. Add a root environment metadata channel

- **PRD:** no direct product-surface change required.
- **Architecture:** adds metadata-driven orchestration and recursive execution accounting in observability.
- **TechSpec:** adds `environment-metadata.ts`, execution-stat entities `RLM_RUN` and `RLM_SUBCALL`, and mandatory RLM log fields.

### H. Separate environment errors from task output

- **PRD:** no direct product-surface change required.
- **Architecture:** adds Typed environment failures under failure handling.
- **TechSpec:** mandates typed environment failures instead of opaque success-shaped strings.

### I. Remove LangChain from the non-CLI product runtime

- **PRD:** no direct product-surface change required.
- **Architecture:** explore flows now route non-CLI execution through the Direct RLM Orchestrator.
- **TechSpec:** rewrites `ADR-003` so API-backed providers use the direct internal RLM path backed by AI SDK adapters and adds an implementation rule that non-CLI `explore` must call `RlmOrchestrator.run(query)` directly without a framework-owned agent loop.

### J. Add proper child-run accounting

- **PRD:** no direct feature change beyond observability/correctness.
- **Architecture:** observability now includes root iterations, child-run count, provider calls, repo calls, prompt size, output size, and total duration.
- **TechSpec:** adds `RLM_RUN` and `RLM_SUBCALL` to the physical model and mandates the corresponding structured log fields.

## Net Effect On Constitutional Docs

- [PRD.md](/home/oscar/GitHub/librarian/docs/PRD.md): strengthened product expectations for recursive correctness and metadata-first exploration.
- [Architecture.md](/home/oscar/GitHub/librarian/docs/Architecture.md): materially updated to represent strict RLM semantics instead of a generic isolated worker loop.
- [TechSpec.md](/home/oscar/GitHub/librarian/docs/TechSpec.md): materially updated with concrete RLM-runtime contracts, persistence requirements, structured repository contracts, and run accounting.
