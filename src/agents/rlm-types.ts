import type { FileSystemEntry, SearchMatch } from "../utils/format-utils.js";

export type LlmProviderType =
  | "openai"
  | "anthropic"
  | "google"
  | "openai-compatible"
  | "anthropic-compatible";

export interface LlmConfig {
  type: LlmProviderType;
  apiKey: string;
  model?: string | undefined;
  baseURL?: string | undefined;
}

export interface RepoListArgs {
  directoryPath?: string;
  includeHidden?: boolean;
  recursive?: boolean;
  maxDepth?: number;
}

export interface RepoViewArgs {
  filePath: string;
  viewRange?: [number, number];
}

export interface RepoFindArgs {
  searchPath?: string;
  patterns: string[];
  exclude?: string[];
  recursive?: boolean;
  maxResults?: number;
  includeHidden?: boolean;
}

export interface RepoGrepArgs {
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
}

export interface SandboxRepoApi {
  list: (args: RepoListArgs) => Promise<unknown>;
  view: (args: RepoViewArgs) => Promise<unknown>;
  find: (args: RepoFindArgs) => Promise<unknown>;
  grep: (args: RepoGrepArgs) => Promise<unknown>;
}

export interface RepoListResult {
  directory: string;
  totalEntries: number;
  entries: Array<{
    name: string;
    path: string;
    isDirectory: boolean;
    size?: number | undefined;
    lineCount?: number | undefined;
    depth?: number | undefined;
  }>;
}

export interface RepoViewResult {
  filePath: string;
  totalLines: number;
  viewRange: [number, number] | null;
  lines: Array<{
    lineNumber: number;
    content: string;
  }>;
  isEmpty?: boolean;
}

export interface RepoFindResult {
  totalFiles: number;
  patterns: string[];
  files: string[];
}

export interface RepoGrepResult {
  totalMatches: number;
  totalFiles: number;
  results: Array<{
    path: string;
    matches: Array<{
      line: number;
      column: number;
      text: string;
      contextBefore?: string[];
      contextAfter?: string[];
    }>;
  }>;
}

export interface RepoApi extends SandboxRepoApi {
  list: (args: RepoListArgs) => Promise<RepoListResult>;
  view: (args: RepoViewArgs) => Promise<RepoViewResult>;
  find: (args: RepoFindArgs) => Promise<RepoFindResult>;
  grep: (args: RepoGrepArgs) => Promise<RepoGrepResult>;
}

export interface EnvironmentErrorPayload {
  kind: "repo" | "runtime" | "timeout" | "llm" | "sub_rlm";
  code: string;
  message: string;
  operation?: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface EnvironmentVariableSummary {
  name: string;
  type: string;
  preview: string;
  size: number;
}

export interface EnvironmentMetadata {
  stdoutPreview: string;
  stdoutLength: number;
  variableCount: number;
  variables: EnvironmentVariableSummary[];
  bufferKeys: string[];
  finalSet: boolean;
  finalSource?: string | undefined;
  error?: EnvironmentErrorPayload | undefined;
}

export interface RootRepoMetadata {
  workingDir: string;
  targetLabel: string;
  repository?: string | undefined;
  branch?: string | undefined;
  outline: string;
  topLevelEntries: FileSystemEntry[];
}

export interface SubRlmRequest {
  prompt: string;
  context: string;
  rootHint?: string | undefined;
}

export interface RlmRunStats {
  rootIterations: number;
  subRlmCalls: number;
  subModelCalls: number;
  repoCalls: number;
  totalInputChars: number;
  totalOutputChars: number;
  finalSet: boolean;
  fallbackRecoveryUsed: boolean;
}

export interface SubRlmResult {
  finalAnswer: string;
  stats: RlmRunStats;
  error?: EnvironmentErrorPayload | undefined;
}

export interface WorkerExecutionResult {
  returnValue?: unknown;
  stdout: string;
  finalAnswer?: string | undefined;
  error?: EnvironmentErrorPayload | undefined;
  metadata: EnvironmentMetadata;
}

export interface WorkerSessionExecuteResult extends WorkerExecutionResult {
  variables: Record<string, unknown>;
  buffers: Record<string, unknown>;
}

export interface RepoSearchResult {
  path: string;
  matches: SearchMatch[];
}
