import fs from 'fs/promises';
import path from 'path';

/**
 * Service to handle .gitignore functionality
 */
export class GitIgnoreService {
  private readonly projectRoot: string;
  private gitignoreContents: Map<string, string[]> = new Map();

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Check if a file should be ignored based on .gitignore rules
   */
  async shouldIgnore(filePath: string): Promise<boolean> {
    const gitignorePath = this.findClosestGitignore(filePath);
    
    if (!gitignorePath) {
      return false;
    }
    
    const patterns = await this.getGitignorePatterns(gitignorePath);
    const relativePath = path.relative(path.dirname(gitignorePath), filePath);
    
    return this.matchesGitignorePattern(relativePath, patterns);
  }

  /**
   * Find the closest .gitignore file for a given path
   */
  private findClosestGitignore(filePath: string): string | null {
    let currentDir = path.dirname(filePath);
    const projectRoot = path.resolve(this.projectRoot);
    
    while (currentDir !== path.dirname(currentDir) && currentDir.startsWith(projectRoot)) {
      const gitignorePath = path.join(currentDir, '.gitignore');
      if (require('fs').existsSync(gitignorePath)) {
        return gitignorePath;
      }
      currentDir = path.dirname(currentDir);
    }
    
    return null;
  }

  /**
   * Get patterns from a .gitignore file
   */
  private async getGitignorePatterns(gitignorePath: string): Promise<string[]> {
    if (this.gitignoreContents.has(gitignorePath)) {
      return this.gitignoreContents.get(gitignorePath)!;
    }
    
    try {
      const content = await fs.readFile(gitignorePath, 'utf8');
      const lines = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && !line.startsWith('!'));
      
      this.gitignoreContents.set(gitignorePath, lines);
      return lines;
    } catch {
      return [];
    }
  }

  /**
   * Check if a path matches gitignore patterns
   */
  private matchesGitignorePattern(relativePath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (this.simpleGlobMatch(relativePath, pattern)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Simple glob pattern matching for .gitignore rules
   */
  private simpleGlobMatch(path: string, pattern: string): boolean {
    // Simple implementation - in a real project we'd want a more robust solution
    const escapedPattern = pattern
      .replace(/\./g, '\\.') // Escape dots
      .replace(/\*/g, '.*')  // Replace * with .*
      .replace(/\?/g, '.'); // Replace ? with .
    
    const regex = new RegExp(`^${escapedPattern}$|^${escapedPattern}/|/${escapedPattern}$|/${escapedPattern}/`);
    return regex.test(path);
  }
}