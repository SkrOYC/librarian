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
      console.log(`Repository ${repoName} already exists at ${repoPath}, skipping clone`);
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

  async queryRepository(repoName: string, query: string): Promise<string> {
    const repoUrl = this.config.repositories[repoName];
    
    if (!repoUrl) {
      throw new Error(`Repository ${repoName} not found in configuration`);
    }

    // Clone or update the repository first
    const repoPath = await this.cloneRepository(repoName, repoUrl);
    
    console.log(`Querying repository ${repoName} with: ${query}`);
    return `Query result for ${repoName} at ${repoPath}`;
  }
}