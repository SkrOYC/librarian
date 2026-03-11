import { logger } from "../utils/logger.js";
import { createRootModelQuery, createSubModelQuery, createRepoApi } from "./rlm-sandbox.js";
import type {
  EnvironmentMetadata,
  LlmConfig,
  RepoApi,
  RlmRunStats,
  RootRepoMetadata,
  SubRlmRequest,
  SubRlmResult,
} from "./rlm-types.js";
import { PersistentWorkerSession } from "./rlm-worker-sandbox.js";

export interface RlmOrchestratorConfig {
  llmConfig?: LlmConfig | undefined;
  llmQuery?: ((instruction: string, data: string) => Promise<string>) | undefined;
  rootModelQuery?: ((history: string) => Promise<string>) | undefined;
  subModelQuery?: ((instruction: string, data: string) => Promise<string>) | undefined;
  workingDir: string;
  rootMetadataLoader: () => Promise<RootRepoMetadata>;
  maxIterations?: number | undefined;
  stdoutPreviewLength?: number | undefined;
  systemPrompt: string;
  initialContext?: string | undefined;
  rootHint?: string | undefined;
}

export interface RlmMetadata {
  iteration: number;
  environment: EnvironmentMetadata;
  errorFeedback?: string | undefined;
  hasContext: boolean;
}

export interface RlmRunResult {
  answer: string;
  stats: RlmRunStats;
  metadataHistory: RlmMetadata[];
}

export class RlmOrchestrator {
  private readonly config: Required<
    Pick<RlmOrchestratorConfig, "maxIterations" | "stdoutPreviewLength" | "systemPrompt">
  > &
    Omit<RlmOrchestratorConfig, "maxIterations" | "stdoutPreviewLength" | "systemPrompt">;
  private readonly repoApi: RepoApi;
  private session: PersistentWorkerSession | null = null;
  private metadataHistory: RlmMetadata[] = [];
  private rootMetadata: RootRepoMetadata | undefined;
  private lastError: string | undefined;
  private stats: RlmRunStats = this.createEmptyStats();
  private rootModelQuery: ((history: string) => Promise<string>) | undefined;
  private subModelQuery:
    | ((instruction: string, data: string) => Promise<string>)
    | undefined;

  constructor(config: RlmOrchestratorConfig) {
    this.config = {
      maxIterations: 10,
      stdoutPreviewLength: 2000,
      ...config,
    };

    this.repoApi = createRepoApi(config.workingDir, () => {
      this.stats.repoCalls += 1;
    });
  }

  private createEmptyStats(): RlmRunStats {
    return {
      rootIterations: 0,
      subRlmCalls: 0,
      subModelCalls: 0,
      repoCalls: 0,
      totalInputChars: 0,
      totalOutputChars: 0,
      finalSet: false,
      fallbackRecoveryUsed: false,
    };
  }

  private getRootModelQuery(): (history: string) => Promise<string> {
    if (this.rootModelQuery) {
      return this.rootModelQuery;
    }

    if (this.config.llmQuery) {
      this.rootModelQuery = async (history) => {
        this.stats.totalInputChars += history.length;
        const text = await this.config.llmQuery!("Execute this code in the REPL", history);
        this.stats.totalOutputChars += text.length;
        return text;
      };
      return this.rootModelQuery;
    }

    if (this.config.rootModelQuery) {
      this.rootModelQuery = async (history) => {
        this.stats.totalInputChars += history.length;
        const text = await this.config.rootModelQuery!(history);
        this.stats.totalOutputChars += text.length;
        return text;
      };
      return this.rootModelQuery;
    }

    if (!this.config.llmConfig) {
      throw new Error("RLM orchestrator requires either llmConfig or rootModelQuery");
    }

    this.rootModelQuery = createRootModelQuery(
      this.config.llmConfig,
      this.config.systemPrompt,
      (inputChars, outputChars) => {
        this.stats.totalInputChars += inputChars;
        this.stats.totalOutputChars += outputChars;
      },
    );
    return this.rootModelQuery;
  }

  private getSubModelQuery(): (instruction: string, data: string) => Promise<string> {
    if (this.subModelQuery) {
      return this.subModelQuery;
    }

    if (this.config.llmQuery) {
      this.subModelQuery = async (instruction, data) => {
        this.stats.subModelCalls += 1;
        this.stats.totalInputChars += instruction.length + data.length;
        const text = await this.config.llmQuery!(instruction, data);
        this.stats.totalOutputChars += text.length;
        return text;
      };
      return this.subModelQuery;
    }

    if (this.config.subModelQuery) {
      this.subModelQuery = async (instruction, data) => {
        this.stats.subModelCalls += 1;
        this.stats.totalInputChars += instruction.length + data.length;
        const text = await this.config.subModelQuery!(instruction, data);
        this.stats.totalOutputChars += text.length;
        return text;
      };
      return this.subModelQuery;
    }

    if (!this.config.llmConfig) {
      throw new Error("RLM orchestrator requires either llmConfig or subModelQuery");
    }

    this.subModelQuery = createSubModelQuery(
      this.config.llmConfig,
      undefined,
      (inputChars, outputChars) => {
        this.stats.subModelCalls += 1;
        this.stats.totalInputChars += inputChars;
        this.stats.totalOutputChars += outputChars;
      },
    );
    return this.subModelQuery;
  }

