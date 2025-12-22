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
    const gitignorePaths = this.findAllApplicableGitignores(filePath);

    for (const gitignorePath of gitignorePaths) {
      const patterns = await this.getGitignorePatterns(gitignorePath);
      const relativePath = path.relative(path.dirname(gitignorePath), filePath);

      if (this.matchesGitignorePattern(relativePath, patterns)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Find all applicable .gitignore files for a given path (from closest to root)
   */
  private findAllApplicableGitignores(filePath: string): string[] {
    const gitignorePaths: string[] = [];
    let currentDir = path.dirname(filePath);
    const projectRoot = path.resolve(this.projectRoot);

    while (currentDir !== path.dirname(currentDir) && currentDir.startsWith(projectRoot)) {
      const gitignorePath = path.join(currentDir, '.gitignore');
      if (require('fs').existsSync(gitignorePath)) {
        gitignorePaths.push(gitignorePath);
      }
      currentDir = path.dirname(currentDir);
    }

    return gitignorePaths;
  }

  /**
   * Find the closest .gitignore file for a given path
   */
  private findClosestGitignore(filePath: string): string | null {
    const gitignores = this.findAllApplicableGitignores(filePath);
    return gitignores.length > 0 ? gitignores[0]! : null;
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
   * Improved glob pattern matching for .gitignore rules
   */
  private simpleGlobMatch(path: string, pattern: string): boolean {
    // Handle directory patterns (ending with /)
    if (pattern.endsWith('/')) {
      const dirPattern = pattern.slice(0, -1);
      const escapedDirPattern = dirPattern
        .replace(/\./g, '\\.') // Escape dots
        .replace(/\*/g, '.*')  // Replace * with .*
        .replace(/\?/g, '.'); // Replace ? with .

      // Match if path starts with the directory pattern
      const regex = new RegExp(`^${escapedDirPattern}(/|$)`);
      return regex.test(path);
    }

    // Handle wildcard patterns
    const escapedPattern = pattern
      .replace(/\./g, '\\.') // Escape dots
      .replace(/\*/g, '.*')  // Replace * with .*
      .replace(/\?/g, '.'); // Replace ? with .

    // Match exact file/directory names or files within directories
    const regex = new RegExp(`^${escapedPattern}$|^${escapedPattern}/|/${escapedPattern}$|/${escapedPattern}/`);
    return regex.test(path);
  }
}