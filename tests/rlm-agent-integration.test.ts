/**
 * ReactAgent integration coverage for the split execution model:
 * API-backed providers use the direct internal RLM orchestrator, while
 * CLI-backed providers stay on their subprocess path.
 */

import { describe, expect, it } from "bun:test";
import { ReactAgent } from "../src/agents/react-agent.js";
import { listTool } from "../src/tools/file-listing.tool.js";
import { logger } from "../src/utils/logger.js";

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

      expect(
        (agent as unknown as { rlmOrchestrator?: unknown }).rlmOrchestrator
      ).toBeUndefined();
    });

    it("should create the direct orchestrator on first non-CLI use", () => {
      const agent = new ReactAgent({
        aiProvider: { type: "openai", apiKey: "test-key" },
        workingDir: "/test/repo",
      });

      (
        agent as unknown as { initializeRlmOrchestrator: () => void }
      ).initializeRlmOrchestrator();

      expect(
        (agent as unknown as { rlmOrchestrator?: unknown }).rlmOrchestrator
      ).toBeDefined();
    });

    it("should keep claude-code on the CLI path", async () => {
      const agent = new ReactAgent({
        aiProvider: { type: "claude-code", apiKey: "" },
        workingDir: "/test/repo",
      });

      await agent.initialize();

      expect(
        (agent as unknown as { rlmOrchestrator?: unknown }).rlmOrchestrator
      ).toBeUndefined();
    });

    it("should keep gemini-cli on the CLI path", async () => {
      const agent = new ReactAgent({
        aiProvider: { type: "gemini-cli", apiKey: "" },
        workingDir: "/test/repo",
      });

      await agent.initialize();

      expect(
        (agent as unknown as { rlmOrchestrator?: unknown }).rlmOrchestrator
      ).toBeUndefined();
    });

    it("should keep codex-sdk off the RLM path", async () => {
      const agent = new ReactAgent({
        aiProvider: { type: "codex-sdk", apiKey: "" },
        workingDir: "/test/repo",
      });

      await agent.initialize();

      expect(
        (agent as unknown as { rlmOrchestrator?: unknown }).rlmOrchestrator
      ).toBeUndefined();
    });
  });

  describe("root metadata loading", () => {
    it("should fall back to empty top-level entries when the listing is not JSON", async () => {
      const agent = new ReactAgent({
        aiProvider: { type: "openai", apiKey: "test-key" },
        workingDir: "/test/repo",
      });

      const originalInvoke = listTool.invoke;
      let callCount = 0;
      (listTool as { invoke: typeof listTool.invoke }).invoke = async (
        input,
        config
      ) => {
        callCount += 1;
        if (callCount === 1) {
          return "Path not found: .";
        }

        return await originalInvoke(input, config);
      };

      try {
        const metadata = await (
          agent as unknown as {
            loadRootMetadata: () => Promise<{
              topLevelEntries: Array<{ name: string }>;
              outline: string;
            }>;
          }
        ).loadRootMetadata();

        expect(metadata.topLevelEntries).toEqual([]);
        expect(metadata.outline).toBe("(outline unavailable)");
      } finally {
        (listTool as { invoke: typeof listTool.invoke }).invoke =
          originalInvoke;
      }
    });

    it("should fall back to empty top-level entries when the listing payload has no entries", async () => {
      const agent = new ReactAgent({
        aiProvider: { type: "openai", apiKey: "test-key" },
        workingDir: "/test/repo",
      });

      const originalInvoke = listTool.invoke;
      let callCount = 0;
      (listTool as { invoke: typeof listTool.invoke }).invoke = async () => {
        callCount += 1;
        if (callCount === 1) {
          return JSON.stringify({
            error: true,
            message: "listing unavailable",
          });
        }

        return JSON.stringify({
          directory: ".",
          totalEntries: 1,
          entries: [
            {
              name: "src",
              path: "/test/repo/src",
              isDirectory: true,
              depth: 0,
            },
          ],
        });
      };

      try {
        const metadata = await (
          agent as unknown as {
            loadRootMetadata: () => Promise<{
              topLevelEntries: Array<{ name: string }>;
              outline: string;
            }>;
          }
        ).loadRootMetadata();

        expect(metadata.topLevelEntries).toEqual([]);
        expect(metadata.outline).toBe("[DIR] src");
      } finally {
        (listTool as { invoke: typeof listTool.invoke }).invoke =
          originalInvoke;
      }
    });
  });

  describe("run stats logging", () => {
    it("should emit the full structured RLM stats payload", async () => {
      const agent = new ReactAgent({
        aiProvider: { type: "openai", apiKey: "test-key" },
        workingDir: "/test/repo",
      });

      const originalInfo = logger.info;
      const logEntries: Array<{
        component: string;
        message: string;
        metadata?: Record<string, unknown>;
      }> = [];
      logger.info = ((component, message, metadata) => {
        logEntries.push({
          component,
          message,
          metadata: metadata as Record<string, unknown> | undefined,
        });
      }) as typeof logger.info;

      const originalExecuteRlmQuery = (
        agent as unknown as {
          executeRlmQuery: (query: string) => Promise<{
            answer: string;
            stats: {
              rootIterations: number;
              subRlmCalls: number;
              subModelCalls: number;
              repoCalls: number;
              totalInputChars: number;
              totalOutputChars: number;
              finalSet: boolean;
              fallbackRecoveryUsed: boolean;
            };
            metadataHistory: unknown[];
          }>;
        }
      ).executeRlmQuery;

      (
        agent as unknown as {
          executeRlmQuery: (query: string) => Promise<{
            answer: string;
            stats: {
              rootIterations: number;
              subRlmCalls: number;
              subModelCalls: number;
              repoCalls: number;
              totalInputChars: number;
              totalOutputChars: number;
              finalSet: boolean;
              fallbackRecoveryUsed: boolean;
            };
            metadataHistory: unknown[];
          }>;
        }
      ).executeRlmQuery = async () => ({
        answer: "done",
        stats: {
          rootIterations: 3,
          subRlmCalls: 2,
          subModelCalls: 5,
          repoCalls: 7,
          totalInputChars: 111,
          totalOutputChars: 222,
          finalSet: true,
          fallbackRecoveryUsed: false,
        },
        metadataHistory: [],
      });

      try {
        const result = await agent.queryRepository("/test/repo", "test query");

        expect(result).toBe("done");
        expect(
          logEntries.find(
            (entry) => entry.message === "RLM query result received"
          )?.metadata
        ).toEqual({
          root_iterations: 3,
          sub_rlm_calls: 2,
          sub_model_calls: 5,
          repo_calls: 7,
          total_input_chars: 111,
          total_output_chars: 222,
          final_set: true,
          fallback_recovery_used: false,
          metadata_history_entries: 0,
          last_error: null,
        });
      } finally {
        logger.info = originalInfo;
        (
          agent as unknown as {
            executeRlmQuery: typeof originalExecuteRlmQuery;
          }
        ).executeRlmQuery = originalExecuteRlmQuery;
      }
    });
  });
});
