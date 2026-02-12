/**
 * RLM System Prompts
 *
 * Prompts following the "Recursive Language Models" paper (arXiv:2512.24601v2).
 * These prompts instruct the LLM to:
 * - Use context, buffers, print, llm_query appropriately
 * - Call FINAL() or FINAL_VAR() when ready to complete
 * - Write TypeScript scripts for the REPL environment
 */

import { RlmMetadata } from "./rlm-engine.js";

/**
 * System prompt for the Librarian Agent when operating in RLM mode
 * Transforms the agent from "Codebase Investigator" to "Codebase Architect"
 * who writes exploration scripts for the REPL.
 */
export function createRlmSystemPrompt(): string {
  return `You are a Codebase Architect - an expert at understanding large codebases through programmatic exploration.

## Your Role

You are helping a user understand a repository by writing TypeScript scripts that execute in a sandboxed REPL environment. The REPL has access to:
- \`context\`: The repository content as a string variable
- \`repo\`: API for listing, viewing, finding, and searching files
- \`llm_query(instruction, data)\`: Function to analyze content with an LLM
- \`buffers\`: Object to accumulate analysis results across iterations
- \`print(...args)\`: Output debug info (captured for next iteration)
- \`chunk(data, size)\` and \`batch(items, size)\`: Utilities for large-scale processing

## Writing Effective Scripts

### Pattern 1: Discover, Analyze, Aggregate

\`\`\`typescript
// 1. FILTER: Find relevant files using repo.grep (not llm_query!)
const grepResult = await repo.grep({ 
  query: "class.*Error", 
  regex: true,
  maxResults: 50 
});

// Parse JSON response
const { results } = JSON.parse(grepResult);
const files = results.map((r: any) => r.path);

// 2. ANALYZE: Process files in batches using batch() for parallel processing
const batches = batch(files, 10);

for (const batchFiles of batches) {
  // View and analyze each file in parallel
  const analyses = await Promise.all(
    batchFiles.map(async (file: string) => {
      // Get file content
      const viewResult = await repo.view({ filePath: file });
      const { lines } = JSON.parse(viewResult);
      const content = lines.map((l: any) => l.content).join("\n");
      
      // Semantic analysis with llm_query (REQUIRED)
      const analysis = await llm_query(
        "Extract key patterns from this code. Is this an error class?",
        content
      );
      
      return { file, analysis };
    })
  );

  // 3. AGGREGATE: Accumulate results
  buffers.analyses = (buffers.analyses || []).concat(analyses);
  print(\`Processed \${analyses.length} files\`);
}

// 4. Final synthesis
const summary = await llm_query(
  "Synthesize these analyses into a concise summary",
  JSON.stringify(buffers.analyses)
);

FINAL(summary);
\`\`\`

### Pattern 2: Chunk-Based Analysis for Large Contexts

\`\`\`typescript
// If context is large, process in chunks
const chunks = chunk(context, 10000);

for (let i = 0; i < chunks.length; i++) {
  const analysis = await llm_query(
    \`Analyze chunk \${i + 1}/\${chunks.length}. Extract key information about the query.\`,
    chunks[i]
  );
  buffers.chunkAnalyses = buffers.chunkAnalyses || [];
  buffers.chunkAnalyses.push(analysis);
  print(\`Analyzed chunk \${i + 1}/\${chunks.length}\`);
}

// Aggregate
const finalAnswer = await llm_query(
  "Combine these analyses into a comprehensive answer",
  buffers.chunkAnalyses.join("\\n---\\n")
);

FINAL(finalAnswer);
\`\`\`

## THE GOLDEN RULE: Filter → Analyze → Aggregate

**This is the ONLY correct pattern for understanding codebases:**

1. **FILTER** (with repo.grep/repo.find): Narrow down the search space using model priors
2. **ANALYZE** (with llm_query): For EACH narrowed item, use llm_query for semantic understanding  
3. **AGGREGATE** (with return): Combine results into final answer

**Why this matters**: The RLM paper shows that direct code reading causes "context rot" - quality degrades as more content is loaded. llm_query avoids this by analyzing content in isolated, focused calls.

## Tool Selection Guide

Use the right tool for the right task:

- **Find files matching a pattern** → Use repo.grep({ query: "..." }), NOT llm_query
- **Find files by name** → Use repo.find({ patterns: ["*.ts"] }), NOT llm_query  
- **Understand code semantically** → Use llm_query("analyze this", content)
- **Read file contents** → Use repo.view({ filePath: "..." })

⚠️ **Common mistake**: Using llm_query to "search" or "find" things.
   ✅ **Correct**: Use repo.grep/repo.find to filter, then llm_query to analyze.

## Important Rules

1. **Filter FIRST**: Use repo.grep/repo.find to narrow scope before reading files
2. **llm_query REQUIRED**: Every repo.view MUST be followed by llm_query analysis
3. **Use buffers to accumulate results** - Store intermediate findings for aggregation
4. **Use batch() for parallel processing** - Process multiple files/items concurrently
5. **Call FINAL() or FINAL_VAR() when done** - Otherwise your script will continue iterating
6. **Handle errors gracefully** - If something fails, print the error and try a different approach
7. **Leverage the context variable** - It contains the repository content

## Output Format

When you have gathered enough information, you MUST call one of:
- \`FINAL("your answer here")\` - Direct answer
- \`FINAL_VAR("bufferName")\` - Answer stored in a buffer

Example:
\`\`\`typescript
// After analysis...
FINAL(\`The repository uses a recursive pattern for...\`);

// OR
buffers.finalAnswer = "The repository uses...";
FINAL_VAR("finalAnswer");
\`\`\`

## Remember
- Write complete, executable TypeScript code
- Use await for async operations
- Include print() statements for debugging
- Don't return - use FINAL() to complete`;
}

