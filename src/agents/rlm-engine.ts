/**
 * RLM Engine - Recursive Language Model Execution Engine with State Management
 *
 * Implements the RLM REPL loop as described in "Recursive Language Models" paper.
 * Key features:
 * - Persistent state across iterations (context, buffers, stdout)
 * - Metadata-only history for next iteration (per paper Algorithm 1)
 * - FINAL/FINAL_VAR output convention for completion detection
 * - Error feedback for retry with agent
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                     Librarian Agent (Root LLM)                        │
 * │  Input: { query, metadata: { iteration, stdout, buffers } }          │
 * │  Output: { code: string }                                            │
 * └─────────────────────────────────────────────────────────────────────┘
 *                                  │
 *                                  ▼
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                           RLM Engine                                 │
 * │  State: {                                                            │
 * │    context: string,      // Repository content (lazy-loaded)          │
 * │    buffers: {},           // Accumulated analysis                     │
 * │    stdout: string,        // Execution output                         │
 * │    iteration: number,     // For max iteration limit                 │
 * │    final?: string         // Set by FINAL/FINAL_VAR                  │
 * │  }                                                                     │
 * └─────────────────────────────────────────────────────────────────────┘
 */

import { logger } from "../utils/logger.js";
import {
  RepoApi,
  createRepoApi,
  LlmConfig,
  createLlmQuery,
  executeRlmScript,
  type RlmExecutionResult,
} from "./rlm-sandbox.js";

/**
 * RLM state persisted across iterations
 */
export interface RlmState {
  context: string;
  buffers: Record<string, unknown>;
  stdout: string;
  iteration: number;
  final?: string;
}

/**
 * Metadata passed to LLM for next iteration (per paper Algorithm 1)
 * Only constant-size information, not full context
 */
export interface RlmMetadata {
  iteration: number;
  stdoutPreview: string;  // Last N chars of stdout
  stdoutLength: number;
  bufferKeys: string[];
  bufferSummary: Array<{
    key: string;
    preview: string;
    size: number;
  }>;
  hasContext: boolean;  // Flag indicating context is available
  errorFeedback?: string;  // Error from previous iteration
}

/**
 * Configuration for RLM Engine
 */
export interface RlmEngineConfig {
  /** LLM configuration for llm_query calls */
  llmConfig: LlmConfig;
  /** Function to lazily load repository content */
  repoContentLoader: () => Promise<string>;
  /** Working directory for repo operations */
  workingDir: string;
  /** Maximum iterations before forcing completion (default: 10) */
  maxIterations?: number;
  /** Maximum stdout length for preview (default: 1000) */
  stdoutPreviewLength?: number;
}

/**
 * Result of script execution
 */
export interface ScriptResult {
  stdout: string;
  buffers: Record<string, unknown>;
  finalAnswer?: string;
  error?: string;
}

/**
 * RLM Engine - Manages REPL loop with persistent state
 *
 * Follows Algorithm 1 from the paper:
 * 1. Initialize state with context variable
 * 2. Execute code in sandbox
 * 3. Collect stdout and update buffers
 * 4. Check for FINAL/FINAL_VAR
 * 5. Return metadata for next iteration
 */
export class RlmEngine {
  private config: Required<RlmEngineConfig>;
  private state: RlmState;
  private repoApi: RepoApi;
  private errorFeedback?: string;
  /** Cached llm_query function to avoid recreating clients */
  private llmQuery: ((instruction: string, data: string) => Promise<string>) | undefined;

  constructor(config: RlmEngineConfig) {
    this.config = {
      maxIterations: 10,
      stdoutPreviewLength: 1000,
      ...config,
    };

    this.state = {
      context: '',
      buffers: {},
      stdout: '',
      iteration: 0,
    };

    this.repoApi = createRepoApi(config.workingDir);
  }

  /**
   * Get or create the cached llm_query function
   * Caches the LLM clients to avoid recreating them on every call
   */
  private getLlmQuery(): (instruction: string, data: string) => Promise<string> {
    if (!this.llmQuery) {
      this.llmQuery = createLlmQuery(this.config.llmConfig);
      logger.debug("RLM", "Created cached llm_query function");
    }
    return this.llmQuery;
  }

