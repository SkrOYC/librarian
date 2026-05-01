import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  Codex,
  type CodexOptions,
  type ModelReasoningEffort,
  type ThreadEvent,
  type ThreadOptions,
} from "@openai/codex-sdk";
import type { AgentContext } from "./context-schema.js";

const CODEX_REASONING_EFFORTS: readonly ModelReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

interface CodexThread {
  runStreamed(input: string): Promise<{
    events: AsyncGenerator<ThreadEvent>;
  }>;
}

interface CodexClient {
  startThread(options?: ThreadOptions): CodexThread;
}

interface CodexProviderConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export interface CodexModelSelection {
  model?: string;
  modelReasoningEffort?: ModelReasoningEffort;
}

export interface CodexSdkTextStreamState {
  agentMessageTextById: Map<string, string>;
  hasEmittedText: boolean;
}

export interface CodexSdkRuntimeOptions {
  workingDir: string;
  query: string;
  systemPrompt: string;
  aiProvider: CodexProviderConfig;
  context?: AgentContext;
  clientFactory?: (options: CodexOptions) => CodexClient;
  runtimeFilesFactory?: (systemPrompt: string) => Promise<{
    tempDir: string;
    instructionsPath: string;
    codexHome: string;
  }>;
  cleanupRuntimeFiles?: (tempDir: string) => Promise<void>;
}

function isCodexReasoningEffort(value: string): value is ModelReasoningEffort {
  switch (value) {
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return true;
    default:
      return false;
  }
}

export function createCodexSdkTextStreamState(): CodexSdkTextStreamState {
  return { agentMessageTextById: new Map(), hasEmittedText: false };
}

export function parseCodexModelSelection(
  modelString: string | undefined
): CodexModelSelection {
  const trimmed = modelString?.trim();
  if (!trimmed) {
    return {};
  }

  const parts = trimmed.split(":");
  if (parts.length > 2) {
    throw new Error(
      `Invalid Codex model string "${modelString}". Expected "model" or "model:reasoning_effort".`
    );
  }

  const model = parts[0]?.trim();
  if (!model) {
    throw new Error(
      `Invalid Codex model string "${modelString}". Model name is required before the reasoning effort suffix.`
    );
  }

  const effort = parts[1]?.trim();
  if (parts.length === 1) {
    return { model };
  }

  if (!(effort && isCodexReasoningEffort(effort))) {
    throw new Error(
      `Invalid Codex reasoning effort "${parts[1] ?? ""}". Expected one of: ${CODEX_REASONING_EFFORTS.join(", ")}.`
    );
  }

  return { model, modelReasoningEffort: effort };
}

export function buildCodexSdkClientOptions(
  aiProvider: CodexProviderConfig,
  instructionsPath: string,
  codexHome: string
): CodexOptions {
  const baseUrl = aiProvider.baseURL?.trim();
  const codexPathOverride = resolveCodexPathOverride();

  return {
    ...(baseUrl ? { baseUrl } : {}),
    ...(codexPathOverride ? { codexPathOverride } : {}),
    env: buildCodexSdkEnv(codexHome),
    config: {
      model_instructions_file: instructionsPath,
      personality: "friendly",
      model_reasoning_summary: "none",
      model_verbosity: "high",
      notify: [],
      allow_login_shell: false,
      file_opener: "none",
      hide_agent_reasoning: true,
      show_raw_agent_reasoning: false,
      check_for_update_on_startup: false,
      sandbox_workspace_write: {
        network_access: false,
      },
      tools: {
        web_search: false,
      },
      mcp_servers: {},
      apps: {
        _default: {
          enabled: false,
          open_world_enabled: false,
        },
      },
      history: {
        persistence: "none",
      },
      tui: {
        notifications: false,
      },
    },
  };
}

function resolveCodexPathOverride(): string | undefined {
  const explicitPath =
    envValue("LIBRARIAN_CODEX_PATH") ?? envValue("CODEX_PATH");
  if (explicitPath) {
    return explicitPath;
  }

  // Standalone Bun/Nix builds cannot rely on the SDK's optional-package
  // resolver, so prefer the same system codex executable the user already runs.
  return findExecutableOnPath("codex");
}

