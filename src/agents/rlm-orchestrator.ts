  /**
   * RLM Orchestrator - Multi-turn REPL Orchestrator (Algorithm 1)
   *
   * Implements Algorithm 1 from the "Recursive Language Models" paper (arXiv:2512.24601v2).
   *
   * Key features:
   * - Explicit while loop: LLM → execute → metadata → LLM
   * - Metadata-only history (constant size, not full context)
   * - Worker reuse across iterations (buffers persist like real REPL)
   * - Fresh worker per sub_rlm call
   *
   * Algorithm 1:
   * ```
   * state ← InitREPL(prompt=P)
   * state ← AddFunction(state, sub_RLM)
   * hist ← [Metadata(state)]
   *
   * while True do
   *   code ← LLM(hist)
   *   (state, stdout) ← REPL(state, code)
   *   hist ← hist ∥ code ∥ Metadata(stdout)
   *   if state[Final] is set then
   *     return state[Final]
   * ```
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
import { BunWorkerSandbox, type WorkerExecutionResult } from "./rlm-worker-sandbox.js";

/**
 * Configuration for RLM Orchestrator
 */
export interface RlmOrchestratorConfig {
  /** LLM configuration for creating query function */
  llmConfig?: LlmConfig;
  /** Direct LLM query function (alternative to llmConfig, useful for testing) */
  llmQuery?: (instruction: string, data: string) => Promise<string>;
  /** Working directory for repo operations */
  workingDir: string;
  /** Function to lazily load repository content */
  repoContentLoader: () => Promise<string>;
  /** Maximum iterations before forcing completion (default: 10) */
  maxIterations?: number;
  /** Maximum stdout length for preview (default: 1000) */
  stdoutPreviewLength?: number;
}

/**
 * Metadata passed to LLM for each iteration (per paper Algorithm 1)
 * Only constant-size information, not full context
 */
export interface RlmMetadata {
  iteration: number;
  stdoutPreview: string;
  stdoutLength: number;
  bufferKeys: string[];
  bufferSummary: Array<{
    key: string;
    preview: string;
    size: number;
  }>;
  errorFeedback?: string;
}

/**
 * RLM state persisted across iterations
 */
interface RlmState {
  context: string;
  buffers: Record<string, unknown>;
  stdout: string;
  iteration: number;
  finalAnswer?: string;
}

/**
 * RlmOrchestrator - Multi-turn REPL Orchestrator implementing Algorithm 1
 *
 * This class provides explicit control over the REPL loop rather than
 * relying on LangChain's internal agent machinery.
 */
export class RlmOrchestrator {
  private config: RlmOrchestratorConfig & { maxIterations: number; stdoutPreviewLength: number };
  private state: RlmState;
  private repoApi: RepoApi;
  private metadataHistory: RlmMetadata[];
  private errorFeedback?: string;
  private lastError?: string; // Preserved for summary even after errorFeedback is cleared
  private worker: BunWorkerSandbox | null = null;
  private llmQuery: ((instruction: string, data: string) => Promise<string>) | undefined;

  constructor(config: RlmOrchestratorConfig) {
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
    this.metadataHistory = [];
  }

  /**
   * Get or create the cached llm_query function
   */
  private getLlmQuery(): (instruction: string, data: string) => Promise<string> {
    if (!this.llmQuery) {
      // Use direct llmQuery if provided in config
      if (this.config.llmQuery) {
        this.llmQuery = this.config.llmQuery;
      } else if (this.config.llmConfig) {
        // Otherwise create from llmConfig
        this.llmQuery = createLlmQuery(this.config.llmConfig);
      } else {
        throw new Error("Either llmConfig or llmQuery must be provided");
      }
      logger.debug("RLM Orchestrator", "Created/retrieved llm_query function");
    }
    return this.llmQuery;
  }

  /**
   * Initialize the persistent worker for reuse across iterations
   */
  private async initializeWorker(): Promise<void> {
    if (!this.worker) {
      const llmQuery = this.getLlmQuery();
      
      // Create sub_rlm executor that spawns fresh workers with isolated state
      // sub_rlm receives JavaScript code to execute in a fresh worker
      const subRlmExecutor = async (scriptCode: string) => {
        const freshWorker = this.createFreshWorker();
        try {
          const result = await freshWorker.execute(scriptCode);
          return {
            stdout: result.stdout,
            buffers: result.buffers,
            finalAnswer: result.finalAnswer,
          };
        } finally {
          freshWorker.terminate();
        }
      };
      
      this.worker = new BunWorkerSandbox({
        repo: this.repoApi,
        llmQuery,
        timeout: 30000,
        initialBuffers: { ...this.state.buffers },
        context: this.state.context,
        subRlmExecutor,
      });
      logger.debug("RLM Orchestrator", "Created persistent worker with sub_rlm support");
    }
  }

