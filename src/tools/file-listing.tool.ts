import fs from "node:fs/promises";
import path from "node:path";
import { tool } from "langchain";
import { z } from "zod";
import { formatToolError, getToolSuggestion } from "../utils/error-utils.js";
import { getFileLineCount } from "../utils/file-utils.js";
import {
  type FileSystemEntry,
  formatDirectoryTree,
} from "../utils/format-utils.js";
import { GitIgnoreService } from "../utils/gitignore-service.js";
import { logger } from "../utils/logger.js";

/**
 * Improved listDirectory that sorts siblings before recursing to maintain DFS tree order.
 * Processes line counts in parallel for performance.
 */
async function listDirectoryDFS(
  dirPath: string,
  includeHidden = false,
  recursive = false,
  maxDepth = 1,
  currentDepth = 0,
  gitignore?: GitIgnoreService
): Promise<FileSystemEntry[]> {
  // At maxDepth=1:
  // - currentDepth=0: process entries, DON'T recurse (0 + 1 < 1 is FALSE)
  // - currentDepth=1: return early (stop recursion)
  if (currentDepth >= maxDepth) {
    return [];
  }

  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  // Filter entries
  const filteredEntries: import("node:fs").Dirent[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    // 1. Check hidden
    if (!includeHidden && entry.name.startsWith(".")) {
      continue;
    }

    // 2. Check gitignore
    if (gitignore?.shouldIgnore(fullPath, entry.isDirectory())) {
      continue;
    }

    filteredEntries.push(entry);
  }

  // Sort: directories first, then by name
  filteredEntries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  const fileEntries: FileSystemEntry[] = [];

  for (const entry of filteredEntries) {
    const fullPath = path.join(dirPath, entry.name);
    try {
      const stats = await fs.stat(fullPath);
      const metadata: FileSystemEntry = {
        name: entry.name,
        path: fullPath,
        isDirectory: stats.isDirectory(),
        ...(stats.isFile() && { size: stats.size }),
        depth: currentDepth,
      };

      fileEntries.push(metadata);
    } catch {
      // Skip files that can't be accessed
    }
  }

  // Calculate line counts in parallel for all files at this level, with throttling to avoid EMFILE
  const CONCURRENCY_LIMIT = 50;
  const files = fileEntries.filter((e) => !e.isDirectory);

  for (let i = 0; i < files.length; i += CONCURRENCY_LIMIT) {
    const batch = files.slice(i, i + CONCURRENCY_LIMIT);

    // Process batch with EMFILE retry logic
    let retries = 3;
    while (retries > 0) {
      try {
        await Promise.all(
          batch.map(async (e) => {
            e.lineCount = await getFileLineCount(e.path);
          })
        );
        break; // Success, exit retry loop
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EMFILE" && retries > 0) {
          retries--;
          await new Promise((resolve) => setTimeout(resolve, 100));
        } else {
          throw error;
        }
      }
    }
  }

  // Recursively process subdirectories
  const resultEntries: FileSystemEntry[] = [];
  for (const entry of fileEntries) {
    // Determine if we should recurse into this entry
    // Only recurse if: it's a directory, recursive is true, and next depth is within maxDepth
    const willRecurse =
      entry.isDirectory && recursive && currentDepth + 1 < maxDepth;

    // Add the entry if:
    // 1. It's a file (files are always included)
    // 2. It's a directory AND (recursive is false OR we will recurse into it)
    // 3. It's a directory AND we're at currentDepth=0 (show top-level directories but not their contents)
    if (
      !(entry.isDirectory && recursive) ||
      willRecurse ||
      (entry.isDirectory && currentDepth === 0)
    ) {
      resultEntries.push(entry);
    }

    // Recurse if allowed
    if (willRecurse) {
      const subEntries = await listDirectoryDFS(
        entry.path,
        includeHidden,
        recursive,
        maxDepth,
        currentDepth + 1,
        gitignore
      );
      resultEntries.push(...subEntries);
    }
  }

  return resultEntries;
}

// Create the modernized tool using the tool() function
export const listTool = tool(
  async (
    {
      directoryPath = ".",
      includeHidden = false,
      recursive = false,
      maxDepth = 1,
    },
    config
  ) => {
    const timingId = logger.timingStart("list");

    logger.info("TOOL", "list called", {
      directoryPath,
      includeHidden,
      recursive,
      maxDepth,
    });

    try {
      // Get working directory from config context - required for security
      const workingDir = config?.context?.workingDir;
      if (!workingDir) {
        throw new Error(
          "Context with workingDir is required for file operations"
        );
      }

      // Validate path to prevent directory traversal
      const resolvedPath = path.resolve(workingDir, directoryPath);
      const resolvedWorkingDir = path.resolve(workingDir);
      const relativePath = path.relative(resolvedWorkingDir, resolvedPath);

      // Check if resolved path escapes working directory
      if (relativePath.startsWith("..")) {
        throw new Error(
          `Directory path "${directoryPath}" attempts to escape working directory sandbox`
        );
      }

      // Initialize GitIgnoreService
      const gitignore = new GitIgnoreService(workingDir);
      await gitignore.initialize();

      // List the directory using DFS to maintain tree order
      const entries = await listDirectoryDFS(
        resolvedPath,
        includeHidden,
        recursive,
        maxDepth,
        0,
        gitignore
      );

      // Format the result for the AI
      const treeOutput = formatDirectoryTree(entries);

      // Use relative path for display
      const displayPath = relativePath === "" ? "." : relativePath;
      let result = `Contents of directory: ${displayPath}\n\n`;
      result += `Total entries: ${entries.length}\n\n`;
      result += treeOutput;

      logger.timingEnd(timingId, "TOOL", "list completed");
      return result;
    } catch (error) {
      logger.error(
        "TOOL",
        "list failed",
        error instanceof Error ? error : new Error(String(error)),
        { directoryPath }
      );

      return formatToolError({
        operation: "list",
        path: directoryPath,
        cause: error,
        suggestion: getToolSuggestion("list", directoryPath),
      });
    }
  },
  {
    name: "list",
    description:
      "List the contents of a directory with metadata. Use this to understand the structure of a repository or directory.",
    schema: z.object({
      directoryPath: z.string().describe("The directory path to list"),
      includeHidden: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Whether to include hidden files and directories. Defaults to `false`"
        ),
      recursive: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Whether to list subdirectories recursively. Defaults to `false`"
        ),
      maxDepth: z
        .number()
        .optional()
        .default(1)
        .describe("Maximum depth for recursive listing. Defaults to 1"),
    }),
  }
);
