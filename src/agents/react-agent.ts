import { createAgent } from "langchain";
import { fileListTool } from "../tools/file-listing.tool";
import { fileReadTool } from "../tools/file-reading.tool";
import { GrepContentTool } from "../tools/grep-content.tool";
import { FileFindTool } from "../tools/file-finding.tool";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

// Import the Librarian config interface
import { LibrarianConfig } from "../index";

export interface ReactAgentConfig {
  aiProvider: {
    type: 'openai' | 'anthropic' | 'google' | 'openai-compatible';
    apiKey: string;
    model?: string;
    baseURL?: string;
  };
  workingDir: string;
}

export class ReactAgent {
  private aiModel: ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI;
  private tools: any[];
  private agent: any;

  constructor(config: ReactAgentConfig) {
    this.aiModel = this.createAIModel(config.aiProvider);
    
    // Initialize tools - modernized tool pattern
    this.tools = [
      fileListTool,
      fileReadTool,
      new GrepContentTool(config.workingDir),
      new FileFindTool(config.workingDir)
    ];
  }

  private createAIModel(aiProvider: ReactAgentConfig['aiProvider']): ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI {
    const { type, apiKey, model, baseURL } = aiProvider;
    
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
        throw new Error(`Unsupported AI provider type: ${type}`);
    }
  }

  async initialize(): Promise<void> {
    // Create the agent using LangChain's createAgent function
    this.agent = createAgent({
      model: this.aiModel,
      tools: this.tools,
      systemPrompt: `You are a sophisticated AI research assistant that can explore and analyze code repositories using specialized tools. 
      
Your available tools are:
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

Always provide specific file paths and line numbers when referencing code in your responses.`
    });
  }

  async queryRepository(repoPath: string, query: string): Promise<string> {
    if (!this.agent) {
      throw new Error("Agent not initialized. Call initialize() first.");
    }

    // Create a system message with repository context
    const systemMessage = `You are analyzing a repository located at "${repoPath}". 
    Use the available tools to explore the repository structure and content to answer the user's question. 
    All file operations should be performed relative to this repository path.`;
    
    // Prepare the messages for the agent
    const messages = [
      new SystemMessage(systemMessage),
      new HumanMessage(query)
    ];

    // Execute the agent
    const result = await this.agent.invoke({
      messages
    });

    return result.content as string;
  }
}