/**
 * RLM Orchestrator Tests
 *
 * Tests for the Multi-turn REPL Orchestrator implementing Algorithm 1 from the paper.
 * Key features tested:
 * - Multi-turn execution with configurable max iterations
 * - Metadata passed to LLM (not full context)
 * - FINAL(answer) stops loop and returns answer
 * - FINAL_VAR(bufferName) returns buffer value
 * - sub_rlm() creates fresh worker per call
 * - Worker reuse across iterations (buffers persist)
 */

import { beforeEach, describe, expect, it, jest } from "bun:test";
import {
  RlmOrchestrator,
  type RlmOrchestratorConfig,
} from "../src/agents/rlm-orchestrator.js";

// Mock dependencies
const mockLlmQuery = jest.fn(async (instruction: string, data: string) => {
  return "mock LLM response";
});

const mockRepoApi = {
  list: async () => "mock list",
  view: async () => "mock view",
  find: async () => "mock find",
  grep: async () => "mock grep",
};

describe("RlmOrchestrator", () => {
  let config: RlmOrchestratorConfig;

  beforeEach(() => {
    jest.clearAllMocks();
    config = {
      llmConfig: {
        type: "openai",
        apiKey: "test-key",
        model: "gpt-4",
      },
      workingDir: "/test/repo",
      repoContentLoader: async () => "mock repository content",
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

  describe("run() - Multi-turn execution", () => {
    it("should execute multi-turn loop multiple times", async () => {
      let callCount = 0;
      const mockLlm = jest.fn(async (_instruction: string, _data: string) => {
        callCount++;
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
      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    it("should stop iteration when FINAL signal is detected", async () => {
      const mockLlm = jest.fn(async () => {
        return "FINAL('the answer')";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");
      expect(result).toBe("the answer");
      // Should only call LLM once since FINAL stops immediately
      expect(mockLlm).toHaveBeenCalledTimes(1);
    });

    it("should stop iteration when FINAL_VAR signal is detected", async () => {
      const mockLlm = jest.fn(async (_instruction: string, _data: string) => {
        return "buffers.myAnswer = 'buffer value'; FINAL_VAR('myAnswer')";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");
      expect(result).toBe("buffer value");
    });
  });

  describe("Metadata handling", () => {
    it("should pass metadata (not full context) to LLM", async () => {
      const receivedHistories: string[] = [];
      // Mock receives (instruction, data) - data is the history
      const mockLlm = jest.fn(async (_instruction: string, data: string) => {
        receivedHistories.push(data);
        return "FINAL('done')";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      await orchestrator.run("test query");

      // First history should contain task (no metadata yet - that's added after first execution)
      expect(receivedHistories[0]).toContain("Task");
      expect(receivedHistories[0]).toContain("test query");

      // Metadata should not contain the full repository content
      for (const history of receivedHistories) {
        // Metadata should not contain the full repository content
        expect(history).not.toContain("mock repository content");
      }

      // Second history onwards should contain iteration info (after first execution)
      if (receivedHistories.length > 1) {
        expect(receivedHistories[1]).toMatch(/iteration|Iteration/i);
      }
    });

    it("should accumulate metadata history across iterations", async () => {
      let callCount = 0;
      const receivedHistories: string[] = [];
      const mockLlm = jest.fn(async (_instruction: string, data: string) => {
        callCount++;
        receivedHistories.push(data);
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

      // History should accumulate across iterations
      expect(callCount).toBe(3);
      // Second history should contain first history's content
      expect(receivedHistories[1]).toContain("Iteration: 0");
    });
  });

  describe("Worker reuse across iterations", () => {
    it("should reuse worker across iterations (buffers persist)", async () => {
      let executionCount = 0;
      const buffers: Record<string, unknown> = {};

      const mockLlm = jest.fn(async (_instruction: string, _data: string) => {
        executionCount++;
        if (executionCount === 1) {
          return "buffers.counter = 1; print('first')";
        }
        if (executionCount === 2) {
          return "buffers.counter = buffers.counter + 1; print('second')";
        }
        return "FINAL(buffers.counter)";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");

      // Buffer should persist across iterations
      expect(result).toBe("2");
    });
  });

  describe("sub_rlm() - Fresh worker per call", () => {
    it("should execute sub_rlm code and return result", async () => {
      // The LLM returns code that calls sub_rlm, which should execute in a fresh worker
      const mockLlm = jest.fn(async (_instruction: string, data: string) => {
        if (data.includes("sub_rlm")) {
          // This code runs in the fresh worker - it should have isolated buffers
          return "buffers.subResult = 'from-sub-rlm'; FINAL(buffers.subResult)";
        }
        // This code runs in the main worker - it calls sub_rlm
        return "sub_rlm('nested query'); FINAL('main done')";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");
      // Should complete without error
      expect(result).toBeDefined();
    });

    it("should have isolated buffers in sub_rlm vs main worker", async () => {
      const mockLlm = jest.fn(async (_instruction: string, data: string) => {
        if (data.includes("sub_rlm")) {
          // This runs in fresh worker - should have empty initial buffers
          // Return the value of parentBuffer (should be undefined in fresh worker)
          return "FINAL(String(buffers.parentBuffer))";
        }
        // This runs in main worker - set a buffer before calling sub_rlm
        // Then call sub_rlm with code that checks if it can see parent's buffer
        return "buffers.parentBuffer = 'from-parent'; const r = await sub_rlm(\"FINAL(String(buffers.parentBuffer))\"); FINAL(r)";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");

      // The sub_rlm should have isolated buffers - it should NOT see parent's buffer
      // So it should return 'undefined', not 'from-parent'
      expect(result).toBe("undefined");
    });

    it("should propagate FINAL from sub_rlm result to main", async () => {
      const mockLlm = jest.fn(async (_instruction: string, data: string) => {
        if (data.includes("sub_rlm")) {
          // sub_rlm returns this - runs in fresh worker with isolated buffers
          return "FINAL('from-sub-rlm')";
        }
        // Main worker calls sub_rlm with JavaScript CODE to execute in fresh worker
        return "const r = await sub_rlm(\"FINAL('from-sub-rlm')\"); FINAL(r)";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");
      // The FINAL from sub_rlm should propagate
      expect(result).toBe("from-sub-rlm");
    });
  });

  describe("Signal detection", () => {
    it("should parse FINAL(answer) correctly", async () => {
      // LLM returns JavaScript code that calls FINAL() - this gets executed in the worker
      const mockLlm = jest.fn(async () => {
        return "FINAL('The final answer is here')";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");
      expect(result).toBe("The final answer is here");
    });

    it("should parse FINAL_VAR(bufferName) correctly", async () => {
      // LLM returns JavaScript code that sets a buffer and calls FINAL_VAR
      const mockLlm = jest.fn(async () => {
        return 'buffers.answer = "from buffer"; FINAL_VAR("answer")';
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");
      expect(result).toBe("from buffer");
    });

    it("should handle FINAL with multiline content", async () => {
      // LLM returns JavaScript code with multiline FINAL
      const mockLlm = jest.fn(async () => {
        return "FINAL('Line 1\\nLine 2\\nLine 3')";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");
      expect(result).toBe("Line 1\nLine 2\nLine 3");
    });
  });

  describe("Max iterations", () => {
    it("should stop at max iterations", async () => {
      let callCount = 0;
      const mockLlm = jest.fn(async () => {
        callCount++;
        // Always return non-FINAL code to force max iterations
        return "print('still running')";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
        maxIterations: 3,
      });

      const result = await orchestrator.run("test query");

      // Should stop at max iterations (3)
      expect(callCount).toBe(3);
      // Result should indicate max iterations reached
      expect(result).toContain("Max iterations");
    });
  });

  describe("Error handling", () => {
    it("should handle LLM errors gracefully", async () => {
      const mockLlm = jest.fn(async () => {
        throw new Error("LLM API error");
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");
      expect(result).toContain("Error");
    });

    it("should handle script execution errors", async () => {
      const mockLlm = jest.fn(async () => {
        return "throw new Error('script error')";
      });

      const orchestrator = new RlmOrchestrator({
        ...config,
        llmQuery: mockLlm,
      });

      const result = await orchestrator.run("test query");
      // Should continue to next iteration with error feedback
      expect(result).toBeDefined();
    });
  });
});
