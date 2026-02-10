/**
 * RLM Sandbox - Recursive Language Model Execution Engine
 *
 * Provides a sandboxed environment for executing TypeScript exploration scripts.
 * Scripts have access to:
 * - `repo` object: Wraps the 4 atomic tools (list, view, find, grep)
 * - `llm_query`: Stateless LLM bridge for semantic analysis
 */

import type { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { ChatOpenAI } from "@langchain/openai";
import { findTool } from "../tools/file-finding.tool.js";
import { listTool } from "../tools/file-listing.tool.js";
import { viewTool } from "../tools/file-reading.tool.js";
import { grepTool } from "../tools/grep-content.tool.js";
import { logger } from "../utils/logger.js";

type ChatModel = ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI;

const SUB_AGENT_SYSTEM_PROMPT = `You are a stateless Functional Analyzer. You are a component of a larger recursive search.
1. **Input**: You will receive a code snippet and a specific instruction.
2. **Constraint**: You have NO access to tools. You must answer based ONLY on the provided text.
3. **Output**: Be extremely concise. If the instruction asks for a boolean or a specific extraction, provide ONLY that. No conversational filler.`;

/**
 * The sandbox repo API surface available to RLM scripts.
 */
export interface RepoApi {
  list: (args: {
    directoryPath?: string;
    includeHidden?: boolean;
    recursive?: boolean;
    maxDepth?: number;
  }) => Promise<string>;
  view: (args: {
    filePath: string;
    viewRange?: [number, number];
  }) => Promise<string>;
  find: (args: {
    searchPath?: string;
    patterns: string[];
    exclude?: string[];
    recursive?: boolean;
    maxResults?: number;
    includeHidden?: boolean;
  }) => Promise<string>;
  grep: (args: {
    searchPath?: string;
    query: string;
    patterns?: string[];
    caseSensitive?: boolean;
    regex?: boolean;
    recursive?: boolean;
    maxResults?: number;
    contextBefore?: number;
    contextAfter?: number;
    exclude?: string[];
    includeHidden?: boolean;
  }) => Promise<string>;
}

/**
 * Creates a `repo` API object that wraps the 4 atomic tools,
 * binding them to the given workingDir for security sandboxing.
 */
export function createRepoApi(workingDir: string): RepoApi {
  const toolContext = { workingDir, group: "", technology: "" };

  return {
    list: async (args) => {
      return await listTool.invoke(
        {
          directoryPath: args.directoryPath ?? ".",
          includeHidden: args.includeHidden ?? false,
          recursive: args.recursive ?? false,
          maxDepth: args.maxDepth ?? 1,
        },
        { context: toolContext }
      );
    },
    view: async (args) => {
      return await viewTool.invoke(
        {
          filePath: args.filePath,
          viewRange: args.viewRange,
        },
        { context: toolContext }
      );
    },
    find: async (args) => {
      return await findTool.invoke(
        {
          searchPath: args.searchPath ?? ".",
          patterns: args.patterns,
          exclude: args.exclude ?? [],
          recursive: args.recursive ?? true,
          maxResults: args.maxResults ?? 100,
          includeHidden: args.includeHidden ?? false,
        },
        { context: toolContext }
      );
    },
    grep: async (args) => {
      return await grepTool.invoke(
        {
          searchPath: args.searchPath ?? ".",
          query: args.query,
          patterns: args.patterns ?? ["*"],
          caseSensitive: args.caseSensitive ?? false,
          regex: args.regex ?? false,
          recursive: args.recursive ?? true,
          maxResults: args.maxResults ?? 100,
          contextBefore: args.contextBefore ?? 0,
          contextAfter: args.contextAfter ?? 0,
          exclude: args.exclude ?? [],
          includeHidden: args.includeHidden ?? false,
        },
        { context: toolContext }
      );
    },
  };
}

/**
 * Creates an `llm_query` function that invokes the model in stateless, tool-less mode.
 * Used by RLM scripts for semantic analysis of code snippets.
 */
export function createLlmQuery(
  model: ChatModel
): (instruction: string, data: string) => Promise<string> {
  return async (instruction: string, data: string): Promise<string> => {
    logger.debug("RLM", "llm_query invoked", {
      instructionLength: instruction.length,
      dataLength: data.length,
    });

    const messages = [
      new SystemMessage(SUB_AGENT_SYSTEM_PROMPT),
      new HumanMessage(
        `**Instruction:** ${instruction}\n\n**Data:**\n${data}`
      ),
    ];

    const response = await model.invoke(messages);

    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    logger.debug("RLM", "llm_query completed", {
      responseLength: content.length,
    });

    return content;
  };
}

/**
 * Executes an RLM script string inside a sandboxed async context.
 * The script receives `repo` and `llm_query` as globals and must
 * use `return` to provide its final result.
 */
export async function executeRlmScript(
  script: string,
  repo: RepoApi,
  llmQuery: (instruction: string, data: string) => Promise<string>
): Promise<string> {
  logger.info("RLM", "Executing script", { scriptLength: script.length });
  const timingId = logger.timingStart("rlmScript");

  try {
    // Wrap the user script in an async IIFE that receives sandbox globals
    const asyncFn = new Function(
      "repo",
      "llm_query",
      `return (async () => {\n${script}\n})();`
    );

    const result = await asyncFn(repo, llmQuery);

    logger.timingEnd(timingId, "RLM", "Script execution completed");

    if (result === undefined || result === null) {
      return "Script completed with no return value.";
    }

    if (typeof result === "string") {
      return result;
    }

    return JSON.stringify(result, null, 2);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logger.error(
      "RLM",
      "Script execution failed",
      error instanceof Error ? error : new Error(errorMessage)
    );
    logger.timingEnd(timingId, "RLM", "Script execution failed");
    return `Script execution error: ${errorMessage}`;
  }
}
