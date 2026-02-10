/**
 * RLM Agent Integration Tests
 *
 * Tests that ReactAgent correctly wires up the RLM paradigm for LangChain providers
 * while leaving CLI providers untouched.
 */

import { describe, it, expect } from "bun:test";
import { ReactAgent } from "../src/agents/react-agent.js";

describe("ReactAgent RLM Integration", () => {
  describe("RLM System Prompt", () => {
    it("should generate an RLM system prompt for LangChain providers", () => {
      const agent = new ReactAgent({
        aiProvider: { type: "openai", apiKey: "test-key" },
        workingDir: "/test/repo",
        technology: {
          name: "my-lib",
          repository: "https://github.com/test/my-lib",
          branch: "main",
        },
      });

      const prompt = agent.createRlmSystemPrompt();
      expect(prompt).toContain("Codebase Architect");
      expect(prompt).toContain("research_repository");
      expect(prompt).toContain("repo.list");
      expect(prompt).toContain("repo.view");
      expect(prompt).toContain("repo.find");
      expect(prompt).toContain("repo.grep");
      expect(prompt).toContain("llm_query");
      expect(prompt).toContain("my-lib");
      expect(prompt).toContain("/test/repo");
    });

    it("should include technology context in RLM prompt", () => {
      const agent = new ReactAgent({
        aiProvider: { type: "anthropic", apiKey: "test-key" },
        workingDir: "/sandbox/react",
        technology: {
          name: "react",
          repository: "https://github.com/facebook/react",
          branch: "main",
        },
      });

      const prompt = agent.createRlmSystemPrompt();
      expect(prompt).toContain("react");
      expect(prompt).toContain("https://github.com/facebook/react");
      expect(prompt).toContain("/sandbox/react");
    });

    it("should handle group context (no specific technology)", () => {
      const agent = new ReactAgent({
        aiProvider: { type: "openai", apiKey: "test-key" },
        workingDir: "/sandbox/group",
      });

      const prompt = agent.createRlmSystemPrompt();
      expect(prompt).toContain("Codebase Architect");
      expect(prompt).toContain("several related repositories");
      expect(prompt).toContain("/sandbox/group");
    });
  });

  describe("CLI System Prompt (unchanged)", () => {
    it("should still generate the original system prompt for CLI usage", () => {
      const agent = new ReactAgent({
        aiProvider: { type: "claude-code", apiKey: "" },
        workingDir: "/test/repo",
        technology: {
          name: "my-lib",
          repository: "https://github.com/test/my-lib",
          branch: "main",
        },
      });

      const prompt = agent.createDynamicSystemPrompt();
      expect(prompt).toContain("Codebase Investigator");
      expect(prompt).toContain("Evidence First");
      expect(prompt).not.toContain("Codebase Architect");
      expect(prompt).not.toContain("research_repository");
    });
  });

  describe("Agent constructor", () => {
    it("should create RLM tool for LangChain providers", () => {
      const agent = new ReactAgent({
        aiProvider: { type: "openai", apiKey: "test-key" },
        workingDir: "/test/repo",
      });
      // Agent should be created without error
      expect(agent).toBeDefined();
    });

    it("should skip RLM tool for claude-code provider", () => {
      const agent = new ReactAgent({
        aiProvider: { type: "claude-code", apiKey: "" },
        workingDir: "/test/repo",
      });
      expect(agent).toBeDefined();
    });

    it("should skip RLM tool for gemini-cli provider", () => {
      const agent = new ReactAgent({
        aiProvider: { type: "gemini-cli", apiKey: "" },
        workingDir: "/test/repo",
      });
      expect(agent).toBeDefined();
    });

    it("should have streamRepository method regardless of provider", () => {
      const langchainAgent = new ReactAgent({
        aiProvider: { type: "openai", apiKey: "test-key" },
        workingDir: "/test/repo",
      });
      const cliAgent = new ReactAgent({
        aiProvider: { type: "claude-code", apiKey: "" },
        workingDir: "/test/repo",
      });

      expect(typeof langchainAgent.streamRepository).toBe("function");
      expect(typeof cliAgent.streamRepository).toBe("function");
    });
  });

  describe("CLI provider zero-regression", () => {
    it("should initialize claude-code provider without LangChain setup", async () => {
      const agent = new ReactAgent({
        aiProvider: { type: "claude-code", apiKey: "" },
        workingDir: "/test/repo",
      });

      // Should resolve without error (skips LangChain)
      await agent.initialize();
      expect(agent).toBeDefined();
    });

    it("should initialize gemini-cli provider without LangChain setup", async () => {
      const agent = new ReactAgent({
        aiProvider: { type: "gemini-cli", apiKey: "" },
        workingDir: "/test/repo",
      });

      // Should resolve without error (skips LangChain)
      await agent.initialize();
      expect(agent).toBeDefined();
    });
  });
});
