import { stat } from "node:fs/promises";
import path from "node:path";
import { Glob } from "bun";
import { tool } from "langchain";
import { z } from "zod";
import { formatToolError, getToolSuggestion } from "../utils/error-utils.js";
import { isTextFile } from "../utils/file-utils.js";
import {
  formatSearchResults,
  type SearchMatch,
} from "../utils/format-utils.js";
import { GitIgnoreService } from "../utils/gitignore-service.js";
import { logger } from "../utils/logger.js";

/**
 * Robust search for context-aware grep.
 * While streaming is good for huge files, contextAfter requires looking ahead or buffering.
 * Since Librarian typically works on source code files (KB to low MBs), loading the file into memory
 * but processing it efficiently is a balanced trade-off for accurate context.
 */
async function searchFileWithContext(
  filePath: string,
  regex: RegExp,
  contextBefore = 0,
  contextAfter = 0
): Promise<SearchMatch[]> {
  const file = Bun.file(filePath);
  const stream = file.stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  const matches: SearchMatch[] = [];
  const beforeBuffer: string[] = [];
  let currentLineNum = 1;
  let partialLine = "";

  // Track matches that are still waiting for their contextAfter lines
  const pendingMatches: Array<{
    match: SearchMatch;
    linesRemaining: number;
  }> = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (partialLine) {
          processLine(partialLine);
        }
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      const lines = (partialLine + chunk).split("\n");
      partialLine = lines.pop() || "";

      for (const line of lines) {
        processLine(line);
      }
    }
  } finally {
    reader.releaseLock();
  }

  function processLine(line: string) {
    // Update pending matches
    for (const pending of pendingMatches) {
      if (pending.linesRemaining > 0) {
        pending.match.context?.after.push(line);
        pending.linesRemaining--;
      }
    }

    // Remove completed matches from pendingMatches to prevent memory leak
    // This keeps the array small for files with many matches
    for (let i = pendingMatches.length - 1; i >= 0; i--) {
      const pending = pendingMatches[i];
      if (pending && pending.linesRemaining === 0) {
        pendingMatches.splice(i, 1);
      }
    }

    // Check for new match
    regex.lastIndex = 0;
    const matchExec = regex.exec(line);

    // We only take the first match on a line for context-aware grep to avoid duplication
    // or complex context merging if there are multiple matches on the same line.
    if (matchExec !== null) {
      const searchMatch: SearchMatch = {
        line: currentLineNum,
        column: matchExec.index + 1,
        text: line,
      };

      if (contextBefore > 0 || contextAfter > 0) {
        const context: { before: string[]; after: string[] } = {
          before: contextBefore > 0 ? [...beforeBuffer] : [],
          after: [],
        };
        searchMatch.context = context;

        if (contextAfter > 0) {
          pendingMatches.push({
            match: searchMatch,
            linesRemaining: contextAfter,
          });
        }
      }

      matches.push(searchMatch);
    }

    // Update before buffer
    if (contextBefore > 0) {
      beforeBuffer.push(line);
      if (beforeBuffer.length > contextBefore) {
        beforeBuffer.shift();
      }
    }

    currentLineNum++;
  }

  return matches;
}

// Find files matching a pattern in a directory using Bun.Glob
async function findFilesToSearch(
  dirPath: string,
  patterns: string[],
  recursive: boolean,
  includeHidden: boolean
): Promise<string[]> {
  const foundFiles: string[] = [];
  for (const pattern of patterns) {
    const effectivePattern =
      recursive && !pattern.includes("/") && !pattern.includes("**")
        ? `**/${pattern}`
        : pattern;

    const glob = new Glob(effectivePattern);
    for await (const file of glob.scan({
      cwd: dirPath,
      onlyFiles: true,
      dot: includeHidden,
    })) {
      const fullPath = path.resolve(dirPath, file);
      if (!foundFiles.includes(fullPath)) {
        foundFiles.push(fullPath);
      }
    }
  }
  return foundFiles;
}

function compileSearchRegex(
  query: string,
  regex: boolean,
  caseSensitive: boolean
): RegExp {
  const flags = caseSensitive ? "gm" : "gim";

  if (regex) {
    try {
      return new RegExp(query, flags);
    } catch (e) {
      throw new Error(`Invalid regex pattern: ${(e as Error).message}`);
    }
  }

  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escapedQuery, flags);
}

