import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import { findTool } from "../tools/file-finding.tool.js";
import { listTool } from "../tools/file-listing.tool.js";
import { viewTool } from "../tools/file-reading.tool.js";
import { grepTool } from "../tools/grep-content.tool.js";
import { logger } from "../utils/logger.js";
import { SUB_AGENT_SYSTEM_PROMPT } from "./rlm-prompts.js";
import type {
  EnvironmentErrorPayload,
  EnvironmentMetadata,
  LlmConfig,
  LlmProviderType,
  RepoApi,
  RepoFindArgs,
  RepoFindResult,
  RepoGrepArgs,
  RepoGrepResult,
  RepoListArgs,
  RepoListResult,
  RepoViewArgs,
  RepoViewResult,
} from "./rlm-types.js";
import { PersistentWorkerSession } from "./rlm-worker-sandbox.js";

export type { LlmConfig, LlmProviderType, RepoApi } from "./rlm-types.js";

export interface RlmExecutionContext {
  context?: string | undefined;
  buffers?: Record<string, unknown> | undefined;
  onPrint?: ((output: string) => void) | undefined;
  onFinal?: ((answer: string) => void) | undefined;
}

export interface RlmExecutionResult {
  returnValue?: unknown;
  stdout: string;
  buffers: Record<string, unknown>;
  finalAnswer?: string | undefined;
  error?: string | undefined;
  metadata: EnvironmentMetadata;
}

function createErrorPayload(
  kind: EnvironmentErrorPayload["kind"],
  code: string,
  message: string,
  details?: Record<string, unknown>,
): EnvironmentErrorPayload {
  return {
    kind,
    code,
    message,
    ...(details ? { details } : {}),
  };
}

function getDefaultModel(config: LlmConfig): string {
  switch (config.type) {
    case "openai":
    case "openai-compatible":
      return "gpt-5";
    case "anthropic":
    case "anthropic-compatible":
      return "claude-sonnet-4-5";
    case "google":
      return "gemini-2.5-flash";
  }
}

function validateLanguageModelConfig(config: LlmConfig): void {
  if (config.type === "openai-compatible" && !config.baseURL) {
    throw new Error("baseURL is required for openai-compatible provider");
  }

  if (config.type === "anthropic-compatible") {
    if (!config.baseURL) {
      throw new Error("baseURL is required for anthropic-compatible provider");
    }

    if (!config.model) {
      throw new Error("model is required for anthropic-compatible provider");
    }
  }
}

function createLanguageModel(config: LlmConfig) {
  validateLanguageModelConfig(config);
  const modelId = config.model || getDefaultModel(config);

  switch (config.type) {
    case "openai": {
      const provider = createOpenAI({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      });
      return provider(modelId);
    }
    case "openai-compatible": {
      const baseURL = config.baseURL;
      if (!baseURL) {
        throw new Error("baseURL is required for openai-compatible provider");
      }
      const provider = createOpenAICompatible({
        name: "openai-compatible",
        apiKey: config.apiKey,
        baseURL,
      });
      return provider(modelId);
    }
    case "anthropic": {
      const provider = createAnthropic({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      });
      return provider(modelId);
    }
    case "anthropic-compatible": {
      const baseURL = config.baseURL;
      if (!baseURL) {
        throw new Error("baseURL is required for anthropic-compatible provider");
      }
      const provider = createAnthropic({
        apiKey: config.apiKey,
        baseURL,
      });
      return provider(modelId);
    }
    case "google": {
      const provider = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      });
      return provider(modelId);
    }
  }
}

async function runGenerateText(
  config: LlmConfig,
  systemPrompt: string,
  prompt: string,
): Promise<string> {
  const model = createLanguageModel(config);
  const { text } = await generateText({
    model,
    system: systemPrompt,
    prompt,
  });

  return text;
}

export function createRootModelQuery(
  config: LlmConfig,
  systemPrompt: string,
  onUsage?: (inputChars: number, outputChars: number) => void,
): (history: string) => Promise<string> {
  return async (history: string): Promise<string> => {
    logger.debug("LLM", "Root model query", {
      provider: config.type,
      model: config.model || getDefaultModel(config),
      historyLength: history.length,
    });

    const text = await runGenerateText(config, systemPrompt, history);
    onUsage?.(history.length, text.length);
    return text;
  };
}

