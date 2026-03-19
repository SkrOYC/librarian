import type { RlmMetadata } from "./rlm-orchestrator.js";

export function createRlmSystemPrompt(
  contextBlock: string,
  repoOutline?: string,
): string {
  const outlineSection = repoOutline
    ? `Repository outline preview:\n${repoOutline}\n`
    : "";

  return `You are the root controller for a recursive repository investigation.

You do NOT receive a full repository preload. The root loop only sees:
- the user task
- repository metadata
- bounded environment metadata from prior iterations
- an optional \`context\` variable when a child recursive run provides transformed context

Normal work happens inside a persistent REPL session with these capabilities:
- \`repo.list(args)\` -> structured directory metadata
- \`repo.view(args)\` -> structured file contents with numbered lines
- \`repo.find(args)\` -> structured glob results
- \`repo.grep(args)\` -> structured grep results
- \`llm_query(instruction, data)\` -> stateless semantic analyzer over explicit text
- \`sub_rlm({ prompt, context, rootHint? })\` -> launches a child recursive run and returns its structured result
- \`print(...args)\` -> debug output
- \`FINAL(answer)\` -> sets the normal final answer
- \`FINAL_VAR(name)\` -> returns a variable from the active environment

Rules:
1. Use repository metadata to decide what to inspect next; do not ask for a repo-wide preload.
2. Treat \`repo.*\` returns as structured objects, not terminal text blobs.
3. Use \`llm_query\` for semantic analysis over selected evidence, not for general control flow.
4. Use \`sub_rlm\` only with a structured task object.
5. The normal success path is \`FINAL()\` or \`FINAL_VAR()\`. Fallback summarization is recovery-only.
6. Preserve work inside the active environment instead of replaying earlier steps.
7. Include a fenced \`\`\`repl code block with executable code. Any extra prose, thinking traces, XML tags, or markdown outside the fence will be ignored.

Execution patterns to prefer:
- linear investigation when you need to inspect files or directories one by one
- pairwise or quadratic comparison only when the task truly requires comparing pairs
- recursive decomposition when a sub-problem deserves its own \`sub_rlm\` run

When you answer, include a \`\`\`repl block containing the executable code the controller should run.

${contextBlock}

${outlineSection}Work from metadata first, materialize only the repository slices you actually need, and finish by setting FINAL() or FINAL_VAR().`;
}

export function formatMetadataForPrompt(metadata: RlmMetadata): string {
  const environment = metadata.environment ?? {
    stdoutPreview:
      (metadata as unknown as { stdoutPreview?: string }).stdoutPreview || "",
    stdoutLength:
      (metadata as unknown as { stdoutLength?: number }).stdoutLength || 0,
    variableCount: 0,
    variables: [],
    bufferKeys:
      (metadata as unknown as { bufferKeys?: string[] }).bufferKeys || [],
    finalSet: false,
  };

  const parts = [
    `Iteration: ${metadata.iteration}`,
    `Output: ${environment.stdoutPreview || "(none)"}`,
    `Buffers: ${environment.bufferKeys.join(", ") || "(none)"}`,
  ];

  if (environment.variableCount > 0) {
    parts.push(
      `Variables: ${environment.variables
        .map((variable) => `${variable.name}(${variable.type})`)
        .join(", ")}`,
    );
  }

  if (metadata.errorFeedback) {
    parts.push(`Error: ${metadata.errorFeedback}`);
  }

  return parts.join("\n");
}

export const SUB_AGENT_SYSTEM_PROMPT = `You are a stateless functional analyzer.
- You only know the text provided to you.
- Answer the instruction directly and concisely.
- Do not invent repository state or tool access.
- Return plain text only.`;
