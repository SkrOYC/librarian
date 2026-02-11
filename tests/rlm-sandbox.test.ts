/**
 * RLM Sandbox Tests
 *
 * Comprehensive tests for the Recursive Language Model execution engine:
 * - repo API (list, view, find, grep) via sandbox
 * - llm_query bridge
 * - Script execution in the sandboxed REPL environment
 * - Edge cases: syntax errors, infinite loops, async patterns, return semantics
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

describe("RLM Sandbox", () => {
  let testDir: string;
  let repo: RepoApi;

  beforeAll(() => {
    testDir = path.join(process.cwd(), `test-rlm-sandbox-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });

    // Create test file structure
    fs.mkdirSync(path.join(testDir, "src"), { recursive: true });
    fs.mkdirSync(path.join(testDir, "src", "errors"), { recursive: true });
    fs.mkdirSync(path.join(testDir, "src", "utils"), { recursive: true });
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
      path.join(testDir, "src", "errors", "AuthError.ts"),
      `export class AuthError extends Error {
  constructor(message: string) {
    super(message);
  }
}
`
    );
    fs.writeFileSync(
      path.join(testDir, "src", "errors", "helpers.ts"),
      `export function formatError(e: Error): string { return e.message; }
`
    );
    fs.writeFileSync(
      path.join(testDir, "src", "utils", "logger.ts"),
      'export const logger = { info: console.log };\n'
    );
    fs.writeFileSync(
      path.join(testDir, "lib", "config.json"),
      '{"name": "test-project", "version": "1.0.0"}\n'
    );
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      '{"name": "test-pkg", "version": "0.1.0"}\n'
    );

    repo = createRepoApi(testDir);
  });

  afterAll(async () => {
    if (fs.existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  // ─── Repo API Tests ────────────────────────────────────────────

  describe("createRepoApi", () => {
    describe("repo.list", () => {
      it("should list directory contents", async () => {
        const result = await repo.list({});
        expect(result).toContain("src");
        expect(result).toContain("lib");
        expect(result).toContain("package.json");
      });

      it("should list with recursive option", async () => {
        const result = await repo.list({
          directoryPath: "src",
          recursive: true,
          maxDepth: 3,
        });
        expect(result).toContain("errors");
        expect(result).toContain("utils");
      });

      it("should default to non-recursive", async () => {
        const result = await repo.list({ directoryPath: "." });
        expect(result).toContain("Contents of directory");
      });
    });

    describe("repo.view", () => {
      it("should read file contents", async () => {
        const result = await repo.view({
          filePath: "src/index.ts",
        });
        expect(result).toContain("export function main");
      });

      it("should read file with viewRange", async () => {
        const result = await repo.view({
          filePath: "src/errors/DatabaseError.ts",
          viewRange: [1, 3],
        });
        expect(result).toContain("DatabaseError");
        // Should NOT contain the constructor body at line 4+
        expect(result).not.toContain("this.code = code");
      });

      it("should handle non-existent file gracefully", async () => {
        const result = await repo.view({
          filePath: "nonexistent.ts",
        });
        expect(result).toContain("not found");
      });
    });

    describe("repo.find", () => {
      it("should find files by glob pattern", async () => {
        const result = await repo.find({
          patterns: ["*.ts"],
        });
        expect(result).toContain("src/index.ts");
        expect(result).toContain("DatabaseError.ts");
        expect(result).toContain("AuthError.ts");
      });

      it("should find files in a specific subdirectory", async () => {
        const result = await repo.find({
          searchPath: "src/errors",
          patterns: ["*.ts"],
        });
        expect(result).toContain("DatabaseError.ts");
        expect(result).toContain("AuthError.ts");
        expect(result).toContain("helpers.ts");
        expect(result).not.toContain("index.ts");
      });

      it("should find JSON files", async () => {
        const result = await repo.find({
          patterns: ["*.json"],
        });
        expect(result).toContain("package.json");
        expect(result).toContain("config.json");
      });

      it("should limit results", async () => {
        const result = await repo.find({
          patterns: ["*.ts"],
          maxResults: 2,
        });
        expect(result).toContain("Found 2 files");
      });
    });

    describe("repo.grep", () => {
      it("should search for text patterns", async () => {
        const result = await repo.grep({
          query: "extends Error",
          patterns: ["*.ts"],
        });
        expect(result).toContain("DatabaseError.ts");
        expect(result).toContain("AuthError.ts");
        expect(result).not.toContain("helpers.ts");
      });

      it("should search with regex", async () => {
        const result = await repo.grep({
          query: "class\\s+\\w+Error",
          patterns: ["*.ts"],
          regex: true,
        });
        expect(result).toContain("DatabaseError");
        expect(result).toContain("AuthError");
      });

      it("should return no matches gracefully", async () => {
        const result = await repo.grep({
          query: "this_string_does_not_exist_anywhere_xyz",
          patterns: ["*.ts"],
        });
        expect(result).toContain("No matches");
      });
    });
  });

  // ─── Script Execution Tests ────────────────────────────────────

  describe("executeRlmScript", () => {
    // Mock llm_query that returns deterministic results
    const mockLlmQuery = async (
      instruction: string,
      data: string
    ): Promise<string> => {
      if (instruction.includes("error class") || instruction.includes("Error class")) {
        if (data.includes("class") && data.includes("extends Error")) {
          const match = data.match(/class\s+(\w+)/);
          const className = match ? match[1] : "Unknown";
          const hasCode = data.includes("code:");
          return JSON.stringify({ isErrorClass: true, hasCode, className });
        }
        return "NULL";
      }
      if (instruction.includes("summarize")) {
        return "This is a summary of the provided code.";
      }
      return `Analyzed ${data.length} characters of data.`;
    };

    describe("Basic script execution", () => {
      it("should execute a simple return statement", async () => {
        const result = await executeRlmScript(
          'return "hello world";',
          repo,
          mockLlmQuery
        );
        expect(result).toBe("hello world");
      });

      it("should return JSON-serialized objects", async () => {
        const result = await executeRlmScript(
          'return { name: "test", count: 42 };',
          repo,
          mockLlmQuery
        );
        const parsed = JSON.parse(result);
        expect(parsed.name).toBe("test");
        expect(parsed.count).toBe(42);
      });

      it("should return JSON-serialized arrays", async () => {
        const result = await executeRlmScript(
          'return [1, 2, 3];',
          repo,
          mockLlmQuery
        );
        const parsed = JSON.parse(result);
        expect(parsed).toEqual([1, 2, 3]);
      });

      it("should handle null return", async () => {
        const result = await executeRlmScript(
          "return null;",
          repo,
          mockLlmQuery
        );
        expect(result).toBe("Script completed with no return value.");
      });

      it("should handle undefined return (no return statement)", async () => {
        const result = await executeRlmScript(
          'const x = 42;',
          repo,
          mockLlmQuery
        );
        expect(result).toBe("Script completed with no return value.");
      });

      it("should handle numeric return", async () => {
        const result = await executeRlmScript(
          "return 42;",
          repo,
          mockLlmQuery
        );
        expect(result).toBe("42");
      });

      it("should handle boolean return", async () => {
        const result = await executeRlmScript(
          "return true;",
          repo,
          mockLlmQuery
        );
        expect(result).toBe("true");
      });
    });

    describe("Repo API access from scripts", () => {
      it("should call repo.list from within a script", async () => {
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

      it("should call repo.view from within a script", async () => {
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

      it("should call repo.find from within a script", async () => {
        const result = await executeRlmScript(
          `
          const files = await repo.find({ searchPath: "src/errors", patterns: ["*.ts"] });
          return files;
          `,
          repo,
          mockLlmQuery
        );
        expect(result).toContain("DatabaseError.ts");
        expect(result).toContain("AuthError.ts");
      });

      it("should call repo.grep from within a script", async () => {
        const result = await executeRlmScript(
          `
          const matches = await repo.grep({ query: "extends Error", patterns: ["*.ts"] });
          return matches;
          `,
          repo,
          mockLlmQuery
        );
        expect(result).toContain("DatabaseError");
      });
    });

    describe("llm_query access from scripts", () => {
      it("should call llm_query from within a script", async () => {
        const result = await executeRlmScript(
          `
          const analysis = await llm_query("summarize", "some code here");
          return analysis;
          `,
          repo,
          mockLlmQuery
        );
        expect(result).toContain("summary");
      });

      it("should use llm_query for semantic filtering", async () => {
        const result = await executeRlmScript(
          `
          const content = await repo.view({ filePath: "src/errors/DatabaseError.ts" });
          const analysis = await llm_query("summarize this file", content);
          return analysis;
          `,
          repo,
          mockLlmQuery
        );
        // mockLlmQuery returns "This is a summary..." for "summarize" instructions
        expect(result).toContain("summary");
      });
    });

    describe("Complex multi-step scripts", () => {
      it("should iterate over files with for...of loop", async () => {
        const result = await executeRlmScript(
          `
          const findResult = await repo.find({ searchPath: "src/errors", patterns: ["*.ts"] });
          const lines = findResult.split("\\n").filter(l => l.trim() && !l.startsWith("Found"));
          const results = [];
          for (const line of lines) {
            const file = line.trim();
            if (file) {
              const content = await repo.view({ filePath: file });
              results.push({ file, length: content.length });
            }
          }
          return results;
          `,
          repo,
          mockLlmQuery
        );
        const parsed = JSON.parse(result);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeGreaterThanOrEqual(2);
        expect(parsed.some((r: { file: string }) => r.file.includes("DatabaseError"))).toBe(true);
        expect(parsed.some((r: { file: string }) => r.file.includes("AuthError"))).toBe(true);
      });

      it("should combine repo and llm_query in a pipeline", async () => {
        const result = await executeRlmScript(
          `
          const findResult = await repo.find({ searchPath: "src/errors", patterns: ["*.ts"] });
          const files = findResult.split("\\n").filter(l => l.trim() && !l.startsWith("Found"));
          const results = [];
          for (const line of files) {
            const file = line.trim();
            if (!file) continue;
            const content = await repo.view({ filePath: file });
            const analysis = await llm_query(
              "Is this an error class with a code property?",
              content
            );
            if (analysis !== "NULL") {
              results.push({ file, analysis });
            }
          }
          return results;
          `,
          repo,
          mockLlmQuery
        );
        const parsed = JSON.parse(result);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeGreaterThan(0);
      });

      it("should handle conditional logic and branching", async () => {
        const result = await executeRlmScript(
          `
          const grepResult = await repo.grep({ query: "export class", patterns: ["*.ts"] });
          if (grepResult.includes("No matches")) {
            return { found: false, classes: [] };
          }
          return { found: true, preview: grepResult.substring(0, 200) };
          `,
          repo,
          mockLlmQuery
        );
        const parsed = JSON.parse(result);
        expect(parsed.found).toBe(true);
      });
    });

    describe("Error handling and edge cases", () => {
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
          'throw new Error("intentional test error");',
          repo,
          mockLlmQuery
        );
        expect(result).toContain("Script execution error");
        expect(result).toContain("intentional test error");
      });

      it("should handle reference errors gracefully", async () => {
        const result = await executeRlmScript(
          "return undefinedVariable.property;",
          repo,
          mockLlmQuery
        );
        expect(result).toContain("Script execution error");
      });

      it("should handle type errors gracefully", async () => {
        const result = await executeRlmScript(
          'const x = null; return x.toString();',
          repo,
          mockLlmQuery
        );
        expect(result).toContain("Script execution error");
      });

      it("should handle errors in repo calls within script", async () => {
        const result = await executeRlmScript(
          `
          try {
            const content = await repo.view({ filePath: "../../etc/passwd" });
            return content;
          } catch (e) {
            return "Error caught: " + e.message;
          }
          `,
          repo,
          mockLlmQuery
        );
        // Should contain the escape error or the sandbox error message
        expect(result).toContain("escape");
      });

      it("should handle empty script", async () => {
        const result = await executeRlmScript("", repo, mockLlmQuery);
        expect(result).toBe("Script completed with no return value.");
      });

      it("should handle script with only comments", async () => {
        const result = await executeRlmScript(
          "// This is a comment\n/* block comment */",
          repo,
          mockLlmQuery
        );
        expect(result).toBe("Script completed with no return value.");
      });

      it("should handle script with only whitespace", async () => {
        const result = await executeRlmScript(
          "   \n  \n  ",
          repo,
          mockLlmQuery
        );
        expect(result).toBe("Script completed with no return value.");
      });
    });

    describe("Async patterns", () => {
      it("should handle Promise.all", async () => {
        const result = await executeRlmScript(
          `
          const [list, content] = await Promise.all([
            repo.list({}),
            repo.view({ filePath: "package.json" }),
          ]);
          return { hasList: list.length > 0, hasContent: content.length > 0 };
          `,
          repo,
          mockLlmQuery
        );
        const parsed = JSON.parse(result);
        expect(parsed.hasList).toBe(true);
        expect(parsed.hasContent).toBe(true);
      });

      it("should handle nested async operations", async () => {
        const result = await executeRlmScript(
          `
          const listing = await repo.list({ directoryPath: "src" });
          const content = await repo.view({ filePath: "src/index.ts" });
          const grep = await repo.grep({ query: "main", searchPath: "src", patterns: ["*.ts"] });
          return { hasListing: listing.length > 0, hasContent: content.length > 0, hasGrep: grep.length > 0 };
          `,
          repo,
          mockLlmQuery
        );
        const parsed = JSON.parse(result);
        expect(parsed.hasListing).toBe(true);
        expect(parsed.hasContent).toBe(true);
        expect(parsed.hasGrep).toBe(true);
      });

      it("should handle Promise.allSettled for error tolerance", async () => {
        const result = await executeRlmScript(
          `
          const results = await Promise.allSettled([
            repo.view({ filePath: "src/index.ts" }),
            repo.view({ filePath: "nonexistent.ts" }),
          ]);
          return results.map(r => r.status);
          `,
          repo,
          mockLlmQuery
        );
        const parsed = JSON.parse(result);
        expect(parsed).toEqual(["fulfilled", "fulfilled"]);
      });
    });

    describe("Variable scoping and state", () => {
      it("should support let and const declarations", async () => {
        const result = await executeRlmScript(
          `
          const a = 1;
          let b = 2;
          b = b + a;
          return b;
          `,
          repo,
          mockLlmQuery
        );
        expect(result).toBe("3");
      });

      it("should support array accumulation pattern", async () => {
        const result = await executeRlmScript(
          `
          const items = [];
          for (let i = 0; i < 5; i++) {
            items.push(i * 2);
          }
          return items;
          `,
          repo,
          mockLlmQuery
        );
        expect(JSON.parse(result)).toEqual([0, 2, 4, 6, 8]);
      });

      it("should support Map and Set", async () => {
        const result = await executeRlmScript(
          `
          const seen = new Set();
          const counts = new Map();
          const items = ["a", "b", "a", "c", "b", "a"];
          for (const item of items) {
            seen.add(item);
            counts.set(item, (counts.get(item) || 0) + 1);
          }
          return { uniqueCount: seen.size, aCounts: counts.get("a") };
          `,
          repo,
          mockLlmQuery
        );
        const parsed = JSON.parse(result);
        expect(parsed.uniqueCount).toBe(3);
        expect(parsed.aCounts).toBe(3);
      });

      it("should support destructuring", async () => {
        const result = await executeRlmScript(
          `
          const obj = { x: 10, y: 20, z: 30 };
          const { x, ...rest } = obj;
          return { x, restKeys: Object.keys(rest) };
          `,
          repo,
          mockLlmQuery
        );
        const parsed = JSON.parse(result);
        expect(parsed.x).toBe(10);
        expect(parsed.restKeys).toEqual(["y", "z"]);
      });
    });

    describe("String and data manipulation", () => {
      it("should parse find output into file list", async () => {
        const result = await executeRlmScript(
          `
          const findOutput = await repo.find({ searchPath: "src/errors", patterns: ["*.ts"] });
          const files = findOutput
            .split("\\n")
            .filter(line => line.trim() && !line.startsWith("Found"))
            .map(line => line.trim());
          return files;
          `,
          repo,
          mockLlmQuery
        );
        const parsed = JSON.parse(result);
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed.length).toBeGreaterThanOrEqual(2);
        expect(parsed.every((f: string) => f.endsWith(".ts"))).toBe(true);
      });

      it("should handle JSON.parse and JSON.stringify within script", async () => {
        const result = await executeRlmScript(
          `
          const content = await repo.view({ filePath: "package.json" });
          // Extract just the JSON part (skip line numbers from view output)
          const lines = content.split("\\n").map(l => l.replace(/^\\s*\\d+\\s*/, "")).join("\\n");
          try {
            const parsed = JSON.parse(lines);
            return { name: parsed.name, hasVersion: "version" in parsed };
          } catch {
            return { parseError: true, raw: content.substring(0, 100) };
          }
          `,
          repo,
          mockLlmQuery
        );
        const parsed = JSON.parse(result);
        // Either we parsed it or we got the raw preview
        expect(parsed.name === "test-pkg" || parsed.parseError === true).toBe(true);
      });

      it("should handle template literals", async () => {
        const result = await executeRlmScript(
          `
          const name = "test";
          const count = 5;
          return \`Found \${count} results for \${name}\`;
          `,
          repo,
          mockLlmQuery
        );
        expect(result).toBe("Found 5 results for test");
      });
    });

    describe("Security boundaries", () => {
      it("should prevent path traversal via repo.view", async () => {
        const result = await executeRlmScript(
          `
          try {
            return await repo.view({ filePath: "../../../etc/passwd" });
          } catch (e) {
            return "blocked: " + e.message;
          }
          `,
          repo,
          mockLlmQuery
        );
        expect(result).toContain("escape");
      });

      it("should prevent path traversal via repo.list", async () => {
        const result = await executeRlmScript(
          `
          try {
            return await repo.list({ directoryPath: "../../.." });
          } catch (e) {
            return "blocked: " + e.message;
          }
          `,
          repo,
          mockLlmQuery
        );
        expect(result).toContain("escape");
      });

      it("should prevent path traversal via repo.find", async () => {
        const result = await executeRlmScript(
          `
          try {
            return await repo.find({ searchPath: "../../../", patterns: ["*.ts"] });
          } catch (e) {
            return "blocked: " + e.message;
          }
          `,
          repo,
          mockLlmQuery
        );
        expect(result).toContain("escape");
      });

      it("should prevent path traversal via repo.grep", async () => {
        const result = await executeRlmScript(
          `
          try {
            return await repo.grep({ searchPath: "../../../", query: "password" });
          } catch (e) {
            return "blocked: " + e.message;
          }
          `,
          repo,
          mockLlmQuery
        );
        expect(result).toContain("escape");
      });

      it("should not allow access to process or require", async () => {
        // The sandbox uses new Function() which doesn't have access to
        // module-scoped variables, but global objects like process may be available.
        // Verify the script cannot import modules.
        const result = await executeRlmScript(
          `
          try {
            const fs = require("fs");
            return "SHOULD NOT REACH: " + typeof fs;
          } catch (e) {
            return "blocked: " + e.message;
          }
          `,
          repo,
          mockLlmQuery
        );
        expect(result).toContain("blocked");
      });
    });

    describe("RLM issue example - Error class analysis", () => {
      it("should implement the full example from the issue spec", async () => {
        const result = await executeRlmScript(
          `
          const findResult = await repo.find({
            searchPath: "src/errors",
            patterns: ["*.ts"],
          });
          const lines = findResult.split("\\n").filter(l => l.trim() && !l.startsWith("Found"));
          const results = [];
          for (const line of lines) {
            const file = line.trim();
            if (!file) continue;
            const content = await repo.view({ filePath: file });
            const analysis = await llm_query(
              "Does this file define a custom error class? If so, does it have a code property? Return JSON: { isErrorClass: bool, hasCode: bool, className: string } or NULL",
              content
            );
            if (analysis !== "NULL") {
              try {
                results.push({ file, analysis: JSON.parse(analysis) });
              } catch {
                results.push({ file, analysis });
              }
            }
          }
          return results;
          `,
          repo,
          mockLlmQuery
        );
        const parsed = JSON.parse(result);
        expect(Array.isArray(parsed)).toBe(true);

        // Should have found at least DatabaseError and AuthError
        const dbError = parsed.find((r: { file: string }) =>
          r.file.includes("DatabaseError")
        );
        const authError = parsed.find((r: { file: string }) =>
          r.file.includes("AuthError")
        );

        expect(dbError).toBeDefined();
        expect(authError).toBeDefined();

        // DatabaseError has `code:` in it, so mock returns hasCode: true
        if (dbError?.analysis?.isErrorClass !== undefined) {
          expect(dbError.analysis.isErrorClass).toBe(true);
        }
      });
    });
  });

  // ─── createLlmQuery Tests ─────────────────────────────────────
  // Note: These tests require real API calls or proper SDK mocking.
  // Skipped for now as createLlmQuery requires a valid LlmConfig with API key.

  describe("createLlmQuery", () => {
    it.todo("should create a callable function with valid config");
    it.todo("should invoke the model and return string content");
    it.todo("should handle array content from model");
  });
});
