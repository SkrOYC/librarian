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
import { SUB_AGENT_SYSTEM_PROMPT } from "./rlm-prompts.js";

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
  model?: string | undefined;
  baseURL?: string | undefined;
}

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
  // Note: group and technology are not used by tools - only workingDir is needed for sandboxing
  const toolContext = { workingDir };

  return {
    list: async (args) => {
      try {
        return await listTool.invoke(
          {
            directoryPath: args.directoryPath ?? ".",
            includeHidden: args.includeHidden ?? false,
            recursive: args.recursive ?? false,
            maxDepth: args.maxDepth ?? 1,
          },
          { context: toolContext }
        );
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
    },
    view: async (args) => {
      try {
        return await viewTool.invoke(
          {
            filePath: args.filePath,
            viewRange: args.viewRange,
          },
          { context: toolContext }
        );
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
    },
    find: async (args) => {
      try {
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
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
    },
    grep: async (args) => {
      try {
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
      } catch (error) {
        return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
      }
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
          if (!config.model) {
            throw new Error('Model name is required for Anthropic provider');
          }
          const client = new Anthropic({ apiKey: config.apiKey });
          const message = await client.messages.create({
            max_tokens: 1024,
            system: SUB_AGENT_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: input }],
            model: config.model,
          });
          
          // Handle both text and thinking content types
          let textContent = '';
          for (const block of message.content) {
            if (block.type === 'text') {
              textContent += block.text;
            } else if (block.type === 'thinking') {
              logger.debug("RLM", "Model used thinking block", {
                thinking: block.thinking?.substring(0, 100),
              });
            }
          }
          content = textContent;
          break;
        }

        case 'anthropic-compatible': {
          if (!config.model) {
            throw new Error('Model name is required for Anthropic-compatible provider');
          }
          const client = new Anthropic({ 
            apiKey: config.apiKey,
            baseURL: config.baseURL,
          });
          const message = await client.messages.create({
            max_tokens: 1024,
            system: SUB_AGENT_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: input }],
            model: config.model,
          });
          
          // Handle both text and thinking content types
          // Some models (like MiniMax) return thinking blocks followed by text blocks
          // We need to find ALL text blocks and concatenate them
          let textContent = '';
          for (const block of message.content) {
            if (block.type === 'text') {
              textContent += block.text;
            } else if (block.type === 'thinking') {
              // Log thinking for debugging but don't include in output
              logger.debug("RLM", "Model used thinking block", {
                thinking: block.thinking?.substring(0, 100),
              });
            }
          }
          
          // Log full response for debugging
          logger.debug("RLM", "Anthropic response", {
            stopReason: message.stop_reason,
            usage: message.usage,
            contentBlocks: message.content.length,
            contentTypes: message.content.map(b => b.type).join(', '),
            finalTextLength: textContent.length,
          });
          content = textContent;
          break;
        }

        case 'openai': {
          if (!config.model) {
            throw new Error('Model name is required for OpenAI provider');
          }
          const client = new OpenAI({ apiKey: config.apiKey });
          const response = await client.responses.create({
            model: config.model,
            instructions: SUB_AGENT_SYSTEM_PROMPT,
            input: input,
          });
          // Log full response for debugging
          logger.debug("RLM", "OpenAI response", {
            outputIndex: response.output?.length,
            outputText: response.output_text?.substring(0, 200),
          });
          content = response.output_text || '';
          break;
        }

        case 'openai-compatible': {
          if (!config.model) {
            throw new Error('Model name is required for OpenAI-compatible provider');
          }
          const client = new OpenAI({ 
            apiKey: config.apiKey,
            baseURL: config.baseURL || 'https://api.openai.com/v1',
          });
          const response = await client.responses.create({
            model: config.model,
            instructions: SUB_AGENT_SYSTEM_PROMPT,
            input: input,
          });
          content = response.output_text || '';
          break;
        }

        case 'google': {
          if (!config.model) {
            throw new Error('Model name is required for Google provider');
          }
          const ai = new GoogleGenAI({ apiKey: config.apiKey });
          const response = await ai.models.generateContent({
            model: config.model,
            contents: input,
            config: {
              systemInstruction: SUB_AGENT_SYSTEM_PROMPT,
            },
          });
          // Log full response for debugging
          logger.debug("RLM", "Google response", {
            finishReason: response.finishReason,
            text: response.text?.substring(0, 200),
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
      logger.error("RLM", "llm_query failed", undefined, { errorMessage, type: config.type });
      throw error;
    }
  };
}

