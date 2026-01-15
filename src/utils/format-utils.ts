/**
 * Formatting utility functions for tool outputs
 */

export interface FileSystemEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  lineCount?: number;
  depth?: number;
}

export interface SearchMatch {
  line: number;
  column: number;
  text: string;
  context?: {
    before: string[];
    after: string[];
  };
}

const MIN_LINE_NUM_WIDTH = 3;
const FILE_SEPARATOR = "--";

/**
 * Add line numbers to an array of lines for display
 */
export function withLineNumbers(lines: string[], startLine = 1): string {
  if (!lines || lines.length === 0) {
    return "";
  }

  const maxLineNumWidth = Math.max(
    MIN_LINE_NUM_WIDTH,
    String(startLine + lines.length - 1).length
  );

  return lines
    .map((line, index) => {
      const lineNum = startLine + index;
      const paddedNum = String(lineNum).padStart(maxLineNumWidth);
      return `${paddedNum}→${line}`;
    })
    .join("\n");
}

/**
 * Format content with optional line range using line arrays for efficiency
 */
export function formatLinesWithRange(
  lines: string[],
  viewRange?: [number, number]
): string {
  if (!lines || lines.length === 0) {
    return "[File is empty]";
  }

  if (!viewRange) {
    return withLineNumbers(lines);
  }

  const [start, end] = viewRange;
  const startIndex = Math.max(0, start - 1);
  const endIndex = end === -1 ? lines.length : Math.min(lines.length, end);

  const selectedLines = lines.slice(startIndex, endIndex);
  return withLineNumbers(selectedLines, start);
}

/**
 * Legacy wrapper for formatLinesWithRange that accepts a string
 * @deprecated Use formatLinesWithRange with pre-split lines for better performance
 */
function _formatContentWithRange(
  content: string,
  viewRange?: [number, number]
): string {
  if (!content || content.trim() === "") {
    return "[File is empty]";
  }
  return formatLinesWithRange(content.split("\n"), viewRange);
}

/**
 * Format directory listing in tree-like format with indentation
 */
export function formatDirectoryTree(entries: FileSystemEntry[]): string {
  let output = "";

  for (const entry of entries) {
    const indent = "  ".repeat(entry.depth || 0);
    let line = `${indent}${entry.isDirectory ? `${entry.name}/` : entry.name}`;

    // For files, show line count if available
    if (!entry.isDirectory && entry.lineCount !== undefined) {
      line += ` (${entry.lineCount} lines)`;
    } else if (!entry.isDirectory && entry.size !== undefined) {
      line += ` (${entry.size} bytes)`;
    }

    output += `${line}\n`;
  }

  return output.trimEnd();
}

/**
 * Format search results with context
 */
export function formatSearchResults(
  results: { path: string; matches: SearchMatch[] }[]
): string {
  let output = "";
  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);

  output += `Found ${totalMatches} matches in ${results.length} files:\n\n`;

  let fileIndex = 0;
  for (const result of results) {
    output += `${result.path}\n`;

    const sortedMatches = [...result.matches].sort((a, b) => a.line - b.line);
    const displayedLines = new Set<number>();
    let lastPrintedLine = -1;

    // Calculate max line num width for this file
    let maxLineNum = 0;
    for (const match of sortedMatches) {
      const lastContextLine = match.line + (match.context?.after.length || 0);
      maxLineNum = Math.max(maxLineNum, lastContextLine);
    }
    const maxLineNumWidth = Math.max(
      MIN_LINE_NUM_WIDTH,
      String(maxLineNum).length
    );

    for (const match of sortedMatches) {
      // Before context
      if (match.context?.before) {
        const startLine = Math.max(1, match.line - match.context.before.length);
        for (let j = 0; j < match.context.before.length; j++) {
          const lineNum = startLine + j;
          if (!displayedLines.has(lineNum)) {
            if (lastPrintedLine !== -1 && lineNum > lastPrintedLine + 1) {
              output += `${" ".repeat(maxLineNumWidth)}⁝\n`;
            }
            output += `${String(lineNum).padStart(maxLineNumWidth)}→${match.context.before[j]}\n`;
            displayedLines.add(lineNum);
            lastPrintedLine = lineNum;
          }
        }
      }

      // Match line
      if (!displayedLines.has(match.line)) {
        if (lastPrintedLine !== -1 && match.line > lastPrintedLine + 1) {
          output += `${" ".repeat(maxLineNumWidth)}⁝\n`;
        }
        output += `${String(match.line).padStart(maxLineNumWidth)}→${match.text}\n`;
        displayedLines.add(match.line);
        lastPrintedLine = match.line;
      }

      // After context
      if (match.context?.after) {
        const startLine = match.line + 1;
        for (let j = 0; j < match.context.after.length; j++) {
          const lineNum = startLine + j;
          if (!displayedLines.has(lineNum)) {
            if (lastPrintedLine !== -1 && lineNum > lastPrintedLine + 1) {
              output += `${" ".repeat(maxLineNumWidth)}⁝\n`;
            }
            output += `${String(lineNum).padStart(maxLineNumWidth)}→${match.context.after[j]}\n`;
            displayedLines.add(lineNum);
            lastPrintedLine = lineNum;
          }
        }
      }
    }

    if (fileIndex < results.length - 1) {
      output += `${FILE_SEPARATOR}\n`;
    }
    fileIndex++;
  }

  return output;
}