  /**
   * Execute a code string in the REPL environment
   * Updates state and checks for completion
   */
  async execute(code: string): Promise<{
    stdout: string;
    buffers: Record<string, unknown>;
    isComplete: boolean;
    finalAnswer?: string;
    error?: string;
  }> {
    logger.info("RLM", `Iteration ${this.state.iteration + 1} executing script`, {
      codeLength: code.length,
    });

    // Clear any stale error feedback from previous iterations
    this.errorFeedback = undefined;

    try {
      // Lazy load context on first execution
      if (!this.state.context) {
        logger.info("RLM", "Lazy loading repository content");
        this.state.context = await this.config.repoContentLoader();
        logger.info("RLM", "Repository content loaded", {
          contextLength: this.state.context.length,
        });
      }

      // Use cached llm_query function
      const llmQuery = this.getLlmQuery();

      // Execute script using unified sandbox
      const result = await executeRlmScript(
        code,
        this.repoApi,
        llmQuery,
        {
          context: this.state.context,
          buffers: this.state.buffers,
        }
      );

      // Update state
      this.state.buffers = result.buffers;
      this.state.stdout = result.stdout;
      this.state.final = result.finalAnswer;
      this.state.iteration++;

      // Check for completion
      if (result.finalAnswer) {
        logger.info("RLM", "RLM completed with FINAL answer", {
          answerLength: result.finalAnswer.length,
          iterations: this.state.iteration,
        });
        return {
          ...result,
          isComplete: true,
          finalAnswer: result.finalAnswer,
        };
      }

      // Check iteration limit
      if (this.state.iteration >= this.config.maxIterations) {
        logger.warn("RLM", "Max iterations reached", {
          iterations: this.state.iteration,
        });
        const summary = this.generateIterationSummary();
        return {
          stdout: result.stdout,
          buffers: result.buffers,
          isComplete: true,
          finalAnswer: `Max iterations (${this.config.maxIterations}) reached.\n\n${summary}`,
        };
      }

      // Continue with next iteration
      return {
        ...result,
        isComplete: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("RLM", "Script execution error", { error: errorMessage });

      return {
        stdout: this.state.stdout,
        buffers: this.state.buffers,
        isComplete: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Get metadata for next LLM iteration
   * Per paper: only constant-size metadata, not full context
   */
  getMetadata(): RlmMetadata {
    return {
      iteration: this.state.iteration,
      stdoutPreview: this.state.stdout.slice(-this.config.stdoutPreviewLength),
      stdoutLength: this.state.stdout.length,
      bufferKeys: Object.keys(this.state.buffers),
      bufferSummary: Object.entries(this.state.buffers).map(([key, value]) => ({
        key,
        preview: String(value).slice(0, 200),
        size: String(value).length,
      })),
      hasContext: true,
      errorFeedback: this.errorFeedback,
    };
  }

  /**
   * Get current state (for debugging/testing)
   */
  getState(): Readonly<RlmState> {
    return { ...this.state };
  }

  /**
   * Generate a summary of accumulated state (for fallback answer)
   */
  private generateIterationSummary(): string {
    const parts: string[] = ["=== Iteration Summary ==="];

    parts.push(`Total iterations: ${this.state.iteration}`);
    parts.push(`\n=== Buffers (${Object.keys(this.state.buffers).length}) ===`);

    for (const [key, value] of Object.entries(this.state.buffers)) {
      const valueStr = String(value);
      parts.push(`\n${key} (${valueStr.length} chars):`);
      parts.push(valueStr.slice(0, 500));
      if (valueStr.length > 500) {
        parts.push("... (truncated)");
      }
    }

    if (this.state.stdout) {
      parts.push(`\n=== Last Output ===\n${this.state.stdout.slice(-2000)}`);
    }

    return parts.join("\n");
  }

  /**
   * Set error feedback for next iteration (enables retry)
   */
  setErrorFeedback(feedback: string): void {
    this.errorFeedback = feedback;
  }
}

/**
 * Parse FINAL/FINAL_VAR from script output
 * Helper for external use
 */
export function parseFinalOutput(output: string): {
  finalAnswer?: string;
  cleanedStdout: string;
} {
  const finalMatch = output.match(/FINAL\(([\s\S]*?)\)/);
  const finalVarMatch = output.match(/FINAL_VAR\(([\w]+)\)/);

  let finalAnswer: string | undefined;
  if (finalMatch) {
    finalAnswer = finalMatch[1].trim();
  }

  // Note: FINAL_VAR resolution requires buffer access, handled in engine

  const cleanedStdout = output
    .replace(/FINAL\([\s\S]*?\)/g, "")
    .replace(/FINAL_VAR\([\w]+\)/g, "")
    .trim();

  return { finalAnswer, cleanedStdout };
}
