/**
 * RLM Sandbox - Recursive Language Model Execution Engine
 *
 * Provides a sandboxed environment for executing TypeScript exploration scripts.
 * Scripts have access to:
 * - `repo` object: Wraps the 4 atomic tools (list, view, find, grep)
 * - `llm_query`: Stateless LLM bridge for semantic analysis
 *
 * NOTE: Uses direct provider SDKs to avoid LangChain callback interference.
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from "@google/genai";
import OpenAI from 'openai';
import vm from "node:vm";
import { findTool } from "../tools/file-finding.tool.js";
import { listTool } from "../tools/file-listing.tool.js";
import { viewTool } from "../tools/file-reading.tool.js";
import { grepTool } from "../tools/grep-content.tool.js";
import { logger } from "../utils/logger.js";

/**
 * Provider type for LLM configuration
 */
export type LlmProviderType = 'openai' | 'anthropic' | 'google' | 'openai-compatible' | 'anthropic-compatible';

/**
 * Configuration for creating llm_query function
 */
export interface LlmConfig {
  type: LlmProviderType;
  apiKey: string;
  model?: string;
  baseURL?: string;
}

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
 * Creates an `llm_query` function that invokes the model using direct provider SDKs.
 * This avoids LangChain callback interference and ensures clean output control.
 *
 * @param config - LLM provider configuration
 * @returns A function that takes (instruction, data) and returns the model's analysis
 */
export function createLlmQuery(config: LlmConfig): (instruction: string, data: string) => Promise<string> {
  return async (instruction: string, data: string): Promise<string> => {
    logger.debug("RLM", "llm_query invoked", {
      type: config.type,
      model: config.model,
      instructionLength: instruction.length,
      dataLength: data.length,
    });

    const input = `**Instruction:** ${instruction}\n\n**Data:**\n${data}`;
    let content = '';

    try {
      switch (config.type) {
        case 'anthropic': {
          const client = new Anthropic({ apiKey: config.apiKey });
          const message = await client.messages.create({
            max_tokens: 1024,
            messages: [
              { role: 'system', content: SUB_AGENT_SYSTEM_PROMPT },
              { role: 'user', content: input },
            ],
            model: config.model || 'claude-sonnet-4-5-20250929',
          });
          content = message.content[0]?.type === 'text' ? message.content[0].text : '';
          break;
        }

        case 'anthropic-compatible': {
          const client = new Anthropic({ 
            apiKey: config.apiKey,
            baseURL: config.baseURL,
          });
          const message = await client.messages.create({
            max_tokens: 1024,
            messages: [
              { role: 'system', content: SUB_AGENT_SYSTEM_PROMPT },
              { role: 'user', content: input },
            ],
            model: config.model || 'claude-sonnet-4-5-20250929',
          });
          content = message.content[0]?.type === 'text' ? message.content[0].text : '';
          break;
        }

        case 'openai': {
          const client = new OpenAI({ apiKey: config.apiKey });
          const response = await client.responses.create({
            model: config.model || 'gpt-4.1',
            input: `System: ${SUB_AGENT_SYSTEM_PROMPT}\n\nUser: ${input}`,
          });
          content = response.output_text || '';
          break;
        }

        case 'openai-compatible': {
          const client = new OpenAI({ 
            apiKey: config.apiKey,
            baseURL: config.baseURL || 'https://api.openai.com/v1',
          });
          const response = await client.responses.create({
            model: config.model || 'gpt-4.1',
            input: `System: ${SUB_AGENT_SYSTEM_PROMPT}\n\nUser: ${input}`,
          });
          content = response.output_text || '';
          break;
        }

        case 'google': {
          const client = new GoogleGenAI({ apiKey: config.apiKey });
          const response = await client.models.generateContent({
            model: config.model || 'gemini-2.5-flash-lite',
            contents: `System: ${SUB_AGENT_SYSTEM_PROMPT}\n\nUser: ${input}`,
          });
          content = response.text || '';
          break;
        }

        default:
          throw new Error(`Unsupported LLM provider type: ${config.type}`);
      }

      logger.debug("RLM", "llm_query completed", {
        type: config.type,
        responseLength: content.length,
      });

      return `<LLM_QUERY_OUTPUT>\n${content}\n</LLM_QUERY_OUTPUT>`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("RLM", "llm_query failed", { error: errorMessage, type: config.type });
      throw error;
    }
  };
}

/**
 * Executes an RLM script string inside a sandboxed async context.
 * Uses Node.js vm.runInNewContext() with a carefully curated set of safe globals.
 * This provides isolation from Node.js/Bun built-ins while allowing standard JavaScript operations.
 *
 * Security measures:
 * - Blocks access to process, require, Buffer, fetch, and other Node.js APIs
 * - 30-second timeout prevents infinite loops and DoS attacks
 * - Sandboxed globals prevent access to application state
 *
 * Note: The vm module is NOT a true security boundary against sophisticated attacks.
 * For production deployments with untrusted user input, consider container-based isolation.
 *
 * Extended globals (when options provided):
 * - context: Repository content as string variable
 * - buffers: Object for accumulating analysis results
 * - print(...args): Adds to stdout
 * - FINAL(answer): Sets final answer
 * - FINAL_VAR(name): Returns buffer value as final answer
 * - chunk(data, size): Split string into chunks
 * - batch(items, size): Batch array for parallel processing
 */
