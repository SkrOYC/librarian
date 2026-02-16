/**
 * RLM Worker Sandbox - Bun Worker-based execution environment
 *
 * Provides true process isolation for RLM script execution using Bun Workers.
 * - Inline worker code as template string (no file I/O)
 * - IPC-based communication for stdout/buffers
 * - Timeout enforcement
 * - smol: true for memory efficiency
 */

import type { RepoApi } from "./rlm-sandbox.js";

/**
 * Result of worker script execution
 */
export interface WorkerExecutionResult {
  /** Return value from the script */
  returnValue?: unknown;
  /** Captured stdout from print() calls */
  stdout: string;
  /** Final buffers state */
  buffers: Record<string, unknown>;
  /** Final answer if FINAL/FINAL_VAR was called */
  finalAnswer?: string;
  /** Error message if execution failed */
  error?: string;
}

/**
 * Configuration for BunWorkerSandbox
 */
export interface BunWorkerSandboxConfig {
  /** Repository API for file operations */
  repo: RepoApi;
  /** LLM query function for semantic analysis */
  llmQuery: (instruction: string, data: string) => Promise<string>;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Initial buffers for stateful iterations */
  initialBuffers?: Record<string, unknown>;
  /** Context content from repository (for RLM engine) */
  context?: string;
  /** Callback for sub_rlm - creates fresh worker with isolated state */
  subRlmExecutor?: (query: string) => Promise<{ stdout: string; buffers: Record<string, unknown>; finalAnswer?: string }>;
}

/**
 * IPC message types for worker communication
 */
type IpcMessage =
  | { type: "execute"; script: string; buffers: Record<string, unknown>; context?: string }
  | { type: "result"; returnValue?: unknown; stdout: string; buffers: Record<string, unknown>; finalAnswer?: string }
  | { type: "error"; error: string }
  | { type: "ready" }
  | { type: "print"; output: string }
  | { type: "final"; answer: string }
  | { type: "repo_call"; method: string; args: unknown; requestId: string }
  | { type: "repo_result"; requestId: string; result: string }
  | { type: "repo_error"; requestId: string; error: string }
  | { type: "llm_query_call"; instruction: string; data: string; requestId: string }
  | { type: "llm_query_result"; requestId: string; result: string }
  | { type: "llm_query_error"; requestId: string; error: string }
  | { type: "sub_rlm_call"; query: string; requestId: string }
  | { type: "sub_rlm_result"; requestId: string; result: string; error?: string };

/**
 * Inline worker code template
 * This runs in an isolated JavaScriptCore context
 */