  private async ensureRootMetadata(): Promise<RootRepoMetadata> {
    if (!this.rootMetadata) {
      if (this.config.rootMetadataLoader) {
        this.rootMetadata = await this.config.rootMetadataLoader();
      } else {
        this.rootMetadata = {
          workingDir: this.config.workingDir,
          targetLabel: this.config.workingDir,
          outline: "(outline unavailable)",
          topLevelEntries: [],
        };
      }
    }
    return this.rootMetadata;
  }

  private async ensureSession(): Promise<PersistentWorkerSession> {
    if (this.session) {
      return this.session;
    }

    this.session = new PersistentWorkerSession({
      repo: this.repoApi,
      llmQuery: this.getSubModelQuery(),
      context: this.config.initialContext,
      subRlmExecutor: (task) => this.runChild(task),
    });

    return this.session;
  }

  private formatEnvironment(environment: EnvironmentMetadata): string {
    const parts: string[] = [];
    parts.push(`stdout: ${environment.stdoutPreview || "(empty)"}`);
    parts.push(`stdout_length: ${environment.stdoutLength}`);

    if (environment.variableCount > 0) {
      parts.push(
        `variables: ${environment.variables
          .map((variable) => `${variable.name}(${variable.type})`)
          .join(", ")}`,
      );
    } else {
      parts.push("variables: (none)");
    }

    if (environment.error) {
      parts.push(`error: ${environment.error.message}`);
    }

    if (environment.finalSet) {
      parts.push("final_set: true");
    }

    return parts.join("\n");
  }

  private buildHistory(query: string): string {
    if (!this.rootMetadata) {
      throw new Error("Root metadata must be loaded before building history");
    }

    const parts = [
      `Task:\n${query}`,
      `Repository metadata:\nTarget: ${this.rootMetadata.targetLabel}\nWorking directory: ${this.rootMetadata.workingDir}\n${this.rootMetadata.repository ? `Repository: ${this.rootMetadata.repository}\n` : ""}${this.rootMetadata.branch ? `Branch: ${this.rootMetadata.branch}\n` : ""}Outline:\n${this.rootMetadata.outline}`,
    ];

    if (this.config.initialContext) {
      parts.push(
        `Active context variable:\nLength: ${this.config.initialContext.length}\n${this.config.rootHint ? `Hint: ${this.config.rootHint}\n` : ""}The full context is available in the REPL variable \`context\`. Do not ask for a repo preload.`,
      );
    }

    if (this.metadataHistory.length > 0) {
      parts.push(
        this.metadataHistory
          .map(
            (entry) =>
              `Iteration ${entry.iteration}\n${this.formatEnvironment(entry.environment)}${entry.errorFeedback ? `\nfeedback: ${entry.errorFeedback}` : ""}`,
          )
          .join("\n\n---\n\n"),
      );
    }

    const maxIterations = this.config.maxIterations ?? 10;
    const remainingIterations = maxIterations - this.stats.rootIterations;
    if (remainingIterations <= 5) {
      parts.push(
        `Guardrail: only ${remainingIterations} root iteration(s) remain. Set FINAL() or FINAL_VAR() when the answer is ready.`,
      );
    }

    return parts.join("\n\n---\n\n");
  }

  private extractCodeFromResponse(response: string): string {
    const replMatch = response.match(/```repl\\s*([\\s\\S]*?)```/);
    if (replMatch?.[1]) {
      return replMatch[1].trim();
    }

    const jsMatch = response.match(/```(?:javascript|js|ts|typescript)\\s*([\\s\\S]*?)```/);
    if (jsMatch?.[1]) {
      return jsMatch[1].trim();
    }

    return response.trim();
  }

