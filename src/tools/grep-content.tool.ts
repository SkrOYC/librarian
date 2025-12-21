import { Tool } from "@langchain/core/tools";
import fs from 'fs/promises';
import path from 'path';

// Check if file is text-based
async function isTextFile(filePath: string): Promise<boolean> {
  const textExtensions = new Set([
    '.txt', '.js', '.ts', '.jsx', '.tsx', '.json', '.yaml', '.yml', '.md', 
    '.html', '.htm', '.css', '.scss', '.sass', '.less', '.py', '.rb', '.java',
    '.cpp', '.c', '.h', '.hpp', '.go', '.rs', '.php', '.sql', '.xml', '.csv',
    '.toml', '.lock', '.sh', '.bash', '.zsh', '.env', '.dockerfile', 'dockerfile',
    '.gitignore', '.npmrc', '.prettierrc', '.eslintrc', '.editorconfig', '.jsonc'
  ]);
  
  const ext = path.extname(filePath).toLowerCase();
  if (textExtensions.has(ext)) {
    return true;
  }
  
  // For files without extensions or unknown extensions, try to detect if it's text
  try {
    const buffer = await fs.readFile(filePath);
    // Check the first few bytes for null bytes which indicate binary content
    for (let i = 0; i < Math.min(512, buffer.length); i++) {
      if (buffer[i] === 0) return false; // Found null byte, likely binary
    }
    return true;
  } catch {
    return false;
  }
}

// Safe file read with encoding detection
async function readFileContent(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to read file: ${errorMessage}`);
  }
}

// Search for content in a single file
function searchFileContent(content: string, regex: RegExp, contextBefore: number = 3, contextAfter: number = 3): Array<{
  line: number;
  column: number;
  text: string;
  context?: {
    before: string[];
    after: string[];
  };
}> {
  const lines = content.split('\n');
  const matches: Array<{
    line: number;
    column: number;
    text: string;
    context?: {
      before: string[];
      after: string[];
    };
  }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = regex.exec(line);

    if (match) {
      const context = {
        before: lines.slice(Math.max(0, i - contextBefore), i),
        after: lines.slice(i + 1, Math.min(lines.length, i + 1 + contextAfter))
      };

      matches.push({
        line: i + 1, // 1-based line numbers
        column: match.index + 1, // 1-based column
        text: line,
        context
      });

      // Reset regex lastIndex for global matches
      regex.lastIndex = 0;
    }
  }

  return matches;
}

// Find files matching a pattern in a directory
async function findFiles(dirPath: string, pattern: string, recursive: boolean = true): Promise<string[]> {
  const foundFiles: string[] = [];
  
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    
    if (entry.isDirectory()) {
      if (recursive) {
        const subDirFiles = await findFiles(fullPath, pattern, recursive);
        foundFiles.push(...subDirFiles);
      }
    } else if (entry.isFile()) {
      // Simple pattern matching - if pattern is '*' or matches the filename
      if (pattern === '*' || entry.name.includes(pattern.replace(/\*/g, ''))) {
        foundFiles.push(fullPath);
      }
    }
  }
  
  return foundFiles;
}

interface GrepContentInput {
  searchPath: string;
  query: string;
  patterns?: string[];
  caseSensitive?: boolean;
  regex?: boolean;
  recursive?: boolean;
  maxResults?: number;
}

// Define the tool using LangChain's Tool class
export class GrepContentTool extends Tool {
  name = "grep_content";
  description = "Search for content patterns in files. Use this to find specific text or code patterns across multiple files.";

  constructor() {
    super();
  }

  async _call(input: string): Promise<string> {
    try {
      // Parse the input JSON string
      const parsedInput: Partial<GrepContentInput> = JSON.parse(input);

      // Extract parameters with defaults and type assertions
      const searchPath: string | undefined = parsedInput.searchPath;
      const query: string | undefined = parsedInput.query;
      const patterns: string[] | undefined = parsedInput.patterns;
      const caseSensitive: boolean | undefined = parsedInput.caseSensitive;
      const regex: boolean | undefined = parsedInput.regex;
      const recursive: boolean | undefined = parsedInput.recursive;
      const maxResults: number | undefined = parsedInput.maxResults;

      // Ensure required fields are present
      if (!searchPath || !query) {
        throw new Error('Both searchPath and query are required parameters');
      }

      // Validate the path to prevent directory traversal
      if (searchPath!.includes('../') || searchPath!.includes('..\\') || searchPath!.startsWith('..')) {
        throw new Error(`Search path "${searchPath}" contains invalid path characters`);
      }

      const resolvedPath = path.resolve(searchPath!);
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

      // Create the search regex
      let searchRegex: RegExp;
      const effectiveCaseSensitive = caseSensitive ?? false;
      const effectiveRegex = regex ?? false;
      const effectivePatterns = patterns ?? ['*'];
      const effectiveRecursive = recursive ?? true;
      const effectiveMaxResults = maxResults ?? 100;

      if (effectiveRegex) {
        const flags = effectiveCaseSensitive ? 'gm' : 'gim';
        try {
          searchRegex = new RegExp(query!, flags);
        } catch (e) {
          return `Invalid regex pattern: ${(e as Error).message}`;
        }
      } else {
        // Escape special regex characters for literal search
        const escapedQuery = query!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const flags = effectiveCaseSensitive ? 'gm' : 'gim';
        searchRegex = new RegExp(escapedQuery, flags);
      }

      // Find files to search
      let filesToSearch: string[] = [];
      for (const pattern of effectivePatterns) {
        const foundFiles = await findFiles(resolvedPath, pattern, effectiveRecursive);
        filesToSearch = [...filesToSearch, ...foundFiles];
      }

      // Filter to only text files
      const textFiles = [];
      for (const file of filesToSearch) {
        if (await isTextFile(file)) {
          textFiles.push(file);
        }
      }

      if (textFiles.length === 0) {
        return `No text files found in: ${searchPath}`;
      }

      // Perform the search
      const results: { path: string; matches: Array<{
        line: number;
        column: number;
        text: string;
        context?: {
          before: string[];
          after: string[];
        };
      }> }[] = [];
      let totalMatches = 0;

      for (const file of textFiles) {
        if (totalMatches >= effectiveMaxResults) {
          break;
        }

        try {
          const content = await readFileContent(file);
          const fileMatches = searchFileContent(content, searchRegex, 3, 3);

          if (fileMatches.length > 0) {
            // Limit matches per file to avoid overwhelming results
            const limitedMatches = fileMatches.slice(0, effectiveMaxResults - totalMatches);
            results.push({
              path: file,
              matches: limitedMatches
            });
            totalMatches += limitedMatches.length;
          }
        } catch (error) {
          // Skip files that can't be read
          continue;
        }
      }

      if (results.length === 0) {
        return `No matches found for query "${query}" in ${textFiles.length} text files`;
      }

      // Format results
      let output = `Found ${totalMatches} matches for query "${query}" in ${results.length} files:\n\n`;
      
      for (const result of results) {
        output += `File: ${result.path}\n`;
        for (const match of result.matches) {
          output += `  Line ${match.line}, Col ${match.column}: ${match.text}\n`;
          if (match.context && (match.context.before.length > 0 || match.context.after.length > 0)) {
            output += `    Context:\n`;
            for (const beforeLine of match.context.before) {
              output += `      ${beforeLine}\n`;
            }
            output += `    > ${match.text}\n`;
            for (const afterLine of match.context.after) {
              output += `      ${afterLine}\n`;
            }
          }
        }
        output += '\n';
      }

      return output;
    } catch (error) {
      return `Error searching content: ${(error as Error).message}`;
    }
  }
}