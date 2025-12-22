import { tool } from "langchain";
import * as z from "zod";
import fs from 'fs/promises';
import path from 'path';

// Find files matching glob patterns in a directory
async function findFiles(
  searchPath: string, 
  patterns: string[], 
  options: {
    exclude?: string[];
    recursive?: boolean;
    maxResults?: number;
    includeHidden?: boolean;
  } = {}
): Promise<string[]> {
  const { 
    exclude = [], 
    recursive = true, 
    maxResults = 1000, 
    includeHidden = false 
  } = options;
  
  const foundFiles: string[] = [];
  const processedPaths = new Set<string>();

  // Process each pattern
  for (const pattern of patterns) {
    // Only add **/ prefix if recursive and pattern doesn't already contain path separators
    const effectivePattern = (recursive && !pattern.includes('**') && !pattern.includes('/')) ? `**/${pattern}` : pattern;
    
    // Simple glob matching implementation
    const matchingFiles = await simpleGlobSearch(searchPath, effectivePattern, {
      recursive,
      includeHidden
    });
    
    for (const file of matchingFiles) {
      if (foundFiles.length >= maxResults) {
        break;
      }
      
      if (processedPaths.has(file)) {
        continue;
      }
      
      processedPaths.add(file);
      
      // Check if file should be excluded
      const relativePath = path.relative(searchPath, file);
      if (exclude.some(excl => simpleMatch(relativePath, excl))) {
        continue;
      }
      
      foundFiles.push(file);
    }
    
    if (foundFiles.length >= maxResults) {
      break;
    }
  }
  
  return foundFiles.slice(0, maxResults);
}

// Simple glob search implementation (basic pattern matching)
async function simpleGlobSearch(
  basePath: string, 
  pattern: string, 
  options: {
    recursive: boolean;
    includeHidden: boolean;
  }
): Promise<string[]> {
  const results: string[] = [];
  
  try {
    const entries = await fs.readdir(basePath, { withFileTypes: true });
    
    for (const entry of entries) {
      // Skip hidden files/directories if not including them
      if (!options.includeHidden && entry.name.startsWith('.')) {
        continue;
      }
      
      const fullPath = path.join(basePath, entry.name);
      
      if (entry.isDirectory()) {
        // Handle directory matching
        if (pattern === '**' || pattern.includes('**') || options.recursive) {
          const basePattern = pattern.split('/')[0] || pattern;
          if (simpleMatch(entry.name, basePattern)) {
            results.push(fullPath);
          }
          
          if (options.recursive) {
            const subDirResults = await simpleGlobSearch(fullPath, pattern, options);
            results.push(...subDirResults);
          }
        }
      } else if (entry.isFile()) {
        // Handle file matching
        const relativePath = path.relative(basePath, fullPath);
        // For files, match against pattern or against base pattern for **/prefix patterns
        const basePattern = pattern.includes('**/') ? pattern.split('**/')[1] || '' : pattern;
        if (simpleMatch(entry.name, basePattern) || simpleMatch(relativePath, basePattern)) {
          results.push(fullPath);
        }
      }
    }
  } catch (error) {
    // If directory can't be read, just return empty results
    return [];
  }
  
  return results;
}

// Simple pattern matching (supports * and ? wildcards)
function simpleMatch(str: string, pattern: string): boolean {
  // Handle exact match first
  if (pattern === str) {
    return true;
  }
  
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.') // Escape dots
    .replace(/\*/g, '.*')  // Replace * with .*
    .replace(/\?/g, '.'); // Replace ? with .
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(str);
}

// Create the modernized tool using the tool() function
export const fileFindTool = tool(
  async ({ 
    searchPath = '.',
    patterns, 
    exclude = [], 
    recursive = true, 
    maxResults = 1000, 
    includeHidden = false 
  }, config) => {
    try {
      // Get working directory from config context or default to process.cwd()
      const workingDir = config?.context?.workingDir || process.cwd();

      // Validate the path to prevent directory traversal
      if (searchPath.includes('..')) {
        throw new Error(`Search path "${searchPath}" contains invalid path characters`);
      }

      const resolvedPath = path.resolve(workingDir, searchPath);
      const resolvedWorkingDir = path.resolve(workingDir);

      if (!resolvedPath.startsWith(resolvedWorkingDir)) {
        throw new Error(`Search path "${searchPath}" attempts to escape the working directory sandbox`);
      }

      // Validate that the search path exists and is a directory
      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        throw new Error(`Search path "${searchPath}" is not a directory`);
      }

      // Find matching files
      const foundFiles = await findFiles(resolvedPath, patterns || ['*'], {
        exclude,
        recursive,
        maxResults,
        includeHidden
      });

      if (foundFiles.length === 0) {
        return `No files found matching patterns: ${patterns?.join(', ') || '*'}`;
      }

      // Format results
      let output = `Found ${foundFiles.length} files matching patterns [${patterns?.join(', ') || '*'}]:\n\n`;
      
      for (const file of foundFiles) {
        const relativePath = path.relative(resolvedPath, file);
        output += `${relativePath}\n`;
      }

      return output;
    } catch (error) {
      return `Error finding files: ${(error as Error).message}`;
    }
  },
  {
    name: "file_find",
    description: "Find files matching glob patterns in a directory. Use this to locate specific files by name or extension.",
    schema: z.object({
      searchPath: z.string().optional().default('.').describe("The directory path to search in, relative to the working directory"),
      patterns: z.array(z.string()).describe("Array of glob patterns to match files (e.g., ['*.js', '*.ts'])"),
      exclude: z.array(z.string()).optional().default([]).describe("Array of patterns to exclude from results"),
      recursive: z.boolean().optional().default(true).describe("Whether to search recursively in subdirectories"),
      maxResults: z.number().optional().default(1000).describe("Maximum number of files to return"),
      includeHidden: z.boolean().optional().default(false).describe("Whether to include hidden files and directories"),
    }),
  }
);