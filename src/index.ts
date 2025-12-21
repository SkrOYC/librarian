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

  public resolveTechnology(qualifiedName: string): { name: string, group: string, repo: string, branch: string } | undefined {
    let group: string | undefined;
    let name: string;

    if (qualifiedName.includes(':')) {
      const parts = qualifiedName.split(':');
      group = parts[0];
      name = parts[1] || '';
    } else {
      name = qualifiedName;
    }

    if (group) {
      const groupTechs = this.config.technologies[group];
      const tech = groupTechs ? groupTechs[name] : undefined;
      if (tech) {
        return { name, group, repo: tech.repo, branch: tech.branch || 'main' };
      }
    } else {
      for (const [groupName, techs] of Object.entries(this.config.technologies)) {
        const tech = techs[name];
        if (tech) {
          return { name, group: groupName, repo: tech.repo, branch: tech.branch || 'main' };
        }
      }
    }
    return undefined;
  }

  private getSecureGroupPath(groupName: string): string {
    if (groupName.includes('../') || groupName.includes('..\\') || groupName.startsWith('..')) {
      throw new Error(`Group name "${groupName}" contains invalid path characters`);
    }

    const sanitizedGroupName = path.basename(groupName);
    const workDir = this.config.repos_path || this.config.workingDir;
    const groupPath = path.join(workDir, sanitizedGroupName);

    const resolvedWorkingDir = path.resolve(workDir);
    const resolvedGroupPath = path.resolve(groupPath);

    if (!resolvedGroupPath.startsWith(resolvedWorkingDir)) {
      throw new Error(`Group name "${groupName}" attempts to escape the working directory sandbox`);
    }

    return groupPath;
  }

  private getSecureRepoPath(repoName: string, groupName: string = 'default'): string {
    // Check for path traversal attempts in the repoName before sanitizing
    if (repoName.includes('../') || repoName.includes('..\\') || repoName.startsWith('..')) {
      throw new Error(`Repository name "${repoName}" contains invalid path characters`);
    }
    
    // Sanitize the names
    const sanitizedRepoName = path.basename(repoName);
    const groupPath = this.getSecureGroupPath(groupName);
    const repoPath = path.join(groupPath, sanitizedRepoName);
    
    // Verify that the resulting path is within the group directory (which is already sandboxed)
    const resolvedGroupDir = path.resolve(groupPath);
    const resolvedRepoPath = path.resolve(repoPath);
    
    if (!resolvedRepoPath.startsWith(resolvedGroupDir)) {
      throw new Error(`Repository name "${repoName}" attempts to escape the group sandbox`);
    }
    
    return repoPath;
  }

  async updateRepository(repoName: string, groupName: string = 'default'): Promise<void> {
    const repoPath = this.getSecureRepoPath(repoName, groupName);
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
    
    const tech = this.resolveTechnology(groupName + ':' + repoName) || this.resolveTechnology(repoName);
    const branch = tech?.branch || 'main';
    
    // Checkout the latest version
    await checkout({
      fs,
      dir: repoPath,
      ref: `origin/${branch}`,
    });
  }

  private getRepoBranch(repoName: string): string {
    const tech = this.resolveTechnology(repoName);
    return tech?.branch || 'main';
  }

  private getRepoUrl(repoName: string): string | undefined {
    const tech = this.resolveTechnology(repoName);
    return tech?.repo;
  }

  async syncRepository(repoName: string): Promise<string> {
    const tech = this.resolveTechnology(repoName);
    
    if (!tech) {
      throw new Error(`Repository ${repoName} not found in configuration`);
    }

    const repoPath = this.getSecureRepoPath(tech.name, tech.group);
    
    if (fs.existsSync(repoPath)) {
      // Repository exists, update it
      await this.updateRepository(tech.name, tech.group);
    } else {
      // Repository doesn't exist, clone it
      return await this.cloneRepository(tech.name, tech.repo, tech.group, tech.branch);
    }
    
    return repoPath;
  }

  async cloneRepository(repoName: string, repoUrl: string, groupName: string = 'default', branch: string = 'main'): Promise<string> {
    const repoPath = this.getSecureRepoPath(repoName, groupName);
    
    // Check if repository already exists
    if (fs.existsSync(repoPath)) {
      // Check if it's a git repository by checking for .git folder
      const gitPath = path.join(repoPath, '.git');
      if (fs.existsSync(gitPath)) {
        console.log(`Repository ${repoName} already exists at ${repoPath}, updating instead of cloning`);
        await this.updateRepository(repoName, groupName);
      } else {
        console.log(`Directory ${repoName} exists but is not a git repo, skipping update`);
      }
      return repoPath;
    }

    // Ensure group directory exists
    const groupPath = this.getSecureGroupPath(groupName);
    if (!fs.existsSync(groupPath)) {
      fs.mkdirSync(groupPath, { recursive: true });
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