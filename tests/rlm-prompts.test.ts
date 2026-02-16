/**
 * RLM Prompts Tests
 *
 * Tests for verifying that RLM system prompts include all required content
 * from the "Recursive Language Models" paper (arXiv:2512.24601v2).
 */

import { describe, expect, it } from "bun:test";
import type { RlmMetadata } from "../src/agents/rlm-orchestrator.js";
import {
  createRlmSystemPrompt,
  formatMetadataForPrompt,
} from "../src/agents/rlm-prompts.js";

describe("RLM Prompts", () => {
  describe("createRlmSystemPrompt", () => {
    it("should include llm_query documentation", () => {
      const prompt = createRlmSystemPrompt("## Context\ntest context");

      // The prompt should document the llm_query function
      expect(prompt).toContain("llm_query");
    });

    it("should include sub_rlm documentation", () => {
      const prompt = createRlmSystemPrompt("## Context\ntest context");

      // The prompt should document the sub_rlm function for recursive processing
      expect(prompt).toContain("sub_rlm");
    });

    it("should include linear processing pattern example", () => {
      const prompt = createRlmSystemPrompt("## Context\ntest context");

      // The prompt should include an example of linear processing (process each, aggregate)
      // Looking for patterns like iteration, for loop, or aggregation
      expect(
        prompt.toLowerCase().includes("linear") ||
          prompt.toLowerCase().includes("iterate") ||
          prompt.toLowerCase().includes("for each") ||
          prompt.toLowerCase().includes("for i in")
      ).toBe(true);
    });

    it("should include quadratic processing pattern example", () => {
      const prompt = createRlmSystemPrompt("## Context\ntest context");

      // The prompt should include an example of quadratic processing (all pairs)
      expect(
        prompt.toLowerCase().includes("quadratic") ||
          prompt.toLowerCase().includes("pair") ||
          prompt.toLowerCase().includes("pairs")
      ).toBe(true);
    });

    it("should include recursive decomposition pattern example", () => {
      const prompt = createRlmSystemPrompt("## Context\ntest context");

      // The prompt should include an example of recursive decomposition (split and recurse)
      expect(
        prompt.toLowerCase().includes("recursive") ||
          prompt.toLowerCase().includes("chunk") ||
          prompt.toLowerCase().includes("split") ||
          prompt.toLowerCase().includes("section")
      ).toBe(true);
    });

    it("should explain context as a symbolic variable", () => {
      const prompt = createRlmSystemPrompt("## Context\ntest context");

      // The prompt should explain that context is a string variable that can be manipulated
      expect(
        prompt.toLowerCase().includes("context") &&
          (prompt.toLowerCase().includes("variable") ||
            prompt.toLowerCase().includes("slice") ||
            prompt.toLowerCase().includes("split") ||
            prompt.toLowerCase().includes("string"))
      ).toBe(true);
    });

    it("should document FINAL completion signal", () => {
      const prompt = createRlmSystemPrompt("## Context\ntest context");

      // The prompt should document FINAL for returning the answer
      expect(prompt).toContain("FINAL");
    });

    it("should document FINAL_VAR completion signal", () => {
      const prompt = createRlmSystemPrompt("## Context\ntest context");

      // The prompt should document FINAL_VAR for returning a buffer variable
      expect(prompt).toContain("FINAL_VAR");
    });
  });

  describe("formatMetadataForPrompt", () => {
    it("should format iteration number", () => {
      const metadata: RlmMetadata = {
        iteration: 5,
        stdoutPreview: "some output",
        stdoutLength: 100,
        bufferKeys: ["key1", "key2"],
        bufferSummary: [
          { key: "key1", preview: "value1", size: 10 },
          { key: "key2", preview: "value2", size: 20 },
        ],
        hasContext: true,
      };

      const formatted = formatMetadataForPrompt(metadata);
      expect(formatted).toContain("Iteration: 5");
    });

    it("should include buffer keys when present", () => {
      const metadata: RlmMetadata = {
        iteration: 1,
        stdoutPreview: "",
        stdoutLength: 0,
        bufferKeys: ["results", "summary"],
        bufferSummary: [{ key: "results", preview: "data", size: 100 }],
        hasContext: true,
      };

      const formatted = formatMetadataForPrompt(metadata);
      expect(formatted).toContain("Buffers: results, summary");
    });

    it("should include error feedback when present", () => {
      const metadata: RlmMetadata = {
        iteration: 1,
        stdoutPreview: "",
        stdoutLength: 0,
        bufferKeys: [],
        bufferSummary: [],
        hasContext: true,
        errorFeedback: "Syntax error in script",
      };

      const formatted = formatMetadataForPrompt(metadata);
      expect(formatted).toContain("Error: Syntax error in script");
    });
  });
});
