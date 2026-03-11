import { logger } from "../utils/logger.js";
import { transformReplScript } from "./repl-script-transform.js";
import type {
  EnvironmentErrorPayload,
  EnvironmentMetadata,
  SandboxRepoApi,
  SubRlmRequest,
  SubRlmResult,
  WorkerSessionExecuteResult,
} from "./rlm-types.js";

export interface PersistentWorkerSessionConfig {
  repo: SandboxRepoApi;
  llmQuery: (instruction: string, data: string) => Promise<string>;
  timeout?: number;
  initialBuffers?: Record<string, unknown> | undefined;
  context?: string | undefined;
  subRlmExecutor?: ((task: SubRlmRequest) => Promise<SubRlmResult>) | undefined;
}

type WorkerMessage =
  | {
      type: "execute";
      requestId: string;
      script: string;
      buffers: Record<string, unknown>;
      context?: string;
      iteration: number;
    }
  | { type: "ready" }
  | {
      type: "result";
      requestId: string;
      returnValue?: unknown;
      stdout: string;
      buffers: Record<string, unknown>;
      variables: Record<string, unknown>;
      finalAnswer?: string;
      error?: EnvironmentErrorPayload;
      metadata: EnvironmentMetadata;
    }
  | {
      type: "repo_call";
      requestId: string;
      method: keyof SandboxRepoApi;
      args: unknown;
    }
  | { type: "repo_result"; requestId: string; result: unknown }
  | {
      type: "repo_error";
      requestId: string;
      error: EnvironmentErrorPayload;
    }
  | {
      type: "llm_query_call";
      requestId: string;
      instruction: string;
      data: string;
    }
  | { type: "llm_query_result"; requestId: string; result: string }
  | {
      type: "llm_query_error";
      requestId: string;
      error: EnvironmentErrorPayload;
    }
  | {
      type: "sub_rlm_call";
      requestId: string;
      task: SubRlmRequest;
    }
  | {
      type: "sub_rlm_result";
      requestId: string;
      result?: SubRlmResult;
      error?: EnvironmentErrorPayload;
    };

