/**
 * RLM Tool Tests
 *
 * Tests for the research_repository LangChain tool.
 * Verifies tool metadata, context requirements, and integration with the sandbox.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { rm } from "node:fs/promises";
import { ChatAnthropic } from "@langchain/anthropic";
import type { LlmConfig } from "../src/agents/rlm-sandbox.js";
import { createResearchRepositoryTool } from "../src/agents/rlm-tool.js";

describe("RLM Tool - research_repository", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = path.join(process.cwd(), `test-rlm-tool-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(
      path.join(testDir, "hello.ts"),
      'export function greet() { return "hello"; }\n'
    );
    fs.writeFileSync(
      path.join(testDir, "world.ts"),
      'export function farewell() { return "goodbye"; }\n'
    );
    fs.mkdirSync(path.join(testDir, "sub"), { recursive: true });
    fs.writeFileSync(
      path.join(testDir, "sub", "nested.ts"),
      'export const value = 42;\n'
    );
  });

  afterAll(async () => {
    if (fs.existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  // Create a mock LLM config for llm_query
  const mockLlmConfig: LlmConfig = {
    type: "anthropic",
    apiKey: "test-key",
    model: "claude-sonnet-4-5-20250929",
  };

  describe("Tool metadata", () => {
    it("should have correct tool name", () => {
      const tool = createResearchRepositoryTool(mockLlmConfig);
      expect(tool.name).toBe("research_repository");
    });

    it("should have a description", () => {
      const tool = createResearchRepositoryTool(mockLlmConfig);
      expect(tool.description).toContain("TypeScript script");
      expect(tool.description).toContain("repo.find");
      expect(tool.description).toContain("repo.grep");
      expect(tool.description).toContain("repo.list");
      expect(tool.description).toContain("repo.view");
      expect(tool.description).toContain("llm_query");
      expect(tool.description).toContain("FINAL");
    });
  });

  describe("Tool invocation", () => {
    it("should require workingDir in context", async () => {
      const tool = createResearchRepositoryTool(mockLlmConfig);
      try {
        await tool.invoke({ script: 'return "test";' }, {});
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect((error as Error).message).toContain("workingDir");
      }
    });

    it("should execute a simple script with context", async () => {
      const tool = createResearchRepositoryTool(mockLlmConfig);
      const context = { workingDir: testDir, group: "test", technology: "test" };

      const result = await tool.invoke(
        { script: 'return "hello from tool";' },
        { context }
      );
      expect(result).toBe("hello from tool");
    });

    it("should provide repo API to scripts", async () => {
      const tool = createResearchRepositoryTool(mockLlmConfig);
      const context = { workingDir: testDir, group: "test", technology: "test" };

      const result = await tool.invoke(
        {
          script: `
            const listing = await repo.list({});
            return listing.includes("hello.ts") ? "found" : "not found";
          `,
        },
        { context }
      );
      expect(result).toBe("found");
    });

    it("should provide llm_query to scripts", async () => {
      const tool = createResearchRepositoryTool(mockLlmConfig);
      const context = { workingDir: testDir, group: "test", technology: "test" };

      const result = await tool.invoke(
        {
          script: `
            // llm_query is available but requires valid API key
            // It will throw an auth error when called
            return typeof llm_query === "function" ? "llm_query available" : "llm_query not found";
          `,
        },
        { context }
      );
      expect(result).toBe("llm_query available");
    });

    it("should handle script errors gracefully", async () => {
      const tool = createResearchRepositoryTool(mockLlmConfig);
      const context = { workingDir: testDir, group: "test", technology: "test" };

      const result = await tool.invoke(
        { script: 'throw new Error("test error");' },
        { context }
      );
      expect(result).toContain("Script execution error");
      expect(result).toContain("test error");
    });

    it("should scope file operations to workingDir", async () => {
      const tool = createResearchRepositoryTool(mockLlmConfig);
      const context = { workingDir: testDir, group: "test", technology: "test" };

      const result = await tool.invoke(
        {
          script: `
            const files = await repo.find({ patterns: ["*.ts"] });
            return files;
          `,
        },
        { context }
      );
      expect(result).toContain("hello.ts");
      expect(result).toContain("world.ts");
      expect(result).toContain("nested.ts");
    });

    it("should execute a complete exploration pipeline", async () => {
      const tool = createResearchRepositoryTool(mockLlmConfig);
      const context = { workingDir: testDir, group: "test", technology: "test" };

      const result = await tool.invoke(
        {
          script: `
            const findOutput = await repo.find({ patterns: ["*.ts"] });
            // Use JSON.parse to parse the find output
            const { files } = JSON.parse(findOutput);
            const analyzed = [];
            for (const file of files) {
              const content = await repo.view({ filePath: file });
              analyzed.push({ file, contentLength: content.length });
            }
            return JSON.stringify({ fileCount: analyzed.length, files: analyzed.map(a => a.file) });
          `,
        },
        { context }
      );
      const parsed = JSON.parse(result);
      expect(parsed.fileCount).toBeGreaterThanOrEqual(2);
      expect(parsed.files.some((f: string) => f.includes("hello.ts"))).toBe(true);
    });
  });
});