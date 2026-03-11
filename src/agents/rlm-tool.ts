/**
 * Legacy `research_repository` compatibility tool.
 *
 * It accepts a TypeScript exploration script and executes it in a sandboxed
 * environment with access to `repo` and `llm_query`. The main product runtime
 * no longer depends on this tool, but older invoke-style consumers and tests
 * still exercise it.
 */

import { z } from "zod";
import { logger } from "../utils/logger.js";
import { createTool } from "../tools/tool.js";
import {
  createLlmQuery,
  createRepoApi,
  executeRlmScript,
  type LlmConfig,
  type SandboxRepoApi,
} from "./rlm-sandbox.js";

/**
 * Legacy type alias for backward compatibility
 */
export type ModelConfig = LlmConfig;

/**
 * Creates the legacy `research_repository` tool.
 *
 * @param config - The LLM provider configuration
 * @returns A simple invoke-compatible tool for research_repository
 *
 * Note: We use the internal AI SDK-backed query adapter to keep the legacy
 * compatibility surface isolated from the main runtime.
 */
export function createResearchRepositoryTool(config: LlmConfig) {
  const llmQuery = createLlmQuery(config);

  return createTool(
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
      const legacyRepo: SandboxRepoApi = {
        list: async (args: Parameters<typeof repo.list>[0]) =>
          JSON.stringify(await repo.list(args)),
        view: async (args: Parameters<typeof repo.view>[0]) => {
          const result = await repo.view(args);
          return result.lines.map((line) => line.content).join("\n");
        },
        find: async (args: Parameters<typeof repo.find>[0]) =>
          JSON.stringify(await repo.find(args)),
        grep: async (args: Parameters<typeof repo.grep>[0]) =>
          JSON.stringify(await repo.grep(args)),
      };
      const result = await executeRlmScript(
        script,
        legacyRepo,
        llmQuery,
      );

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
        return typeof returnValue === "string"
          ? returnValue
          : JSON.stringify(returnValue, null, 2);
      }

      return "Script completed with no output.";
    },
    {
      name: "research_repository",
      description: `Execute a JavaScript script to explore the repository. The script runs in a sandbox with access to file operations and semantic analysis.

The script has access to:
- repo.find({patterns: [...]}) - find files by glob patterns
- repo.grep({query: '...'}) - search file contents  
- repo.list({directoryPath: '...'}) - list directory contents
- repo.view({filePath: '...'}) - read file contents
- llm_query(instruction, data) - analyze content with LLM
- print(...args) - output debug information
- buffers - object to store intermediate results

Example:
{
  "script": "const result = await repo.list({directoryPath: '.'}); print(result); return result;"
}

Legacy repo contract:
- repo.list / repo.find / repo.grep return JSON strings
- repo.view returns plain text file contents`,
      schema: z.object({
        script: z
          .string()
          .max(100_000, "Script exceeds maximum size of 100KB")
          .describe(
            "The TypeScript exploration script to execute in the sandbox (max 100KB)"
          ),
      }),
    },
  );
}
