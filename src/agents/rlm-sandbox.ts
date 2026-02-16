/**
 * RLM Sandbox - Recursive Language Model Execution Engine
 *
 * Provides a sandboxed environment for executing TypeScript exploration scripts.
 * Scripts have access to:
 * - `repo` object: Wraps the 4 atomic tools (list, view, find, grep)
 * - `llm_query`: Stateless LLM bridge for semantic analysis
 *
 * NOTE: Uses Bun Worker-based sandbox for true process isolation.
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { findTool } from "../tools/file-finding.tool.js";
import { listTool } from "../tools/file-listing.tool.js";
import { viewTool } from "../tools/file-reading.tool.js";
import { grepTool } from "../tools/grep-content.tool.js";
import { logger } from "../utils/logger.js";
import { SUB_AGENT_SYSTEM_PROMPT } from "./rlm-prompts.js";
import {
  BunWorkerSandbox,
  type WorkerExecutionResult,
} from "./rlm-worker-sandbox.js";

/**
 * Provider type for LLM configuration
 */
export type LlmProviderType =
  | "openai"
  | "anthropic"
  | "google"
  | "openai-compatible"
  | "anthropic-compatible";

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
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        });
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
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        });
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
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        });
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
        return JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        });
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
export function createLlmQuery(
  config: LlmConfig
): (instruction: string, data: string) => Promise<string> {
  return async (instruction: string, data: string): Promise<string> => {
    logger.debug("RLM", "llm_query invoked", {
      type: config.type,
      model: config.model,
      instructionLength: instruction.length,
      dataLength: data.length,
    });

    const input = `**Instruction:** ${instruction}\n\n**Data:**\n${data}`;
    let content = "";

    try {
      switch (config.type) {
        case "anthropic": {
          if (!config.model) {
            throw new Error("Model name is required for Anthropic provider");
          }
          const client = new Anthropic({ apiKey: config.apiKey });
          const message = await client.messages.create({
            max_tokens: 1024,
            system: SUB_AGENT_SYSTEM_PROMPT,
            messages: [{ role: "user", content: input }],
            model: config.model,
          });

          // Handle both text and thinking content types
          let textContent = "";
          for (const block of message.content) {
            if (block.type === "text") {
              textContent += block.text;
            } else if (block.type === "thinking") {
              logger.debug("RLM", "Model used thinking block", {
                thinking: block.thinking?.substring(0, 100),
              });
            }
          }
          content = textContent;
          break;
        }

        case "anthropic-compatible": {
          if (!config.model) {
            throw new Error(
              "Model name is required for Anthropic-compatible provider"
            );
          }
          const client = new Anthropic({
            apiKey: config.apiKey,
            baseURL: config.baseURL,
          });
          const message = await client.messages.create({
            max_tokens: 1024,
            system: SUB_AGENT_SYSTEM_PROMPT,
            messages: [{ role: "user", content: input }],
            model: config.model,
          });

          // Handle both text and thinking content types
          // Some models (like MiniMax) return thinking blocks followed by text blocks
          // We need to find ALL text blocks and concatenate them
          let textContent = "";
          for (const block of message.content) {
            if (block.type === "text") {
              textContent += block.text;
            } else if (block.type === "thinking") {
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
            contentTypes: message.content.map((b) => b.type).join(", "),
            finalTextLength: textContent.length,
          });
          content = textContent;
          break;
        }

        case "openai": {
          if (!config.model) {
            throw new Error("Model name is required for OpenAI provider");
          }
          const client = new OpenAI({ apiKey: config.apiKey });
          const response = await client.responses.create({
            model: config.model,
            instructions: SUB_AGENT_SYSTEM_PROMPT,
            input,
          });
          // Log full response for debugging
          logger.debug("RLM", "OpenAI response", {
            outputIndex: response.output?.length,
            outputText: response.output_text?.substring(0, 200),
          });
          content = response.output_text || "";
          break;
        }

        case "openai-compatible": {
          if (!config.model) {
            throw new Error(
              "Model name is required for OpenAI-compatible provider"
            );
          }
          const client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseURL || "https://api.openai.com/v1",
          });
          const response = await client.responses.create({
            model: config.model,
            instructions: SUB_AGENT_SYSTEM_PROMPT,
            input,
          });
          content = response.output_text || "";
          break;
        }

        case "google": {
          if (!config.model) {
            throw new Error("Model name is required for Google provider");
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
          content = response.text || "";
          break;
        }

        default:
          throw new Error(`Unsupported LLM provider type: ${config.type}`);
      }

      logger.debug("RLM", "llm_query completed", {
        type: config.type,
        responseLength: content.length,
      });

      return content;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("RLM", "llm_query failed", undefined, {
        errorMessage,
        type: config.type,
      });
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
  /** Return value from the script */
  returnValue?: unknown;
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
 * Executes an RLM script string inside a Bun Worker sandbox.
 * Uses true process isolation with Bun Workers (JavaScriptCore).
 *
 * This unified function supports both:
 * - One-shot tool calls (research_repository tool)
 * - Multi-turn engine iterations (RlmEngine with state persistence)
 *
 * Security measures:
 * - Worker runs in isolated JavaScriptCore context
 * - 30-second timeout prevents infinite loops and DoS attacks
 * - No access to parent process globals
 */
export async function executeRlmScript(
  script: string,
  repo: RepoApi,
  llmQuery: (instruction: string, data: string) => Promise<string>,
  executionContext?: RlmExecutionContext
): Promise<RlmExecutionResult> {
  logger.info("RLM", "Executing script", { scriptLength: script.length });
  // Limit logged script content to prevent log bloat (max 500 chars)
  const truncatedScript =
    script.length > 500 ? script.slice(0, 500) + "... [truncated]" : script;
  logger.debug("RLM", "Script content", { script: truncatedScript });
  const timingId = logger.timingStart("rlmScript");

  try {
    // Create sandbox with worker
    const sandbox = new BunWorkerSandbox({
      repo,
      llmQuery,
      timeout: 30_000, // 30 seconds max execution time
      initialBuffers: { ...(executionContext?.buffers ?? {}) },
      context: executionContext?.context,
    });

    // Execute the script
    const result: WorkerExecutionResult = await sandbox.execute(script);

    logger.timingEnd(timingId, "RLM", "Script execution completed");

    // Store return value in buffers for legacy compatibility
    if (result.returnValue !== undefined && result.returnValue !== null) {
      result.buffers.__returnValue = result.returnValue;
    }

    // Call callbacks if provided
    if (executionContext?.onPrint && result.stdout) {
      for (const line of result.stdout.split("\n")) {
        if (line) executionContext.onPrint(line);
      }
    }
    if (result.finalAnswer && executionContext?.onFinal) {
      executionContext.onFinal(result.finalAnswer);
    }

    return {
      stdout: result.stdout,
      buffers: result.buffers,
      finalAnswer: result.finalAnswer,
      error: result.error,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const fullErrorMessage = `Script Error: ${errorMessage}`;

    logger.error(
      "RLM",
      "Script execution failed",
      error instanceof Error ? error : new Error(errorMessage)
    );
    logger.timingEnd(timingId, "RLM", "Script execution failed");

    return {
      stdout: "",
      buffers: { ...(executionContext?.buffers ?? {}) },
      error: fullErrorMessage,
    };
  }
}
