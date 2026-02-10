/**
 * RLM Tool - The unified `research_repository` tool for LangChain agents.
 *
 * Replaces the 4 atomic tools with a single tool that accepts a TypeScript
 * exploration script. The script is executed in a sandboxed environment with
 * access to `repo` (file operations) and `llm_query` (semantic analysis).
 */

import type { ChatAnthropic } from "@langchain/anthropic";
import type { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { ChatOpenAI } from "@langchain/openai";
import { tool } from "langchain";
import { z } from "zod";
import { logger } from "../utils/logger.js";
import {
  createLlmQuery,
  createRepoApi,
  executeRlmScript,
} from "./rlm-sandbox.js";

type ChatModel = ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI;

/**
 * Creates the `research_repository` LangChain tool bound to a specific model.
 * The model is used for `llm_query` calls within scripts.
 */
export function createResearchRepositoryTool(model: ChatModel) {
  const llmQuery = createLlmQuery(model);

  return tool(
    async ({ script }, config) => {
      const timingId = logger.timingStart("research_repository");

      const workingDir = config?.context?.workingDir;
      if (!workingDir) {
        throw new Error(
          "Context with workingDir is required for research_repository"
        );
      }

      logger.info("RLM", "research_repository called", {
        scriptLength: script.length,
      });

      const repo = createRepoApi(workingDir);
      const result = await executeRlmScript(script, repo, llmQuery);

      logger.timingEnd(timingId, "RLM", "research_repository completed");

      return result;
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
Invoke a stateless LLM to analyze a code snippet. Use this instead of reading raw code into the conversation.
- \`instruction\`: What to analyze (e.g., "Does this define an error class with a code property?")
- \`data\`: The code or text to analyze.
- Returns: A concise string response.

## Script Rules
- Use \`return\` to provide the final result (string or JSON-serializable object).
- Use \`for...of\` loops and \`async/await\` for iteration.
- Use \`llm_query\` for semantic filtering instead of regex heuristics.
- For large files, split content into chunks and query each separately.`,
      schema: z.object({
        script: z
          .string()
          .describe(
            "The TypeScript exploration script to execute in the sandbox"
          ),
      }),
    }
  );
}
