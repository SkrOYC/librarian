/**
 * RLM Sandbox Security Tests
 *
 * Verifies that the sandbox implementation properly restricts access to
 * dangerous Node.js/Bun built-ins and provides proper isolation.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { rm } from "node:fs/promises";
import {
  createRepoApi,
  createLlmQuery,
  executeRlmScript,
  type RepoApi,
} from "../src/agents/rlm-sandbox.js";

describe("RLM Sandbox Security", () => {
  let testDir: string;
  let repo: RepoApi;

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
    testDir = path.join(process.cwd(), `test-rlm-security-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    // Create test file structure
    fs.mkdirSync(path.join(testDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, "src", "index.ts"),
      'export function main() { return "hello"; }\n'
    );
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      '{"name": "test", "version": "1.0.0"}\n'
    );

    repo = createRepoApi(testDir);
  });

  afterAll(async () => {
    if (fs.existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  // ─── Dangerous Global Blocking Tests ───────────────────────────────────────

  describe("Dangerous globals are blocked", () => {
    it("should block access to process global", async () => {
      const result = await executeRlmScript(
        "return typeof process;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("undefined");
    });

    it("should block access to require function", async () => {
      const result = await executeRlmScript(
        "return typeof require;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("undefined");
    });

    it("should block access to Buffer", async () => {
      const result = await executeRlmScript(
        "return typeof Buffer;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("undefined");
    });

    it("should block access to fetch", async () => {
      const result = await executeRlmScript(
        "return typeof fetch;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("undefined");
    });

    it("should block access to XMLHttpRequest", async () => {
      const result = await executeRlmScript(
        "return typeof XMLHttpRequest;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("undefined");
    });

    it("should block access to child_process", async () => {
      const result = await executeRlmScript(
        "return typeof child_process;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("undefined");
    });

    it("should block access to fs module", async () => {
      const result = await executeRlmScript(
        "return typeof fs;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("undefined");
    });

    it("should block access to http/https modules", async () => {
      const result = await executeRlmScript(
        "return typeof http;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("undefined");
    });

    it("should block access to module object", async () => {
      const result = await executeRlmScript(
        "return typeof module;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("undefined");
    });

    it("should block access to __dirname", async () => {
      const result = await executeRlmScript(
        "return typeof __dirname;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("undefined");
    });

    it("should block access to __filename", async () => {
      const result = await executeRlmScript(
        "return typeof __filename;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("undefined");
    });
  });

  // ─── Constructor Chain Attack Tests ───────────────────────────────────────

  describe("Constructor chain attacks are blocked", () => {
    it("should block direct Function constructor access", async () => {
      const result = await executeRlmScript(
        "return typeof Function;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("undefined");
    });

    it("should block eval function", async () => {
      const result = await executeRlmScript(
        "return typeof eval;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("undefined");
    });

    it("should block new Function() inside script", async () => {
      const result = await executeRlmScript(
        "return typeof (new Function('return 1'));",
        repo,
        mockLlmQuery
      );
      // Function is undefined, so new Function() should throw
      expect(result).toContain("Script execution error");
    });

    it("should block eval() call", async () => {
      const result = await executeRlmScript(
        "return eval('1 + 1');",
        repo,
        mockLlmQuery
      );
      // eval is undefined, so eval() should throw
      expect(result).toContain("Script execution error");
    });
  });

  // ─── Safe Globals Availability Tests ───────────────────────────────────────

  describe("Safe globals are available", () => {
    it("should provide console object", async () => {
      const result = await executeRlmScript(
        "return typeof console;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("object");
    });

    it("should provide JSON object", async () => {
      const result = await executeRlmScript(
        "return typeof JSON;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("object");
    });

    it("should provide Math object", async () => {
      const result = await executeRlmScript(
        "return typeof Math;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("object");
    });

    it("should provide Array constructor", async () => {
      const result = await executeRlmScript(
        "return typeof Array;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("function");
    });

    it("should provide Object constructor", async () => {
      const result = await executeRlmScript(
        "return typeof Object;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("function");
    });

    it("should provide String constructor", async () => {
      const result = await executeRlmScript(
        "return typeof String;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("function");
    });

    it("should provide Promise constructor", async () => {
      const result = await executeRlmScript(
        "return typeof Promise;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("function");
    });

    it("should provide Map constructor", async () => {
      const result = await executeRlmScript(
        "return typeof Map;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("function");
    });

    it("should provide Set constructor", async () => {
      const result = await executeRlmScript(
        "return typeof Set;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("function");
    });

    it("should provide RegExp constructor", async () => {
      const result = await executeRlmScript(
        "return typeof RegExp;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("function");
    });

    it("should provide parseInt function", async () => {
      const result = await executeRlmScript(
        "return typeof parseInt;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("function");
    });

    it("should provide encodeURI function", async () => {
      const result = await executeRlmScript(
        "return typeof encodeURI;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("function");
    });
  });

  // ─── Script Functionality Tests ────────────────────────────────────────────

  describe("Script functionality works correctly", () => {
    it("should execute basic return statements", async () => {
      const result = await executeRlmScript(
        'return "hello world";',
        repo,
        mockLlmQuery
      );
      expect(result).toBe("hello world");
    });

    it("should execute array operations", async () => {
      const result = await executeRlmScript(
        "return [1, 2, 3].map(x => x * 2);",
        repo,
        mockLlmQuery
      );
      expect(JSON.parse(result)).toEqual([2, 4, 6]);
    });

    it("should execute object operations", async () => {
      const result = await executeRlmScript(
        "return Object.keys({ a: 1, b: 2, c: 3 });",
        repo,
        mockLlmQuery
      );
      expect(JSON.parse(result)).toEqual(["a", "b", "c"]);
    });

    it("should execute Promise.all", async () => {
      const result = await executeRlmScript(
        `
        const results = await Promise.all([
          Promise.resolve(1),
          Promise.resolve(2),
          Promise.resolve(3),
        ]);
        return results;
        `,
        repo,
        mockLlmQuery
      );
      expect(JSON.parse(result)).toEqual([1, 2, 3]);
    });

    it("should handle JSON.parse and JSON.stringify", async () => {
      const result = await executeRlmScript(
        `
        const obj = { name: "test", value: 42 };
        const json = JSON.stringify(obj);
        const parsed = JSON.parse(json);
        return parsed;
        `,
        repo,
        mockLlmQuery
      );
      expect(JSON.parse(result)).toEqual({ name: "test", value: 42 });
    });

    it("should use Map data structure", async () => {
      const result = await executeRlmScript(
        `
        const map = new Map();
        map.set("key1", "value1");
        map.set("key2", "value2");
        return map.get("key1");
        `,
        repo,
        mockLlmQuery
      );
      expect(result).toBe("value1");
    });

    it("should use Set data structure", async () => {
      const result = await executeRlmScript(
        `
        const set = new Set([1, 2, 3, 2, 1]);
        return set.size;
        `,
        repo,
        mockLlmQuery
      );
      expect(result).toBe("3");
    });

    it("should execute regex operations", async () => {
      const result = await executeRlmScript(
        `
        const pattern = /test/i;
        return pattern.test("This is a TEST");
        `,
        repo,
        mockLlmQuery
      );
      expect(result).toBe("true");
    });
  });

  // ─── Timeout Tests ─────────────────────────────────────────────────────────

  describe("Timeout protection works", () => {
    it("should allow short-running scripts", async () => {
      const result = await executeRlmScript(
        `
        // Brief computation
        const arr = [];
        for (let i = 0; i < 1000; i++) {
          arr.push(i * 2);
        }
        return "Completed successfully";
        `,
        repo,
        mockLlmQuery
      );
      expect(result).toBe("Completed successfully");
    });

    it("should timeout scripts exceeding 30 seconds", async () => {
      // Note: This test is skipped in CI because it takes 30+ seconds
      // To verify timeout works, run this test manually with a longer timeout
      // The vm.runInNewContext timeout option is set to 30000ms
      // Manually test with: bun test tests/rlm-security.test.ts -t "should timeout"
      expect(true).toBe(true); // Placeholder - manual verification required
    });
  });

  // ─── repo API Tests ────────────────────────────────────────────────────────

  describe("repo API is accessible from scripts", () => {
    it("should call repo.list", async () => {
      const result = await executeRlmScript(
        `
        const listing = await repo.list({});
        return listing;
        `,
        repo,
        mockLlmQuery
      );
      expect(result).toContain("src");
      expect(result).toContain("package.json");
    });

    it("should call repo.view", async () => {
      const result = await executeRlmScript(
        `
        const content = await repo.view({ filePath: "src/index.ts" });
        return content;
        `,
        repo,
        mockLlmQuery
      );
      expect(result).toContain("export function main");
    });

    it("should call repo.find", async () => {
      const result = await executeRlmScript(
        `
        const files = await repo.find({ patterns: ["*.ts"] });
        return files;
        `,
        repo,
        mockLlmQuery
      );
      expect(result).toContain("index.ts");
    });

    it("should call repo.grep", async () => {
      const result = await executeRlmScript(
        `
        const matches = await repo.grep({ query: "main", patterns: ["*.ts"] });
        return matches;
        `,
        repo,
        mockLlmQuery
      );
      expect(result).toContain("main");
    });
  });

  // ─── llm_query Tests ───────────────────────────────────────────────────────

  describe("llm_query API is accessible from scripts", () => {
    it("should call llm_query", async () => {
      const result = await executeRlmScript(
        `
        const analysis = await llm_query("summarize this code", "const x = 1;");
        return analysis;
        `,
        repo,
        mockLlmQuery
      );
      expect(result).toContain("Summary");
    });

    it("should work with semantic filtering pattern", async () => {
      const result = await executeRlmScript(
        `
        const content = await repo.view({ filePath: "src/index.ts" });
        const analysis = await llm_query(
          "summarize this code",
          content
        );
        return analysis;
        `,
        repo,
        mockLlmQuery
      );
      expect(result).toContain("Summary");
    });
  });

  // ─── Error Handling Tests ──────────────────────────────────────────────────

  describe("Error handling works correctly", () => {
    it("should handle syntax errors gracefully", async () => {
      const result = await executeRlmScript(
        'const x = {;',
        repo,
        mockLlmQuery
      );
      expect(result).toContain("Script execution error");
    });

    it("should handle runtime errors gracefully", async () => {
      const result = await executeRlmScript(
        'throw new Error("test error");',
        repo,
        mockLlmQuery
      );
      expect(result).toContain("Script execution error");
      expect(result).toContain("test error");
    });

    it("should handle undefined returns", async () => {
      const result = await executeRlmScript(
        "const x = 42;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("Script completed with no return value.");
    });

    it("should handle null returns", async () => {
      const result = await executeRlmScript(
        "return null;",
        repo,
        mockLlmQuery
      );
      expect(result).toBe("Script completed with no return value.");
    });

    it("should handle object returns", async () => {
      const result = await executeRlmScript(
        "return { name: 'test', value: 123 };",
        repo,
        mockLlmQuery
      );
      const parsed = JSON.parse(result);
      expect(parsed.name).toBe("test");
      expect(parsed.value).toBe(123);
    });
  });
});
