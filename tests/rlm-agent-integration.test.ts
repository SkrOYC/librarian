/**
 * ReactAgent integration coverage for the split execution model:
 * API-backed providers use the direct internal RLM orchestrator, while
 * CLI-backed providers stay on their subprocess path.
 */

import { describe, expect, it } from "bun:test";
import { ReactAgent } from "../src/agents/react-agent.js";

describe("ReactAgent RLM integration", () => {
  describe("RLM system prompt", () => {
    it("should generate a truthful prompt for API-backed providers", () => {
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

      expect(prompt).toContain("repo.grep");
      expect(prompt).toContain("repo.view");
      expect(prompt).toContain("llm_query");
      expect(prompt).toContain("sub_rlm({ prompt, context, rootHint? })");
      expect(prompt).toContain("my-lib");
      expect(prompt).toContain("/test/repo");
      expect(prompt).toContain("FINAL(");
      expect(prompt).not.toContain("research_repository");
    });

    it("should include technology context in the direct RLM prompt", () => {
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

    it("should handle group context without a specific technology", () => {
      const agent = new ReactAgent({
        aiProvider: { type: "openai", apiKey: "test-key" },
        workingDir: "/sandbox/group",
      });

      const prompt = agent.createRlmSystemPrompt();

      expect(prompt).toContain("/sandbox/group");
      expect(prompt).toContain("FINAL(");
    });
  });

  describe("CLI system prompt", () => {
    it("should keep the original investigator prompt for CLI usage", () => {
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

  describe("constructor", () => {
    it("should create an agent for API-backed providers", () => {
      const agent = new ReactAgent({
        aiProvider: { type: "openai", apiKey: "test-key" },
        workingDir: "/test/repo",
      });

      expect(agent).toBeDefined();
    });

    it("should still create an agent for CLI-backed providers", () => {
      const agent = new ReactAgent({
        aiProvider: { type: "claude-code", apiKey: "" },
        workingDir: "/test/repo",
      });

      expect(agent).toBeDefined();
    });

    it("should expose streamRepository regardless of provider type", () => {
      const apiAgent = new ReactAgent({
        aiProvider: { type: "openai", apiKey: "test-key" },
        workingDir: "/test/repo",
      });
      const cliAgent = new ReactAgent({
        aiProvider: { type: "claude-code", apiKey: "" },
        workingDir: "/test/repo",
      });

      expect(typeof apiAgent.streamRepository).toBe("function");
      expect(typeof cliAgent.streamRepository).toBe("function");
    });
  });

  describe("initialization routing", () => {
    it("should keep API-backed provider initialization lazy", async () => {
      const agent = new ReactAgent({
        aiProvider: { type: "openai", apiKey: "test-key" },
        workingDir: "/test/repo",
      });

      await agent.initialize();

      expect((agent as unknown as { rlmOrchestrator?: unknown }).rlmOrchestrator).toBeUndefined();
    });

    it("should create the direct orchestrator on first non-CLI use", () => {
      const agent = new ReactAgent({
        aiProvider: { type: "openai", apiKey: "test-key" },
        workingDir: "/test/repo",
      });

      (agent as unknown as { initializeRlmOrchestrator: () => void }).initializeRlmOrchestrator();

      expect((agent as unknown as { rlmOrchestrator?: unknown }).rlmOrchestrator).toBeDefined();
    });

    it("should keep claude-code on the CLI path", async () => {
      const agent = new ReactAgent({
        aiProvider: { type: "claude-code", apiKey: "" },
        workingDir: "/test/repo",
      });

      await agent.initialize();

      expect((agent as unknown as { rlmOrchestrator?: unknown }).rlmOrchestrator).toBeUndefined();
    });

    it("should keep gemini-cli on the CLI path", async () => {
      const agent = new ReactAgent({
        aiProvider: { type: "gemini-cli", apiKey: "" },
        workingDir: "/test/repo",
      });

      await agent.initialize();

      expect((agent as unknown as { rlmOrchestrator?: unknown }).rlmOrchestrator).toBeUndefined();
    });

    it("should keep codex-cli on the CLI path", async () => {
      const agent = new ReactAgent({
        aiProvider: { type: "codex-cli", apiKey: "" },
        workingDir: "/test/repo",
      });

      await agent.initialize();

      expect((agent as unknown as { rlmOrchestrator?: unknown }).rlmOrchestrator).toBeUndefined();
    });
  });
});
