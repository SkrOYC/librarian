import { createAgent } from "langchain";
import { fileListTool } from "../tools/file-listing.tool.js";
import { fileReadTool } from "../tools/file-reading.tool.js";
import { grepContentTool } from "../tools/grep-content.tool.js";
import { fileFindTool } from "../tools/file-finding.tool.js";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { HumanMessage } from "@langchain/core/messages";
import { logger } from "../utils/logger.js";
import os from "os";
import { mkdir, rm } from "fs/promises";
import path from "path";
import { AgentContext } from "./context-schema.js";
import { spawn } from "child_process"; // Using child_process for better streaming control in Node/Bun mix
import { Readable } from "stream";

/**
 * Configuration interface for ReactAgent
 */
export interface ReactAgentConfig {
	/** AI provider configuration including type, API key, and optional model/base URL */
	aiProvider: {
		type:
			| "openai"
			| "anthropic"
			| "google"
			| "openai-compatible"
			| "anthropic-compatible"
			| "claude-code"
			| "gemini-cli";
		apiKey: string;
		model?: string;
		baseURL?: string;
	};
	/** Working directory where the agent operates */
	workingDir: string;
	/** Optional technology context for dynamic system prompt construction */
	technology?: {
		name: string;
		repository: string;
		branch: string;
	};
	/** Optional context schema for runtime context validation */
	contextSchema?: any;
}

export class ReactAgent {
	private aiModel?: ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI;
	private tools: any[];
	private agent: any;
	private config: ReactAgentConfig;
	private contextSchema?: any;

	constructor(config: ReactAgentConfig) {
		this.config = config;
		this.contextSchema = config.contextSchema;

		if (
			config.aiProvider.type !== "claude-code" &&
			config.aiProvider.type !== "gemini-cli"
		) {
			this.aiModel = this.createAIModel(config.aiProvider);
		}

		// Initialize tools - modernized tool pattern
		this.tools = [fileListTool, fileReadTool, grepContentTool, fileFindTool];

		logger.info("AGENT", "Initializing ReactAgent", {
			aiProviderType: config.aiProvider.type,
			model: config.aiProvider.model,
			workingDir: config.workingDir.replace(os.homedir(), "~"),
			toolCount: this.tools.length,
			hasContextSchema: !!this.contextSchema,
		});
	}

	/**
	 * Creates a dynamic system prompt based on current configuration and technology context
	 * @returns A context-aware system prompt string
	 */
	createDynamicSystemPrompt(): string {
		const { workingDir, technology, aiProvider } = this.config;
		const isClaudeCli = aiProvider.type === "claude-code";
		const isGeminiCli = aiProvider.type === "gemini-cli";

		let prompt = `
			# Role and Objective
You are a **Codebase Investigator** specializing in technology exploration and architectural analysis. Your goal is to provide deep technical insights grounded in actual source code evidence. You must verify every claim by reading files rather than speculating.

# Instructions
- **Scope & Boundaries:**
  - Operate exclusively as a read-only explorer within the sandboxed working directory.
  - Prioritize giving complete answers over asking clarifying questions.
  - If a file read would improve your answer, execute it immediately without asking the user.
- **Investigation Methodology:**
  - Map the codebase structure (directories, key files) first.
  - Trace component connections (imports, exports, function calls).
  - Validate assumptions by reading the actual implementation details.
- **Evidence & Citations:**
  - **Strict Rule:** Every technical claim must be backed by specific source code evidence.
  - Cite specific file paths, line numbers, or function names. Avoid vague references like "the code."
  - If a file is missing or inaccessible, explicitly state: "Based on accessible files, I cannot find [X], but typically [Y] applies."
- **Developer Focus:**
  - Default to explaining how a developer would *consume* or *use* the code (APIs, parameters, return values).
  - Only focus on internal architecture or extension patterns if explicitly asked (e.g., "How is X structured?").
- **Adaptive Strategy:**
  - If initial searches fail, pivot to configuration files or alternative naming patterns.
  - Distinguish clearly between verified facts (file contents) and inferred patterns.

# Reasoning Steps
Before answering, you must perform the following internal investigation steps:
1.  **Map & Plan:** Identify relevant directories and files based on the user's query.
2.  **Tool Execution:** Use tools to list files and read content. **Do not guess.**
3.  **Verification:** Ask yourself, "Am I relying on external libraries or unverified assumptions?" If so, read the local source.
4.  **Synthesis:** Compile the evidence. If evidence contradicts documentation, prioritize the local code.
5.  **Final Review:** Ensure the answer explains *how to use* the code (unless asked otherwise) and cites specific sources.

# Output Format
- Provide clear, technical explanations.
- Use Markdown for structure.
- When citing files, use the format: \`path/to/file.ext\` (always relative path).
- If providing code examples, show *calling code* (usage) rather than implementation details, unless the user asked for implementation analysis.

# Context

	`;
		// Add technology context if available
		if (technology) {
			prompt += `
You have been provided the **${technology.name}** repository.
Repository: ${technology.repository}
Your Working Directory: ${workingDir}

Remember that ALL tool calls MUST be executed using absolute path in \`${workingDir}\`
`;
		} else {
			prompt += `
You have been provided several related repositories to work with grouped in the following working directory: ${workingDir}

Remember that ALL tool calls MUST be executed using absolute path in \`${workingDir}\`
`;
		}

		logger.debug("AGENT", "Dynamic system prompt generated", {
			hasTechnologyContext: !!technology,
			promptLength: prompt.length,
		});

		return prompt;
	}

