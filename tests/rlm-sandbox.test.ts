import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  createRootModelQuery,
  createRepoApi,
  createSubModelQuery,
  executeRlmScript,
  type RepoApi,
  type RlmExecutionResult,
} from "../src/agents/rlm-sandbox.js";

const getReturn = (result: RlmExecutionResult): unknown =>
  result.buffers.__returnValue;

describe("RLM sandbox", () => {
  let testDir: string;
  let repo: RepoApi;

  const mockLlmQuery = async (
    instruction: string,
    data: string,
  ): Promise<string> => {
    if (instruction.includes("summarize")) {
      return `Summary for ${data.length} chars`;
    }
    if (instruction.includes("error class")) {
      return data.includes("extends Error")
        ? '{"isErrorClass":true,"hasCode":true}'
        : "NULL";
    }
    return `Analyzed ${data.length} chars`;
  };

  beforeAll(() => {
    testDir = path.join(process.cwd(), `test-rlm-sandbox-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, "src", "errors"), { recursive: true });
    fs.mkdirSync(path.join(testDir, "src", "utils"), { recursive: true });
    fs.mkdirSync(path.join(testDir, "lib"), { recursive: true });

    fs.writeFileSync(
      path.join(testDir, "src", "index.ts"),
      'export function main() { return "hello"; }\n',
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
`,
    );
    fs.writeFileSync(
      path.join(testDir, "src", "errors", "AuthError.ts"),
      `export class AuthError extends Error {
  constructor(message: string) {
    super(message);
  }
}
`,
    );
    fs.writeFileSync(
      path.join(testDir, "src", "utils", "logger.ts"),
      "export const logger = { info: console.log };\n",
    );
    fs.writeFileSync(
      path.join(testDir, "lib", "config.json"),
      '{"name":"test-project","version":"1.0.0"}\n',
    );
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      '{"name":"test-pkg","version":"0.1.0"}\n',
    );

    repo = createRepoApi(testDir);
  });

  afterAll(async () => {
    if (fs.existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe("language model configuration", () => {
    it("should require a baseURL for openai-compatible providers", async () => {
      const query = createRootModelQuery(
        {
          type: "openai-compatible",
          apiKey: "test-key",
          model: "gpt-5",
        },
        "system prompt",
      );

      await expect(query("history")).rejects.toThrow(
        "baseURL is required for openai-compatible provider",
      );
    });

    it("should require a baseURL for anthropic-compatible providers", async () => {
      const query = createSubModelQuery({
        type: "anthropic-compatible",
        apiKey: "test-key",
        model: "claude-sonnet-4-5",
      });

      await expect(query("instruction", "data")).rejects.toThrow(
        "baseURL is required for anthropic-compatible provider",
      );
    });

    it("should require a model for anthropic-compatible providers", async () => {
      const query = createSubModelQuery({
        type: "anthropic-compatible",
        apiKey: "test-key",
        baseURL: "https://example.test/v1",
      });

      await expect(query("instruction", "data")).rejects.toThrow(
        "model is required for anthropic-compatible provider",
      );
    });
  });

  describe("createRepoApi", () => {
    it("should return structured directory listings", async () => {
      const result = await repo.list({ directoryPath: ".", recursive: false });

      expect(result.directory.endsWith(path.basename(testDir))).toBe(true);
      expect(result.totalEntries).toBeGreaterThan(0);
      expect(result.entries.some((entry) => entry.name === "src")).toBe(true);
      expect(result.entries.some((entry) => entry.name === "package.json")).toBe(true);
    });

    it("should return structured file views with numbered lines", async () => {
      const result = await repo.view({
        filePath: "src/errors/DatabaseError.ts",
        viewRange: [1, 3],
      });

      expect(result.filePath).toBe("src/errors/DatabaseError.ts");
      expect(result.viewRange).toEqual([1, 3]);
      expect(result.lines[0]?.lineNumber).toBe(1);
      expect(result.lines.map((line) => line.content).join("\n")).toContain(
        "DatabaseError",
      );
      expect(result.lines.map((line) => line.content).join("\n")).not.toContain(
        "this.code = code",
      );
    });

    it("should return structured glob results", async () => {
      const result = await repo.find({
        searchPath: "src/errors",
        patterns: ["*.ts"],
      });

      expect(result.totalFiles).toBe(2);
      expect(result.files).toContain("src/errors/DatabaseError.ts");
      expect(result.files).toContain("src/errors/AuthError.ts");
    });

    it("should return structured grep results", async () => {
      const result = await repo.grep({
        query: "extends Error",
        patterns: ["*.ts"],
      });

      expect(result.totalMatches).toBeGreaterThan(0);
      expect(result.results.some((entry) => entry.path.includes("DatabaseError.ts"))).toBe(
        true,
      );
      expect(result.results.some((entry) => entry.path.includes("AuthError.ts"))).toBe(
        true,
      );
    });

    it("should throw typed repo errors for invalid paths", async () => {
      const error = await repo
        .view({ filePath: "nonexistent.ts" })
        .catch((caught) => caught as { kind?: string; code?: string });

      expect(error.kind).toBe("repo");
      expect(error.code).toBe("REPO_TOOL_PARSE_FAILED");
    });
  });

  describe("executeRlmScript", () => {
    it("should preserve primitive and null return values", async () => {
      const stringResult = await executeRlmScript(
        'return "hello world";',
        repo,
        mockLlmQuery,
      );
      const nullResult = await executeRlmScript("return null;", repo, mockLlmQuery);
      const numberResult = await executeRlmScript("return 42;", repo, mockLlmQuery);

      expect(getReturn(stringResult)).toBe("hello world");
      expect(getReturn(nullResult)).toBeNull();
      expect(getReturn(numberResult)).toBe(42);
    });

    it("should expose structured repo.list results inside scripts", async () => {
      const result = await executeRlmScript(
        `
          const listing = await repo.list({ recursive: false });
          return listing.entries.map((entry) => entry.name).sort();
        `,
        repo,
        mockLlmQuery,
      );

      expect(getReturn(result)).toEqual(["lib", "package.json", "src"]);
    });

    it("should expose structured repo.view results inside scripts", async () => {
      const result = await executeRlmScript(
        `
          const file = await repo.view({ filePath: "src/index.ts" });
          return file.lines.map((line) => line.content).join("\\n");
        `,
        repo,
        mockLlmQuery,
      );

      expect(getReturn(result)).toBe('export function main() { return "hello"; }');
    });

    it("should expose structured repo.find results inside scripts", async () => {
      const result = await executeRlmScript(
        `
          const files = await repo.find({ searchPath: "src/errors", patterns: ["*.ts"] });
          return files.files;
        `,
        repo,
        mockLlmQuery,
      );

      expect(getReturn(result)).toEqual([
        "src/errors/AuthError.ts",
        "src/errors/DatabaseError.ts",
      ]);
    });

    it("should expose structured repo.grep results inside scripts", async () => {
      const result = await executeRlmScript(
        `
          const matches = await repo.grep({ query: "extends Error", patterns: ["*.ts"] });
          return matches.results.map((entry) => entry.path).sort();
        `,
        repo,
        mockLlmQuery,
      );

      expect(getReturn(result)).toEqual([
        "src/errors/AuthError.ts",
        "src/errors/DatabaseError.ts",
      ]);
    });

    it("should allow llm_query over selected evidence", async () => {
      const result = await executeRlmScript(
        `
          const file = await repo.view({ filePath: "src/errors/DatabaseError.ts" });
          const content = file.lines.map((line) => line.content).join("\\n");
          return await llm_query("summarize this file", content);
        `,
        repo,
        mockLlmQuery,
      );

      expect(getReturn(result)).toEqual(expect.stringContaining("Summary for"));
    });

    it("should support structured multi-step analysis pipelines", async () => {
      const result = await executeRlmScript(
        `
          const files = await repo.find({ searchPath: "src/errors", patterns: ["*.ts"] });
          const analyses = [];
          for (const filePath of files.files) {
            const file = await repo.view({ filePath });
            const content = file.lines.map((line) => line.content).join("\\n");
            const analysis = await llm_query(
              "Is this an error class with a code property?",
              content
            );
            analyses.push({ filePath, analysis });
          }
          return analyses;
        `,
        repo,
        mockLlmQuery,
      );

      const analyses = getReturn(result) as Array<{
        filePath: string;
        analysis: string;
      }>;

      expect(Array.isArray(analyses)).toBe(true);
      expect(analyses).toHaveLength(2);
      expect(analyses.some((entry) => entry.filePath.includes("DatabaseError"))).toBe(
        true,
      );
    });

    it("should support conditional logic over structured grep metadata", async () => {
      const result = await executeRlmScript(
        `
          const grep = await repo.grep({ query: "export class", patterns: ["*.ts"] });
          if (grep.totalMatches === 0) {
            return { found: false, files: [] };
          }
          return { found: true, fileCount: grep.totalFiles };
        `,
        repo,
        mockLlmQuery,
      );

      expect(getReturn(result)).toEqual({ found: true, fileCount: 2 });
    });

    it("should surface syntax and runtime failures", async () => {
      const syntaxResult = await executeRlmScript("const x = {;", repo, mockLlmQuery);
      const runtimeResult = await executeRlmScript(
        'throw new Error("intentional test error");',
        repo,
        mockLlmQuery,
      );

      expect(syntaxResult.error).toBeDefined();
      expect(runtimeResult.error).toBeDefined();
    });

    it("should propagate typed repo errors through script catches", async () => {
      const result = await executeRlmScript(
        `
          try {
            await repo.view({ filePath: "../../etc/passwd" });
            return "unexpected";
          } catch (error) {
            return {
              kind: error.kind,
              code: error.code,
              message: error.message
            };
          }
        `,
        repo,
        mockLlmQuery,
      );

      expect(getReturn(result)).toEqual(
        expect.objectContaining({
          kind: "repo",
          code: "REPO_TOOL_PARSE_FAILED",
        }),
      );
    });

    it("should support Promise.all with structured helper results", async () => {
      const result = await executeRlmScript(
        `
          const [list, file] = await Promise.all([
            repo.list({}),
            repo.view({ filePath: "package.json" }),
          ]);
          return {
            hasEntries: list.totalEntries > 0,
            hasLines: file.totalLines > 0
          };
        `,
        repo,
        mockLlmQuery,
      );

      expect(getReturn(result)).toEqual({ hasEntries: true, hasLines: true });
    });

    it("should support Promise.allSettled for typed error tolerance", async () => {
      const result = await executeRlmScript(
        `
          const settled = await Promise.allSettled([
            repo.view({ filePath: "src/index.ts" }),
            repo.view({ filePath: "nonexistent.ts" }),
          ]);
          return settled.map((entry) => entry.status);
        `,
        repo,
        mockLlmQuery,
      );

      expect(getReturn(result)).toEqual(["fulfilled", "rejected"]);
    });
  });
});