  private async runChild(task: SubRlmRequest): Promise<SubRlmResult> {
    this.stats.subRlmCalls += 1;

    const child = new RlmOrchestrator({
      workingDir: this.config.workingDir,
      rootMetadataLoader: async () => await this.ensureRootMetadata(),
      maxIterations: this.config.maxIterations,
      stdoutPreviewLength: this.config.stdoutPreviewLength,
      systemPrompt: this.config.systemPrompt,
      ...(this.config.llmConfig ? { llmConfig: this.config.llmConfig } : {}),
      ...(this.config.llmQuery ? { llmQuery: this.config.llmQuery } : {}),
      ...(this.config.rootModelQuery
        ? { rootModelQuery: this.config.rootModelQuery }
        : {}),
      ...(this.config.subModelQuery
        ? { subModelQuery: this.config.subModelQuery }
        : {}),
      initialContext: task.context,
      ...(task.rootHint ? { rootHint: task.rootHint } : {}),
    });

    const childResult = await child.runDetailed(task.prompt);
    this.stats.subModelCalls += childResult.stats.subModelCalls;
    this.stats.repoCalls += childResult.stats.repoCalls;
    this.stats.totalInputChars += childResult.stats.totalInputChars;
    this.stats.totalOutputChars += childResult.stats.totalOutputChars;

    return {
      finalAnswer: childResult.answer,
      stats: childResult.stats,
    };
  }

  private async recoverFinalAnswer(query: string): Promise<string> {
    this.stats.fallbackRecoveryUsed = true;
    const recoveryInput = [
      `Original query:\n${query}`,
      this.metadataHistory
        .map(
          (entry) =>
            `Iteration ${entry.iteration}\n${this.formatEnvironment(entry.environment)}${entry.errorFeedback ? `\nfeedback: ${entry.errorFeedback}` : ""}`,
        )
        .join("\n\n---\n\n"),
    ].join("\n\n");

    if (
      this.config.llmQuery &&
      !this.config.subModelQuery &&
      !this.config.llmConfig
    ) {
      return `RLM reached max iterations without FINAL(). Last known metadata:\n\n${recoveryInput}`;
    }

    try {
      return await this.getSubModelQuery()(
        "Recover the best final answer from the environment metadata. Respond with the answer only.",
        recoveryInput,
      );
    } catch (error) {
      logger.warn("RLM", "Fallback recovery failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      return `RLM reached max iterations without FINAL(). Last known metadata:\n\n${recoveryInput}`;
    }
  }

  async runDetailed(query: string): Promise<RlmRunResult> {
    const timingId = logger.timingStart("rlmOrchestrator");
    this.metadataHistory = [];
    this.lastError = undefined;
    this.stats = this.createEmptyStats();

    const rootMetadata = await this.ensureRootMetadata();
    logger.info("RLM", "Starting RLM orchestrator", {
      workingDir: rootMetadata.workingDir,
      target: rootMetadata.targetLabel,
      maxIterations: this.config.maxIterations,
      hasInitialContext: !!this.config.initialContext,
    });

    try {
      const maxIterations = this.config.maxIterations ?? 10;
      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        const history = this.buildHistory(query);
        let codeResponse: string;
        try {
          codeResponse = await this.getRootModelQuery()(history);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.lastError = message;
          this.metadataHistory.push({
            iteration,
            environment: {
              stdoutPreview: "",
              stdoutLength: 0,
              variableCount: 0,
              variables: [],
              bufferKeys: [],
              finalSet: false,
              error: {
                kind: "llm",
                code: "ROOT_MODEL_QUERY_FAILED",
                message,
              },
            },
            errorFeedback: message,
            hasContext: !!this.config.initialContext,
          });
          this.stats.rootIterations += 1;
          continue;
        }
        const code = this.extractCodeFromResponse(codeResponse);
        const session = await this.ensureSession();
        const executionResult = await session.execute(code);

        this.stats.rootIterations += 1;
        this.metadataHistory.push({
          iteration,
          environment: executionResult.metadata,
          errorFeedback: executionResult.error?.message,
          hasContext: !!this.config.initialContext,
        });

        if (executionResult.error) {
          this.lastError = executionResult.error.message;
          logger.warn("RLM", "Iteration execution error", {
            iteration,
            error: executionResult.error.message,
          });
        }

        if (executionResult.finalAnswer) {
          this.stats.finalSet = true;
          logger.timingEnd(timingId, "RLM", "Orchestrator completed");
          return {
            answer: executionResult.finalAnswer,
            stats: { ...this.stats },
            metadataHistory: [...this.metadataHistory],
          };
        }
      }

      const recovered = await this.recoverFinalAnswer(query);
      logger.timingEnd(timingId, "RLM", "Orchestrator recovered");

      return {
        answer: recovered,
        stats: { ...this.stats },
        metadataHistory: [...this.metadataHistory],
      };
    } finally {
      this.session?.terminate();
      this.session = null;
    }
  }

  async run(query: string): Promise<string> {
    const result = await this.runDetailed(query);
    return result.answer;
  }

  getMetadataHistory(): readonly RlmMetadata[] {
    return [...this.metadataHistory];
  }

  getLastError(): string | undefined {
    return this.lastError;
  }
}
