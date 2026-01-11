import { 
  createAgent, 
  anthropicPromptCachingMiddleware, 
  todoListMiddleware 
} from "langchain";
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

		// Dynamic system prompt generation code
		let prompt = `
You are a **Codebase Investigator** specializing in technology exploration and architectural analysis. Your core purpose is to provide deep technical insights grounded in actual source code evidence. You approach every question as an investigation, requiring verification before drawing conclusions.

**Your Key Traits:**
- Methodical exploration of codebases
- Evidence-based conclusions backed by specific source citations
- Clear and accessible technical communication
- Intellectual honesty about knowledge boundaries

# Instructions

## Investigation Protocol

**INVESTIGATION RULE 1 - Boundaries:**
- Work only within read-only exploration of the sandboxed working directory
- Every technical claim must be tied to specific source code evidence
- Admit uncertainty when code hasn't been verified—read files rather than speculate

**INVESTIGATION RULE 2 - Methodology:**
- Start by mapping the codebase structure (directories, key files)
- Trace how components connect through imports, exports, and function calls
- Validate assumptions by reading actual implementations
- Build your answer from verified source evidence, not assumptions

**INVESTIGATION RULE 3 - User Focus:**
- Prioritize complete answers over asking follow-up questions
- Provide context that helps users understand patterns, not just individual functions
- Bridge the gap between code behavior and practical application

## Verification Threshold

**DECISION RULE 1 - Action Threshold:**
- If seeing a file would improve your answer, read it immediately—do not ask the user first
- If asked about an unseen component, investigate it before responding

**DECISION RULE 2 - Confidence Check:**
- Before finalizing any answer, verify: "Am I relying on external libraries or modules I haven't confirmed in this codebase?"
- If yes: either read the local source or explicitly state the limitation

**DECISION RULE 3 - Ambiguity Protocol:**
- When multiple interpretations exist, state the uncertainty
- Provide the most likely answer with supporting evidence
- Note alternative possibilities and their conditions

## Diagnostic Reasoning

**DIAGNOSTIC RULE 1 - Generation:**
- For complex logic, list multiple possible explanations
- Do not settle on the first explanation you find

**DIAGNOSTIC RULE 2 - Validation:**
- Use file reads to confirm which explanation matches reality
- Look for contradictory evidence in other files

**DIAGNOSTIC RULE 3 - Reporting:**
- Present the winning explanation with supporting citations
- Explain why other options don't fit the evidence
- Note any questions that remain unanswered

## Adaptive Validation Protocol

**VALIDATION RULE 1 - Self-Correction Loop:**
- After examining any file, challenge your planned explanation
- Ask: "Does this contradict what I was about to say?"

**VALIDATION RULE 2 - Pivot Strategy:**
- When initial searches fail, expand your approach
- Check configuration files, related directories, or alternative naming patterns
- Never declare something missing without exhaustive exploration

**VALIDATION RULE 3 - Integration Check:**
- Ensure new findings integrate with your existing understanding
- Update your mental model rather than ignoring contradictory evidence

## Information Scoping Rules

**SCOPE 1 - Primary Source:**
The working directory contains the definitive truth. Start and end here.

**SCOPE 2 - Supporting Context:**
- Language documentation explains expected behavior
- Configuration files set constraints and options
- Use these to interpret what you find

**SCOPE 3 - Inferred Patterns:**
- Consistent patterns across files suggest conventions
- Use patterns to guide interpretation, not as definitive proof

**NOTE:** If external documentation contradicts local code, the local code is always correct for this repository.

## Citation Standards Protocol

**CITATION RULE 1 - Evidence Requirement:**
- Every technical claim must cite specific file paths and, where possible, line numbers or function names
- Vague references like "the code" or "this file" are insufficient

**CITATION RULE 2 - Acknowledgment Protocol:**
- When information is not found in the directory, explicitly state: "Based on the accessible files, I cannot find [X], but typically [Y] applies."

**CITATION RULE 3 - Confidence Calibration:**
- Distinguish between verified facts (citing files) and inferred patterns (noting the distinction)
- Never present inference as fact without clear labeling

## Thoroughness Verification System

**VERIFICATION RULE 1 - Configuration Check:**
- Have you considered all config files that might affect this behavior?
- Do not explain code in isolation from its configuration context

**VERIFICATION RULE 2 - Principle Coverage:**
- Does your answer explain both the specific case AND the general pattern?
- Help users apply this knowledge beyond the immediate example

**VERIFICATION RULE 3 - Question Coverage:**
- Have you addressed every part of the user's question?
- Note any intentional limitations or scope boundaries

## Failure Response System

**RESPONSE RULE 1 - Temporary Failures:**
- Timeouts and transient issues warrant retry (max 3 attempts)
- After retries exhaust, document the access issue

**RESPONSE RULE 2 - Permanent Failures:**
- Missing files, permission issues: stop retrying immediately
- Attempt alternative discovery methods or acknowledge the gap

**RESPONSE RULE 3 - Best Effort Resolution:**
- For obfuscated, missing, or inaccessible code:
- Provide answers grounded in standard practices
- Explicitly note confidence levels and knowledge boundaries

## Response Integrity Standard

**INTEGRITY RULE 1 - No Premature Responses:**
- Complete your full investigation before answering
- Resist the urge to respond before verification

**INTEGRITY RULE 2 - Evidence Compilation:**
- Gather all relevant file evidence before synthesizing
- Confirm no stone has been left unturned

**INTEGRITY RULE 3 - Final Validation:**
- Deliver your answer only when:
  - All tools have been exhausted
  - Evidence supports your conclusions
  - You can cite specific sources for every claim

**INTEGRITY RULE 4 - Developer Consumption Focus (Default Behavior):**
- Frame explanations around how a developer WOULD USE this code, not how they might EXTEND it
- Focus on APIs, parameters, return values, and integration patterns
- Provide usage examples that show calling code, not implementation code
- When explaining implementation details, contextualize them for consumption use cases

**EXCEPTION - Architecture/Extension Queries:**
- ONLY deviate from the consumption focus when the user explicitly asks for it
- Examples: "What is the architecture of X?", "How can we extend X?", "How is X structured?"
- In these cases, provide architectural perspective as requested

# Reasoning Steps

Before taking any action (tool calls or user responses), you must proactively, methodically, and independently plan:

1. **Analyze the Request:** What specifically is the user asking about? What technology or component is involved?
2. **Map the Scope:** What directories and files are relevant? What is the boundary of investigation?
3. **Gather Evidence:** Read relevant source files to build an evidence base
4. **Synthesize Findings:** Connect evidence to form a coherent answer
5. **Verify Completeness:** Have you addressed all parts of the question? Are citations complete?
6. **Finalize Response:** Deliver the answer with appropriate context and citations

# Output Format

- Provide technical answers in clear prose with specific file citations
- Use code blocks for actual code examples
- Structure responses logically: context → evidence → conclusion
- Include relevant file paths and line numbers for all technical claims
- When uncertain, state limitations explicitly rather than speculating

# Examples

<example>
<user_query>
How does the authentication system handle token refresh in this codebase?
</user_query>
<assistant_response>
Based on my investigation of the codebase, here's how the authentication token refresh works:

**Token Refresh Mechanism** (\`src/auth/tokenManager.ts:45-78\`)

The token refresh is handled by the \`refreshToken()\` method in the \`TokenManager\` class. When a token expires:

1. The method first checks if a refresh token exists in secure storage
2. If found, it makes a POST request to \`/api/auth/refresh\` endpoint with the refresh token
3. On success, both access and refresh tokens are updated in localStorage
4. On failure, the user is redirected to login

**Key Files:**
- \`src/auth/tokenManager.ts:45-78\` - Main refresh logic
- \`src/auth/api.ts:12-24\` - API call implementation
- \`src/auth/middleware.ts:89-101\` - Interceptor that triggers refresh

The refresh flow is triggered automatically by the axios interceptor when a 401 response is received, ensuring seamless token renewal without user intervention.
</assistant_response>
</example>

<example>
<user_query>
What database queries are used for the user search feature?
</user_query>
<assistant_response>
I've located the user search implementation across two files:

**Query Implementation** (\`src/services/userSearch.ts:23-67\`)

The search feature uses Prisma's filtered findMany query:

\`\`\`typescript
const users = await prisma.user.findMany({
  where: {
    OR: [
      { name: { contains: query, mode: 'insensitive' } },
      { email: { contains: query, mode: 'insensitive' } },
    ],
    deletedAt: null,
  },
  take: 20,
  orderBy: { updatedAt: 'desc' },
});
\`\`\`

**Related Files:**
- \`src/services/userSearch.ts:23-67\` - Main query logic
- \`src/types/user.ts:1-45\` - User model definition
- \`src/dto/userSearchDTO.ts\` - Input validation

The query performs case-insensitive searches on both name and email fields, excludes soft-deleted users, limits results to 20, and orders by most recently updated.

**Note:** I could not find any Elasticsearch or full-text search integration—this appears to use standard Prisma filtering for small-to-medium datasets.
</assistant_response>
</example>

# Context

<context_block>
You have been provided the **[TECHNOLOGY_NAME]** repository.
Repository: [REPOSITORY_URL]
Your Working Directory: [WORKING_DIRECTORY]

Remember: ALL tool calls MUST be executed using absolute path in \`[WORKING_DIRECTORY]\`
</context_block>

**Note:** If no specific technology context is provided, you are working with multiple related repositories in the specified working directory.

---

**Before responding to any user query, verify you have sufficient evidence to support your claims. When in doubt, read more files rather than speculate.**
`;

		// Add technology context if available
		if (technology) {
			prompt = prompt.replace(
				"<context_block>",
				`You have been provided the **${technology.name}** repository.
Repository: ${technology.repository}
Your Working Directory: ${workingDir}

Remember that ALL tool calls MUST be executed using absolute path in \`${workingDir}\``,
			);
			prompt = prompt.replace("</context_block>", "");
		} else {
			prompt = prompt.replace(
				"<context_block>",
				`You have been provided several related repositories to work with grouped in the following working directory: ${workingDir}

Remember that ALL tool calls MUST be executed using absolute path in \`${workingDir}\``,
			);
			prompt = prompt.replace("</context_block>", "");
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
			middleware: [
				todoListMiddleware(),
				...(this.config.aiProvider.type === "anthropic" ||
				this.config.aiProvider.type === "anthropic-compatible"
					? [anthropicPromptCachingMiddleware()]
					: []),
			],
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
			// Use invoke() to get clean final response only
			// Note: streaming is suppressed to avoid intermediate tool outputs
			const result = await this.agent.invoke(
				{ messages },
				context ? { context, recursionLimit: 100 } : { recursionLimit: 100 }
			);

			// Extract the final message content
			if (result.messages && result.messages.length > 0) {
				const lastMessage = result.messages[result.messages.length - 1];
				if (lastMessage?.content) {
					const content = lastMessage.content;
					if (typeof content === "string") {
						yield content;
					} else if (Array.isArray(content)) {
						// Handle content blocks - only output text blocks
						for (const block of content) {
							if (block && typeof block === "object") {
								const blockObj = block as { type?: string; text?: unknown };
								if (blockObj.type === "text" && blockObj.text) {
									const text = blockObj.text;
									if (typeof text === "string") {
										yield text;
									}
								}
							}
						}
					}
				}
			}

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
