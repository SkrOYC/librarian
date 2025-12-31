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
import { ReactAgent } from './agents/react-agent.js';
import { AgentContext } from './agents/context-schema.js';
import { logger } from './utils/logger.js';
import os from 'os';

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
    type: 'openai' | 'anthropic' | 'google' | 'openai-compatible' | 'claude-code';
    apiKey: string;
    model?: string;
    baseURL?: string;
  };
  workingDir: string;
  repos_path?: string;
}

export class Librarian {
  private config: LibrarianConfig;
  private aiModel?: ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI;

  constructor(config: LibrarianConfig) {
    this.config = config;
    if (config.aiProvider.type !== 'claude-code') {
      this.aiModel = this.createAIModel();
    }

    logger.info('LIBRARIAN', 'Initializing librarian', {
      aiProviderType: config.aiProvider.type,
      model: config.aiProvider.model,
      workingDir: config.workingDir.replace(os.homedir(), '~'),
      reposPath: config.repos_path ? config.repos_path.replace(os.homedir(), '~') : 'workingDir'
    });
  }

  private createAIModel(): ChatOpenAI | ChatAnthropic | ChatGoogleGenerativeAI {
    logger.debug('LIBRARIAN', 'Creating AI model instance');

    const { type, apiKey, model, baseURL } = this.config.aiProvider;

    logger.debug('LIBRARIAN', 'AI provider configuration', { type, model, hasBaseURL: !!baseURL });
    
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
    // Check if Claude CLI is available if using claude-code provider
    if (this.config.aiProvider.type === 'claude-code') {
      try {
        const { execSync } = await import('child_process');
        execSync('claude --version', { stdio: 'ignore' });
        logger.info('LIBRARIAN', 'Claude CLI verified');
      } catch (error) {
        logger.error('LIBRARIAN', 'Claude CLI not found in PATH', undefined, { type: 'claude-code' });
        console.error('Error: "claude" CLI not found. Please install it to use the "claude-code" provider.');
        process.exit(1);
      }
    }

    // Create working directory if it doesn't exist
    const workDir = this.config.repos_path || this.config.workingDir;
    if (!fs.existsSync(workDir)) {
      logger.info('LIBRARIAN', 'Creating working directory', { path: workDir.replace(os.homedir(), '~') });
      fs.mkdirSync(workDir, { recursive: true });
    } else {
      logger.debug('LIBRARIAN', 'Working directory already exists', { path: workDir.replace(os.homedir(), '~') });
    }

    logger.info('LIBRARIAN', 'Initialization complete');
  }

