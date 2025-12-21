import { Tool } from "@langchain/core/tools";
import fs from 'fs/promises';
import path from 'path';

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

// Define the tool using LangChain's Tool class
export class FileListTool extends Tool {
  name = "file_list";
  description = "List the contents of a directory with metadata. Use this to understand the structure of a repository or directory.";

  constructor() {
    super();
  }

  async _call(input: string): Promise<string> {
    try {
      // Parse the input JSON string
      const parsedInput = JSON.parse(input);
      const { directoryPath, includeHidden = false } = parsedInput;

      // Validate the path to prevent directory traversal
      if (directoryPath.includes('../') || directoryPath.includes('..\\') || directoryPath.startsWith('..')) {
        throw new Error(`Directory path "${directoryPath}" contains invalid path characters`);
      }

      const resolvedPath = path.resolve(directoryPath);
      const workingDir = process.cwd(); // In a real implementation, this would be from config
      const resolvedWorkingDir = path.resolve(workingDir);

      if (!resolvedPath.startsWith(resolvedWorkingDir)) {
        throw new Error(`Directory path "${directoryPath}" attempts to escape the working directory sandbox`);
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

      return result;
    } catch (error) {
      return `Error listing directory: ${(error as Error).message}`;
    }
  }
}