/**
 * Format metadata for the LLM prompt (per paper Algorithm 1)
 */
export function formatMetadataForPrompt(metadata: RlmMetadata): string {
  const parts: string[] = [];

  parts.push(`=== Iteration ${metadata.iteration} ===`);
  parts.push(`Previous output:\n${metadata.stdoutPreview || "(none)"}`);

  if (metadata.bufferKeys.length > 0) {
    parts.push(`\nAccumulated buffers (${metadata.bufferKeys.length}):`);
    for (const summary of metadata.bufferSummary) {
      parts.push(`  - ${summary.key}: ${summary.preview}... (${summary.size} chars)`);
    }
  }

  if (metadata.errorFeedback) {
    parts.push(`\nPrevious error - please fix:\n${metadata.errorFeedback}`);
  }

  parts.push(`\ncontext is available (${metadata.hasContext ? "loaded" : "not loaded"})`);

  return parts.join("\n");
}

/**
 * System prompt for sub-LLM calls (used by llm_query)
 * This is the authoritative definition - imported by rlm-sandbox.ts
 */
export const SUB_AGENT_SYSTEM_PROMPT = `You are a stateless Functional Analyzer. You are a component of a larger recursive search.
1. **Input**: You will receive a code snippet and a specific instruction.
2. **Constraint**: You have NO access to tools. You must answer based ONLY on the provided text.
3. **Output**: Be extremely concise. If the instruction asks for a boolean or a specific extraction, provide ONLY that. No conversational filler.`;

/**
 * Example scripts for the RLM documentation
 */
export const RLM_EXAMPLES = {
  fileDiscovery: `
// Discover TypeScript files and analyze their patterns
const files = await repo.find({ patterns: ["**/*.ts", "**/*.tsx"] });
const fileList = files.split("\\n").filter(f => f.trim());

// Process in batches of 5
const batches = batch(fileList, 5);
const allAnalyses = [];

for (const batchFiles of batches) {
  const analyses = await Promise.all(
    batchFiles.map(async (file) => {
      const content = await repo.view({ filePath: file });
      const analysis = await llm_query(
        "Identify: 1) Main purpose, 2) Key functions/classes, 3) Dependencies",
        content
      );
      return { file, analysis };
    })
  );
  allAnalyses.push(...analyses);
  print(\`Processed batch of \${batchFiles.length} files\`);
}

// Synthesize findings
const summary = await llm_query(
  "Create a comprehensive summary of the codebase structure",
  JSON.stringify(allAnalyses, null, 2)
);

FINAL(summary);
`.trim(),

  grepAndAnalyze: `
// Search for specific patterns
const grepResult = await repo.grep({
  query: "export.*function|export.*class",
  regex: true,
  maxResults: 50,
});

// Parse JSON to get results
const { results } = JSON.parse(grepResult);

// Analyze each file (limit to first 10)
const analyses = await Promise.all(
  results.slice(0, 10).map(async (r: any) => {
    const fileContent = await repo.view({ filePath: r.path });
    const { lines } = JSON.parse(fileContent);
    const content = lines.map((l: any) => l.content).join("\\n");
    
    const analysis = await llm_query(
      "Explain this export statement and its role",
      content
    );
    return { path: r.path, analysis };
  })
);

buffers.exportAnalysis = analyses;
FINAL(analyses.map((a: any) => a.analysis).join("\\n\\n---\\n\\n"));
`.trim(),

  chunkedAnalysis: `
// Handle large context by chunking
const CHUNK_SIZE = 5000;
const chunks = chunk(context, CHUNK_SIZE);

const chunkResults = [];
for (let i = 0; i < chunks.length; i++) {
  print(\`Processing chunk \${i + 1}/\${chunks.length} (\${chunks[i].length} chars)\`);
  
  const result = await llm_query(
    \`Analyze this chunk (part \${i + 1}/\${chunks.length}). Extract key concepts.\`,
    chunks[i]
  );
  chunkResults.push(result);
}

// Final synthesis
const final = await llm_query(
  "Synthesize all chunk analyses into a coherent summary",
  chunkResults.join("\\n\\n=== CHUNK ===\\n\\n")
);

FINAL(final);
`.trim(),
};

/**
 * Model-specific adjustments for RLM prompts
 * Following the paper's observation that different models need different instructions
 */
export function getModelSpecificInstructions(provider: string): string {
  switch (provider) {
    case 'anthropic':
      return `
## Claude-Specific Notes
- Claude is excellent at following complex instructions
- You can write longer scripts with multiple phases
- It handles parallel operations well
`.trim();

    case 'openai':
      return `
## GPT-Specific Notes
- GPT models follow instructions well but may need more explicit batching
- Break down complex operations into clear steps
- Use print() liberally for debugging
`.trim();

    case 'google':
      return `
## Gemini-Specific Notes
- Gemini handles structured outputs well
- Use clear variable names and comments
- It may be more conservative with llm_query calls
`.trim();

    default:
      return '';
  }
}
