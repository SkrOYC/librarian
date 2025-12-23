import { tool } from "langchain";
import * as z from "zod";
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

// Define types for file system operations
interface FileSystemEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number | undefined;
  modified?: Date | undefined;
  permissions?: string | undefined;
  lineCount?: number | undefined;
}

interface DirectoryListing {
  entries: FileSystemEntry[];
  totalCount: number;
  filteredCount?: number;
}

// Simplified function to check if a file should be ignored (basic .gitignore handling)
async function shouldIgnoreFile(filePath: string): Promise<boolean> {
  const basename = path.basename(filePath);

  // Basic checks for common files/directories to ignore
  if (basename.startsWith('.') && basename !== '.env') {
    // Check for common gitignored items
    const ignoredItems = ['node_modules', '.git', '.DS_Store', '.idea', '.vscode', '.pytest_cache'];
    if (ignoredItems.includes(basename)) {
      return true;
    }
  }

  // Check for common build/output directories
  const commonBuildDirs = ['dist', 'build', 'out', 'target', 'coverage'];
  if (commonBuildDirs.includes(basename) && (await fs.stat(filePath).then(s => s.isDirectory()).catch(() => false))) {
    return true;
  }

  return false;
}

/**
 * List directory contents with metadata
 */
async function listDirectory(
  dirPath: string,
  includeHidden = false
): Promise<DirectoryListing> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const fileEntries: FileSystemEntry[] = [];

  for (const entry of entries) {
    if (!includeHidden && entry.name.startsWith('.')) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    
    try {
      // Check if file should be ignored
      if (!includeHidden && await shouldIgnoreFile(fullPath)) {
        continue;
      }

      const stats = await fs.stat(fullPath);
      const name = path.basename(fullPath);

      logger.debug('TOOL', 'Processing file entry', { name, isDirectory: stats.isDirectory() });

      const metadata: FileSystemEntry = {
        name,
        path: fullPath,
        isDirectory: stats.isDirectory(),
        size: stats.isFile() ? stats.size : undefined,
        modified: stats.mtime,
        permissions: stats.mode?.toString(8),
      };

      fileEntries.push(metadata);
    } catch {
      // Skip files that can't be accessed or have metadata errors
    }
  }

  // Sort: directories first, then by name
  fileEntries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    entries: fileEntries,
    totalCount: fileEntries.length,
    filteredCount: fileEntries.length,
  };
}

// Create the modernized tool using the tool() function
export const fileListTool = tool(
  async ({ directoryPath = '.', includeHidden = false }, config) => {
    const timingId = logger.timingStart('fileList');

    logger.info('TOOL', 'file_list called', { directoryPath, includeHidden });

    try {
      // Get working directory from config context or default to process.cwd()
      const workingDir = config?.context?.workingDir || process.cwd();
      logger.debug('TOOL', 'Working directory', { workingDir: workingDir.replace(process.env.HOME || '', '~') });

      // Validate path to prevent directory traversal
      const resolvedPath = path.resolve(workingDir, directoryPath);
      const resolvedWorkingDir = path.resolve(workingDir);
      const relativePath = path.relative(resolvedWorkingDir, resolvedPath);

      logger.debug('TOOL', 'Path validation', {
        resolvedPath: resolvedPath.replace(process.env.HOME || '', '~'),
        resolvedWorkingDir: resolvedWorkingDir.replace(process.env.HOME || '', '~'),
        relativePath,
        validated: !relativePath.startsWith('..')
      });

      // Check if resolved path escapes working directory
      if (relativePath.startsWith('..')) {
        logger.error('PATH', 'Directory path escapes working directory sandbox', undefined, { directoryPath, relativePath });
        throw new Error(`Directory path "${directoryPath}" attempts to escape working directory sandbox`);
      }

      // List the directory
      const listing = await listDirectory(resolvedPath, includeHidden);

      // Format the result for the AI
      let result = `Contents of directory: ${resolvedPath}\n\n`;
      result += `Total entries: ${listing.totalCount}\n\n`;

      for (const entry of listing.entries) {
        const type = entry.isDirectory ? 'DIR' : 'FILE';
        const size = entry.size ? ` (${entry.size} bytes)` : '';
        const lineCount = entry.lineCount ? ` (${entry.lineCount} lines)` : '';
        result += `${type}  ${entry.name}${size}${lineCount}\n`;
      }

      logger.timingEnd(timingId, 'TOOL', 'file_list completed');
      logger.debug('TOOL', 'Directory listing successful', { directoryPath, entryCount: listing.totalCount, dirCount: listing.entries.filter(e => e.isDirectory).length, fileCount: listing.entries.filter(e => !e.isDirectory).length });

      return result;
    } catch (error) {
      logger.error('TOOL', 'file_list failed', error instanceof Error ? error : new Error(String(error)), { directoryPath });
      return `Error listing directory: ${(error as Error).message}`;
    }
  },
  {
    name: "file_list",
    description: "List the contents of a directory with metadata. Use this to understand the structure of a repository or directory.",
    schema: z.object({
      directoryPath: z.string().optional().default('.').describe("The directory path to list, relative to the working directory"),
      includeHidden: z.boolean().optional().default(false).describe("Whether to include hidden files and directories"),
    }),
  }
);