  /**
   * Create a fresh worker for sub_rlm calls (isolated state)
   */
  private createFreshWorker(): BunWorkerSandbox {
    const llmQuery = this.getLlmQuery();
    return new BunWorkerSandbox({
      repo: this.repoApi,
      llmQuery,
      timeout: 30000,
      initialBuffers: {}, // Fresh empty buffers
      context: this.state.context, // Same context but fresh buffers
    });
  }

  /**
   * Execute code in the REPL environment
   * Uses persistent worker for main loop
   * (Fresh workers for sub_rlm are handled via subRlmExecutor callback)
   */
  private async executeCode(code: string): Promise<RlmExecutionResult> {
    try {
      // Lazy load context on first execution
      if (!this.state.context) {
        logger.info("RLM Orchestrator", "Lazy loading repository content");
        this.state.context = await this.config.repoContentLoader();
        logger.info("RLM Orchestrator", "Repository content loaded", {
          contextLength: this.state.context.length,
        });
      }

      let result: WorkerExecutionResult;

      // Reuse persistent worker
      await this.initializeWorker();
      
      // Update worker with current buffers
      if (this.worker) {
        this.worker.setBuffers(this.state.buffers);
        result = await this.worker.execute(code);
        // Persist buffers back from worker
        this.state.buffers = this.worker.getBuffers();
      } else {
        throw new Error("Worker not initialized");
      }

      // Update state
      this.state.stdout = result.stdout;
      if (result.finalAnswer) {
        this.state.finalAnswer = result.finalAnswer;
      }

      return {
        returnValue: result.returnValue,
        stdout: result.stdout,
        buffers: this.state.buffers,
        finalAnswer: result.finalAnswer,
        error: result.error,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("RLM Orchestrator", "Script execution error", undefined, { errorMessage });
      
      return {
        returnValue: undefined,
        stdout: this.state.stdout,
        buffers: this.state.buffers,
        error: errorMessage,
      };
    }
  }

  /**
   * Generate metadata for current state (per paper Algorithm 1)
   * Only constant-size information, not full context
   */
  private generateMetadata(): RlmMetadata {
    const metadata: RlmMetadata = {
      iteration: this.state.iteration,
      stdoutPreview: this.state.stdout.slice(-this.config.stdoutPreviewLength),
      stdoutLength: this.state.stdout.length,
      bufferKeys: Object.keys(this.state.buffers),
      bufferSummary: Object.entries(this.state.buffers).map(([key, value]) => ({
        key,
        preview: String(value).slice(0, 200),
        size: String(value).length,
      })),
      errorFeedback: this.errorFeedback,
    };

    // Preserve last error for summary even after clearing errorFeedback
    if (this.errorFeedback) {
      this.lastError = this.errorFeedback;
    }

    // Clear error feedback after it's been used
    this.errorFeedback = undefined;

    return metadata;
  }

  /**
   * Format metadata for LLM prompt
   */
  private formatMetadata(metadata: RlmMetadata): string {
    const parts: string[] = [];
    parts.push(`Iteration: ${metadata.iteration}`);
    parts.push(`Output: ${metadata.stdoutPreview || "(none)"}`);
    
    if (metadata.bufferKeys.length > 0) {
      parts.push(`Buffers: ${metadata.bufferKeys.join(", ")}`);
    }
    
    if (metadata.errorFeedback) {
      parts.push(`Error: ${metadata.errorFeedback}`);
    }
    
    return parts.join("\n");
  }

  /**
   * Build the full history string for LLM
   * Includes all metadata from previous iterations (not full context)
   */
  private buildHistory(query: string): string {
    const historyParts: string[] = [];
    
    // Start with the initial query
    historyParts.push(`## Task\n${query}`);
    
    // Add all metadata from previous iterations
    for (const metadata of this.metadataHistory) {
      historyParts.push(this.formatMetadata(metadata));
    }
    
    return historyParts.join("\n\n---\n\n");
  }

  /**
   * Parse FINAL/FINAL_VAR signals from output
   */
  private parseFinalSignal(output: string): { finalAnswer?: string; cleanedStdout: string } {
    // Match FINAL(content) - can span multiple lines
    const finalMatch = output.match(/FINAL\(([\s\S]*?)\)/);
    // Match FINAL_VAR(bufferName)
    const finalVarMatch = output.match(/FINAL_VAR\((\w+)\)/);

    let finalAnswer: string | undefined;

    if (finalMatch && finalMatch[1]) {
      // FINAL(answer) - direct answer
      finalAnswer = finalMatch[1].trim();
    } else if (finalVarMatch && finalVarMatch[1]) {
      // FINAL_VAR(bufferName) - answer from buffer
      const bufferName = finalVarMatch[1];
      const bufferValue = this.state.buffers[bufferName];
      if (bufferValue !== undefined) {
        finalAnswer = String(bufferValue);
      } else {
        logger.warn("RLM Orchestrator", `FINAL_VAR referenced unknown buffer: ${bufferName}`);
        finalAnswer = `Error: Buffer '${bufferName}' not found`;
      }
    }

    // Clean FINAL/FINAL_VAR signals from stdout
    const cleanedStdout = output
      .replace(/FINAL\([\s\S]*?\)/g, "")
      .replace(/FINAL_VAR\(\w+\)/g, "")
      .trim();

    return { finalAnswer, cleanedStdout };
  }

  /**
   * Run the RLM orchestrator with the given query
   * Implements Algorithm 1 from the paper
   */
  async run(query: string): Promise<string> {
    const timingId = logger.timingStart("rlmOrchestrator");

    try {
      logger.info("RLM Orchestrator", "Starting RLM orchestrator", {
        queryLength: query.length,
        maxIterations: this.config.maxIterations,
      });

      // Initialize state
      this.state = {
        context: '',
        buffers: {},
        stdout: '',
        iteration: 0,
        finalAnswer: undefined,
      };
      this.metadataHistory = [];
      this.errorFeedback = undefined;

      // Main loop (Algorithm 1)
      while (this.state.iteration < this.config.maxIterations) {
        logger.info("RLM Orchestrator", `Iteration ${this.state.iteration + 1}`);

        // Build history for LLM (metadata only, not full context)
        const history = this.buildHistory(query);

        // Call LLM with history
        const llmQuery = this.getLlmQuery();
        let llmResponse: string;
        
        try {
          llmResponse = await llmQuery("Execute this code in the REPL", history);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error("RLM Orchestrator", "LLM query failed", undefined, { errorMessage });
          this.errorFeedback = `LLM Error: ${errorMessage}`;
          
          // Continue to next iteration with error feedback
          this.metadataHistory.push(this.generateMetadata());
          this.state.iteration++;
          continue;
        }

        logger.debug("RLM Orchestrator", "LLM response", {
          responseLength: llmResponse.length,
          responsePreview: llmResponse.slice(0, 200),
        });

        // Execute the code in REPL
        logger.debug("RLM Orchestrator", "About to execute code", {
          codeLength: llmResponse.length,
          codePreview: llmResponse.slice(0, 100),
        });
        const execResult = await this.executeCode(llmResponse);

        logger.debug("RLM Orchestrator", "Execution result", {
          stdoutLength: execResult.stdout.length,
          stdoutPreview: execResult.stdout.slice(0, 200),
          returnValue: execResult.returnValue,
          hasFinalAnswer: !!execResult.finalAnswer,
          finalAnswer: execResult.finalAnswer?.slice(0, 100),
        });

        // Check for execution errors
        if (execResult.error) {
          logger.warn("RLM Orchestrator", "Execution error", { error: execResult.error });
          this.errorFeedback = execResult.error;
        }

        // Check for FINAL/FINAL_VAR - first from execution result, then parse stdout
        let finalAnswer = execResult.finalAnswer;
        
        // If not set by execution, try parsing from stdout (handles case where LLM returns FINAL in string output)
        if (!finalAnswer && execResult.stdout) {
          const { finalAnswer: parsedFinal, cleanedStdout } = this.parseFinalSignal(execResult.stdout);
          finalAnswer = parsedFinal;
          // Update stdout to cleaned version (never use returnValue as stdout)
          this.state.stdout = cleanedStdout;
        }

        // Check for completion
        if (finalAnswer) {
          logger.info("RLM Orchestrator", "Completed with FINAL answer", {
            answerLength: finalAnswer.length,
            iterations: this.state.iteration + 1,
          });
          logger.timingEnd(timingId, "RLM Orchestrator", "Orchestrator completed");
          return finalAnswer;
        }

        // Add metadata to history
        this.metadataHistory.push(this.generateMetadata());
        this.state.iteration++;
      }

      // Max iterations reached
      logger.warn("RLM Orchestrator", "Max iterations reached", {
        iterations: this.state.iteration,
      });

      const summary = this.generateIterationSummary();
      logger.timingEnd(timingId, "RLM Orchestrator", "Max iterations");
      
      return `Max iterations (${this.config.maxIterations}) reached.\n\n${summary}`;
    } finally {
      // Cleanup persistent worker
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
    }
  }

  /**
   * Generate a summary of accumulated state (for fallback answer)
   */
  private generateIterationSummary(): string {
    const parts: string[] = ["=== Iteration Summary ==="];
    parts.push(`Total iterations: ${this.state.iteration}`);
    
    // Include error feedback if present (from lastError which is preserved)
    if (this.lastError) {
      parts.push(`\n=== Last Error ===\n${this.lastError}`);
    }
    
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
   * Get current state (for debugging/testing)
   */
  getState(): Readonly<RlmState> {
    return { ...this.state };
  }

  /**
   * Get metadata history (for debugging/testing)
   */
  getMetadataHistory(): readonly RlmMetadata[] {
    return [...this.metadataHistory];
  }
}
