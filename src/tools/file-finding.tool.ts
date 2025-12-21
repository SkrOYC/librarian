import { Tool } from "@langchain/core/tools";
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
    const effectivePattern = recursive && !pattern.includes('**') ? `**/${pattern}` : pattern;
    
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
          if (simpleMatch(entry.name, pattern.split('/')[0] || pattern)) {
            results.push(fullPath);
          }
          
          if (options.recursive) {
            const subDirResults = await simpleGlobSearch(fullPath, pattern, options);
            results.push(...subDirResults);
          }
        }
      } else if (entry.isFile()) {
        // Handle file matching
        if (simpleMatch(entry.name, pattern) || simpleMatch(path.relative(basePath, fullPath), pattern)) {
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
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\./g, '\\.') // Escape dots
    .replace(/\*/g, '.*')  // Replace * with .*
    .replace(/\?/g, '.'); // Replace ? with .
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(str);
}

// Define the tool using LangChain's Tool class
export class FileFindTool extends Tool {
  name = "file_find";
  description = "Find files matching glob patterns in a directory. Use this to locate specific files by name or extension.";

  constructor() {
    super();
  }

  async _call(input: string): Promise<string> {
    try {
      // Parse the input JSON string
      const parsedInput: {
        searchPath: string;
        patterns: string[];
        exclude?: string[];
        recursive?: boolean;
        maxResults?: number;
        includeHidden?: boolean;
      } = JSON.parse(input);

      const { 
        searchPath, 
        patterns, 
        exclude, 
        recursive, 
        maxResults, 
        includeHidden 
      } = parsedInput;

      // Validate the path to prevent directory traversal
      if (searchPath.includes('../') || searchPath.includes('..\\') || searchPath.startsWith('..')) {
        throw new Error(`Search path "${searchPath}" contains invalid path characters`);
      }

      const resolvedPath = path.resolve(searchPath);
      const workingDir = process.cwd(); // In a real implementation, this would be from config
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
        exclude: exclude || [],
        recursive: recursive ?? true,
        maxResults: maxResults ?? 1000,
        includeHidden: includeHidden ?? false
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
  }
}