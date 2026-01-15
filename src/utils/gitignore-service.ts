import { readFile } from "node:fs/promises";
import path from "node:path";
import { Glob } from "bun";

interface GitIgnorePattern {
  pattern: string;
  isNegation: boolean;
  isDirectoryOnly: boolean;
  glob: Glob;
}

/**
 * Service to handle .gitignore patterns and filtering.
 * Uses Bun's native Glob for high performance.
 */
export class GitIgnoreService {
  private readonly rootDir: string;
  private patterns: GitIgnorePattern[] = [];
  private initialized = false;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    try {
      const gitignorePath = path.join(this.rootDir, ".gitignore");
      const content = await readFile(gitignorePath, "utf-8");
      this.patterns = this.parseGitIgnore(content);
    } catch {
      this.patterns = [];
    }
    this.initialized = true;
  }

  shouldIgnore(filePath: string, isDirectory = false): boolean {
    if (!this.initialized) {
      return false;
    }

    const relativePath = path.relative(this.rootDir, filePath);
    if (relativePath === "" || relativePath === ".") {
      return false;
    }

    let ignored = false;
    let hasNegationMatch = false;
    for (const p of this.patterns) {
      if (p.glob.match(relativePath)) {
        // If it's a directory-only pattern like "dist/", it should only match
        // directories or files INSIDE a directory named "dist".
        // Glob patterns like "**/dist{,/**}" will match the file "dist" too.
        if (
          p.isDirectoryOnly &&
          !isDirectory &&
          !relativePath.includes("/") &&
          p.glob.match(relativePath)
        ) {
          // Naive check: if it's a directory-only pattern but the target is a file
          // in the root (no slashes in relativePath), we skip it if it's an exact match.
          // This is not perfect for nested files but good enough for common cases.
          continue;
        }
        if (p.isNegation) {
          ignored = false;
          hasNegationMatch = true;
        } else if (!hasNegationMatch) {
          // Only set ignored to true if we haven't seen a negation pattern yet
          ignored = true;
        }
      }
    }
    return ignored;
  }

  private parseGitIgnore(content: string): GitIgnorePattern[] {
    const lines = content.split(/\r?\n/);
    const patterns: GitIgnorePattern[] = [];

    for (let line of lines) {
      line = line.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      let isNegation = false;
      if (line.startsWith("!")) {
        isNegation = true;
        line = line.slice(1).trim();
      }

      const isDirectoryOnly = line.endsWith("/");
      let cleanPattern = isDirectoryOnly ? line.slice(0, -1) : line;

      if (cleanPattern.startsWith("/")) {
        cleanPattern = cleanPattern.slice(1);
      } else if (!cleanPattern.includes("/")) {
        cleanPattern = `**/${cleanPattern}`;
      }

      // Pattern to match the item and everything beneath it
      const finalPattern = `${cleanPattern}{,/**}`;

      try {
        patterns.push({
          pattern: line,
          isNegation,
          isDirectoryOnly,
          glob: new Glob(finalPattern),
        });
      } catch {
        // Skip invalid
      }
    }
    return patterns;
  }
}
