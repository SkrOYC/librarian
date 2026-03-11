# RLM Alignment Plan For `explore`

Status note, March 11, 2026: Phase 1 of this plan has been implemented. This
document is retained as a historical gap-analysis note for the pre-rewrite
runtime. For the current runtime contract, use
[Tasks.md](/home/oscar/GitHub/librarian/docs/Tasks.md),
[Architecture.md](/home/oscar/GitHub/librarian/docs/Architecture.md), and
[TechSpec.md](/home/oscar/GitHub/librarian/docs/TechSpec.md) as the source of
truth.

This document describes the changes needed for Librarian to behave like a
Recursive Language Model (RLM) for `explore` queries, following the intended
semantics from the paper "Recursive Language Models" (arXiv:2512.24601v2).

The focus is the non-CLI provider path:

- `openai`
- `anthropic`
- `google`
- `openai-compatible`
- `anthropic-compatible`

The CLI providers already have their own execution model and should remain
separate.

## Goal

For `librarian explore`, the runtime should behave like an RLM in the strict
sense:

1. The user query and repository context live in the external environment, not
   in the root model context window.
2. The root model operates over metadata about the environment and writes code
   into a persistent REPL.
3. Code in that REPL can invoke recursive sub-RLM calls over transformed slices
   of the external context.
4. Intermediate results live symbolically in environment state, not only inside
   model text history.
5. The final answer is produced by the environment state, not by fallback
   prompt stuffing after the loop collapses.

## Historical Baseline

The current implementation is a useful scaffold, but it is not yet an RLM.

Relevant files:

- `src/agents/react-agent.ts`
- `src/agents/rlm-orchestrator.ts`
- `src/agents/rlm-sandbox.ts`
- `src/agents/rlm-worker-sandbox.ts`
- `src/agents/rlm-prompts.ts`
- `src/agents/rlm-tool.ts`

What it already gets right:

- There is an explicit iterative orchestration loop in `RlmOrchestrator`.
- There is a sandboxed execution environment.
- The execution environment exposes a `repo` API and an `llm_query` bridge.
- There is an attempt to keep prompt history metadata-sized.
- There is an attempt to support recursive execution through `sub_rlm()`.

What it currently gets wrong:

- The root prompt is reused for sub-model calls.
- The "persistent REPL" is not actually persistent across iterations.
- `sub_rlm()` executes code in a fresh worker instead of launching a new RLM
  loop over a new prompt/context.
- The `context` variable is only a shallow preloaded repo snapshot, not the full
  external object the paper relies on.
- The repo API contract is inconsistent: some methods return formatted text,
  while docs and tests still assume JSON.
- Max-iteration fallback currently reverts to summarization from recent stdout,
  which is closer to a compaction heuristic than to the paper's model.

## Non-Negotiable RLM Properties

If the goal is to be "RLM-like" rather than merely "agentic", these properties
must hold.

### 1. Externalized prompt/context

The repository and query context must exist in the environment as structured
state. The root model should not be given the full repository snapshot in its
text prompt.

For Librarian, that means:

- The environment should expose repository access through functions and symbolic
  handles.
- The root model prompt should contain metadata only:
  - working directory
  - repo outline
  - counts and sizes
  - available environment functions
  - summaries of current buffers
  - summaries of previous stdout

### 2. Persistent REPL state

The REPL must persist across root iterations.

That state must include:

- variables created by executed code
- derived arrays and maps
- helper functions defined by the model
- symbolic handles to selected files or chunks
- logs and final answer bindings

Persisting only `buffers` is not enough. If each iteration starts a fresh worker
process and merely reloads a serializable object, the system is not a true
persistent REPL.

### 3. Symbolic recursion

`sub_rlm()` must mean:

- create a new recursive language model call
- over a new prompt or transformed context
- with its own environment and history
- then return the resulting value back to the parent environment

It must not mean:

- evaluate arbitrary JavaScript in another worker

The recursive unit is a new RLM run, not just a nested code execution.

### 4. Environment-owned completion

The final answer should be read from environment state via `FINAL()` or
`FINAL_VAR()`.

The system should not rely on a fallback like:

- "the model forgot to call FINAL(), so ask the model to summarize stdout"