/**
 * Execution context for RLM scripts
 * Used by both one-shot tool calls and multi-turn engine iterations
 */
export interface RlmExecutionContext {
  /** Repository content as string variable */
  context?: string;
  /** Accumulated buffers for stateful iterations */
  buffers?: Record<string, unknown>;
  /** Callback when print() is called - captures to stdout */
  onPrint?: (output: string) => void;
  /** Callback when FINAL() is called - signals completion */
  onFinal?: (answer: string) => void;
  /** Callback when FINAL_VAR() is called - signals completion with buffer */
  onFinalVar?: (name: string) => void;
}

/**
 * Result of RLM script execution
 */
export interface RlmExecutionResult {
  /** Captured stdout from print() calls */
  stdout: string;
  /** Final buffers state */
  buffers: Record<string, unknown>;
  /** Final answer if FINAL/FINAL_VAR was called */
  finalAnswer?: string | undefined;
  /** Error message if execution failed */
  error?: string | undefined;
}

/**
 * Executes an RLM script string inside a sandboxed async context.
 * Uses Node.js vm.runInNewContext() with a carefully curated set of safe globals.
 * 
 * This unified function supports both:
 * - One-shot tool calls (research_repository tool)
 * - Multi-turn engine iterations (RlmEngine with state persistence)
 *
 * Security measures:
 * - Blocks access to process, require, Buffer, fetch, and other Node.js APIs
 * - 30-second timeout prevents infinite loops and DoS attacks
 * - Sandboxed globals prevent access to application state
 *
 * Note: The vm module is NOT a true security boundary against sophisticated attacks.
 * For production deployments with untrusted user input, consider container-based isolation.
 */
