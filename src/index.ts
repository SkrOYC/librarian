/**
 * Librarian CLI - Technology Research Agent
 * Main entry point for the application
 */

import { clone, fetch, checkout } from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import fs from 'fs';
import path from 'path';

export interface LibrarianConfig {
  repositories: {
    [key: string]: string; // name -> URL mapping
  };
  aiProvider: {
    type: 'openai' | 'anthropic' | 'google';
    apiKey: string;
    model?: string;
  };
  workingDir: string;
}

export class Librarian {
  private config: LibrarianConfig;

  constructor(config: LibrarianConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    console.log('Librarian initialized');
    // Create working directory if it doesn't exist
    if (!fs.existsSync(this.config.workingDir)) {
      fs.mkdirSync(this.config.workingDir, { recursive: true });
    }
  }

  async cloneRepository(repoName: string, repoUrl: string): Promise<string> {
    const repoPath = path.join(this.config.workingDir, repoName);
    
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

    console.log(`Cloning repository ${repoName} from ${repoUrl} to ${repoPath}`);
    
    await clone({
      fs,
      http,
      dir: repoPath,
      url: repoUrl,
      singleBranch: true,
      depth: 1, // Shallow clone for faster operation
    });
    
    return repoPath;
  }

  async updateRepository(repoName: string): Promise<void> {
    const repoPath = path.join(this.config.workingDir, repoName);
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
    
    // Checkout the latest version
    await checkout({
      fs,
      dir: repoPath,
      ref: 'origin/main', // or 'origin/master' depending on the repository
    });
  }

  async syncRepository(repoName: string): Promise<string> {
    const repoUrl = this.config.repositories[repoName];
    
    if (!repoUrl) {
      throw new Error(`Repository ${repoName} not found in configuration`);
    }

    const repoPath = path.join(this.config.workingDir, repoName);
    
    if (fs.existsSync(repoPath)) {
      // Repository exists, update it
      await this.updateRepository(repoName);
    } else {
      // Repository doesn't exist, clone it
      return await this.cloneRepository(repoName, repoUrl);
    }
    
    return repoPath;
  }

  async queryRepository(repoName: string, query: string): Promise<string> {
    const repoUrl = this.config.repositories[repoName];
    
    if (!repoUrl) {
      throw new Error(`Repository ${repoName} not found in configuration`);
    }

    // Clone or sync the repository first
    const repoPath = await this.syncRepository(repoName);
    
    console.log(`Querying repository ${repoName} with: ${query}`);
    return `Query result for ${repoName} at ${repoPath}`;
  }
}