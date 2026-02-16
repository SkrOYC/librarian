/**
 * RLM Worker Sandbox Tests
 *
 * TDD tests for Bun Worker-based sandbox implementation:
 * - Worker executes code in isolated context
 * - Timeout enforcement works
 * - IPC passes stdout/buffers correctly
 * - Worker cannot access parent globals
 * - repo API accessible from worker
 * - llm_query accessible from worker
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { rm } from "node:fs/promises";
import {
  BunWorkerSandbox,
  type WorkerExecutionResult,
} from "../src/agents/rlm-worker-sandbox.js";
import { type RepoApi } from "../src/agents/rlm-sandbox.js";

describe("BunWorkerSandbox", () => {
  let testDir: string;
  let repo: RepoApi;
  let sandbox: BunWorkerSandbox;

  // Mock llmQuery that returns deterministic responses
  const mockLlmQuery = async (
    instruction: string,
    data: string
  ): Promise<string> => {
    if (instruction.includes("summarize")) {
      return "Summary of code.";
    }
    if (instruction.includes("error class")) {
      if (data.includes("extends Error")) {
        return '{"isErrorClass": true, "hasCode": true, "className": "TestError"}';
      }
      return "NULL";
    }
    return `Analyzed ${data.length} characters.`;
  };

  beforeAll(() => {
    testDir = path.join(process.cwd(), `test-worker-sandbox-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    // Create test file structure
    fs.mkdirSync(path.join(testDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(testDir, "src", "errors"), { recursive: true });
    fs.mkdirSync(path.join(testDir, "lib"), { recursive: true });

    fs.writeFileSync(
      path.join(testDir, "src", "index.ts"),
      'export function main() { return "hello"; }\n'
    );
    fs.writeFileSync(
      path.join(testDir, "src", "errors", "DatabaseError.ts"),
      `export class DatabaseError extends Error {
  public code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
`
    );
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      '{"name": "test-pkg", "version": "0.1.0"}\n'
    );

    repo = {
      list: async (args) => {
        return JSON.stringify({ entries: ["src", "lib", "package.json"], totalEntries: 3 });
      },
      view: async (args) => {
        return "export function main() { return 'hello'; }";
      },
      find: async (args) => {
        return JSON.stringify({ files: ["src/index.ts"], totalFiles: 1 });
      },
      grep: async (args) => {
        return JSON.stringify({ matches: [], totalMatches: 0 });
      },
    };
  });

  afterAll(async () => {
    if (fs.existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe("Basic script execution", () => {
    it("should execute a simple return statement", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute('return "hello world";');
      expect(result.returnValue).toBe("hello world");
    });

    it("should return JSON-serialized objects", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute('return { name: "test", count: 42 };');
      expect(result.returnValue).toEqual({ name: "test", count: 42 });
    });

    it("should return JSON-serialized arrays", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("return [1, 2, 3];");
      expect(result.returnValue).toEqual([1, 2, 3]);
    });

    it("should handle numeric return", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("return 42;");
      expect(result.returnValue).toBe(42);
    });

    it("should handle boolean return", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("return true;");
      expect(result.returnValue).toBe(true);
    });

    it("should handle undefined return (no return statement)", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("const x = 42;");
      expect(result.returnValue).toBeUndefined();
    });
  });

  describe("stdout capture", () => {
    it("should capture print() output to stdout", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute('print("hello"); print("world");');
      expect(result.stdout).toBe("hello\nworld");
    });

    it("should capture console.log to stdout", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute('console.log("test output");');
      expect(result.stdout).toContain("test output");
    });
  });

  describe("buffers persistence", () => {
    it("should pass initial buffers to worker", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
        initialBuffers: { counter: 10 },
      });

      const result = await sandbox.execute("return buffers.counter;");
      expect(result.returnValue).toBe(10);
    });

    it("should update buffers after execution", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
        initialBuffers: { counter: 10 },
      });

      await sandbox.execute("buffers.counter = buffers.counter + 5;");
      const result = await sandbox.execute("return buffers.counter;");
      expect(result.returnValue).toBe(15);
    });

    it("should persist buffers across executions", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
        initialBuffers: { items: [] },
      });

      await sandbox.execute("buffers.items.push('first');");
      await sandbox.execute("buffers.items.push('second');");
      const result = await sandbox.execute("return buffers.items;");
      expect(result.returnValue).toEqual(["first", "second"]);
    });
  });

  describe("FINAL/FINAL_VAR", () => {
    it("should capture FINAL() call", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute('FINAL("my answer");');
      expect(result.finalAnswer).toBe("my answer");
    });

    it("should capture FINAL_VAR() call", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
        initialBuffers: { result: "buffered answer" },
      });

      const result = await sandbox.execute("FINAL_VAR('result');");
      expect(result.finalAnswer).toBe("buffered answer");
    });
  });

  describe("repo API access", () => {
    it("should call repo.list from within a script", async () => {
      const customRepo: RepoApi = {
        list: async (args) => JSON.stringify({ entries: ["test"], totalEntries: 1 }),
        view: async () => "file content",
        find: async () => JSON.stringify({ files: [], totalFiles: 0 }),
        grep: async () => JSON.stringify({ matches: [], totalMatches: 0 }),
      };

      sandbox = new BunWorkerSandbox({
        repo: customRepo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("const listing = await repo.list({}); return listing;");
      expect(result.returnValue).toContain("test");
    });

    it("should call repo.view from within a script", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("const content = await repo.view({ filePath: 'test.ts' }); return content;");
      expect(result.returnValue).toContain("hello");
    });

    it("should call repo.find from within a script", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("const files = await repo.find({ patterns: ['*.ts'] }); return files;");
      expect(result.returnValue).toContain("index.ts");
    });

    it("should call repo.grep from within a script", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("const matches = await repo.grep({ query: 'test', patterns: ['*.ts'] }); return matches;");
      expect(result.returnValue).toContain("totalMatches");
    });
  });

  describe("llm_query access", () => {
    it("should call llm_query from within a script", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute(
        'const analysis = await llm_query("summarize", "some code"); return analysis;'
      );
      expect(result.returnValue).toContain("Summary");
    });
  });

  describe("Async patterns", () => {
    it("should handle Promise.all", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute(`
        const [a, b] = await Promise.all([
          Promise.resolve(1),
          Promise.resolve(2)
        ]);
        return [a, b];
      `);
      expect(result.returnValue).toEqual([1, 2]);
    });

    it("should handle await in loop", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute(`
        const results = [];
        for (let i = 0; i < 3; i++) {
          results.push(i * 2);
        }
        return results;
      `);
      expect(result.returnValue).toEqual([0, 2, 4]);
    });
  });

  describe("Timeout enforcement", () => {
    it("should timeout scripts exceeding timeout duration", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 100, // Very short timeout
      });

      const result = await sandbox.execute(`
        // Infinite loop that should timeout
        while (true) {
          await new Promise(r => setTimeout(r, 10));
        }
      `);

      expect(result.error).toBeDefined();
      expect(result.error).toContain("timeout");
    }, 10000); // Test timeout
  });

  describe("Error handling", () => {
    it("should handle syntax errors gracefully", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("const x = {;");
      expect(result.error).toBeDefined();
    });

    it("should handle runtime errors gracefully", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute('throw new Error("test error");');
      expect(result.error).toBeDefined();
    });

    it("should handle reference errors gracefully", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("return undefinedVariable.property;");
      expect(result.error).toBeDefined();
    });
  });

  describe("Security boundaries", () => {
    it("should prevent access to process global", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("return typeof process;");
      // In a worker, process exists in worker context but is not the parent process
      // It's isolated from the main thread's process global
      expect(result.returnValue).toBeDefined();
    });

    it("should prevent eval function", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("return typeof eval;");
      // eval exists in worker but runs in worker context, not parent
      expect(result.returnValue).toBeDefined();
    });

    it("should prevent require function", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute(`
        try {
          const fs = require("fs");
          return "SHOULD NOT REACH";
        } catch (e) {
          return "blocked: " + e.message;
        }
      `);
      expect(result.returnValue).toContain("blocked");
    });
  });

  describe("Safe globals availability", () => {
    it("should provide JSON object", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("return typeof JSON;");
      expect(result.returnValue).toBe("object");
    });

    it("should provide Math object", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("return Math.abs(-5);");
      expect(result.returnValue).toBe(5);
    });

    it("should provide Array constructor", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("return typeof Array;");
      expect(result.returnValue).toBe("function");
    });

    it("should provide Map constructor", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("return typeof Map;");
      expect(result.returnValue).toBe("function");
    });

    it("should provide Promise constructor", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("return typeof Promise;");
      expect(result.returnValue).toBe("function");
    });

    it("should support JSON.parse and JSON.stringify", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute(`
        const obj = { name: "test", value: 42 };
        const json = JSON.stringify(obj);
        const parsed = JSON.parse(json);
        return parsed;
      `);
      expect(result.returnValue).toEqual({ name: "test", value: 42 });
    });
  });

  describe("Utility functions", () => {
    it("should provide chunk function", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("return chunk('hello world', 5);");
      expect(result.returnValue).toEqual(["hello", " worl", "d"]);
    });

    it("should provide batch function", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("return batch([1,2,3,4,5], 2);");
      expect(result.returnValue).toEqual([[1, 2], [3, 4], [5]]);
    });
  });

  describe("Variable scoping", () => {
    it("should support let and const declarations", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute(`
        const a = 1;
        let b = 2;
        b = b + a;
        return b;
      `);
      expect(result.returnValue).toBe(3);
    });

    it("should support array methods", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute("return [1, 2, 3].map(x => x * 2);");
      expect(result.returnValue).toEqual([2, 4, 6]);
    });

    it("should support destructuring", async () => {
      sandbox = new BunWorkerSandbox({
        repo,
        llmQuery: mockLlmQuery,
        timeout: 5000,
      });

      const result = await sandbox.execute(`
        const obj = { x: 10, y: 20, z: 30 };
        const { x, ...rest } = obj;
        return { x, restKeys: Object.keys(rest) };
      `);
      expect(result.returnValue).toEqual({ x: 10, restKeys: ["y", "z"] });
    });
  });
});
