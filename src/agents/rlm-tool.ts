/**
 * RLM Tool - The unified `research_repository` tool for LangChain agents.
 *
 * Replaces the 4 atomic tools with a single tool that accepts a TypeScript
 * exploration script. The script is executed in a sandboxed environment with
 * access to `repo` (file operations) and `llm_query` (semantic analysis).
 *
 * IMPORTANT: This tool uses DIRECT PROVIDER SDKs for llm_query()
 * to avoid callback/interceptor interference from the main agent model.
 */

import { tool } from "langchain";
import { z } from "zod";
import { logger } from "../utils/logger.js";
import {
  createLlmQuery,
  createRepoApi,
  executeRlmScript,
  type LlmConfig,
} from "./rlm-sandbox.js";

/**
 * Legacy type alias for backward compatibility
 */
export type ModelConfig = LlmConfig;

/**
 * Creates the `research_repository` LangChain tool.
 *
 * @param config - The LLM provider configuration
 * @returns A DynamicStructuredTool for research_repository
 *
 * Note: We use direct provider SDKs to ensure llm_query() operates
 * independently from the main agent's LangChain callback system.
 */
export function createResearchRepositoryTool(
  config: LlmConfig
) {
  const llmQuery = createLlmQuery(config);

  return tool(
    async ({ script }, toolConfig) => {
      const timingId = logger.timingStart("research_repository");

      const workingDir = toolConfig?.context?.workingDir;
      if (!workingDir) {
        throw new Error(
          "Context with workingDir is required for research_repository"
        );
      }

      logger.info("RLM", "research_repository called", {
        scriptLength: script.length,
        llmType: config.type,
        model: config.model,
      });

      const repo = createRepoApi(workingDir);
      const result = await executeRlmScript(script, repo, llmQuery);

      logger.timingEnd(timingId, "RLM", "research_repository completed");

      // Return final answer, stdout, or formatted result
      if (result.error) {
        return `Script execution error: ${result.error}`;
      }
      
      if (result.finalAnswer) {
        return result.finalAnswer;
      }
      
      if (result.stdout?.trim()) {
        return result.stdout;
      }
      
      const returnValue = result.buffers.__returnValue;
      if (returnValue !== undefined) {
        return typeof returnValue === 'string' ? returnValue : JSON.stringify(returnValue, null, 2);
      }
      
      return "Script completed with no output.";
    },
    {
      name: "research_repository",
      description: `Execute a complete exploration strategy as a TypeScript script against the repository.

**REQUIRED PATTERN: Filter → Analyze → Aggregate**
1. FILTER: Use repo.grep/repo.find to narrow search space first
2. ANALYZE: Use llm_query for semantic analysis of each filtered item (REQUIRED)
3. AGGREGATE: Combine results with return

The script runs in an async context and has access to two globals:

## \`repo\` — File Operations API (Use for FILTER phase)
All repo methods return JSON - use JSON.parse() to extract data!

### repo.grep({ query, regex?, maxResults?, ... })
Returns:
\`\`\`json
{
  "totalMatches": 3,
  "totalFiles": 1,
  "results": [
    { "path": "src/errors.ts", "matches": [{ "line": 12, "column": 1, "text": "class Error {" }] }
  ]
}
\`\`\`

### repo.find({ patterns, searchPath?, maxResults?, ... })
Returns:
\`\`\`json
{ "totalFiles": 5, "patterns": ["*.ts"], "files": ["src/index.ts", "src/utils.ts"] }
\`\`\`

### repo.list({ directoryPath?, recursive?, maxDepth?, ... })
Returns:
\`\`\`json
{
  "directory": "src",
  "totalEntries": 10,
  "entries": [{ "name": "index.ts", "path": "src/index.ts", "isDirectory": false, "size": 1234, "depth": 0 }]
}
\`\`\`

### repo.view({ filePath, viewRange? })
Returns:
\`\`\`json
{
  "filePath": "src/errors.ts",
  "totalLines": 100,
  "viewRange": [1, 20],
  "lines": [{ "lineNumber": 1, "content": "export class Error {" }]
}
\`\`\`

## \`llm_query(instruction, data)\` — **REQUIRED for ANALYZE phase**
This is your PRIMARY semantic analysis tool. Use it for EVERY file you read.
- \`instruction\`: What to analyze (e.g., "Does this define an error class?")
- \`data\`: The code or text to analyze.
- Returns: A concise string response (NULL if not found).
- **Why required**: Avoids context rot, provides accurate semantic understanding

## Script Rules
- Use \`return\` to provide the final result (string or JSON-serializable object).
- Use \`for...of\` loops and \`async/await\` for iteration.
- **llm_query is REQUIRED**: Every \`repo.view\` MUST be followed by \`llm_query\` analysis.
- **Filter FIRST**: Don't read files blindly - use grep/find to narrow scope first.
- **PARSE JSON**: Always use JSON.parse() on repo.* results to extract data.
- For large files, split content into chunks and query each separately.
- Use Promise.all for parallel llm_query calls (much faster!).`,
      schema: z.object({
        script: z
          .string()
          .max(100000, "Script exceeds maximum size of 100KB")
          .describe(
            "The TypeScript exploration script to execute in the sandbox (max 100KB)"
          ),
      }),
    }
  );
}
