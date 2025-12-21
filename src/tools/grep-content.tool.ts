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
  
  try {
    const buffer = await fs.readFile(filePath);
    for (let i = 0; i < Math.min(512, buffer.length); i++) {
      if (buffer[i] === 0) return false;
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
function searchFileContent(content: string, regex: RegExp) {
  const lines = content.split('\n');
  const matches = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    
    const match = regex.exec(line);

    if (match) {
      matches.push({
        line: i + 1,
        column: match.index + 1,
        text: line
      });
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

export class GrepContentTool extends Tool {
  name = "grep_content";
  description = "Search for content patterns in files. Use this to find specific text or code patterns across multiple files.";
  private workingDir: string;

  constructor(workingDir: string = process.cwd()) {
    super();
    this.workingDir = workingDir;
  }

  async _call(input: string): Promise<string> {
    try {
      const parsedInput: Partial<GrepContentInput> = JSON.parse(input);
      const searchPath = parsedInput.searchPath || '.';
      const query = parsedInput.query;
      const patterns = parsedInput.patterns || ['*'];
      const caseSensitive = parsedInput.caseSensitive ?? false;
      const isRegex = parsedInput.regex ?? false;
      const recursive = parsedInput.recursive ?? true;
      const maxResults = parsedInput.maxResults ?? 100;

      if (!query) {
        throw new Error('The "query" parameter is required');
      }

      if (searchPath.includes('..')) {
        throw new Error(`Search path "${searchPath}" contains invalid path characters`);
      }

      const resolvedPath = path.resolve(this.workingDir, searchPath);
      const resolvedWorkingDir = path.resolve(this.workingDir);

      if (!resolvedPath.startsWith(resolvedWorkingDir)) {
        throw new Error(`Search path "${searchPath}" attempts to escape the working directory sandbox`);
      }

      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        throw new Error(`Search path "${searchPath}" is not a directory`);
      }

      let searchRegex: RegExp;
      const flags = caseSensitive ? 'gm' : 'gim';
      
      if (isRegex) {
        try {
          searchRegex = new RegExp(query, flags);
        } catch (e) {
          return `Invalid regex pattern: ${(e as Error).message}`;
        }
      } else {
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        searchRegex = new RegExp(escapedQuery, flags);
      }

      let filesToSearch: string[] = [];
      for (const pattern of patterns) {
        const foundFiles = await findFiles(resolvedPath, pattern, recursive);
        filesToSearch = [...filesToSearch, ...foundFiles];
      }

      const results = [];
      let totalMatches = 0;

      for (const file of filesToSearch) {
        if (totalMatches >= maxResults) break;
        if (await isTextFile(file)) {
          try {
            const content = await readFileContent(file);
            const fileMatches = searchFileContent(content, searchRegex);
            if (fileMatches.length > 0) {
              const limitedMatches = fileMatches.slice(0, maxResults - totalMatches);
              results.push({ path: file, matches: limitedMatches });
              totalMatches += limitedMatches.length;
            }
          } catch {
            continue;
          }
        }
      }

      if (results.length === 0) {
        return `No matches found for query "${query}" in the searched files`;
      }

      let output = `Found ${totalMatches} matches for query "${query}" in ${results.length} files:\n\n`;
      for (const result of results) {
        output += `File: ${result.path}\n`;
        for (const match of result.matches) {
          output += `  Line ${match.line}, Col ${match.column}: ${match.text}\n`;
        }
        output += '\n';
      }

      return output;
    } catch (error) {
      return `Error searching content: ${(error as Error).message}`;
    }
  }
}