That fallback can exist as a guardrail, but it should be clearly treated as an
error recovery path, not as normal completion behavior.

## Precise Changes Needed

## A. Split Root-Model And Sub-Model Prompts Completely

Current issue:

- `createLlmQuery()` accepts `systemPrompt`.
- The orchestrator passes the root RLM prompt into that shared query function.
- As a result, `llm_query()` calls receive the root recursive-control prompt.

That is incorrect.

Required change:

- Introduce two separate model call factories:
  - `createRootModelQuery()`
  - `createSubModelQuery()`
- The root model query should use the full RLM controller prompt.
- The sub model query should always use a stateless analyzer prompt.

Recommended interface:

```ts
interface RootModelQuery {
  (history: string): Promise<string>;
}

interface SubModelQuery {
  (instruction: string, data: string): Promise<string>;
}
```

Recommended implementation:

- `RlmOrchestrator` should own the root model caller.
- `BunWorkerSandbox` should receive only the sub-model caller.
- `sub_rlm()` should recursively construct another orchestrator, not another raw
  worker eval.

## B. Replace Fake REPL Persistence With Real REPL Persistence

Current issue:

- `RlmOrchestrator` caches a `BunWorkerSandbox`, but `BunWorkerSandbox.execute()`
  creates a new worker per execution.
- This preserves only exported buffer state.

Required change:

- Introduce a dedicated persistent worker session for the root environment.
- The worker should stay alive across all root iterations.
- Each iteration should send only the next code block for execution.

Recommended shape:

```ts
interface PersistentWorkerSession {
  execute(code: string): Promise<WorkerExecutionResult>;
  getMetadata(): Promise<EnvironmentMetadata>;
  terminate(): void;
}
```

The worker should maintain:

- `context`
- `buffers`
- helper functions
- ordinary local bindings stored on `globalThis` or in a persistent environment
  object
- final answer state

If keeping a worker alive becomes too fragile, a fallback is acceptable:

- maintain a single persistent VM realm
- serialize only when forced

But the first choice should be a genuinely persistent execution environment.

## C. Redefine `sub_rlm()` Around Prompt/Context, Not Script Eval

Current issue:

- `sub_rlm(scriptCode)` sends JavaScript to a fresh worker.
- That is recursive execution, but not recursive language modeling.

Required change:

- Redefine `sub_rlm()` to accept a recursive task description plus data.

Recommended API:

```ts
type SubRlmInput = {
  prompt: string;
  context?: string | string[] | Record<string, unknown>;
  rootHint?: string;
};

async function sub_rlm(input: SubRlmInput): Promise<string>;
```

Behavior:

1. Create a fresh child RLM environment.
2. Install the provided context as that child's `context`.
3. Run a full recursive orchestration loop.
4. Return the child's final answer string.

Optional convenience overload:

```ts
await sub_rlm({
  prompt: "Summarize the auth behavior in these files",
  context: selectedFiles.join("\n\n=== FILE ===\n\n"),
});
```

Do not expose raw code execution as the primary recursion interface.

If you want nested code execution too, expose it separately:

- `sub_repl(scriptCode)`

But do not confuse it with `sub_rlm()`.

## D. Treat The Repository As The Environment, Not As A Prebuilt Mega-String

Current issue:

- `loadRepoContentForRlm()` creates a handcrafted context string containing a
  shallow listing, README, `package.json`, and one entry file.
- The prompt then tells the root model that `context` is the important global
  object.

That is not aligned with the paper. The paper's key move is that the prompt
itself becomes an environment object the model can examine symbolically.

Required change:

- Stop treating `context` as a small preloaded repo digest.
- Make the repository environment first-class.

Recommended design:

- `context` is a lightweight environment object, not a raw string:

```ts
type RepoContext = {
  repoRoot: string;
  fileCount: number;
  topLevelEntries: string[];
  outline: string;
};
```

- Add environment functions for symbolic access:
  - `repo.list(...)`
  - `repo.view(...)`
  - `repo.find(...)`
  - `repo.grep(...)`
  - `repo.readMany(paths)`
  - `repo.readChunk(path, startLine, endLine)`
  - `repo.concat(paths)`

Then the root model can:

- inspect metadata first
- decide which file subsets matter
- materialize only relevant slices into variables
- pass those slices into `llm_query()` or `sub_rlm()`

This is much closer to the paper's environment-centric design.

## E. Make The Root Prompt Truthful

Current issue:

- The prompt in `rlm-prompts.ts` claims properties the runtime does not actually
  satisfy.
- Several examples omit `await` even though the same prompt later says `await`
  is mandatory.

Required change:

- Rewrite the root prompt so it exactly matches runtime behavior.

It should state:

- what `context` actually is
- what `repo.*` returns
- what `sub_rlm()` actually accepts
- whether locals persist across iterations
- how large `llm_query()` payloads may safely be

It should not state:

- that the context is already chunked if it is not
- that the REPL is persistent if only buffers persist
- that `sub_rlm()` is recursive LM processing if it actually evals code

Prompt reliability matters because the root model is effectively programming
against your runtime contract.

## F. Choose One Repo API Contract And Keep It Stable

Current issue:

- `repo.list`, `repo.view`, and `repo.grep` return human-formatted text.
- `repo.find` still returns raw tool JSON.
- The tool description still says "All repo.* methods return JSON strings."

Required change:

Pick one of these two models:

### Option 1: Structured contract

All `repo.*` methods return JSON strings or typed objects.

Pros:

- reliable for model-written code
- easy to test
- easy to evolve

Cons:

- slightly more verbose in scripts

### Option 2: Human text contract

All `repo.*` methods return plain text optimized for model reading.

Pros:

- easier for direct semantic use

Cons:

- less stable
- harder to parse
- weakens programmatic manipulation

Recommendation:

- Use structured return values in the sandbox runtime.
- If you want ergonomic summaries, add separate helpers:
  - `repo.listText(...)`
  - `repo.grepText(...)`

For a real RLM, the environment should favor symbolic/programmatic access over
prettified text output.

## G. Add A Root Environment Metadata Channel

Current issue:

- The metadata history contains stdout preview, buffer names, and errors.
- It does not expose enough structured information about the environment state.

Required change:

- Add a compact environment metadata summary after every execution.

Suggested metadata:

```ts
type EnvironmentMetadata = {
  iteration: number;
  stdoutPreview: string;
  stdoutLength: number;
  finalSet: boolean;
  vars: Array<{
    name: string;
    kind: "string" | "number" | "array" | "object" | "function" | "unknown";
    size: number;
    preview: string;
  }>;
  repoSelections: Array<{
    name: string;
    source: string;
    size: number;
  }>;
  error?: string;
};
```

This is the information the root model should see, not raw context replay.

## H. Separate Environment Errors From Task Output

Current issue:

- some repo errors are converted into ordinary strings
- the orchestrator then treats them as ordinary content

Required change:

- Normalize environment calls to a typed result:

```ts
type ToolResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };
```

- Inside the sandbox, convert failures into thrown errors or structured error
  values.
- In root metadata, surface those errors explicitly.

This avoids accidentally feeding opaque error strings back into the task logic as
though they were valid data.

## I. Remove LangChain From The Non-CLI Product Runtime

Current issue:

- The codebase still carries both:
  - a LangChain tool-driven `research_repository` path
  - a direct orchestrator path

For strict RLM behavior, this is unnecessary indirection.

Required change:

- Make `explore` for non-CLI providers call the orchestrator directly.
- Replace LangChain and direct provider branching with a dedicated AI SDK-backed
  model adapter layer under Librarian-owned root/sub query contracts.
- Delete `research_repository` and other LangChain-specific runtime paths once
  migration lands.

Recommended final routing:

- CLI providers:
  - current CLI path
- API providers:
  - direct `RlmOrchestrator.run(query)`

This will reduce prompt confusion, eliminate the half-migrated tool-agent
model, and make the provider abstraction lighter without surrendering control of
the recursive loop.

## J. Add Proper Child-Run Accounting

The paper treats recursion as part of the inference process. Librarian should
track it explicitly.

Add:

- root iteration count
- sub-RLM call count
- per-subcall prompt size
- per-subcall output size
- total provider calls
- total tool calls
- total runtime

Recommended shape:

