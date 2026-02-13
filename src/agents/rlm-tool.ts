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
      description: `Execute a TypeScript script to explore the repository. The script has access to a 'repo' object for file operations and 'llm_query' for semantic analysis.

**MUST USE FINAL() TO COMPLETE**: Your script MUST call FINAL(answer) when done to provide the final answer. If you don't call FINAL(), the system will keep running and may timeout.

Example:
{
  "script": "const files = await repo.find({patterns: ['*.py']}); FINAL('Found ' + files.length + ' Python files');"
}

Inside the script, use:
- repo.find({patterns: [...]}) - find files by glob patterns
- repo.grep({query: '...'}) - search file contents  
- repo.list({directoryPath: '...'}) - list directory contents
- repo.view({filePath: '...'}) - read file contents
- llm_query(instruction, data) - analyze content with LLM
- buffers - object to store intermediate results
- print(...args) - debug output
- FINAL(answer) - REQUIRED to complete and return your answer

Always use JSON.parse() on repo.* results.`,
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
