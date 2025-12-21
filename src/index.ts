/**
 * Librarian CLI - Technology Research Agent
 * Main entry point for the application
 */

import { clone, fetch, checkout } from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import fs from 'fs';
import path from 'path';

// LangChain imports for AI provider integration
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { BaseMessage, SystemMessage, HumanMessage } from '@langchain/core/messages';

export interface LibrarianConfig {
  technologies: {
    [group: string]: {
      [tech: string]: {
        repo: string;
        branch?: string;
        description?: string;
      };
    };
  };
  aiProvider: {
    type: 'openai' | 'anthropic' | 'google' | 'openai-compatible';
    apiKey: string;
    model?: string;
    baseURL?: string;
  };
  workingDir: string;
  repos_path?: string;
}

export class Librarian {
  private config: LibrarianConfig;
  private aiModel: ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI;

  constructor(config: LibrarianConfig) {
    this.config = config;
    this.aiModel = this.createAIModel();
  }

  private createAIModel(): ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI {
    const { type, apiKey, model, baseURL } = this.config.aiProvider;
    
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
    console.log('Librarian initialized');
    // Create working directory if it doesn't exist
    const workDir = this.config.repos_path || this.config.workingDir;
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }
  }

  private getSecureRepoPath(repoName: string): string {
    // Check for path traversal attempts in the repoName before sanitizing
    if (repoName.includes('../') || repoName.includes('..\\') || repoName.startsWith('..')) {
      throw new Error(`Repository name "${repoName}" contains invalid path characters`);
    }
    
    // Sanitize the repoName to prevent directory traversal
    const sanitizedRepoName = path.basename(repoName);
    const workDir = this.config.repos_path || this.config.workingDir;
    const repoPath = path.join(workDir, sanitizedRepoName);
    
    // Verify that the resulting path is within the working directory (sandboxing)
    const resolvedWorkingDir = path.resolve(workDir);
    const resolvedRepoPath = path.resolve(repoPath);
    
    if (!resolvedRepoPath.startsWith(resolvedWorkingDir)) {
      throw new Error(`Repository name "${repoName}" attempts to escape the working directory sandbox`);
    }
    
    return repoPath;
  }

  async updateRepository(repoName: string): Promise<void> {
    const repoPath = this.getSecureRepoPath(repoName);
    const gitPath = path.join(repoPath, '.git');
    
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository ${repoName} does not exist at ${repoPath}. Cannot update.`);
    }
    
    if (!fs.existsSync(gitPath)) {
      throw new Error(`Directory ${repoName} exists at ${repoPath} but is not a git repository. Cannot update.`);
    }

    console.log(`Updating repository ${repoName} at ${repoPath}`);
    
    // Fetch updates from the remote
    await fetch({
      fs,
      http,
      dir: repoPath,
      singleBranch: true,
    });
    
    const branch = this.getRepoBranch(repoName);
    // Checkout the latest version
    await checkout({
      fs,
      dir: repoPath,
      ref: `origin/${branch}`,
    });
  }

  private getRepoBranch(repoName: string): string {
    for (const group of Object.values(this.config.technologies)) {
      if (group[repoName]) {
        return group[repoName].branch || 'main';
      }
    }
    return 'main';
  }

  private getRepoUrl(repoName: string): string | undefined {
    for (const group of Object.values(this.config.technologies)) {
      if (group[repoName]) {
        return group[repoName].repo;
      }
    }
    return undefined;
  }

  async syncRepository(repoName: string): Promise<string> {
    const repoUrl = this.getRepoUrl(repoName);
    const branch = this.getRepoBranch(repoName);
    
    if (!repoUrl) {
      throw new Error(`Repository ${repoName} not found in configuration`);
    }

    const repoPath = this.getSecureRepoPath(repoName);
    
    if (fs.existsSync(repoPath)) {
      // Repository exists, update it
      await this.updateRepository(repoName);
    } else {
      // Repository doesn't exist, clone it
      return await this.cloneRepository(repoName, repoUrl, branch);
    }
    
    return repoPath;
  }

  async cloneRepository(repoName: string, repoUrl: string, branch: string = 'main'): Promise<string> {
    const repoPath = this.getSecureRepoPath(repoName);
    
    // Check if repository already exists
    if (fs.existsSync(repoPath)) {
      // Check if it's a git repository by checking for .git folder
      const gitPath = path.join(repoPath, '.git');
      if (fs.existsSync(gitPath)) {
        console.log(`Repository ${repoName} already exists at ${repoPath}, updating instead of cloning`);
        await this.updateRepository(repoName);
      } else {
        console.log(`Directory ${repoName} exists but is not a git repo, skipping update`);
      }
      return repoPath;
    }

    console.log(`Cloning repository ${repoName} from ${repoUrl} (branch: ${branch}) to ${repoPath}`);
    
    await clone({
      fs,
      http,
      dir: repoPath,
      url: repoUrl,
      ref: branch,
      singleBranch: true,
      depth: 1, // Shallow clone for faster operation
    });
    
    return repoPath;
  }

  async queryRepository(repoName: string, query: string): Promise<string> {
    const repoUrl = this.getRepoUrl(repoName);
    
    if (!repoUrl) {
      throw new Error(`Repository ${repoName} not found in configuration`);
    }

    // Clone or sync the repository first
    const repoPath = await this.syncRepository(repoName);
    
    // Read the repository content (for now, just list files)
    const repoContents = this.readRepositoryContents(repoPath);
    
    // Create a prompt for the AI with the repository information
    const systemMessage = `You are an expert software engineer analyzing the repository "${repoName}". 
    The repository is located at "${repoPath}" and contains the following files:
    ${repoContents.slice(0, 1000)}...`;
    
    const userMessage = `Based on the repository structure and content, please answer the following question: ${query}`;
    
    // Query the AI model
    const aiResponse = await this.queryAI([
      new SystemMessage(systemMessage),
      new HumanMessage(userMessage)
    ]);
    
    return aiResponse.content as string;
  }

  private readRepositoryContents(repoPath: string): string {
    try {
      const files = this.walkDirectory(repoPath);
      return files.join('\n');
    } catch (error) {
      console.error(`Error reading repository contents: ${error}`);
      return 'Error reading repository contents';
    }
  }

  private walkDirectory(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        // Skip node_modules and other large directories
        if (file !== 'node_modules' && !file.startsWith('.')) {
          this.walkDirectory(filePath, fileList);
        }
      } else {
        // Add file path to the list
        fileList.push(filePath);
      }
    }
    
    return fileList;
  }

  async queryAI(messages: BaseMessage[]): Promise<BaseMessage> {
    return await this.aiModel.invoke(messages);
  }
}