const WORKER_CODE = `
const safeGlobals = {
  JSON,
  Math,
  Map,
  Set,
  WeakMap,
  WeakSet,
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
  chunk: (data, size) => {
    const str = String(data);
    const chunks = [];
    for (let i = 0; i < str.length; i += size) {
      chunks.push(str.slice(i, i + size));
    }
    return chunks;
  },
  batch: (items, size) => {
    const batches = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return batches;
  },
};

const process = undefined;
const require = undefined;
const Buffer = undefined;
const fetch = undefined;
const XMLHttpRequest = undefined;
const child_process = undefined;
const fs = undefined;
const http = undefined;
const https = undefined;
const net = undefined;
const tls = undefined;
const setImmediate = undefined;
const setInterval = undefined;
const clearImmediate = undefined;
const clearInterval = undefined;
const queueMicrotask = undefined;

Object.assign(globalThis, safeGlobals);

const blockedGlobalKeys = [
  "process",
  "require",
  "Buffer",
  "fetch",
  "XMLHttpRequest",
  "child_process",
  "fs",
  "http",
  "https",
  "net",
  "tls",
  "setImmediate",
  "setInterval",
  "clearImmediate",
  "clearInterval",
  "queueMicrotask",
  "module",
  "__dirname",
  "__filename",
];

for (const key of blockedGlobalKeys) {
  try {
    globalThis[key] = undefined;
  } catch {
    // Ignore read-only globals and rely on scope shadowing below.
  }
}

const pendingCalls = new Map();
const replBindings = Object.create(null);
const reservedBindingKeys = new Set([
  "buffers",
  "context",
  "__iteration__",
  "print",
  "FINAL",
  "FINAL_VAR",
  "repo",
  "llm_query",
  "sub_rlm",
]);

let currentBuffers = {};
let currentContext = "";
let currentFinalAnswer = undefined;
let currentStdout = [];
let currentError = undefined;

const console = {
  log: (...args) => {
    const output = args.map((arg) => String(arg)).join(" ");
    currentStdout.push(output);
  },
  info: (...args) => {
    const output = args.map((arg) => String(arg)).join(" ");
    currentStdout.push(output);
  },
  warn: (...args) => {
    const output = args.map((arg) => String(arg)).join(" ");
    currentStdout.push(output);
  },
  error: (...args) => {
    const output = args.map((arg) => String(arg)).join(" ");
    currentStdout.push(output);
  },
};
globalThis.console = console;

const scopeProxy = new Proxy(replBindings, {
  has(_target, key) {
    return key !== Symbol.unscopables;
  },
  get(target, key) {
    if (key === Symbol.unscopables) {
      return undefined;
    }
    if (key in target) {
      return target[key];
    }
    return globalThis[key];
  },
  set(target, key, value) {
    target[key] = value;
    return true;
  },
  deleteProperty(target, key) {
    delete target[key];
    return true;
  },
});

function generateRequestId() {
  return Math.random().toString(36).slice(2, 15);
}

function createErrorPayload(kind, code, message, details) {
  return {
    kind,
    code,
    message,
    ...(details ? { details } : {}),
  };
}

function sanitizeValue(value) {
  if (typeof value === "function") {
    return "[Function]";
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value === undefined) {
    return "[Undefined]";
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function summarizeValue(name, value) {
  const serialized = sanitizeValue(value);
  const preview = typeof serialized === "string"
    ? serialized.slice(0, 200)
    : JSON.stringify(serialized).slice(0, 200);

  return {
    name,
    type: Array.isArray(value) ? "array" : typeof value,
    preview,
    size: typeof serialized === "string"
      ? serialized.length
      : JSON.stringify(serialized).length,
  };
}

function getSerializableBindings() {
  const result = {};
  for (const [key, value] of Object.entries(replBindings)) {
    if (reservedBindingKeys.has(key)) {
      continue;
    }
    result[key] = sanitizeValue(value);
  }
  return result;
}

function getEnvironmentMetadata() {
  const variableEntries = Object.entries(replBindings)
    .filter(([key]) => !reservedBindingKeys.has(key))
    .map(([key, value]) => summarizeValue(key, value));

  return {
    stdoutPreview: currentStdout.join("\\n").slice(-2000),
    stdoutLength: currentStdout.join("\\n").length,
    variableCount: variableEntries.length,
    variables: variableEntries,
    bufferKeys: Object.keys(currentBuffers),
    finalSet: currentFinalAnswer !== undefined,
    ...(currentFinalAnswer !== undefined ? { finalSource: "environment" } : {}),
    ...(currentError ? { error: currentError } : {}),
  };
}

async function callMain(message) {
  const requestId = generateRequestId();
  postMessage({ ...message, requestId });

  return await new Promise((resolve, reject) => {
    pendingCalls.set(requestId, { resolve, reject });
  });
}

function wireEnvironment(iteration) {
  replBindings.buffers = currentBuffers;
  replBindings.context = currentContext;
  replBindings.__iteration__ = iteration;
  for (const key of blockedGlobalKeys) {
    replBindings[key] = undefined;
  }

  replBindings.print = (...args) => {
    const output = args.map((arg) => String(arg)).join(" ");
    currentStdout.push(output);
    return undefined;
  };

  replBindings.FINAL = (answer) => {
    currentFinalAnswer = String(answer);
    return currentFinalAnswer;
  };

  replBindings.FINAL_VAR = (name) => {
    if (Object.prototype.hasOwnProperty.call(replBindings, name)) {
      currentFinalAnswer = String(replBindings[name]);
      return currentFinalAnswer;
    }
    if (Object.prototype.hasOwnProperty.call(currentBuffers, name)) {
      currentFinalAnswer = String(currentBuffers[name]);
      return currentFinalAnswer;
    }
    throw new Error("Variable '" + name + "' not found in active session");
  };

  replBindings.repo = {
    list: async (args) =>
      await callMain({ type: "repo_call", method: "list", args }),
    view: async (args) =>
      await callMain({ type: "repo_call", method: "view", args }),
    find: async (args) =>
      await callMain({ type: "repo_call", method: "find", args }),
    grep: async (args) =>
      await callMain({ type: "repo_call", method: "grep", args }),
  };

  replBindings.llm_query = async (instruction, data) =>
    await callMain({ type: "llm_query_call", instruction, data });

  replBindings.sub_rlm = async (task) =>
    await callMain({ type: "sub_rlm_call", task });
}

self.onmessage = async (event) => {
  const message = event.data;

  if (message.type === "sub_rlm_result" && message.error) {
    const pending = pendingCalls.get(message.requestId);
    if (pending) {
      pendingCalls.delete(message.requestId);
      const error = new Error(message.error.message);
      Object.assign(error, message.error);
      pending.reject(error);
    }
    return;
  }

  if (
    message.type === "repo_result" ||
    message.type === "llm_query_result" ||
    message.type === "sub_rlm_result"
  ) {
    const pending = pendingCalls.get(message.requestId);
    if (pending) {
      pendingCalls.delete(message.requestId);
      pending.resolve(message.result);
    }
    return;
  }

  if (
    message.type === "repo_error" ||
    message.type === "llm_query_error"
  ) {
    const pending = pendingCalls.get(message.requestId);
    if (pending) {
      pendingCalls.delete(message.requestId);
      const error = new Error(message.error.message);
      Object.assign(error, message.error);
      pending.reject(error);
    }
    return;
  }

  if (message.type !== "execute") {
    return;
  }

  currentBuffers = message.buffers || {};
  currentContext = message.context || "";
  currentFinalAnswer = undefined;
  currentStdout = [];
  currentError = undefined;
  wireEnvironment(message.iteration);

  try {
    const executor = new Function(
      "__scope",
      "return (async () => { with (__scope) { " + message.script + " } })();",
    );
    const returnValue = await executor(scopeProxy);

    postMessage({
      type: "result",
      requestId: message.requestId,
      returnValue,
      stdout: currentStdout.join("\\n"),
      buffers: currentBuffers,
      variables: getSerializableBindings(),
      finalAnswer: currentFinalAnswer,
      metadata: getEnvironmentMetadata(),
    });
  } catch (error) {
    currentError = createErrorPayload(
      "runtime",
      "SCRIPT_EXECUTION_FAILED",
      error instanceof Error ? error.message : String(error),
    );
    postMessage({
      type: "result",
      requestId: message.requestId,
      stdout: currentStdout.join("\\n"),
      buffers: currentBuffers,
      variables: getSerializableBindings(),
      finalAnswer: currentFinalAnswer,
      error: currentError,
      metadata: getEnvironmentMetadata(),
    });
  }
};

postMessage({ type: "ready" });
`;

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