  public resolveTechnology(qualifiedName: string): { name: string, group: string, repo: string, branch: string } | undefined {
    logger.debug('LIBRARIAN', 'Resolving technology', { qualifiedName });

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
        const result = { name, group, repo: tech.repo, branch: tech.branch || 'main' };
        logger.debug('LIBRARIAN', 'Technology resolved with explicit group', { name, group, repoHost: tech.repo.split('/')[2] || 'unknown' });
        return result;
      }
    } else {
      for (const [groupName, techs] of Object.entries(this.config.technologies)) {
        const tech = techs[name];
        if (tech) {
          const result = { name, group: groupName, repo: tech.repo, branch: tech.branch || 'main' };
          logger.debug('LIBRARIAN', 'Technology resolved by search', { name, group: groupName, repoHost: tech.repo.split('/')[2] || 'unknown' });
          return result;
        }
      }
    }
    logger.debug('LIBRARIAN', 'Technology not found in configuration', { qualifiedName });
    return undefined;
  }

  private getSecureGroupPath(groupName: string): string {
    logger.debug('PATH', 'Validating group path', { groupName });

    if (groupName.includes('../') || groupName.includes('..\\') || groupName.startsWith('..')) {
      logger.error('PATH', 'Group name contains path traversal characters', undefined, { groupName });
      throw new Error(`Group name "${groupName}" contains invalid path characters`);
    }

    const sanitizedGroupName = path.basename(groupName);
    const workDir = this.config.repos_path || this.config.workingDir;
    const groupPath = path.join(workDir, sanitizedGroupName);

    const resolvedWorkingDir = path.resolve(workDir);
    const resolvedGroupPath = path.resolve(groupPath);

    if (!resolvedGroupPath.startsWith(resolvedWorkingDir)) {
      logger.error('PATH', 'Group path escapes working directory sandbox', undefined, { groupName });
      throw new Error(`Group name "${groupName}" attempts to escape the working directory sandbox`);
    }

    logger.debug('PATH', 'Group path validated', { groupName, path: groupPath.replace(os.homedir(), '~') });
    return groupPath;
  }

  private getSecureRepoPath(repoName: string, groupName: string = 'default'): string {
    logger.debug('PATH', 'Validating repo path', { repoName, groupName });

    // Check for path traversal attempts in the repoName before sanitizing
    if (repoName.includes('../') || repoName.includes('..\\') || repoName.startsWith('..')) {
      logger.error('PATH', 'Repo name contains path traversal characters', undefined, { repoName, groupName });
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
      logger.error('PATH', 'Repo path escapes group sandbox', undefined, { repoName, groupName });
      throw new Error(`Repository name "${repoName}" attempts to escape the group sandbox`);
    }

    logger.debug('PATH', 'Repo path validated', { repoName, groupName, path: repoPath.replace(os.homedir(), '~') });
    return repoPath;
  }

  async updateRepository(repoName: string, groupName: string = 'default'): Promise<void> {
    logger.info('GIT', 'Updating repository', { repoName, groupName });

    const timingId = logger.timingStart('updateRepository');

    const repoPath = this.getSecureRepoPath(repoName, groupName);
    const gitPath = path.join(repoPath, '.git');

    if (!fs.existsSync(repoPath)) {
      logger.error('GIT', 'Repository path does not exist', undefined, { repoName, repoPath: repoPath.replace(os.homedir(), '~') });
      throw new Error(`Repository ${repoName} does not exist at ${repoPath}. Cannot update.`);
    }

    if (!fs.existsSync(gitPath)) {
      logger.error('GIT', 'Directory is not a git repository', undefined, { repoName, repoPath: repoPath.replace(os.homedir(), '~') });
      throw new Error(`Directory ${repoName} exists at ${repoPath} but is not a git repository. Cannot update.`);
    }

    // Fetch updates from the remote
    logger.debug('GIT', 'Fetching updates from remote');
    await fetch({
      fs,
      http,
      dir: repoPath,
      singleBranch: true,
    });

    const tech = this.resolveTechnology(groupName + ':' + repoName) || this.resolveTechnology(repoName);
    const branch = tech?.branch || 'main';

    // Checkout the latest version
    logger.debug('GIT', 'Checking out branch', { branch });
    await checkout({
      fs,
      dir: repoPath,
      ref: `origin/${branch}`,
    });

    logger.timingEnd(timingId, 'GIT', `Repository updated: ${repoName}`);
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
    logger.info('GIT', 'Syncing repository', { repoName });

    const tech = this.resolveTechnology(repoName);

    if (!tech) {
      logger.error('GIT', 'Technology not found in configuration', undefined, { repoName });
      throw new Error(`Repository ${repoName} not found in configuration`);
    }

    const repoPath = this.getSecureRepoPath(tech.name, tech.group);

    // Check if this is a local path (not a remote URL)
    const isLocalRepo = !tech.repo.startsWith('http://') && !tech.repo.startsWith('https://');

    if (fs.existsSync(repoPath)) {
      // Repository exists
      if (isLocalRepo) {
        // For local repos, skip git operations - just use existing files
        logger.debug('GIT', 'Local repository exists, skipping git operations');
        return repoPath;
      }
      // Remote repository, update it (no-op for local repos to avoid isomorphic-git issues with local paths)
      if (!isLocalRepo) {
        logger.debug('GIT', 'Repository exists, performing update');
        await this.updateRepository(tech.name, tech.group);
      }
    } else {
      // Repository doesn't exist
      if (isLocalRepo) {
        // Local repo doesn't exist - this is an error in test setup
        logger.error('GIT', 'Local repository path does not exist', undefined, { repoName, repoPath });
        throw new Error(`Local repository ${repoName} does not exist at ${repoPath}`);
      }
      // Remote repository, clone it
      logger.debug('GIT', 'Repository does not exist, performing clone');
      return await this.cloneRepository(tech.name, tech.repo, tech.group, tech.branch);
    }

    return repoPath;
  }

  async cloneRepository(repoName: string, repoUrl: string, groupName: string = 'default', branch: string = 'main'): Promise<string> {
    logger.info('GIT', 'Cloning repository', { repoName, repoHost: repoUrl.split('/')[2] || 'unknown', branch, groupName });

    const timingId = logger.timingStart('cloneRepository');

    const repoPath = this.getSecureRepoPath(repoName, groupName);

    // Check if repository already exists
    if (fs.existsSync(repoPath)) {
      // Check if it's a git repository by checking for .git folder
      const gitPath = path.join(repoPath, '.git');
      if (fs.existsSync(gitPath)) {
        logger.debug('GIT', 'Repository already exists as git repo, updating instead');
        await this.updateRepository(repoName, groupName);
        return repoPath;
      }
    }

    // Ensure group directory exists
    const groupPath = this.getSecureGroupPath(groupName);
    if (!fs.existsSync(groupPath)) {
      logger.debug('GIT', 'Creating group directory', { groupName, path: groupPath.replace(os.homedir(), '~') });
      fs.mkdirSync(groupPath, { recursive: true });
    }

    logger.debug('GIT', 'Starting shallow clone', { depth: 1 });
    await clone({
      fs,
      http,
      dir: repoPath,
      url: repoUrl,
      ref: branch,
      singleBranch: true,
      depth: 1, // Shallow clone for faster operation
    });

    // Count files cloned
    let fileCount = 0;
    const countFiles = (dir: string) => {
      try {
        const files = fs.readdirSync(dir, { withFileTypes: true });
        for (const file of files) {
          if (file.name === '.git') continue;
          if (file.isDirectory()) {
            countFiles(path.join(dir, file.name));
          } else {
            fileCount++;
          }
        }
      } catch {
        // Ignore errors
      }
    };
    countFiles(repoPath);

    logger.debug('GIT', 'Clone completed', { fileCount });

    logger.timingEnd(timingId, 'GIT', `Repository cloned: ${repoName}`);
    return repoPath;
  }

  async queryRepository(repoName: string, query: string): Promise<string> {
    logger.info('LIBRARIAN', 'Querying repository', { repoName, queryLength: query.length });

    const timingId = logger.timingStart('queryRepository');

    const tech = this.resolveTechnology(repoName);

    if (!tech) {
      logger.error('LIBRARIAN', 'Technology not found in configuration', undefined, { repoName });
      throw new Error(`Repository ${repoName} not found in configuration`);
    }

    // Clone or sync the repository first
    const repoPath = await this.syncRepository(repoName);

    // Construct context object with working directory
    const context: AgentContext = {
      workingDir: repoPath,
      group: tech.group,
      technology: tech.name,
    };

    logger.debug('LIBRARIAN', 'Initializing agent for query with context', {
      workingDir: context.workingDir.replace(os.homedir(), '~'),
      group: context.group,
      technology: context.technology
    });

    // Initialize the agent
    const agent = new ReactAgent({
      aiProvider: this.config.aiProvider,
      workingDir: repoPath
    });
    await agent.initialize();

    // Execute the query using the agent with context
    const result = await agent.queryRepository(repoPath, query, context);

    logger.timingEnd(timingId, 'LIBRARIAN', `Query completed: ${repoName}`);
    logger.info('LIBRARIAN', 'Query result received', { repoName, responseLength: result.length });

    return result;
  }

  async *streamRepository(repoName: string, query: string): AsyncGenerator<string, void, unknown> {
    logger.info('LIBRARIAN', 'Streaming repository query', { repoName, queryLength: query.length });

    const timingId = logger.timingStart('streamRepository');

    const tech = this.resolveTechnology(repoName);

    if (!tech) {
      logger.error('LIBRARIAN', 'Technology not found in configuration', undefined, { repoName });
      throw new Error(`Repository ${repoName} not found in configuration`);
    }

    // Set up interruption handling at Librarian level
    let isInterrupted = false;
    const cleanup = () => {
      isInterrupted = true;
    };

    // Listen for interruption signals (Ctrl+C)
    logger.debug('LIBRARIAN', 'Setting up interruption handlers');
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    try {
      // Clone or sync repository first
      const repoPath = await this.syncRepository(repoName);

      // Check for interruption after sync
      if (isInterrupted) {
        logger.warn('LIBRARIAN', 'Repository sync interrupted by user', { repoName });
        yield '[Repository sync interrupted by user]';
        return;
      }

      // Construct context object with working directory
      const context: AgentContext = {
        workingDir: repoPath,
        group: tech.group,
        technology: tech.name,
      };

      logger.debug('LIBRARIAN', 'Initializing agent for streaming query with context', {
        workingDir: context.workingDir.replace(os.homedir(), '~'),
        group: context.group,
        technology: context.technology
      });

      // Initialize agent
      const agent = new ReactAgent({
        aiProvider: this.config.aiProvider,
        workingDir: repoPath
      });
      await agent.initialize();

      // Check for interruption after initialization
      if (isInterrupted) {
        logger.warn('LIBRARIAN', 'Agent initialization interrupted by user', { repoName });
        yield '[Agent initialization interrupted by user]';
        return;
      }

      // Execute streaming query using agent with context
      logger.debug('LIBRARIAN', 'Starting stream from agent');
      yield* agent.streamRepository(repoPath, query, context);
    } catch (error) {
      // Handle repository-level errors
      let errorMessage = 'Unknown error';

      if (error instanceof Error) {
        if (error.message.includes('not found in configuration')) {
          errorMessage = error.message;
        } else if (error.message.includes('git') || error.message.includes('clone')) {
          errorMessage = `Repository operation failed: ${error.message}`;
        } else if (error.message.includes('timeout')) {
          errorMessage = 'Repository operation timed out';
        } else {
          errorMessage = `Repository error: ${error.message}`;
        }
      }

      logger.error('LIBRARIAN', 'Stream error', error instanceof Error ? error : new Error(errorMessage), { repoName });
      yield `\n[Error: ${errorMessage}]`;
      throw error;
    } finally {
      // Clean up event listeners
      process.removeListener('SIGINT', cleanup);
      process.removeListener('SIGTERM', cleanup);
      logger.timingEnd(timingId, 'LIBRARIAN', `Stream completed: ${repoName}`);
    }
  }

  async queryGroup(groupName: string, query: string): Promise<string> {
    logger.info('LIBRARIAN', 'Querying group', { groupName, queryLength: query.length });

    const timingId = logger.timingStart('queryGroup');

    // Validate group exists
    if (!this.config.technologies[groupName]) {
      logger.error('LIBRARIAN', 'Group not found in configuration', undefined, { groupName });
      throw new Error(`Group ${groupName} not found in configuration`);
    }

    // Get the group directory path
    const groupPath = this.getSecureGroupPath(groupName);

    // Sync all technologies in the group first
    const technologies = this.config.technologies[groupName];
    if (technologies) {
      const techNames = Object.keys(technologies);
      logger.info('LIBRARIAN', 'Syncing all technologies in group', { groupName, techCount: techNames.length });
      for (const techName of techNames) {
        await this.syncRepository(techName);
      }
    }

    // Construct context object for group-level query
    const context: AgentContext = {
      workingDir: groupPath,
      group: groupName,
      technology: '', // No specific technology for group-level queries
    };

    logger.debug('LIBRARIAN', 'Initializing agent for group query with context', {
      workingDir: context.workingDir.replace(os.homedir(), '~'),
      group: context.group
    });

    // Initialize the agent with the group directory as working directory
    const agent = new ReactAgent({
      aiProvider: this.config.aiProvider,
      workingDir: groupPath
    });
    await agent.initialize();

    // Execute the query using the agent with context
    const result = await agent.queryRepository(groupPath, query, context);

    logger.timingEnd(timingId, 'LIBRARIAN', `Group query completed: ${groupName}`);
    logger.info('LIBRARIAN', 'Group query result received', { groupName, responseLength: result.length });

    return result;
  }

  async *streamGroup(groupName: string, query: string): AsyncGenerator<string, void, unknown> {
    logger.info('LIBRARIAN', 'Streaming group query', { groupName, queryLength: query.length });

    const timingId = logger.timingStart('streamGroup');

    // Validate group exists
    if (!this.config.technologies[groupName]) {
      logger.error('LIBRARIAN', 'Group not found in configuration', undefined, { groupName });
      throw new Error(`Group ${groupName} not found in configuration`);
    }

    // Get the group directory path
    const groupPath = this.getSecureGroupPath(groupName);

    // Set up interruption handling
    let isInterrupted = false;
    const cleanup = () => {
      isInterrupted = true;
    };

    // Listen for interruption signals (Ctrl+C)
    logger.debug('LIBRARIAN', 'Setting up interruption handlers for group');
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    try {
      // Sync all technologies in the group first
      const technologies = this.config.technologies[groupName];
      if (technologies) {
        const techNames = Object.keys(technologies);
        logger.info('LIBRARIAN', 'Syncing all technologies in group for streaming', { groupName, techCount: techNames.length });
        for (const techName of techNames) {
          await this.syncRepository(techName);
        }
      }

      // Check for interruption after sync
      if (isInterrupted) {
        logger.warn('LIBRARIAN', 'Group sync interrupted by user', { groupName });
        yield '[Repository sync interrupted by user]';
        return;
      }

      // Construct context object for group-level query
      const context: AgentContext = {
        workingDir: groupPath,
        group: groupName,
        technology: '', // No specific technology for group-level queries
      };

      logger.debug('LIBRARIAN', 'Initializing agent for group streaming with context', {
        workingDir: context.workingDir.replace(os.homedir(), '~'),
        group: context.group
      });

      // Initialize the agent with the group directory as working directory
      const agent = new ReactAgent({
        aiProvider: this.config.aiProvider,
        workingDir: groupPath
      });
      await agent.initialize();

      // Check for interruption after initialization
      if (isInterrupted) {
        logger.warn('LIBRARIAN', 'Agent initialization interrupted by user for group', { groupName });
        yield '[Agent initialization interrupted by user]';
        return;
      }

      // Execute streaming query using agent with context
      logger.debug('LIBRARIAN', 'Starting stream from agent for group');
      yield* agent.streamRepository(groupPath, query, context);
    } catch (error) {
      // Handle group-level errors
      let errorMessage = 'Unknown error';

      if (error instanceof Error) {
        if (error.message.includes('not found in configuration')) {
          errorMessage = error.message;
        } else if (error.message.includes('git') || error.message.includes('clone')) {
          errorMessage = `Repository operation failed: ${error.message}`;
        } else if (error.message.includes('timeout')) {
          errorMessage = 'Repository operation timed out';
        } else {
          errorMessage = `Group error: ${error.message}`;
        }
      }

      logger.error('LIBRARIAN', 'Group stream error', error instanceof Error ? error : new Error(errorMessage), { groupName });
      yield `\n[Error: ${errorMessage}]`;
      throw error;
    } finally {
      // Clean up event listeners
      process.removeListener('SIGINT', cleanup);
      process.removeListener('SIGTERM', cleanup);
      logger.timingEnd(timingId, 'LIBRARIAN', `Group stream completed: ${groupName}`);
    }
  }
}