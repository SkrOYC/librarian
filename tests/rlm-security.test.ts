import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  createRepoApi,
  executeRlmScript,
  type RepoApi,
  type RlmExecutionResult,
} from "../src/agents/rlm-sandbox.js";

const getReturn = (result: RlmExecutionResult): unknown =>
  result.buffers.__returnValue;

describe("RLM sandbox security", () => {
  let testDir: string;
  let repo: RepoApi;

  const mockLlmQuery = async (
    _instruction: string,
    data: string,
  ): Promise<string> => `Analyzed ${data.length} characters.`;

  beforeAll(() => {
    testDir = path.join(process.cwd(), `test-rlm-security-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, "src", "index.ts"),
      'export function main() { return "hello"; }\n',
    );
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      '{"name":"test","version":"1.0.0"}\n',
    );

    repo = createRepoApi(testDir);
  });

  afterAll(async () => {
    if (fs.existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe("blocked globals", () => {
    for (const globalName of [
      "process",
      "require",
      "Buffer",
      "fetch",
      "XMLHttpRequest",
      "child_process",
      "fs",
      "http",
      "setImmediate",
      "setInterval",
      "clearImmediate",
      "clearInterval",
      "queueMicrotask",
      "module",
      "__dirname",
      "__filename",
    ]) {
      it(`should block ${globalName}`, async () => {
        const result = await executeRlmScript(
          `return typeof ${globalName};`,
          repo,
          mockLlmQuery,
        );

        expect(getReturn(result)).toBe("undefined");
      });
    }
  });

  describe("safe globals", () => {
    for (const [name, expectedType] of [
      ["console", "object"],
      ["JSON", "object"],
      ["Math", "object"],
      ["Array", "function"],
      ["Object", "function"],
      ["Promise", "function"],
    ] as const) {
      it(`should expose ${name}`, async () => {
        const result = await executeRlmScript(
          `return typeof ${name};`,
          repo,
          mockLlmQuery,
        );

        expect(getReturn(result)).toBe(expectedType);
      });
    }
  });

  describe("sandboxed capabilities", () => {
    it("should expose structured repo helpers to scripts", async () => {
      const result = await executeRlmScript(
        `
          const listing = await repo.list({});
          const file = await repo.view({ filePath: "src/index.ts" });
          const found = await repo.find({ patterns: ["*.ts"] });
          const grep = await repo.grep({ query: "main", patterns: ["*.ts"] });
          return {
            hasSrc: listing.entries.some((entry) => entry.name === "src"),
            lineCount: file.totalLines,
            foundIndex: found.files.includes("src/index.ts"),
            grepMatches: grep.totalMatches
          };
        `,
        repo,
        mockLlmQuery,
      );

      expect(getReturn(result)).toEqual({
        hasSrc: true,
        lineCount: 1,
        foundIndex: true,
        grepMatches: 1,
      });
    });

    it("should expose llm_query to scripts", async () => {
      const result = await executeRlmScript(
        `
          return await llm_query("summarize", "some code here");
        `,
        repo,
        mockLlmQuery,
      );

      expect(getReturn(result)).toBe("Analyzed 14 characters.");
    });

    it("should keep path traversal blocked inside repo helpers", async () => {
      const result = await executeRlmScript(
        `
          try {
            await repo.view({ filePath: "../../etc/passwd" });
            return "unexpected";
          } catch (error) {
            return {
              kind: error.kind,
              code: error.code,
            };
          }
        `,
        repo,
        mockLlmQuery,
      );

      expect(getReturn(result)).toEqual({
        kind: "repo",
        code: "REPO_TOOL_PARSE_FAILED",
      });
    });
  });
});