	private async *streamGeminiCli(
		query: string,
		context?: AgentContext,
	): AsyncGenerator<string, void, unknown> {
		const workingDir = context?.workingDir || this.config.workingDir;
		const systemPrompt = this.createDynamicSystemPrompt();

		// Create a temporary directory for Gemini CLI config
		const tempDir = path.join(os.tmpdir(), `librarian-gemini-${Date.now()}`);
		await mkdir(tempDir, { recursive: true });

		const systemPromptPath = path.join(tempDir, "system.md");
		const settingsPath = path.join(tempDir, "settings.json");

		// Write system prompt to file using Bun native API
		await Bun.write(systemPromptPath, systemPrompt);

		// Write restrictive settings to file using Bun native API
		const settings = {
			tools: {
				core: ["list_directory", "read_file", "glob", "search_file_content"],
				autoAccept: true,
			},
			mcpServers: {}, // Ensure no host MCP servers are loaded
			mcp: {
				excluded: ["*"], // Extra safety to exclude all servers
			},
			experimental: {
				enableAgents: false, // Disable experimental subagents
			},
			output: {
				format: "json",
			},
		};
		await Bun.write(settingsPath, JSON.stringify(settings, null, 2));

		const model = this.config.aiProvider.model || "gemini-2.5-flash";

		const args = [
			"gemini",
			"-p",
			query,
			"--output-format",
			"stream-json",
			"--yolo",
		];

		const env = {
			...Bun.env,
			GEMINI_SYSTEM_MD: systemPromptPath,
			GEMINI_CLI_SYSTEM_DEFAULTS_PATH: settingsPath, // Override defaults
			GEMINI_CLI_SYSTEM_SETTINGS_PATH: settingsPath, // Override system settings (highest precedence)
			GEMINI_MODEL: model,
		};

		logger.debug("AGENT", "Spawning Gemini CLI", {
			args,
			workingDir,
			model,
		});

		// Using Bun.spawn for native Bun performance and streaming
		const proc = Bun.spawn(args, {
			cwd: workingDir,
			env,
			stdout: "pipe",
			stderr: "pipe", // Suppress internal CLI status messages
		});

		let buffer = "";

		const reader = proc.stdout.getReader();

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += new TextDecoder().decode(value);
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (!line.trim()) continue;
					try {
						const data = JSON.parse(line);
						// Filter for message events from the assistant
						if (
							data.type === "message" &&
							data.role === "assistant" &&
							data.content
						) {
							yield data.content;
						}
					} catch (e) {
						// Silent fail for non-JSON or partial lines
					}
				}
			}

			const exitCode = await proc.exited;
			if (exitCode !== 0) {
				throw new Error(`Gemini CLI exited with code ${exitCode}`);
			}
		} finally {
			// Cleanup temporary files
			try {
				await rm(tempDir, { recursive: true, force: true });
			} catch (err) {
				logger.warn("AGENT", "Failed to cleanup Gemini temp files", {
					error: err,
				});
			}
		}
	}

	private async *streamClaudeCli(
		query: string,
		context?: AgentContext,
	): AsyncGenerator<string, void, unknown> {
		const workingDir = context?.workingDir || this.config.workingDir;
		const systemPrompt = this.createDynamicSystemPrompt();

		const args = [
			"-p",
			query,
			"--system-prompt",
			systemPrompt,
			"--tools",
			"Read,Glob,Grep",
			"--dangerously-skip-permissions",
			"--output-format",
			"stream-json",
		];

		const env = {
			...Bun.env,
			CLAUDE_PROJECT_DIR: workingDir,
			...(this.config.aiProvider.model && {
				ANTHROPIC_MODEL: this.config.aiProvider.model,
			}),
		};

		logger.debug("AGENT", "Spawning Claude CLI", {
			args: args.map((a) => (a.length > 100 ? a.substring(0, 100) + "..." : a)),
			workingDir,
		});

		const proc = spawn("claude", args, {
			cwd: workingDir,
			env,
			stdio: ["pipe", "pipe", "ignore"], // Suppress internal CLI status messages/noise on stderr
		});

		let buffer = "";

		if (!proc.stdout) {
			throw new Error("Failed to capture Claude CLI output");
		}

		const readable = Readable.from(proc.stdout);

		for await (const chunk of readable) {
			buffer += chunk.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const line of lines) {
				if (!line.trim()) continue;
				try {
					const data = JSON.parse(line);
					// Filter for text content blocks in the stream
					// Note: Adjusting to handle different stream message types
					if (data.type === "text" && data.content) {
						yield data.content;
					} else if (data.type === "content_block_delta" && data.delta?.text) {
						yield data.delta.text;
					} else if (data.type === "message" && data.content) {
						// Final message might come as a whole
						if (Array.isArray(data.content)) {
							for (const block of data.content) {
								if (block.type === "text" && block.text) {
									yield block.text;
								}
							}
						}
					}
				} catch (e) {
					// Silent fail for non-JSON or partial lines
				}
			}
		}

		// Wait for process to exit
		await new Promise<void>((resolve, reject) => {
			proc.on("exit", (code) => {
				if (code === 0) resolve();
				else reject(new Error(`Claude CLI exited with code ${code}`));
			});
			proc.on("error", reject);
		});
	}

	private createAIModel(
		aiProvider: ReactAgentConfig["aiProvider"],
	): ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI {
		const { type, apiKey, model, baseURL } = aiProvider;

		logger.debug("AGENT", "Creating AI model instance", {
			type,
			model,
			hasBaseURL: !!baseURL,
		});

		switch (type) {
			case "openai":
				return new ChatOpenAI({
					apiKey,
					modelName: model || "gpt-5.2",
				});
			case "openai-compatible":
				return new ChatOpenAI({
					apiKey,
					modelName: model || "gpt-5.2",
					configuration: {
						baseURL: baseURL || "https://api.openai.com/v1",
					},
				});
			case "anthropic":
				return new ChatAnthropic({
					apiKey,
					modelName: model || "claude-sonnet-4-5",
				});
			case "anthropic-compatible":
				if (!baseURL) {
					throw new Error(
						"baseURL is required for anthropic-compatible provider",
					);
				}
				if (!model) {
					throw new Error(
						"model is required for anthropic-compatible provider",
					);
				}
				return new ChatAnthropic({
					apiKey,
					modelName: model,
					anthropicApiUrl: baseURL,
				});
			case "google":
				return new ChatGoogleGenerativeAI({
					apiKey,
					model: model || "gemini-3-flash-preview",
				});
			default:
				logger.error(
					"AGENT",
					"Unsupported AI provider type",
					new Error(`Unsupported AI provider type: ${type}`),
					{ type },
				);
				throw new Error(`Unsupported AI provider type: ${type}`);
		}
	}

	async initialize(): Promise<void> {
		if (
			this.config.aiProvider.type === "claude-code" ||
			this.config.aiProvider.type === "gemini-cli"
		) {
			logger.info(
				"AGENT",
				`${this.config.aiProvider.type} CLI mode initialized (skipping LangChain setup)`,
			);
			return;
		}

		if (!this.aiModel) {
			throw new Error("AI model not created for non-CLI provider");
		}

		// Create the agent using LangChain's createAgent function with dynamic system prompt
		this.agent = createAgent({
			model: this.aiModel,
			tools: this.tools,
			systemPrompt: this.createDynamicSystemPrompt(),
		});

		logger.info("AGENT", "Agent initialized successfully", {
			toolCount: this.tools.length,
			hasContextSchema: !!this.contextSchema,
		});
	}

	/**
	 * Query repository with a given query and optional context
	 *
	 * @param repoPath - The repository path (deprecated, for compatibility)
	 * @param query - The query string
	 * @param context - Optional context object containing working directory and metadata
	 * @returns The agent's response as a string
	 */
	async queryRepository(
		repoPath: string,
		query: string,
		context?: AgentContext,
	): Promise<string> {
		logger.info("AGENT", "Query started", {
			queryLength: query.length,
			hasContext: !!context,
		});

		if (this.config.aiProvider.type === "claude-code") {
			let fullContent = "";
			for await (const chunk of this.streamClaudeCli(query, context)) {
				fullContent += chunk;
			}
			return fullContent;
		}

		if (this.config.aiProvider.type === "gemini-cli") {
			let fullContent = "";
			for await (const chunk of this.streamGeminiCli(query, context)) {
				fullContent += chunk;
			}
			return fullContent;
		}

		const timingId = logger.timingStart("agentQuery");

		if (!this.agent) {
			logger.error(
				"AGENT",
				"Agent not initialized",
				new Error("Agent not initialized. Call initialize() first."),
			);
			throw new Error("Agent not initialized. Call initialize() first.");
		}

		// Prepare the messages for the agent - system prompt already set during initialization
		const messages = [new HumanMessage(query)];

		logger.debug("AGENT", "Invoking agent with messages", {
			messageCount: messages.length,
			hasContext: !!context,
		});

		// Execute the agent with optional context
		const result = await this.agent.invoke(
			{
				messages,
			},
			context ? { context, recursionLimit: 100 } : { recursionLimit: 100 },
		);

		// Extract the last message content from the state
		const lastMessage = result.messages[result.messages.length - 1];
		const content =
			typeof lastMessage.content === "string"
				? lastMessage.content
				: JSON.stringify(lastMessage.content);

		logger.timingEnd(timingId, "AGENT", "Query completed");
		logger.info("AGENT", "Query result received", {
			responseLength: content.length,
		});

		return content;
	}

	/**
	 * Stream repository query with optional context
	 *
	 * @param repoPath - The repository path (deprecated, for compatibility)
	 * @param query - The query string
	 * @param context - Optional context object containing working directory and metadata
	 * @returns Async generator yielding string chunks
	 */
	async *streamRepository(
		repoPath: string,
		query: string,
		context?: AgentContext,
	): AsyncGenerator<string, void, unknown> {
		logger.info("AGENT", "Stream started", {
			queryLength: query.length,
			hasContext: !!context,
		});

		if (this.config.aiProvider.type === "claude-code") {
			yield* this.streamClaudeCli(query, context);
			return;
		}

		if (this.config.aiProvider.type === "gemini-cli") {
			yield* this.streamGeminiCli(query, context);
			return;
		}

		const timingId = logger.timingStart("agentStream");

		if (!this.agent) {
			logger.error(
				"AGENT",
				"Agent not initialized",
				new Error("Agent not initialized. Call initialize() first."),
			);
			throw new Error("Agent not initialized. Call initialize() first.");
		}

		// Prepare messages for the agent - system prompt already set during initialization
		const messages = [new HumanMessage(query)];

		logger.debug("AGENT", "Invoking agent stream with messages", {
			messageCount: messages.length,
			hasContext: !!context,
		});

		// Set up interruption handling
		let isInterrupted = false;
		const cleanup = () => {
			isInterrupted = true;
		};

		// Listen for interruption signals (Ctrl+C)
		logger.debug("AGENT", "Setting up interruption handlers for streaming");
		process.on("SIGINT", cleanup);
		process.on("SIGTERM", cleanup);

		try {
			// Stream the agent response with LLM token streaming
			const stream = await this.agent.stream(
				{
					messages,
				},
				context
					? {
							context,
							streamMode: "messages",
							recursionLimit: 100,
						}
					: {
							streamMode: "messages",
							recursionLimit: 100,
						},
			);

			logger.debug("AGENT", "Streaming response started");

			// Process stream chunks and yield content
			let tokenCount = 0;
			for await (const [token, metadata] of stream) {
				// Check for interruption
				if (isInterrupted) {
					logger.warn("AGENT", "Streaming interrupted by user");
					yield "\n\n[Streaming interrupted by user]";
					break;
				}

				// Skip tool nodes and tool calls - only stream final model response text
				if (metadata?.langgraph_node === "tools") {
					// Skip tool execution results
					continue;
				}

				// Handle both string tokens and structured content
				if (typeof token === "string") {
					tokenCount++;
					yield token;
				} else if (token && typeof token === "object") {
					// Handle structured token content
					if (token.content) {
						if (typeof token.content === "string") {
							tokenCount++;
							yield token.content;
						} else if (Array.isArray(token.content)) {
							// Handle content blocks (common in LangChain)
							// Skip tool call blocks (only stream final text)

							for (const block of token.content) {
								if (block.type === "text" && block.text) {
									tokenCount++;
									yield block.text;
								}
							}
						}
					}
				}
			}

			// Log token progress periodically
			if (tokenCount > 0 && tokenCount % 100 === 0) {
				logger.debug("AGENT", "Streaming progress", { tokenCount });
			}

			// Clean end of stream
			yield "\n";
		} catch (error) {
			// Enhanced error handling for different error types
			let errorMessage = "Unknown streaming error";

			if (error instanceof Error) {
				// Handle common streaming errors with specific messages
				if (error.message.includes("timeout")) {
					errorMessage =
						"Streaming timeout - request took too long to complete";
				} else if (
					error.message.includes("network") ||
					error.message.includes("ENOTFOUND")
				) {
					errorMessage = "Network error - unable to connect to AI provider";
				} else if (error.message.includes("rate limit")) {
					errorMessage = "Rate limit exceeded - please try again later";
				} else if (
					error.message.includes("authentication") ||
					error.message.includes("unauthorized")
				) {
					errorMessage = "Authentication error - check your API credentials";
				} else {
					errorMessage = `Streaming error: ${error.message}`;
				}
			}

			logger.error(
				"AGENT",
				"Streaming error",
				error instanceof Error ? error : new Error(errorMessage),
			);
			yield `\n\n[Error: ${errorMessage}]`;
			throw error;
		} finally {
			// Clean up event listeners
			process.removeListener("SIGINT", cleanup);
			process.removeListener("SIGTERM", cleanup);
			logger.timingEnd(timingId, "AGENT", "Streaming completed");
		}
	}
}
