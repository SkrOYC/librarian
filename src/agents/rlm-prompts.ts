/**
 * RLM System Prompts
 *
 * Prompts following the "Recursive Language Models" paper (arXiv:2512.24601v2).
 */

import { RlmMetadata } from "./rlm-engine.js";

/**
 * System prompt for the Librarian Agent
 */
export function createRlmSystemPrompt(
  contextBlock: string,
  repoOutline?: string
): string {
  const repoStructureSection = repoOutline
    ? `## Repository Structure (depth 2)\n\n${repoOutline}\n\n`
    : '';

  return `You explore a codebase by writing JavaScript code.

## TASK
Write ONE script that:
1. Greps for relevant files
2. Takes exactly 3-5 file paths from grep results
3. Uses Promise.all to view AND analyze files IN PARALLEL
4. Returns JSON array with {file, analysis} for each file
5. STOPS after processing those files - no more calls

## SCRIPT STRUCTURE (copy this exactly):

const grepResults = JSON.parse(await repo.grep({query: "SEARCH_TERM"}));
const files = grepResults.results.map(r => r.path).slice(0, 5);

// Read all files in PARALLEL
const contents = await Promise.all(files.map(f => repo.view({filePath: f})));

// Analyze all files in PARALLEL using Promise.all
const analyses = await Promise.all(
  files.map((filePath, i) => llm_query("ANALYZE_THIS", contents[i]))
);

// Combine results
const results = files.map((filePath, i) => ({file: filePath, analysis: analyses[i]}));
return JSON.stringify(results);

## RULES
- Use exactly 5 files: .slice(0, 5)
- Use Promise.all for PARALLEL execution - much faster!
- After Promise.all: return immediately - DON'T make more calls
- Never split into multiple calls - this is your ONLY call

## TOOLS
- repo.grep({query: "x"}) -> JSON string
- repo.view({filePath: "x"}) -> string  
- llm_query("instruction", data) -> calls LLM
- Promise.all(arr.map(x => fn(x))) -> runs in parallel

${contextBlock}

${repoStructureSection}Answer the user's question based on your analysis.`;
}

/**
 * Format metadata for the LLM prompt
 */
export function formatMetadataForPrompt(metadata: RlmMetadata): string {
  const parts: string[] = [];
  parts.push(`Iteration: ${metadata.iteration}`);
  parts.push(`Output: ${metadata.stdoutPreview || "(none)"}`);
  if (metadata.bufferKeys.length > 0) {
    parts.push(`Buffers: ${metadata.bufferKeys.join(", ")}`);
  }
  if (metadata.errorFeedback) {
    parts.push(`Error: ${metadata.errorFeedback}`);
  }
  return parts.join("\n");
}

/**
 * System prompt for sub-LLM calls (used by llm_query)
 */
export const SUB_AGENT_SYSTEM_PROMPT = `You are a stateless Functional Analyzer.
1. Input: You will receive a code snippet and a specific instruction.
2. Constraint: You have NO access to tools. Answer based ONLY on the provided text.
3. Output: Be extremely concise. No conversational filler.`;