```ts
type RlmRunStats = {
  rootIterations: number;
  subRlmCalls: number;
  subModelCalls: number;
  repoCalls: number;
  totalInputChars: number;
  totalOutputChars: number;
  durationMs: number;
};
```

This is important for both correctness and cost control.

## Recommended Execution Model For `explore`

For a non-CLI provider, the runtime should follow this flow:

1. Build lightweight repo metadata.
2. Initialize a persistent root REPL session.
3. Install:
   - `context`
   - `repo`
   - `llm_query`
   - `sub_rlm`
   - `FINAL`
   - `FINAL_VAR`
4. Initialize root history with metadata only.
5. Loop:
   - ask root model for code
   - execute code in persistent REPL
   - collect environment metadata
   - append metadata summary to root history
   - stop when `FINAL` or `FINAL_VAR` is set
6. Return the final answer and execution stats.

This is the architecture that is closest to the paper.

## Concrete Refactor Order

Implement in this order.

### Phase 1: Correctness and contract repair

- split root and sub-model query paths
- unify repo API contract
- update prompt to match runtime
- update tests to the chosen contract

This phase should happen first because the current contract drift already causes
test failures and unpredictable behavior.

### Phase 2: True persistent REPL

- replace per-execution worker creation with a persistent root worker session
- preserve locals and helper functions across iterations
- expose environment metadata from the worker

This is the minimum step needed to honestly call the runtime a REPL.

### Phase 3: Real recursive sub-RLM

- replace `sub_rlm(scriptCode)` with `sub_rlm({ prompt, context })`
- implement child orchestrator runs
- return child final answers to the parent REPL

This is the step that converts the scaffold from "code execution plus helper
LLM" into something that more closely matches the paper.

### Phase 4: Better environment abstractions

- make repo access more symbolic
- add bulk read helpers
- add chunk helpers for large files
- add structured selection handles instead of raw concatenated strings

This will make the runtime much more effective on large repositories.

## Suggested Interface Changes

These are the API changes I would make.

### `createRootModelQuery`

```ts
export function createRootModelQuery(config: RootModelConfig): RootModelQuery;
```

### `createSubModelQuery`

```ts
export function createSubModelQuery(config: SubModelConfig): SubModelQuery;
```

### `PersistentWorkerSession`

```ts
export class PersistentWorkerSession {
  async execute(code: string): Promise<WorkerExecutionResult>;
  async getMetadata(): Promise<EnvironmentMetadata>;
  terminate(): void;
}
```

### `sub_rlm`

```ts
type SubRlmInput = {
  prompt: string;
  context?: string | Record<string, unknown>;
};
```

### `repo` helpers

```ts
repo.readMany(paths: string[]): Promise<Record<string, string>>;
repo.readChunk(path: string, startLine: number, endLine: number): Promise<string>;
repo.concat(paths: string[]): Promise<string>;
```

## Testing Changes Needed

The tests should stop checking only "does something run" and start checking RLM
semantics.

Add tests for:

- root and sub prompts are different
- root model never receives the full repo snapshot
- sub-model calls never receive the root controller prompt
- locals persist across root iterations
- `sub_rlm()` launches a child recursive run rather than direct script eval
- `FINAL_VAR()` returns environment state from the active REPL
- repo contract is stable and documented

## Practical Definition Of Done

Librarian can be considered RLM-aligned for `explore` when all of the following
are true:

- non-CLI providers use a direct recursive orchestrator path
- the root model sees metadata, not the full repo body
- executed code runs in a genuinely persistent REPL
- `sub_rlm()` launches a child recursive run over transformed context
- final answers come from environment state via `FINAL()` or `FINAL_VAR()`
- repo access is symbolic and contract-stable
- fallback summarization is rare and treated as a runtime failure mode, not a
  normal completion path

## Bottom Line

The project is close in spirit but not yet in semantics.

Right now the RLM path is best described as:

- a model-controlled sandbox
- with helper LLM calls
- and iterative metadata feedback

To make it behave like an RLM for `explore`, the most important changes are:

1. separate root and sub-model prompts
2. make the REPL truly persistent
3. redefine `sub_rlm()` as child recursive orchestration
4. make the repository environment first-class instead of reducing it to a small
   preload string

If those four changes are made, the rest becomes incremental refinement rather
than conceptual repair.