function toEnvironmentErrorPayload(
  error: unknown,
  fallbackKind: EnvironmentErrorPayload["kind"],
  fallbackCode: string,
  details?: Record<string, unknown>,
): EnvironmentErrorPayload {
  if (
    error &&
    typeof error === "object" &&
    "kind" in error &&
    "code" in error &&
    "message" in error &&
    typeof (error as { kind?: unknown }).kind === "string" &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    const payload = error as EnvironmentErrorPayload;
    return {
      ...payload,
      ...(details || payload.details
        ? {
            details: {
              ...(payload.details ?? {}),
              ...(details ?? {}),
            },
          }
        : {}),
    };
  }

  const message =
    error instanceof Error
      ? error.message
      : error &&
          typeof error === "object" &&
          "message" in error &&
          typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : String(error);

  return createErrorPayload(fallbackKind, fallbackCode, message, details);
}

export class PersistentWorkerSession {
  private readonly repo: SandboxRepoApi;
  private readonly llmQuery: (instruction: string, data: string) => Promise<string>;
  private readonly timeout: number;
  private readonly subRlmExecutor:
    | ((
    task: SubRlmRequest,
  ) => Promise<SubRlmResult>)
    | undefined;
  private readonly initialBuffers: Record<string, unknown>;
  private worker: Worker | null = null;
  private blobUrl: string | null = null;
  private readyPromise: Promise<void> | null = null;
  private pendingExecutions = new Map<
    string,
    {
      resolve: (value: WorkerSessionExecuteResult) => void;
      timeoutId: Timer;
    }
  >();
  private buffers: Record<string, unknown>;
  private context: string | undefined;
  private lastMetadata: EnvironmentMetadata = {
    stdoutPreview: "",
    stdoutLength: 0,
    variableCount: 0,
    variables: [],
    bufferKeys: [],
    finalSet: false,
  };
  private executionCounter = 0;

  constructor(config: PersistentWorkerSessionConfig) {
    this.repo = config.repo;
    this.llmQuery = config.llmQuery;
    this.timeout = config.timeout ?? 30_000;
    this.initialBuffers = { ...(config.initialBuffers ?? {}) };
    this.buffers = { ...this.initialBuffers };
    this.context = config.context;
    this.subRlmExecutor = config.subRlmExecutor;
  }