export function createSubModelQuery(
  config: LlmConfig,
  systemPrompt = SUB_AGENT_SYSTEM_PROMPT,
  onUsage?: (inputChars: number, outputChars: number) => void,
): (instruction: string, data: string) => Promise<string> {
  return async (instruction: string, data: string): Promise<string> => {
    const prompt = `Instruction:\n${instruction}\n\nData:\n${data}`;

    logger.debug("LLM", "Sub model query", {
      provider: config.type,
      model: config.model || getDefaultModel(config),
      instructionLength: instruction.length,
      dataLength: data.length,
    });

    const text = await runGenerateText(config, systemPrompt, prompt);
    onUsage?.(prompt.length, text.length);
    return text;
  };
}

export function createLlmQuery(
  config: LlmConfig & { systemPrompt?: string },
): (instruction: string, data: string) => Promise<string> {
  return createSubModelQuery(
    config,
    config.systemPrompt || SUB_AGENT_SYSTEM_PROMPT,
  );
}

function normalizeToolContext(workingDir: string) {
  return {
    context: {
      workingDir,
      group: "",
      technology: "",
    },
  };
}

function parseToolResponse<T>(
  rawResult: string,
  operation: string,
): T {
  try {
    const parsed = JSON.parse(rawResult) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof parsed.error === "string"
    ) {
      throw createErrorPayload(
        "repo",
        "REPO_TOOL_ERROR",
        typeof parsed.message === "string" ? parsed.message : parsed.error,
        {
          operation,
          toolError: parsed.error,
        },
      );
    }

    return parsed as T;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "kind" in error &&
      "code" in error
    ) {
      throw error;
    }

    throw createErrorPayload(
      "repo",
      "REPO_TOOL_PARSE_FAILED",
      rawResult,
      { operation },
    );
  }
}

export function createRepoApi(
  workingDir: string,
  onRepoCall?: () => void,
): RepoApi {
  const toolConfig = normalizeToolContext(workingDir);

  return {
    async list(args: RepoListArgs): Promise<RepoListResult> {
      onRepoCall?.();
      const result = await listTool.invoke(
        {
          directoryPath: args.directoryPath ?? ".",
          includeHidden: args.includeHidden ?? false,
          recursive: args.recursive ?? false,
          maxDepth: args.maxDepth ?? 1,
        },
        toolConfig,
      );
      return parseToolResponse<RepoListResult>(result, "list");
    },

    async view(args: RepoViewArgs): Promise<RepoViewResult> {
      onRepoCall?.();
      const result = await viewTool.invoke(
        {
          filePath: args.filePath,
          viewRange: args.viewRange,
        },
        toolConfig,
      );
      return parseToolResponse<RepoViewResult>(result, "view");
    },

    async find(args: RepoFindArgs): Promise<RepoFindResult> {
      onRepoCall?.();
      const result = await findTool.invoke(
        {
          searchPath: args.searchPath ?? ".",
          patterns: args.patterns,
          exclude: args.exclude ?? [],
          recursive: args.recursive ?? true,
          maxResults: args.maxResults ?? 100,
          includeHidden: args.includeHidden ?? false,
        },
        toolConfig,
      );
      return parseToolResponse<RepoFindResult>(result, "find");
    },

    async grep(args: RepoGrepArgs): Promise<RepoGrepResult> {
      onRepoCall?.();
      const result = await grepTool.invoke(
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
        toolConfig,
      );
      return parseToolResponse<RepoGrepResult>(result, "grep");
    },
  };
}

export async function executeRlmScript(
  script: string,
  repo: RepoApi,
  llmQuery: (instruction: string, data: string) => Promise<string>,
  executionContext?: RlmExecutionContext,
): Promise<RlmExecutionResult> {
  const session = new PersistentWorkerSession({
    repo,
    llmQuery,
    ...(executionContext?.buffers
      ? { initialBuffers: executionContext.buffers }
      : {}),
    ...(executionContext?.context
      ? { context: executionContext.context }
      : {}),
  });

  try {
    const result = await session.execute(script);

    if (executionContext?.onPrint && result.stdout) {
      for (const line of result.stdout.split("\n")) {
        if (line) {
          executionContext.onPrint(line);
        }
      }
    }

    if (executionContext?.onFinal && result.finalAnswer) {
      executionContext.onFinal(result.finalAnswer);
    }

    if (result.returnValue !== undefined) {
      result.buffers.__returnValue = result.returnValue;
    }

    return {
      ...(result.returnValue !== undefined
        ? { returnValue: result.returnValue }
        : {}),
      stdout: result.stdout,
      buffers: result.buffers,
      ...(result.finalAnswer !== undefined
        ? { finalAnswer: result.finalAnswer }
        : {}),
      ...(result.error ? { error: result.error.message } : {}),
      metadata: result.metadata,
    };
  } finally {
    session.terminate();
  }
}