export async function executeRlmScript(
  script: string,
  repo: RepoApi,
  llmQuery: (instruction: string, data: string) => Promise<string>,
  options?: {
    context?: string;
    buffers?: Record<string, unknown>;
    errorFeedback?: string;
  }
): Promise<string> {
  logger.info("RLM", "Executing script", { scriptLength: script.length });
  logger.debug("RLM", "Script content", { script });
  const timingId = logger.timingStart("rlmScript");

  // Safe globals to expose to the sandbox - comprehensive but minimal
  // Dangerous globals (process, require, Buffer, fetch, eval, Function) are intentionally omitted
  // or explicitly set to undefined to prevent access
  const safeGlobals: Record<string, unknown> = {
    // Explicitly block dangerous globals by setting them to undefined
    // This overrides any inherited globals from the V8 context
    process: undefined,
    require: undefined,
    Buffer: undefined,
    fetch: undefined,
    XMLHttpRequest: undefined,
    child_process: undefined,
    fs: undefined,
    http: undefined,
    https: undefined,
    module: undefined,
    __dirname: undefined,
    __filename: undefined,
    eval: undefined,
    Function: undefined,
    Atomics: undefined,
    SharedArrayBuffer: undefined,

    // Console for debugging (logs go through our logger)
    console: {
      log: (...args: unknown[]) =>
        logger.info("RLM", "Script log", { output: args.join(" ") }),
      error: (...args: unknown[]) =>
        logger.error("RLM", "Script error", new Error(args.join(" "))),
      warn: (...args: unknown[]) =>
        logger.warn("RLM", "Script warning", { output: args.join(" ") }),
      info: (...args: unknown[]) =>
        logger.info("RLM", "Script info", { output: args.join(" ") }),
    },

    // Core data structures
    JSON,
    Math,
    Map,
    Set,
    WeakMap,
    WeakSet,

    // Primitive wrappers and utilities
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    ReferenceError,
    Date,
    Promise,
    Symbol,
    BigInt,

    // Functions
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURI,
    decodeURI,
    encodeURIComponent,
    decodeURIComponent,
    atob,
    btoa,

    // Sandboxed APIs - these are the only ways the script interacts with the outside world
    repo,
    llm_query: llmQuery,

    // RLM-specific globals (when options provided)
    ...(options?.context !== undefined && { context: options.context }),
    ...(options?.buffers !== undefined && { buffers: options.buffers }),

    // print(...args): Adds to stdout (captured for RLM loop)
    print: (...args: unknown[]) => {
      logger.info("RLM", "Script print", { output: args.join(" ") });
    },

    // FINAL(answer): Sets final answer (for RLM completion)
    FINAL: (answer: unknown) => {
      logger.info("RLM", "Script FINAL called", { answer: String(answer) });
    },

    // FINAL_VAR(name): Returns buffer value as final answer
    FINAL_VAR: (name: string) => {
      logger.info("RLM", "Script FINAL_VAR called", { name });
    },

    // chunk(data, size): Split string into chunks
    chunk: (data: unknown, size: number): string[] => {
      const str = String(data);
      const chunks: string[] = [];
      for (let i = 0; i < str.length; i += size) {
        chunks.push(str.slice(i, i + size));
      }
      return chunks;
    },

    // batch(items, size): Batch array for parallel processing
    batch: <T>(items: T[], size: number): T[][] => {
      const batches: T[][] = [];
      for (let i = 0; i < items.length; i += size) {
        batches.push(items.slice(i, i + size));
      }
      return batches;
    },
  };

  try {
    // Wrap the user script in an async IIFE
    const wrappedScript = `(async () => {\n${script}\n})();`;

    // Execute in isolated context with timeout
    const result = await vm.runInNewContext(wrappedScript, safeGlobals, {
      timeout: 30000, // 30 seconds max execution time
    });

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

    // Check if this is a timeout error
    if (errorMessage.includes("timed out") || errorMessage.includes("Timeout")) {
      logger.error(
        "RLM",
        "Script timed out after 30 seconds",
        error instanceof Error ? error : new Error(errorMessage)
      );
      logger.timingEnd(timingId, "RLM", "Script timed out");
      return "Script execution error: Script timed out after 30 seconds.";
    }

    logger.error(
      "RLM",
      "Script execution failed",
      error instanceof Error ? error : new Error(errorMessage)
    );
    logger.timingEnd(timingId, "RLM", "Script execution failed");
    return `Script execution error: ${errorMessage}`;
  }
}