  private async ensureStarted(): Promise<void> {
    if (this.readyPromise) {
      await this.readyPromise;
      return;
    }

    const blob = new Blob([WORKER_CODE], { type: "application/javascript" });
    this.blobUrl = URL.createObjectURL(blob);
    this.worker = new Worker(this.blobUrl, { smol: true });

    this.readyPromise = new Promise<void>((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker failed to initialize"));
        return;
      }

      this.worker.onmessage = (event) => {
        const message = event.data as WorkerMessage;
        this.handleWorkerMessage(message, resolve);
      };

      this.worker.onerror = (event) => {
        reject(new Error(event.message));
      };
    });

    await this.readyPromise;
  }

  private handleWorkerMessage(
    message: WorkerMessage,
    readyResolve: (() => void) | null,
  ): void {
    if (message.type === "ready") {
      readyResolve?.();
      return;
    }

    if (message.type === "result") {
      const pending = this.pendingExecutions.get(message.requestId);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeoutId);
      this.pendingExecutions.delete(message.requestId);
      this.buffers = { ...message.buffers };
      this.lastMetadata = message.metadata;

      pending.resolve({
        ...(message.returnValue !== undefined
          ? { returnValue: message.returnValue }
          : {}),
        stdout: message.stdout,
        ...(message.finalAnswer !== undefined
          ? { finalAnswer: message.finalAnswer }
          : {}),
        ...(message.error !== undefined ? { error: message.error } : {}),
        metadata: message.metadata,
        variables: message.variables,
        buffers: message.buffers,
      });
      return;
    }

    if (message.type === "repo_call") {
      void this.handleRepoCall(message);
      return;
    }

    if (message.type === "llm_query_call") {
      void this.handleLlmQueryCall(message);
      return;
    }

    if (message.type === "sub_rlm_call") {
      void this.handleSubRlmCall(message);
    }
  }

  private buildExecutionErrorResult(
    payload: EnvironmentErrorPayload,
  ): WorkerSessionExecuteResult {
    this.lastMetadata = {
      stdoutPreview: "",
      stdoutLength: 0,
      variableCount: 0,
      variables: [],
      bufferKeys: Object.keys(this.buffers),
      finalSet: false,
      error: payload,
    };

    return {
      stdout: "",
      buffers: { ...this.buffers },
      variables: {},
      metadata: this.lastMetadata,
      error: payload,
    };
  }

  private disposeWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }

    this.readyPromise = null;
  }

  private resolveAllPendingExecutions(
    payload: EnvironmentErrorPayload,
  ): void {
    const result = this.buildExecutionErrorResult(payload);

    for (const pending of this.pendingExecutions.values()) {
      clearTimeout(pending.timeoutId);
      pending.resolve({
        ...result,
        buffers: { ...result.buffers },
        variables: { ...result.variables },
        metadata: { ...result.metadata },
      });
    }

    this.pendingExecutions.clear();
  }

  private async handleRepoCall(
    message: Extract<WorkerMessage, { type: "repo_call" }>,
  ): Promise<void> {
    const worker = this.worker;
    if (!worker) {
      return;
    }

    try {
      const result = await this.repo[message.method](message.args as never);
      try {
        worker.postMessage({
          type: "repo_result",
          requestId: message.requestId,
          result,
        });
      } catch {
        // Ignore if the worker was terminated while the repo call was in flight.
      }
    } catch (error) {
      const payload = toEnvironmentErrorPayload(
        error,
        "repo",
        "REPO_OPERATION_FAILED",
        {
          method: message.method,
        },
      );

      try {
        worker.postMessage({
          type: "repo_error",
          requestId: message.requestId,
          error: payload,
        });
      } catch {
        // Ignore if the worker was terminated while the repo call was in flight.
      }
    }
  }

  private async handleLlmQueryCall(
    message: Extract<WorkerMessage, { type: "llm_query_call" }>,
  ): Promise<void> {
    const worker = this.worker;
    if (!worker) {
      return;
    }

    try {
      const result = await this.llmQuery(message.instruction, message.data);
      try {
        worker.postMessage({
          type: "llm_query_result",
          requestId: message.requestId,
          result,
        });
      } catch {
        // Ignore if the worker was terminated while the llm_query call was in flight.
      }
    } catch (error) {
      try {
        worker.postMessage({
          type: "llm_query_error",
          requestId: message.requestId,
          error: toEnvironmentErrorPayload(
            error,
            "llm",
            "SUB_MODEL_QUERY_FAILED",
          ),
        });
      } catch {
        // Ignore if the worker was terminated while the llm_query call was in flight.
      }
    }
  }

  private async handleSubRlmCall(
    message: Extract<WorkerMessage, { type: "sub_rlm_call" }>,
  ): Promise<void> {
    const worker = this.worker;
    if (!worker) {
      return;
    }

    if (!this.subRlmExecutor) {
      try {
        worker.postMessage({
          type: "sub_rlm_result",
          requestId: message.requestId,
          error: createErrorPayload(
            "sub_rlm",
            "SUB_RLM_NOT_CONFIGURED",
            "sub_rlm is not configured for this session",
          ),
        });
      } catch {
        // Ignore if the worker was terminated while the child request was in flight.
      }
      return;
    }

    try {
      const result = await this.subRlmExecutor(message.task);
      try {
        worker.postMessage({
          type: "sub_rlm_result",
          requestId: message.requestId,
          result,
        });
      } catch {
        // Ignore if the worker was terminated while the child request was in flight.
      }
    } catch (error) {
      try {
        worker.postMessage({
          type: "sub_rlm_result",
          requestId: message.requestId,
          error: toEnvironmentErrorPayload(
            error,
            "sub_rlm",
            "SUB_RLM_FAILED",
          ),
        });
      } catch {
        // Ignore if the worker was terminated while the child request was in flight.
      }
    }
  }

  async execute(script: string): Promise<WorkerSessionExecuteResult> {
    await this.ensureStarted();

    if (!this.worker) {
      throw new Error("Worker session is not available");
    }

    let compiledScript: string;
    try {
      compiledScript = transformReplScript(script);
    } catch (error) {
      const payload = createErrorPayload(
        "runtime",
        "SCRIPT_TRANSFORM_FAILED",
        error instanceof Error ? error.message : String(error),
      );
      this.lastMetadata = {
        stdoutPreview: "",
        stdoutLength: 0,
        variableCount: 0,
        variables: [],
        bufferKeys: Object.keys(this.buffers),
        finalSet: false,
        error: payload,
      };
      return {
        stdout: "",
        buffers: { ...this.buffers },
        variables: {},
        metadata: this.lastMetadata,
        error: payload,
      };
    }
    const requestId = crypto.randomUUID();

    return await new Promise<WorkerSessionExecuteResult>((resolve) => {
      const timeoutId = setTimeout(() => {
        if (!this.pendingExecutions.has(requestId)) {
          return;
        }

        const payload = createErrorPayload(
          "timeout",
          "WORKER_TIMEOUT",
          `timeout after ${this.timeout}ms`,
        );

        // A timed-out execution may still be suspended on an IPC await inside the
        // worker. Tear down the worker and restart on demand so stale async handlers
        // cannot resume and corrupt the next iteration's shared environment state.
        this.disposeWorker();
        this.resolveAllPendingExecutions(payload);
      }, this.timeout);

      this.pendingExecutions.set(requestId, { resolve, timeoutId });
      this.executionCounter += 1;
      const executeMessage: WorkerMessage = {
        type: "execute",
        requestId,
        script: compiledScript,
        buffers: { ...this.buffers },
        iteration: this.executionCounter,
        ...(this.context !== undefined ? { context: this.context } : {}),
      };
      this.worker?.postMessage(executeMessage);
    });
  }

  setBuffers(buffers: Record<string, unknown>): void {
    this.buffers = { ...buffers };
  }

  getBuffers(): Record<string, unknown> {
    return { ...this.buffers };
  }

  setContext(context: string | undefined): void {
    this.context = context;
  }

  getEnvironmentMetadata(): EnvironmentMetadata {
    return this.lastMetadata;
  }

  terminate(): void {
    for (const pending of this.pendingExecutions.values()) {
      clearTimeout(pending.timeoutId);
    }
    this.pendingExecutions.clear();
    this.disposeWorker();

    logger.debug("RLM", "Persistent worker session terminated");
  }
}

export class BunWorkerSandbox {
  private readonly session: PersistentWorkerSession;

  constructor(config: PersistentWorkerSessionConfig) {
    this.session = new PersistentWorkerSession(config);
  }

  async execute(script: string): Promise<{
    returnValue?: unknown;
    stdout: string;
    buffers: Record<string, unknown>;
    finalAnswer?: string;
    error?: string;
  }> {
    const result = await this.session.execute(script);
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
    };
  }

  setBuffers(buffers: Record<string, unknown>): void {
    this.session.setBuffers(buffers);
  }

  getBuffers(): Record<string, unknown> {
    return this.session.getBuffers();
  }

  terminate(): void {
    this.session.terminate();
  }
}