export async function executeRlmScript(
  script: string,
  repo: RepoApi,
  llmQuery: (instruction: string, data: string) => Promise<string>,
  executionContext?: RlmExecutionContext
): Promise<RlmExecutionResult> {
  logger.info("RLM", "Executing script", { scriptLength: script.length });
  // Limit logged script content to prevent log bloat (max 500 chars)
  const truncatedScript = script.length > 500 ? script.slice(0, 500) + '... [truncated]' : script;
  logger.debug("RLM", "Script content", { script: truncatedScript });
  const timingId = logger.timingStart("rlmScript");

  // Initialize execution state
  const buffers: Record<string, unknown> = { ...(executionContext?.buffers ?? {}) };
  const stdout: string[] = [];
  let finalAnswer: string | undefined;

  // Safe globals to expose to the sandbox - comprehensive but minimal
  // Dangerous globals (process, require, Buffer, fetch, eval, Function) are intentionally omitted
  // or explicitly set to undefined to prevent access
  const sandboxGlobals: Record<string, unknown> = {
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
    net: undefined,
    tls: undefined,
    dns: undefined,
    dgram: undefined,
    module: undefined,
    __dirname: undefined,
    __filename: undefined,
    eval: undefined,
    Function: undefined,
    Atomics: undefined,
    SharedArrayBuffer: undefined,
    setImmediate: undefined,
    setInterval: undefined,
    clearImmediate: undefined,
    clearInterval: undefined,
    queueMicrotask: undefined,
    // Note: We intentionally do NOT block constructor, __proto__, or prototype globally.
    // The sandboxed Object/Array/etc. are isolated from the real prototypes.
    // Blocking these globally breaks legitimate code like:
    // - arr.constructor === Array
    // - Object.getPrototypeOf({})
    // - arr instanceof Array

    // Console for debugging (logs go through our logger at debug level)
    console: {
      log: (...args: unknown[]) => {
        const output = args.join(" ");
        logger.debug("RLM", "Script log", { output });
        stdout.push(output);
      },
      error: (...args: unknown[]) => {
        const output = args.join(" ");
        logger.debug("RLM", "Script error", { output });
        stdout.push(`ERROR: ${output}`);
      },
      warn: (...args: unknown[]) => {
        const output = args.join(" ");
        logger.debug("RLM", "Script warning", { output });
        stdout.push(`WARN: ${output}`);
      },
      info: (...args: unknown[]) => {
        const output = args.join(" ");
        logger.debug("RLM", "Script info", { output });
        stdout.push(`INFO: ${output}`);
      },
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

    // RLM-specific globals (when context provided)
    ...(executionContext?.context !== undefined && { 
      context: executionContext.context 
    }),
    
    // Always provide buffers
    buffers,

    // print(...args): Adds to stdout (captured for RLM loop)
    print: (...args: unknown[]) => {
      const output = args.map(a => String(a)).join(" ");
      stdout.push(output);
      executionContext?.onPrint?.(output);
    },

    // FINAL(answer): Sets final answer (for RLM completion)
    FINAL: (answer: unknown) => {
      finalAnswer = String(answer);
      executionContext?.onFinal?.(finalAnswer);
    },

    // FINAL_VAR(name): Returns buffer value as final answer
    FINAL_VAR: (name: string) => {
      if (buffers.hasOwnProperty(name)) {
        finalAnswer = String(buffers[name]);
        executionContext?.onFinalVar?.(name);
      } else {
        throw new Error(`Buffer '${name}' not found`);
      }
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
    // Wrap the user script in an async IIFE that captures the return value
    const wrappedScript = `(async () => {\n${script}\n})();`;

    // Execute in isolated context with timeout and capture return value
    const returnValue = await vm.runInNewContext(wrappedScript, sandboxGlobals, {
      timeout: 30000, // 30 seconds max execution time
    });

    logger.timingEnd(timingId, "RLM", "Script execution completed");

    // Store return value in buffers for legacy compatibility
    if (returnValue !== undefined && returnValue !== null) {
      buffers.__returnValue = returnValue;
    }

    return {
      stdout: stdout.join("\n"),
      buffers,
      finalAnswer,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Extract line number if available (vm errors often include line info)
    let lineInfo = "";
    if (error instanceof Error && error.stack) {
      const lineMatch = error.stack.match(/rlm-script\.ts:(\d+):(\d+)/);
      if (lineMatch) {
        lineInfo = ` (line ${lineMatch[1]}, col ${lineMatch[2]})`;
      }
    }
    
    const fullErrorMessage = `Script Error${lineInfo}: ${errorMessage}`;

    // Capture error in stdout for agent to see
    stdout.push(fullErrorMessage);

    // Check if this is a timeout error
    if (errorMessage.includes("timed out") || errorMessage.includes("Timeout")) {
      logger.error(
        "RLM",
        "Script timed out after 30 seconds",
        error instanceof Error ? error : new Error(errorMessage)
      );
      logger.timingEnd(timingId, "RLM", "Script timed out");
      return {
        stdout: stdout.join("\n"),
        buffers,
        error: "Script timed out after 30 seconds",
      };
    }

    logger.error(
      "RLM",
      "Script execution failed",
      error instanceof Error ? error : new Error(errorMessage)
    );
    logger.timingEnd(timingId, "RLM", "Script execution failed");
    return {
      stdout: stdout.join("\n"),
      buffers,
      error: fullErrorMessage,
    };
  }
}
