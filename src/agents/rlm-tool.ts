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

The script runs in an async context and has access to two globals:

## \`repo\` — File Operations API
- \`repo.list({ directoryPath?, includeHidden?, recursive?, maxDepth? })\`: List directory contents. Returns formatted tree string.
- \`repo.view({ filePath, viewRange? })\`: Read file contents. Returns file text with line numbers.
- \`repo.find({ searchPath?, patterns, exclude?, recursive?, maxResults?, includeHidden? })\`: Find files by glob patterns. Returns matched file paths.
- \`repo.grep({ searchPath?, query, patterns?, caseSensitive?, regex?, recursive?, maxResults?, contextBefore?, contextAfter?, exclude?, includeHidden? })\`: Search text in files. Returns matches with context.

## \`llm_query(instruction, data)\` — Semantic Analysis
Invoke a stateless LLM to analyze a code snippet. Use it instead of reading raw code into the conversation.
- \`instruction\`: What to analyze (e.g., "Does this define an error class with a code property?")
- \`data\`: The code or text to analyze.
- Returns: A concise string response wrapped in <LLM_QUERY_OUTPUT> tags.

## Script Rules
- Use \`return\` to provide the final result (string or JSON-serializable object).
- Use \`for...of\` loops and \`async/await\` for iteration.
- Use \`llm_query\` for semantic filtering instead of regex heuristics.
- For large files, split content into chunks and query each separately.`,
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