const WORKER_CODE = `
// Safe globals for worker - intentionally minimal
const safeGlobals = {
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

  // chunk and batch utilities
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

// Block dangerous globals by not including them
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
// Note: We don't explicitly block dangerous globals because the worker
// runs in an isolated context with its own global scope.
// The parent process globals are not accessible from the worker.
// Also note: can't use "const eval" or "const Function" in strict mode
const setImmediate = undefined;
const setInterval = undefined;
const clearImmediate = undefined;
const clearInterval = undefined;
const queueMicrotask = undefined;

// Expose safe globals to global scope
// We also need to expose buffers, print, FINAL, FINAL_VAR as globals
let currentBuffers = {};
let currentFinalAnswer = undefined;
let currentStdout = [];

// Expose buffers as global immediately so sub_rlm can access it
globalThis.buffers = currentBuffers;

// Override console to capture output
const console = {
  log: (...args) => {
    const output = args.map(a => String(a)).join(" ");
    currentStdout.push(output);
    postMessage({ type: "print", output });
  },
  error: (...args) => {
    const output = "ERROR: " + args.map(a => String(a)).join(" ");
    currentStdout.push(output);
    postMessage({ type: "print", output });
  },
  warn: (...args) => {
    const output = "WARN: " + args.map(a => String(a)).join(" ");
    currentStdout.push(output);
    postMessage({ type: "print", output });
  },
  info: (...args) => {
    const output = "INFO: " + args.map(a => String(a)).join(" ");
    currentStdout.push(output);
    postMessage({ type: "print", output });
  },
};

// Expose safe globals to global scope (including chunk and batch utilities)
Object.assign(globalThis, safeGlobals);

// Pending IPC call resolvers
const pendingCalls = new Map();

function generateRequestId() {
  return Math.random().toString(36).substring(2, 15);
}

async function handlePromiseResult(promiseOrValue) {
  if (promiseOrValue instanceof Promise) {
    return await promiseOrValue;
  }
  return promiseOrValue;
}

// Send message and wait for response
async function callMain(message) {
  const requestId = generateRequestId();
  postMessage({ ...message, requestId });
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingCalls.delete(requestId);
      reject(new Error("Call timeout"));
    }, 30000);
    
    pendingCalls.set(requestId, { resolve, reject, timeout });
  });
}

// Handle IPC responses from main thread - set up once at startup
self.onmessage = async (event) => {
  const message = event.data;
  
  if (message.type === "repo_result" || message.type === "repo_error") {
    if (message.requestId && pendingCalls.has(message.requestId)) {
      const { resolve, reject, timeout } = pendingCalls.get(message.requestId);
      clearTimeout(timeout);
      pendingCalls.delete(message.requestId);
      
      if (message.type === "repo_result") {
        resolve(message.result);
      } else {
        reject(new Error(message.error));
      }
    }
    return;
  }
  
  if (message.type === "llm_query_result" || message.type === "llm_query_error") {
    if (message.requestId && pendingCalls.has(message.requestId)) {
      const { resolve, reject, timeout } = pendingCalls.get(message.requestId);
      clearTimeout(timeout);
      pendingCalls.delete(message.requestId);
      
      if (message.type === "llm_query_result") {
        resolve(message.result);
      } else {
        reject(new Error(message.error));
      }
    }
    return;
  }

  // Handle sub_rlm responses from main thread
  if (message.type === "sub_rlm_result") {
    if (message.requestId && pendingCalls.has(message.requestId)) {
      const { resolve, reject, timeout } = pendingCalls.get(message.requestId);
      clearTimeout(timeout);
      pendingCalls.delete(message.requestId);
      
      if (message.error) {
        reject(new Error(message.error));
      } else {
        // Result is JSON stringified
        resolve(message.result ? JSON.parse(message.result) : { stdout: "", buffers: {} });
      }
    }
    return;
  }

  if (message.type === "execute") {
    currentBuffers = message.buffers || {};
    // Update global buffers reference
    globalThis.buffers = currentBuffers;
    
    // Expose context to scripts if provided
    if (message.context !== undefined) {
      globalThis.context = message.context;
    }
    
    currentFinalAnswer = undefined;
    currentStdout = [];

    // Create print function that captures to stdout
    const print = (...args) => {
      const output = args.map(a => String(a)).join(" ");
      currentStdout.push(output);
      postMessage({ type: "print", output });
    };

    // Create FINAL function
    const FINAL = (answer) => {
      currentFinalAnswer = String(answer);
      postMessage({ type: "final", answer: currentFinalAnswer });
    };

    // Create FINAL_VAR function
    const FINAL_VAR = (name) => {
      if (currentBuffers.hasOwnProperty(name)) {
        currentFinalAnswer = String(currentBuffers[name]);
        postMessage({ type: "final", answer: currentFinalAnswer });
      } else {
        throw new Error("Buffer '" + name + "' not found");
      }
    };

    // Create repo API wrapper that uses IPC
    const repo = {
      list: async (args) => {
        return await callMain({ type: "repo_call", method: "list", args });
      },
      view: async (args) => {
        return await callMain({ type: "repo_call", method: "view", args });
      },
      find: async (args) => {
        return await callMain({ type: "repo_call", method: "find", args });
      },
      grep: async (args) => {
        return await callMain({ type: "repo_call", method: "grep", args });
      },
    };

    // Create llm_query function that uses IPC
    const llm_query = async (instruction, data) => {
      return await callMain({ type: "llm_query_call", instruction, data });
    };

    // Create sub_rlm function that spawns fresh worker via IPC
    // This allows nested RLM calls with isolated state
    // Returns the finalAnswer if set, otherwise returns the result object
    const sub_rlm = async (scriptCode) => {
      const result = await callMain({ type: "sub_rlm_call", query: scriptCode });
      // If the result has a finalAnswer, return that (like calling FINAL in sub_rlm)
      // Otherwise return the full result object
      if (result && result.finalAnswer) {
        return result.finalAnswer;
      }
      return result;
    };

    // Execute the script using async IIFE with eval
    try {
      // Wrap script in async IIFE and execute with eval
      const wrappedScript = "(async () => { " + message.script + " })();";
      const asyncResult = eval(wrappedScript);
      
      // Handle promise result
      const result = await handlePromiseResult(asyncResult);
      
      // Send result back
      postMessage({
        type: "result",
        returnValue: result,
        stdout: currentStdout.join("\\n"),
        buffers: currentBuffers,
        finalAnswer: currentFinalAnswer,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      postMessage({
        type: "error",
        error: errorMessage,
      });
    }
  }
};

// Signal that worker is ready
postMessage({ type: "ready" });
`;

