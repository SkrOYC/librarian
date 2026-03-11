/**
 * RLM Orchestrator Tests
 *
 * These tests cover the metadata-first root loop, persistent REPL behavior,
 * structured child recursion, and recovery-only fallback semantics.
 */

import { beforeEach, describe, expect, it, jest } from "bun:test";
import {
  RlmOrchestrator,
  type RlmOrchestratorConfig,
} from "../src/agents/rlm-orchestrator.js";
import type { RootRepoMetadata } from "../src/agents/rlm-types.js";

const rootMetadata: RootRepoMetadata = {
  workingDir: "/test/repo",
  targetLabel: "/test/repo",
  repository: "https://github.com/test/repo",
  branch: "main",
  outline: "[FILE] package.json\n[DIR] src\n  [FILE] src/index.ts",
  topLevelEntries: [],
};

describe("RlmOrchestrator", () => {
  let config: RlmOrchestratorConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    config = {
      workingDir: "/test/repo",
      rootMetadataLoader: async () => rootMetadata,
      systemPrompt: "test system prompt",
      maxIterations: 5,
    };
  });

  describe("constructor", () => {
    it("should create orchestrator with default max iterations", () => {
      const orchestrator = new RlmOrchestrator({
        ...config,
        maxIterations: undefined,
      });

      expect(orchestrator).toBeDefined();
    });

    it("should create orchestrator with custom max iterations", () => {
      const orchestrator = new RlmOrchestrator({
        ...config,
        maxIterations: 3,
      });

      expect(orchestrator).toBeDefined();
    });
  });

  describe("run()", () => {
    it("should execute the root loop across multiple iterations", async () => {
      let callCount = 0;
      const mockLlm = jest.fn(async () => {
        callCount += 1;
        if (callCount < 3) {
          return "print('iteration ' + __iteration__)";
        }
        return "FINAL('done')";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");

      expect(result).toBe("done");
      expect(callCount).toBe(3);
    });

    it("should stop iteration when FINAL() is set", async () => {
      const mockLlm = jest.fn(async () => "FINAL('the answer')");
      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");

      expect(result).toBe("the answer");
      expect(mockLlm).toHaveBeenCalledTimes(1);
    });

    it("should extract and execute fenced repl code blocks", async () => {
      const mockLlm = jest.fn(
        async () => "```repl\nconst answer = 'from fence'; FINAL(answer)\n```",
      );
      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");

      expect(result).toBe("from fence");
    });

    it("should resolve FINAL_VAR() from active session bindings", async () => {
      const mockLlm = jest.fn(
        async () => "const answer = 'local binding'; FINAL_VAR('answer')",
      );
      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");

      expect(result).toBe("local binding");
    });
  });

  describe("metadata-first history", () => {
    it("should send repository metadata without a repo body preload", async () => {
      const receivedHistories: string[] = [];
      const mockLlm = jest.fn(async (_instruction: string, history: string) => {
        receivedHistories.push(history);
        return "FINAL('done')";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      await orchestrator.run("test query");

      expect(receivedHistories).toHaveLength(1);
      expect(receivedHistories[0]).toContain("Task:");
      expect(receivedHistories[0]).toContain("test query");
      expect(receivedHistories[0]).toContain("Repository metadata:");
      expect(receivedHistories[0]).toContain("https://github.com/test/repo");
      expect(receivedHistories[0]).toContain("[FILE] package.json");
      expect(receivedHistories[0]).not.toContain("mock repository content");
    });

    it("should accumulate bounded environment metadata across iterations", async () => {
      let callCount = 0;
      const receivedHistories: string[] = [];
      const mockLlm = jest.fn(async (_instruction: string, history: string) => {
        callCount += 1;
        receivedHistories.push(history);
        if (callCount < 3) {
          return "print('iteration ' + __iteration__)";
        }
        return "FINAL('done')";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      await orchestrator.run("test query");

      expect(callCount).toBe(3);
      expect(receivedHistories[1]).toContain("Iteration 1");
      expect(receivedHistories[1]).toContain("stdout: iteration 1");
      expect(receivedHistories[2]).toContain("Iteration 2");
    });
  });

  describe("persistent worker session", () => {
    it("should preserve locals and helper functions across iterations", async () => {
      let executionCount = 0;
      const mockLlm = jest.fn(async () => {
        executionCount += 1;
        if (executionCount === 1) {
          return "function double(x) { return x * 2; } let counter = 1;";
        }
        return "counter = double(counter); FINAL(String(counter))";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");

      expect(result).toBe("2");
    });
  });

  describe("structured sub_rlm()", () => {
    it("should launch a child recursive run and inject its structured result", async () => {
      const mockLlm = jest.fn(async (_instruction: string, history: string) => {
        if (history.includes("Task:\nchild task")) {
          return "FINAL(context.toUpperCase())";
        }

        return `
          const child = await sub_rlm({
            prompt: "child task",
            context: "from child",
            rootHint: "uppercase the context"
          });
          FINAL(child.finalAnswer);
        `;
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("parent task");

      expect(result).toBe("FROM CHILD");
    });

    it("should isolate child buffers from the parent session", async () => {
      const mockLlm = jest.fn(async (_instruction: string, history: string) => {
        if (history.includes("Task:\ninspect child isolation")) {
          return "FINAL(String(buffers.parentBuffer))";
        }

        return `
          buffers.parentBuffer = "from-parent";
          const child = await sub_rlm({
            prompt: "inspect child isolation",
            context: "child context",
            rootHint: "check buffer visibility"
          });
          FINAL(child.finalAnswer);
        `;
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("parent task");

      expect(result).toBe("undefined");
    });

    it("should expose child stats as part of the structured result", async () => {
      const mockLlm = jest.fn(async (_instruction: string, history: string) => {
        if (history.includes("Task:\nchild stats task")) {
          return "FINAL(context)";
        }

        return `
          const child = await sub_rlm({
            prompt: "child stats task",
            context: "child answer"
          });
          FINAL(String(child.stats.rootIterations) + ":" + child.finalAnswer);
        `;
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.runDetailed("parent task");

      expect(result.answer).toBe("1:child answer");
      expect(result.stats.subRlmCalls).toBe(1);
    });

    it("should aggregate nested child sub_rlm calls into root stats", async () => {
      const mockLlm = jest.fn(async (_instruction: string, history: string) => {
        if (history.includes("Task:\ngrandchild task")) {
          return "FINAL('deep answer')";
        }

        if (history.includes("Task:\nchild task")) {
          return `
            const nested = await sub_rlm({
              prompt: "grandchild task",
              context: "grandchild context"
            });
            FINAL(nested.finalAnswer);
          `;
        }

        return `
          const child = await sub_rlm({
            prompt: "child task",
            context: "child context"
          });
          FINAL(child.finalAnswer);
        `;
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.runDetailed("root task");

      expect(result.answer).toBe("deep answer");
      expect(result.stats.subRlmCalls).toBe(2);
    });

    it("should share the root iteration budget across nested child runs", async () => {
      const mockLlm = jest.fn(async (_instruction: string, history: string) => {
        if (history.includes("Task:\nchild task")) {
          return `
            const grandchild = await sub_rlm({
              prompt: "grandchild task",
              context: "grandchild context"
            });
            FINAL(String(grandchild.stats.rootIterations) + ":" + grandchild.finalAnswer);
          `;
        }

        if (history.includes("Task:\ngrandchild task")) {
          return "FINAL('grandchild final')";
        }

        return `
          const child = await sub_rlm({
            prompt: "child task",
            context: "child context"
          });
          FINAL(String(child.stats.rootIterations) + ":" + child.finalAnswer);
        `;
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
        maxIterations: 2,
      });

      const result = await orchestrator.runDetailed("root task");

      expect(mockLlm).toHaveBeenCalledTimes(2);
      expect(result.answer).toContain("1:0:RLM reached max iterations without FINAL()");
      expect(result.stats.subRlmCalls).toBe(2);
    });
  });

  describe("completion and recovery", () => {
    it("should support FINAL() with multiline content", async () => {
      const mockLlm = jest.fn(
        async () => "FINAL('Line 1\\nLine 2\\nLine 3')",
      );
      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");

      expect(result).toBe("Line 1\nLine 2\nLine 3");
    });

    it("should fall back only after max iterations without FINAL()", async () => {
      let callCount = 0;
      const mockLlm = jest.fn(async () => {
        callCount += 1;
        return "print('still running')";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
        maxIterations: 3,
      });

      const result = await orchestrator.runDetailed("test query");

      expect(callCount).toBe(3);
      expect(result.answer).toContain("RLM reached max iterations without FINAL()");
      expect(result.stats.fallbackRecoveryUsed).toBe(true);
      expect(result.stats.finalSet).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should surface typed root-model failures in metadata history", async () => {
      const mockLlm = jest.fn(async () => {
        throw new Error("LLM API error");
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
        maxIterations: 2,
      });

      const result = await orchestrator.runDetailed("test query");

      expect(result.answer).toContain("RLM reached max iterations without FINAL()");
      expect(result.metadataHistory).toHaveLength(2);
      expect(result.metadataHistory[0].environment.error?.kind).toBe("llm");
      expect(result.metadataHistory[0].environment.error?.code).toBe(
        "ROOT_MODEL_QUERY_FAILED",
      );
    });

    it("should continue after script errors and allow later recovery", async () => {
      let callCount = 0;
      const mockLlm = jest.fn(async () => {
        callCount += 1;
        if (callCount === 1) {
          return "throw new Error('script error')";
        }
        return "FINAL('recovered')";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.runDetailed("test query");

      expect(result.answer).toBe("recovered");
      expect(result.metadataHistory[0].environment.error?.kind).toBe("runtime");
      expect(result.metadataHistory[0].environment.error?.code).toBe(
        "SCRIPT_EXECUTION_FAILED",
      );
    });
  });
});