function findExecutableOnPath(command: string): string | undefined {
  const pathEnv = envValue("PATH");
  if (!pathEnv) {
    return undefined;
  }

  const names =
    process.platform === "win32" ? [`${command}.exe`, command] : [command];
  for (const directory of pathEnv.split(path.delimiter)) {
    if (!directory) {
      continue;
    }

    for (const name of names) {
      const candidate = path.join(directory, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

export function buildCodexThreadOptions(
  aiProvider: CodexProviderConfig,
  workingDirectory: string
): ThreadOptions {
  const modelSelection = parseCodexModelSelection(aiProvider.model);

  return {
    workingDirectory,
    skipGitRepoCheck: true,
    sandboxMode: "read-only",
    approvalPolicy: "untrusted",
    networkAccessEnabled: false,
    webSearchMode: "disabled",
    webSearchEnabled: false,
    ...modelSelection,
  };
}

function agentMessageDelta(
  id: string,
  text: string,
  state: CodexSdkTextStreamState
): string | null {
  const hasSeenMessage = state.agentMessageTextById.has(id);
  const previousText = state.agentMessageTextById.get(id) ?? "";
  state.agentMessageTextById.set(id, text);

  if (!text || text === previousText) {
    return null;
  }

  if (previousText && text.startsWith(previousText)) {
    const delta = text.slice(previousText.length);
    state.hasEmittedText = true;
    return delta;
  }

  const separator = state.hasEmittedText && !hasSeenMessage ? "\n" : "";
  state.hasEmittedText = true;
  return `${separator}${text}`;
}

export function codexSdkEventText(
  event: ThreadEvent,
  state: CodexSdkTextStreamState = createCodexSdkTextStreamState()
): string | null {
  if (
    (event.type === "item.started" ||
      event.type === "item.updated" ||
      event.type === "item.completed") &&
    event.item.type === "agent_message" &&
    event.item.text
  ) {
    return agentMessageDelta(event.item.id, event.item.text, state);
  }

  if (event.type === "turn.failed") {
    throw new Error(`Codex SDK turn failed: ${event.error.message}`);
  }

  if (event.type === "error") {
    throw new Error(`Codex SDK stream failed: ${event.message}`);
  }

  return null;
}

function envValue(key: string): string | undefined {
  const value = Bun.env[key];
  return value ? value : undefined;
}

export function buildCodexSdkEnv(codexHome: string): Record<string, string> {
  const env: Record<string, string> = {
    CODEX_HOME: codexHome,
    NO_COLOR: "1",
  };

  for (const key of [
    "PATH",
    "HOME",
    "SHELL",
    "USER",
    "LOGNAME",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "TERM",
    "SSL_CERT_FILE",
    "NIX_SSL_CERT_FILE",
    "GIT_SSL_CAINFO",
  ]) {
    const value = envValue(key);
    if (value) {
      env[key] = value;
    }
  }

  return env;
}

async function copyCodexAuth(codexHome: string): Promise<void> {
  const sourceCodexHome =
    envValue("CODEX_HOME") ?? path.join(os.homedir(), ".codex");
  const sourceAuthPath = path.join(sourceCodexHome, "auth.json");
  const targetAuthPath = path.join(codexHome, "auth.json");

  if (!(await Bun.file(sourceAuthPath).exists())) {
    throw new Error(
      `Codex auth file not found at ${sourceAuthPath}. Run "codex" locally to authenticate before using the codex-sdk provider.`
    );
  }

  await copyFile(sourceAuthPath, targetAuthPath);
}

export async function createCodexRuntimeFiles(
  systemPrompt: string
): Promise<{ tempDir: string; instructionsPath: string; codexHome: string }> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "librarian-codex-sdk-"));
  const instructionsPath = path.join(tempDir, "instructions.md");
  const codexHome = path.join(tempDir, ".codex-home");

  try {
    await mkdir(codexHome, { recursive: true });
    await Bun.write(instructionsPath, systemPrompt);
    await copyCodexAuth(codexHome);
  } catch (error) {
    // Cleanup must happen here because streamCodexSdk's finally block is not
    // installed until this setup function resolves.
    await cleanupCodexRuntimeFiles(tempDir);
    throw error;
  }

  return { tempDir, instructionsPath, codexHome };
}

export async function cleanupCodexRuntimeFiles(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true });
}

export async function* streamCodexSdk(
  options: CodexSdkRuntimeOptions
): AsyncGenerator<string, void, unknown> {
  const workingDir = options.context?.workingDir || options.workingDir;
  const runtimeFilesFactory =
    options.runtimeFilesFactory ?? createCodexRuntimeFiles;
  const cleanupRuntimeFiles =
    options.cleanupRuntimeFiles ?? cleanupCodexRuntimeFiles;
  const { tempDir, instructionsPath, codexHome } = await runtimeFilesFactory(
    options.systemPrompt
  );

  try {
    const clientOptions = buildCodexSdkClientOptions(
      options.aiProvider,
      instructionsPath,
      codexHome
    );
    const threadOptions = buildCodexThreadOptions(
      options.aiProvider,
      workingDir
    );
    const client = options.clientFactory
      ? options.clientFactory(clientOptions)
      : new Codex(clientOptions);
    const thread = client.startThread(threadOptions);
    const { events } = await thread.runStreamed(options.query);
    const textState = createCodexSdkTextStreamState();
    for await (const event of events) {
      const text = codexSdkEventText(event, textState);
      if (text) {
        yield text;
      }
    }
  } finally {
    await cleanupRuntimeFiles(tempDir);
  }
}