/**
 * Bun Worker-based sandbox for RLM script execution
 *
 * Provides true process isolation by running scripts in a separate
 * JavaScriptCore context (Bun worker thread).
 */
export class BunWorkerSandbox {
  private repo: RepoApi;
  private llmQuery: (instruction: string, data: string) => Promise<string>;
  private timeout: number;
  private buffers: Record<string, unknown>;
  private context?: string;
  private worker: Worker | null = null;
  private subRlmExecutor?: (query: string) => Promise<{ stdout: string; buffers: Record<string, unknown>; finalAnswer?: string }>;

  constructor(config: BunWorkerSandboxConfig) {
    this.repo = config.repo;
    this.llmQuery = config.llmQuery;
    this.timeout = config.timeout ?? 30000;
    this.buffers = { ...(config.initialBuffers ?? {}) };
    this.context = config.context;
    this.subRlmExecutor = config.subRlmExecutor;
  }

  /**
   * Execute a script in the worker sandbox
   */
  async execute(script: string): Promise<WorkerExecutionResult> {
    // Create a new worker for each execution to ensure clean state
    // We need to set up handlers BEFORE waiting for ready
    const worker = await this.createWorkerWithHandlers(script);
    this.worker = worker;

    return new Promise((resolve) => {
      // The worker is already running with handlers set up
      // Just set up the timeout
      const timeoutId = setTimeout(() => {
        this._currentResolve = null;
        this._currentTimeoutId = null;
        this.cleanup();
        resolve({
          stdout: "",
          buffers: this.buffers,
          error: "Script timed out after " + this.timeout + "ms (timeout)",
        });
      }, this.timeout);

      // Store cleanup and resolve for the handlers to use
      this._currentResolve = resolve;
      this._currentTimeoutId = timeoutId;
      this._currentWorker = worker;
      this._currentScript = script;
    });
  }

  // Temporary storage for execute state
  private _currentResolve: ((value: WorkerExecutionResult) => void) | null = null;
  private _currentTimeoutId: Timer | null = null;
  private _currentWorker: Worker | null = null;
  private _currentScript: string = "";
  private _currentBlobUrl: string | null = null;

