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

/**
 * Configuration interface for ReactAgent
 */
export interface ReactAgentConfig {
  /** AI provider configuration including type, API key, and optional model/base URL */
  aiProvider: {
    type: 'openai' | 'anthropic' | 'google' | 'openai-compatible';
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
}

export class ReactAgent {
  private aiModel: ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI;
  private tools: any[];
  private agent: any;
  private config: ReactAgentConfig;

  constructor(config: ReactAgentConfig) {
    this.config = config;
    this.aiModel = this.createAIModel(config.aiProvider);

    // Initialize tools - modernized tool pattern
    this.tools = [
      fileListTool,
      fileReadTool,
      grepContentTool,
      fileFindTool
    ];

    logger.info('AGENT', 'Initializing ReactAgent', {
      aiProviderType: config.aiProvider.type,
      model: config.aiProvider.model,
      workingDir: config.workingDir.replace(os.homedir(), '~'),
      toolCount: this.tools.length
    });
  }

  /**
   * Creates a dynamic system prompt based on current configuration and technology context
   * @returns A context-aware system prompt string
   */
  createDynamicSystemPrompt(): string {
    const { workingDir, technology } = this.config;

    let prompt = `You are a sophisticated AI research assistant that can explore and analyze code repositories using specialized tools.
`;

    // Add technology context if available
    if (technology) {
      prompt += `
You are currently exploring the **${technology.name}** technology repository.
Repository: ${technology.repository}
Branch: ${technology.branch}
Working Directory: ${workingDir}

Focus your analysis on understanding the architecture, key components, and usage patterns specific to this technology.
`;
    } else {
      prompt += `
Working Directory: ${workingDir}
`;
    }

    prompt += `Your available tools are:
- file_list: List directory contents with metadata
- file_read: Read the contents of a specific file
- grep_content: Search for content patterns across multiple files
- file_find: Find files matching specific patterns

When analyzing a repository:
1. Start by using file_list to understand the repository structure
2. Use file_find to locate specific files of interest
3. Use file_read to examine file contents in detail
4. Use grep_content to search for specific code patterns or text
5. Synthesize all gathered information to provide comprehensive answers

Always provide specific file paths and line numbers when referencing code in your responses.`;

    logger.debug('AGENT', 'Dynamic system prompt generated', {
      hasTechnologyContext: !!technology,
      promptLength: prompt.length
    });

    return prompt;
  }

  private createAIModel(aiProvider: ReactAgentConfig['aiProvider']): ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI {
    const { type, apiKey, model, baseURL } = aiProvider;

    logger.debug('AGENT', 'Creating AI model instance', { type, model, hasBaseURL: !!baseURL });

    switch (type) {
      case 'openai':
        return new ChatOpenAI({
          apiKey,
          modelName: model || 'gpt-4o',
        });
      case 'openai-compatible':
        return new ChatOpenAI({
          apiKey,
          modelName: model || 'gpt-4o',
          configuration: {
            baseURL: baseURL || 'https://api.openai.com/v1',
          }
        });
      case 'anthropic':
        return new ChatAnthropic({
          apiKey,
          modelName: model || 'claude-3-sonnet-20240229',
        });
      case 'google':
        return new ChatGoogleGenerativeAI({
          apiKey,
          model: model || 'gemini-pro',
        });
      default:
        logger.error('AGENT', 'Unsupported AI provider type', new Error(`Unsupported AI provider type: ${type}`), { type });
        throw new Error(`Unsupported AI provider type: ${type}`);
    }
  }

  async initialize(): Promise<void> {
    // Create the agent using LangChain's createAgent function with dynamic system prompt
    this.agent = createAgent({
      model: this.aiModel,
      tools: this.tools,
      systemPrompt: this.createDynamicSystemPrompt()
    });

    logger.info('AGENT', 'Agent initialized successfully', { toolCount: this.tools.length });
  }

