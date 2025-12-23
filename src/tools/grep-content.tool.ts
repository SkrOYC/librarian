import { tool } from "langchain";
import * as z from "zod";
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

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

// Create the modernized tool using the tool() function
export const grepContentTool = tool(
  async ({
    searchPath = '.',
    query,
    patterns = ['*'],
    caseSensitive = false,
    regex = false,
    recursive = true,
    maxResults = 100
  }, config) => {
    const timingId = logger.timingStart('grepContent');

    logger.info('TOOL', 'grep_content called', { searchPath, queryLength: query.length, patterns, caseSensitive, regex, recursive, maxResults });

    try {
      // Get working directory from config context or default to process.cwd()
      const workingDir = config?.context?.workingDir || process.cwd();
      logger.debug('TOOL', 'Working directory', { workingDir: workingDir.replace(process.env.HOME || '', '~') });

      if (!query) {
        logger.error('TOOL', 'Query parameter missing', undefined, {});
        throw new Error('The "query" parameter is required');
      }

      // Validate the path to prevent directory traversal
      const resolvedPath = path.resolve(workingDir, searchPath);
      const resolvedWorkingDir = path.resolve(workingDir);
      const relativePath = path.relative(resolvedWorkingDir, resolvedPath);

      logger.debug('TOOL', 'Path validation', {
        resolvedPath: resolvedPath.replace(process.env.HOME || '', '~'),
        resolvedWorkingDir: resolvedWorkingDir.replace(process.env.HOME || '', '~'),
        relativePath,
        validated: !relativePath.startsWith('..')
      });

      if (relativePath.startsWith('..')) {
        logger.error('PATH', 'Search path escapes working directory sandbox', undefined, { searchPath, relativePath });
        throw new Error(`Search path "${searchPath}" attempts to escape the working directory sandbox`);
      }

      const stats = await fs.stat(resolvedPath);
      if (!stats.isDirectory()) {
        logger.error('TOOL', 'Search path is not a directory', undefined, { searchPath });
        throw new Error(`Search path "${searchPath}" is not a directory`);
      }

      let searchRegex: RegExp;
      const flags = caseSensitive ? 'gm' : 'gim';

      if (regex) {
        try {
          searchRegex = new RegExp(query, flags);
          logger.debug('TOOL', 'Regex pattern compiled', { query, flags });
        } catch (e) {
          logger.error('TOOL', 'Invalid regex pattern', e instanceof Error ? e : new Error(String(e)), { query });
          return `Invalid regex pattern: ${(e as Error).message}`;
        }
      } else {
        const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        searchRegex = new RegExp(escapedQuery, flags);
        logger.debug('TOOL', 'Escaped query compiled to regex', { originalQuery: query, flags });
      }

      let filesToSearch: string[] = [];
      for (const pattern of patterns) {
        const foundFiles = await findFiles(resolvedPath, pattern, recursive);
        filesToSearch = [...filesToSearch, ...foundFiles];
      }

      logger.debug('TOOL', 'Files to search', { count: filesToSearch.length, patterns });

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

      logger.timingEnd(timingId, 'TOOL', 'grep_content completed');
      logger.debug('TOOL', 'Search completed', { filesSearched: filesToSearch.length, filesWithMatches: results.length, totalMatches });

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
      logger.error('TOOL', 'grep_content failed', error instanceof Error ? error : new Error(String(error)), { searchPath, query });
      return `Error searching content: ${(error as Error).message}`;
    }
  },
  {
    name: "grep_content",
    description: "Search for content patterns in files. Use this to find specific text or code patterns across multiple files.",
    schema: z.object({
      searchPath: z.string().optional().default('.').describe("The directory path to search in, relative to the working directory"),
      query: z.string().describe("The search query - the text or pattern to look for in files"),
      patterns: z.array(z.string()).optional().default(['*']).describe("File patterns to search in (e.g., ['*.js', '*.ts'])"),
      caseSensitive: z.boolean().optional().default(false).describe("Whether the search should be case-sensitive"),
      regex: z.boolean().optional().default(false).describe("Whether the query should be treated as a regular expression"),
      recursive: z.boolean().optional().default(true).describe("Whether to search recursively in subdirectories"),
      maxResults: z.number().optional().default(100).describe("Maximum number of matches to return"),
    }),
  }
);