// Create the modernized tool using the tool() function
export const grepTool = tool(
  async (
    {
      searchPath = ".",
      query,
      patterns = ["*"],
      caseSensitive = false,
      regex = false,
      recursive = true,
      maxResults = 100,
      contextBefore = 0,
      contextAfter = 0,
      exclude = [],
      includeHidden = false,
    },
    config
  ) => {
    const timingId = logger.timingStart("grep");

    logger.info("TOOL", "grep called", {
      searchPath,
      query,
      patterns,
      caseSensitive,
      regex,
      recursive,
      maxResults,
      contextBefore,
      contextAfter,
      exclude,
      includeHidden,
    });

    try {
      const workingDir = config?.context?.workingDir;
      if (!workingDir) {
        throw new Error(
          "Context with workingDir is required for file operations"
        );
      }

      if (!query) {
        throw new Error('The "query" parameter is required');
      }

      // Validate path
      const resolvedPath = path.resolve(workingDir, searchPath);
      const resolvedWorkingDir = path.resolve(workingDir);
      const relativePath = path.relative(resolvedWorkingDir, resolvedPath);

      if (relativePath.startsWith("..")) {
        throw new Error(
          `Search path "${searchPath}" attempts to escape the working directory sandbox`
        );
      }

      let stats: import("node:fs").Stats;
      try {
        stats = await stat(resolvedPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error(`Search path "${searchPath}" does not exist`);
        }
        throw error;
      }

      if (!stats.isDirectory()) {
        throw new Error(`Search path "${searchPath}" is not a directory`);
      }

      // Initialize GitIgnoreService
      const gitignore = new GitIgnoreService(workingDir);
      await gitignore.initialize();

      const filesToSearch = await findFilesToSearch(
        resolvedPath,
        patterns,
        recursive,
        includeHidden
      );

      const searchRegex = compileSearchRegex(query, regex, caseSensitive);
      const excludeGlobs = exclude.map((pattern) => new Glob(pattern));
      const results: Array<{ path: string; matches: SearchMatch[] }> = [];
      let totalMatches = 0;

      for (const file of filesToSearch) {
        if (totalMatches >= maxResults) {
          break;
        }

        const relativeFileToWorkingDir = path.relative(workingDir, file);

        // 1. Check if file should be ignored by .gitignore
        if (gitignore.shouldIgnore(file, false)) {
          continue;
        }

        // 2. Check if file should be excluded by manual exclude patterns
        const isExcluded = excludeGlobs.some((eg) =>
          eg.match(relativeFileToWorkingDir)
        );
        if (isExcluded) {
          continue;
        }

        if (await isTextFile(file)) {
          const fileMatches = await searchFileWithContext(
            file,
            searchRegex,
            contextBefore,
            contextAfter
          );

          if (fileMatches.length > 0) {
            const remainingSlot = maxResults - totalMatches;
            const limitedMatches = fileMatches.slice(0, remainingSlot);

            results.push({
              path: path.relative(workingDir, file),
              matches: limitedMatches,
            });
            totalMatches += limitedMatches.length;
          }
        }
      }

      logger.timingEnd(timingId, "TOOL", "grep completed");

      if (results.length === 0) {
        return `No matches found for query "${query}" in the searched files`;
      }

      return formatSearchResults(results);
    } catch (error) {
      logger.error(
        "TOOL",
        "grep failed",
        error instanceof Error ? error : new Error(String(error)),
        { searchPath, query }
      );

      return formatToolError({
        operation: "grep",
        path: searchPath,
        cause: error,
        suggestion: getToolSuggestion("grep", searchPath),
      });
    }
  },
  {
    name: "grep",
    description: `A powerful search tool for finding text patterns in files.

Usage:
- ALWAYS use grep for search tasks.
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx")
- Pattern syntax: Uses JavaScript regex - literal braces need escaping (use \`interface{}\` to find \`interface{}\` in Go code)
`,
    schema: z.object({
      searchPath: z.string().describe("The directory path to search in"),
      query: z
        .string()
        .describe(
          "The search query - the text or pattern to look for in files"
        ),
      patterns: z
        .array(z.string())
        .optional()
        .default(["*"])
        .describe("File patterns to search in (e.g., ['*.js', '*.ts'])"),
      caseSensitive: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Whether the search should be case-sensitive. Defaults to `false`"
        ),
      regex: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Whether the query should be treated as a regular expression. Defaults to `false`"
        ),
      recursive: z
        .boolean()
        .optional()
        .default(true)
        .describe(
          "Whether to search recursively in subdirectories. Defaults to `true`"
        ),
      maxResults: z
        .number()
        .optional()
        .default(100)
        .describe("Maximum number of matches to return. Defaults to 100"),
      contextBefore: z
        .number()
        .optional()
        .default(0)
        .describe(
          "Number of lines of context to show before each match. Defaults to 0"
        ),
      contextAfter: z
        .number()
        .optional()
        .default(0)
        .describe(
          "Number of lines of context to show after each match. Defaults to 0"
        ),
      exclude: z
        .array(z.string())
        .optional()
        .default([])
        .describe(
          "Array of glob patterns to exclude from results (e.g., ['dist/**', 'node_modules/**'])"
        ),
      includeHidden: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Whether to include hidden files and directories in the search. Defaults to `false`"
        ),
    }),
  }
);
