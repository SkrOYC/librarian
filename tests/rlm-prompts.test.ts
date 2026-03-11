import { describe, expect, it } from "bun:test";
import type { RlmMetadata } from "../src/agents/rlm-orchestrator.js";
import {
  createRlmSystemPrompt,
  formatMetadataForPrompt,
  SUB_AGENT_SYSTEM_PROMPT,
} from "../src/agents/rlm-prompts.js";

describe("RLM prompts", () => {
  describe("createRlmSystemPrompt", () => {
    it("should describe the metadata-first root contract", () => {
      const prompt = createRlmSystemPrompt(
        "You have been provided the **react** repository.",
        "[DIR] src",
      );

      expect(prompt).toContain("You do NOT receive a full repository preload");
      expect(prompt).toContain("repository metadata");
      expect(prompt).toContain("bounded environment metadata");
      expect(prompt).toContain("persistent REPL session");
      expect(prompt).toContain("Repository outline preview");
    });

    it("should describe structured repo helpers and recursive child runs", () => {
      const prompt = createRlmSystemPrompt("context block");

      expect(prompt).toContain("`repo.list(args)` -> structured directory metadata");
      expect(prompt).toContain("`repo.view(args)` -> structured file contents");
      expect(prompt).toContain("`repo.find(args)` -> structured glob results");
      expect(prompt).toContain("`repo.grep(args)` -> structured grep results");
      expect(prompt).toContain("sub_rlm({ prompt, context, rootHint? })");
    });

    it("should describe environment-owned completion without legacy tool routing", () => {
      const prompt = createRlmSystemPrompt("context block");

      expect(prompt).toContain("FINAL(answer)");
      expect(prompt).toContain("FINAL_VAR(name)");
      expect(prompt).toContain("Fallback summarization is recovery-only");
      expect(prompt).not.toContain("research_repository");
    });
  });

  describe("SUB_AGENT_SYSTEM_PROMPT", () => {
    it("should keep the sub-model contract stateless and text-only", () => {
      expect(SUB_AGENT_SYSTEM_PROMPT).toContain("stateless functional analyzer");
      expect(SUB_AGENT_SYSTEM_PROMPT).toContain("Do not invent repository state");
      expect(SUB_AGENT_SYSTEM_PROMPT).toContain("Return plain text only.");
      expect(SUB_AGENT_SYSTEM_PROMPT).not.toContain("repo.list");
    });
  });

  describe("formatMetadataForPrompt", () => {
    it("should format the active environment summary", () => {
      const metadata: RlmMetadata = {
        iteration: 5,
        environment: {
          stdoutPreview: "some output",
          stdoutLength: 100,
          variableCount: 2,
          variables: [
            {
              name: "counter",
              type: "number",
              preview: "2",
              size: 1,
            },
            {
              name: "helper",
              type: "function",
              preview: "[Function]",
              size: 10,
            },
          ],
          bufferKeys: ["results", "summary"],
          finalSet: false,
        },
        hasContext: true,
      };

      const formatted = formatMetadataForPrompt(metadata);

      expect(formatted).toContain("Iteration: 5");
      expect(formatted).toContain("Output: some output");
      expect(formatted).toContain("Buffers: results, summary");
      expect(formatted).toContain("Variables: counter(number), helper(function)");
    });

    it("should include error feedback when present", () => {
      const metadata: RlmMetadata = {
        iteration: 1,
        environment: {
          stdoutPreview: "",
          stdoutLength: 0,
          variableCount: 0,
          variables: [],
          bufferKeys: [],
          finalSet: false,
        },
        hasContext: true,
        errorFeedback: "Syntax error in script",
      };

      const formatted = formatMetadataForPrompt(metadata);

      expect(formatted).toContain("Error: Syntax error in script");
    });
  });
});
