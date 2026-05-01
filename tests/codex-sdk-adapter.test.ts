import { describe, expect, it } from "bun:test";
import type {
  CodexOptions,
  ThreadEvent,
  ThreadOptions,
} from "@openai/codex-sdk";
import {
  buildCodexSdkClientOptions,
  buildCodexSdkEnv,
  buildCodexThreadOptions,
  codexSdkEventText,
  createCodexSdkTextStreamState,
  parseCodexModelSelection,
  streamCodexSdk,
} from "../src/agents/codex-sdk-adapter.js";

async function* events(
  items: ThreadEvent[]
): AsyncGenerator<ThreadEvent, void, unknown> {
  await Promise.resolve();
  for (const item of items) {
    yield item;
  }
}

describe("Codex SDK adapter", () => {
  it("parses Codex model and reasoning effort suffixes", () => {
    expect(parseCodexModelSelection("gpt-5.4:xhigh")).toEqual({
      model: "gpt-5.4",
      modelReasoningEffort: "xhigh",
    });
    expect(parseCodexModelSelection("gpt-5.4")).toEqual({
      model: "gpt-5.4",
    });
    expect(parseCodexModelSelection(undefined)).toEqual({});
  });

  it("rejects malformed Codex model strings", () => {
    expect(() => parseCodexModelSelection("gpt-5.4:ultra")).toThrow(
      "Invalid Codex reasoning effort"
    );
    expect(() => parseCodexModelSelection(":high")).toThrow(
      "Model name is required"
    );
    expect(() => parseCodexModelSelection("gpt-5.4:high:extra")).toThrow(
      "Invalid Codex model string"
    );
  });

  it("builds SDK client options without overriding Codex CLI auth", () => {
    const options = buildCodexSdkClientOptions(
      {
        apiKey: "sk-test",
        baseURL: "https://api.example.com/v1",
      },
      "/tmp/instructions.md",
      "/tmp/codex-home"
    );

    expect(options.apiKey).toBeUndefined();
    expect(options.baseUrl).toBe("https://api.example.com/v1");
    expect(options.env?.CODEX_HOME).toBe("/tmp/codex-home");
    expect(options.env?.CODEX_API_KEY).toBeUndefined();
    expect(options.env?.OPENAI_API_KEY).toBeUndefined();
    expect(options.config?.model_instructions_file).toBe(
      "/tmp/instructions.md"
    );
  });

  it("allows an explicit system Codex executable override", () => {
    const originalPath = Bun.env.LIBRARIAN_CODEX_PATH;
    Bun.env.LIBRARIAN_CODEX_PATH = "/opt/codex/bin/codex";

    try {
      const options = buildCodexSdkClientOptions(
        {
          apiKey: "",
        },
        "/tmp/instructions.md",
        "/tmp/codex-home"
      );

      expect(options.codexPathOverride).toBe("/opt/codex/bin/codex");
    } finally {
      if (originalPath) {
        Bun.env.LIBRARIAN_CODEX_PATH = originalPath;
      } else {
        Bun.env.LIBRARIAN_CODEX_PATH = undefined;
      }
    }
  });

  it("builds an isolated SDK environment for the Codex child process", () => {
    const env = buildCodexSdkEnv("/tmp/isolated-codex-home");

    expect(env.CODEX_HOME).toBe("/tmp/isolated-codex-home");
    expect(env.CODEX_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.LIBRARIAN_API_KEY).toBeUndefined();
  });

  it("builds read-only SDK thread options and omits model fields when unset", () => {
    const options = buildCodexThreadOptions({ apiKey: "" }, "/repo");

    expect(options.model).toBeUndefined();
    expect(options.modelReasoningEffort).toBeUndefined();
    expect(options.workingDirectory).toBe("/repo");
    expect(options.sandboxMode).toBe("read-only");
    expect(options.approvalPolicy).toBe("untrusted");
    expect(options.webSearchEnabled).toBe(false);
    expect(options.webSearchMode).toBe("disabled");
    expect(options.networkAccessEnabled).toBe(false);
  });

  it("extracts agent messages from SDK events", () => {
    const text = codexSdkEventText({
      type: "item.completed",
      item: {
        id: "item-1",
        type: "agent_message",
        text: "hello from codex",
      },
    });

    expect(text).toBe("hello from codex");
  });

  it("emits only appended text for updated agent message events", () => {
    const state = createCodexSdkTextStreamState();

    const first = codexSdkEventText(
      {
        type: "item.updated",
        item: {
          id: "item-1",
          type: "agent_message",
          text: "hello",
        },
      },
      state
    );
    const second = codexSdkEventText(
      {
        type: "item.updated",
        item: {
          id: "item-1",
          type: "agent_message",
          text: "hello world",
        },
      },
      state
    );
    const completed = codexSdkEventText(
      {
        type: "item.completed",
        item: {
          id: "item-1",
          type: "agent_message",
          text: "hello world",
        },
      },
      state
    );

    expect([first, second, completed]).toEqual(["hello", " world", null]);
  });

  it("throws for SDK failure events", () => {
    expect(() =>
      codexSdkEventText({
        type: "turn.failed",
        error: { message: "model refused" },
      })
    ).toThrow("Codex SDK turn failed: model refused");

    expect(() =>
      codexSdkEventText({
        type: "error",
        message: "stream ended",
      })
    ).toThrow("Codex SDK stream failed: stream ended");
  });

  it("streams fake SDK events through the adapter", async () => {
    let clientOptions: CodexOptions | undefined;
    let threadOptions: ThreadOptions | undefined;
    let prompt: string | undefined;

    const chunks: string[] = [];
    for await (const chunk of streamCodexSdk({
      workingDir: "/repo",
      query: "Explain the code",
      systemPrompt: "Investigate with citations.",
      aiProvider: {
        apiKey: "sk-test",
        model: "gpt-5.4:xhigh",
        baseURL: "https://api.example.com/v1",
      },
      runtimeFilesFactory: () =>
        Promise.resolve({
          tempDir: "/tmp/librarian-codex-sdk-test",
          instructionsPath: "/tmp/librarian-codex-sdk-test/instructions.md",
          codexHome: "/tmp/librarian-codex-sdk-test/.codex-home",
        }),
      cleanupRuntimeFiles: () => Promise.resolve(),
      clientFactory: (options) => {
        clientOptions = options;
        return {
          startThread: (optionsForThread) => {
            threadOptions = optionsForThread;
            return {
              runStreamed: (input) => {
                prompt = input;
                return Promise.resolve({
                  events: events([
                    {
                      type: "item.updated",
                      item: {
                        id: "item-1",
                        type: "agent_message",
                        text: "partial",
                      },
                    },
                    {
                      type: "item.completed",
                      item: {
                        id: "item-1",
                        type: "agent_message",
                        text: "partial answer",
                      },
                    },
                    {
                      type: "item.completed",
                      item: {
                        id: "item-2",
                        type: "agent_message",
                        text: " plus follow-up",
                      },
                    },
                  ]),
                });
              },
            };
          },
        };
      },
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["partial", " answer", "\n plus follow-up"]);
    expect(prompt).toBe("Explain the code");
    expect(clientOptions?.apiKey).toBeUndefined();
    expect(clientOptions?.baseUrl).toBe("https://api.example.com/v1");
    expect(clientOptions?.env?.CODEX_HOME).toBe(
      "/tmp/librarian-codex-sdk-test/.codex-home"
    );
    expect(threadOptions?.model).toBe("gpt-5.4");
    expect(threadOptions?.modelReasoningEffort).toBe("xhigh");
    expect(threadOptions?.workingDirectory).toBe("/repo");
  });
});