  async queryRepository(repoPath: string, query: string): Promise<string> {
    logger.info('AGENT', 'Query started', { queryLength: query.length });

    const timingId = logger.timingStart('agentQuery');

    if (!this.agent) {
      logger.error('AGENT', 'Agent not initialized', new Error("Agent not initialized. Call initialize() first."));
      throw new Error("Agent not initialized. Call initialize() first.");
    }

    // Prepare the messages for the agent - system prompt already set during initialization
    const messages = [
      new HumanMessage(query)
    ];

    logger.debug('AGENT', 'Invoking agent with messages', { messageCount: messages.length });

    // Execute the agent
    const result = await this.agent.invoke({
      messages
    });

    logger.timingEnd(timingId, 'AGENT', 'Query completed');
    logger.info('AGENT', 'Query result received', { responseLength: String(result.content).length });

    return result.content as string;
  }

  async *streamRepository(repoPath: string, query: string): AsyncGenerator<string, void, unknown> {
    logger.info('AGENT', 'Stream started', { queryLength: query.length });

    const timingId = logger.timingStart('agentStream');

    if (!this.agent) {
      logger.error('AGENT', 'Agent not initialized', new Error("Agent not initialized. Call initialize() first."));
      throw new Error("Agent not initialized. Call initialize() first.");
    }

    // Prepare messages for the agent - system prompt already set during initialization
    const messages = [
      new HumanMessage(query)
    ];

    logger.debug('AGENT', 'Invoking agent stream with messages', { messageCount: messages.length });

    // Set up interruption handling
    let isInterrupted = false;
    const cleanup = () => {
      isInterrupted = true;
    };

    // Listen for interruption signals (Ctrl+C)
    logger.debug('AGENT', 'Setting up interruption handlers for streaming');
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    try {
      // Stream the agent response with LLM token streaming
      const stream = await this.agent.stream({
        messages
      }, {
        streamMode: "messages"
      });

      logger.debug('AGENT', 'Streaming response started');

      // Process stream chunks and yield content
      let tokenCount = 0;
      for await (const [token, metadata] of stream) {
        // Check for interruption
        if (isInterrupted) {
          logger.warn('AGENT', 'Streaming interrupted by user');
          yield '\n\n[Streaming interrupted by user]';
          break;
        }

        // Handle both string tokens and structured content
        if (typeof token === 'string') {
          tokenCount++;
          yield token;
        } else if (token && typeof token === 'object') {
          // Handle structured token content
          if (token.content) {
            if (typeof token.content === 'string') {
              tokenCount++;
              yield token.content;
            } else if (Array.isArray(token.content)) {
              // Handle content blocks (common in LangChain)
              for (const block of token.content) {
                if (block.type === 'text' && block.text) {
                  tokenCount++;
                  yield block.text;
                }
              }
            }
          }
        }

        // Log token progress periodically
        if (tokenCount > 0 && tokenCount % 100 === 0) {
          logger.debug('AGENT', 'Streaming progress', { tokenCount });
        }
      }

      // If we completed without interruption, yield completion indicator
      if (!isInterrupted) {
        logger.debug('AGENT', 'Streaming completed', { tokenCount });
        yield '\n[Streaming completed]';
      }
    } catch (error) {
      // Enhanced error handling for different error types
      let errorMessage = 'Unknown streaming error';

      if (error instanceof Error) {
        // Handle common streaming errors with specific messages
        if (error.message.includes('timeout')) {
          errorMessage = 'Streaming timeout - request took too long to complete';
        } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
          errorMessage = 'Network error - unable to connect to AI provider';
        } else if (error.message.includes('rate limit')) {
          errorMessage = 'Rate limit exceeded - please try again later';
        } else if (error.message.includes('authentication') || error.message.includes('unauthorized')) {
          errorMessage = 'Authentication error - check your API credentials';
        } else {
          errorMessage = `Streaming error: ${error.message}`;
        }
      }

      logger.error('AGENT', 'Streaming error', error instanceof Error ? error : new Error(errorMessage));
      yield `\n\n[Error: ${errorMessage}]`;
      throw error;
    } finally {
      // Clean up event listeners
      process.removeListener('SIGINT', cleanup);
      process.removeListener('SIGTERM', cleanup);
      logger.timingEnd(timingId, 'AGENT', 'Streaming completed');
    }
  }
}