  /**
   * Create worker and set up handlers before waiting for ready
   */
  private async createWorkerWithHandlers(script: string): Promise<Worker> {
    // Create blob from worker code
    const blob = new Blob([WORKER_CODE], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    this._currentBlobUrl = url;

    // Create worker with smol: true for memory efficiency
    const worker = new Worker(url, { smol: true });

    // Set up message handler BEFORE waiting for ready
    worker.onmessage = (event) => {
      const msg = event.data as IpcMessage;
      this.handleWorkerMessage(msg, worker);
    };

    worker.onerror = (error) => {
      if (this._currentResolve) {
        const resolve = this._currentResolve;
        clearTimeout(this._currentTimeoutId!);
        this._currentResolve = null;
        this._currentTimeoutId = null;
        resolve({
          stdout: "",
          buffers: this.buffers,
          error: error.message,
        });
        this.cleanup();
      }
    };

    // Wait for worker to signal ready
    await new Promise<void>((resolve) => {
      let executeSent = false;
      let timeoutHandle: Timer | undefined;

      const sendExecute = () => {
        if (executeSent) return;
        executeSent = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        worker.postMessage({
          type: "execute",
          script,
          buffers: this.buffers,
          context: this.context,
        });
      };

      const readyHandler = (event: MessageEvent) => {
        const msg = event.data as IpcMessage;
        if (msg.type === "ready") {
          worker.removeEventListener("message", readyHandler);
          sendExecute();
          resolve();
        }
      };
      worker.addEventListener("message", readyHandler);
      
      // Timeout - send execute message to ensure worker processes it
      timeoutHandle = setTimeout(() => {
        worker.removeEventListener("message", readyHandler);
        sendExecute();
        resolve();
      }, 5000);
    });

    return worker;
  }

  /**
   * Handle messages from worker
   */
  private handleWorkerMessage(msg: IpcMessage, worker: Worker): void {
    const resolve = this._currentResolve;
    const timeoutId = this._currentTimeoutId;

    switch (msg.type) {
      case "ready":
        // Already handled in createWorkerWithHandlers
        break;

      case "print":
        // Print is handled via final result
        break;

      case "final":
        // Final answer set during execution
        break;

      case "result": {
        if (resolve) {
          clearTimeout(timeoutId!);
          this.buffers = msg.buffers;
          this._currentResolve = null;
          this._currentTimeoutId = null;
          this.cleanup();
          resolve({
            returnValue: msg.returnValue,
            stdout: msg.stdout,
            buffers: msg.buffers,
            finalAnswer: msg.finalAnswer,
          });
        }
        break;
      }

      case "error": {
        if (resolve) {
          clearTimeout(timeoutId!);
          this._currentResolve = null;
          this._currentTimeoutId = null;
          this.cleanup();
          resolve({
            stdout: "",
            buffers: this.buffers,
            error: msg.error,
          });
        }
        break;
      }

      case "repo_call": {
        this.handleRepoCall(msg);
        break;
      }

      case "llm_query_call": {
        this.handleLlmQueryCall(msg);
        break;
      }

      case "sub_rlm_call": {
        this.handleSubRlmCall(msg);
        break;
      }
      // Note: repo_result, repo_error, llm_query_result, llm_query_error
      // are sent FROM main TO worker, not received by main.
      // These cases are handled in the worker's onmessage, not here.
    }
  }

  /**
   * Handle repo API calls from worker via IPC
   */
  private async handleRepoCall(msg: Extract<IpcMessage, { type: "repo_call" }>): Promise<void> {
    if (!this.worker) return;

    try {
      const { method, args, requestId } = msg;
      
      // Validate method is one of the allowed repo API methods
      const allowedMethods = ["list", "view", "find", "grep"];
      if (!allowedMethods.includes(method)) {
        throw new Error(`Invalid repo method: ${method}`);
      }
      
      const result = await this.repo[method](args);
      this.worker.postMessage({ type: "repo_result", requestId, result });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.worker.postMessage({ type: "repo_error", requestId: msg.requestId, error: errorMessage });
    }
  }

  /**
   * Handle llm_query calls from worker via IPC
   */
  private async handleLlmQueryCall(msg: Extract<IpcMessage, { type: "llm_query_call" }>): Promise<void> {
    if (!this.worker) return;

    try {
      const { instruction, data, requestId } = msg;
      const result = await this.llmQuery(instruction, data);
      this.worker.postMessage({ type: "llm_query_result", requestId, result });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.worker.postMessage({ type: "llm_query_error", requestId: msg.requestId, error: errorMessage });
    }
  }

  /**
   * Handle sub_rlm calls from worker via IPC
   * Spawns a fresh worker with isolated state
   */
  private async handleSubRlmCall(msg: Extract<IpcMessage, { type: "sub_rlm_call" }>): Promise<void> {
    const worker = this.worker;
    if (!worker) return;

    const { query, requestId } = msg;

    try {
      if (!this.subRlmExecutor) {
        throw new Error("sub_rlm is not configured - no executor provided");
      }

      // Call the executor to spawn fresh worker and execute
      const result = await this.subRlmExecutor(query);
      
      // Send result back to worker (check worker still exists)
      if (this.worker) {
        this.worker.postMessage({ 
          type: "sub_rlm_result", 
          requestId, 
          result: JSON.stringify(result) 
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (this.worker) {
        this.worker.postMessage({ type: "sub_rlm_result", requestId, error: errorMessage });
      }
    }
  }

  /**
   * Cleanup worker and blob URL
   */
  private cleanup(): void {
    // Revoke blob URL to prevent memory leak
    if (this._currentBlobUrl) {
      URL.revokeObjectURL(this._currentBlobUrl);
      this._currentBlobUrl = null;
    }

    // Terminate worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Get current buffers
   */
  getBuffers(): Record<string, unknown> {
    return this.buffers;
  }

  /**
   * Set buffers
   */
  setBuffers(buffers: Record<string, unknown>): void {
    this.buffers = buffers;
  }

  /**
   * Terminate the worker
   */
  terminate(): void {
    this.cleanup();
  }
}
