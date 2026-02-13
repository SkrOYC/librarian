import path from "node:path";
import { tool } from "langchain";
import { z } from "zod";
import { formatToolError, getToolSuggestion } from "../utils/error-utils.js";
import { isTextFile } from "../utils/file-utils.js";
import { withLineNumbers, formatViewAsJson } from "../utils/format-utils.js";
import { logger } from "../utils/logger.js";

// Check if file is an image file
function isImageFile(filePath: string): boolean {
  const imageExtensions = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
    ".webp",
    ".svg",
    ".ico",
    ".tiff",
    ".tif",
  ]);
  const ext = path.extname(filePath).toLowerCase();
  return imageExtensions.has(ext);
}

// Check if file is an audio file
function isAudioFile(filePath: string): boolean {
  const audioExtensions = new Set([
    ".mp3",
    ".wav",
    ".ogg",
    ".flac",
    ".m4a",
    ".aac",
    ".wma",
    ".opus",
    ".webm",
  ]);
  const ext = path.extname(filePath).toLowerCase();
  return audioExtensions.has(ext);
}

// Check if file is a binary file that cannot be read as text
function isBinaryFile(filePath: string): boolean {
  const binaryExtensions = new Set([
    ".pdf",
    ".zip",
    ".gz",
    ".tar",
    ".rar",
    ".7z",
    ".exe",
    ".dll",
    ".so",
    ".dylib",
    ".class",
    ".jar",
    ".war",
    ".ear",
  ]);
  const ext = path.extname(filePath).toLowerCase();
  return binaryExtensions.has(ext);
}

/**
 * Reads lines from a file within a specific range using a streaming approach.
 * This is memory-efficient for large files as it avoids loading the entire file.
 */
async function readLinesInRange(
  filePath: string,
  viewRange?: [number, number]
): Promise<{ lines: string[]; totalLines: number }> {
  const file = Bun.file(filePath);
  const stream = file.stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  const lines: string[] = [];
  let currentLine = 1;
  const startLine = viewRange ? viewRange[0] : 1;
  const endLine = viewRange ? viewRange[1] : -1;
  let totalLines = 0;

  let partialLine = "";

  try {
    while (true) {
      let chunk: string;
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (partialLine) {
            totalLines++;
            if (
              currentLine >= startLine &&
              (endLine === -1 || currentLine <= endLine)
            ) {
              lines.push(partialLine);
            }
          }
          break;
        }
        chunk = decoder.decode(value, { stream: true });
      } catch (readError) {
        reader.releaseLock();
        throw new Error(
          `Failed to read file ${filePath}: ${(readError as Error).message}`
        );
      }

      const chunkLines = (partialLine + chunk).split("\n");
      partialLine = chunkLines.pop() || "";

      for (const line of chunkLines) {
        if (
          currentLine >= startLine &&
          (endLine === -1 || currentLine <= endLine)
        ) {
          lines.push(line);
        }
        currentLine++;
        totalLines++;

        // Optimization: Stop reading if we've passed the requested range
        if (endLine !== -1 && currentLine > endLine) {
          await reader.cancel();
          return { lines, totalLines: -1 };
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { lines, totalLines };
}

// Create the modernized tool using the tool() function
export const viewTool = tool(
  async ({ filePath, viewRange }, config) => {
    const timingId = logger.timingStart("view");

    logger.info("TOOL", "view called", { filePath, viewRange });

    try {
      // Validate viewRange if provided
      if (viewRange) {
        const [start, end] = viewRange;
        if (start < 1) {
          throw new Error(
            `Invalid viewRange: start must be >= 1, got ${start}`
          );
        }
        if (end !== -1 && end < start) {
          throw new Error(
            `Invalid viewRange: end (${end}) must be >= start (${start}) or -1 for end of file`
          );
        }
      }

      // Get working directory from config context - required for security
      const workingDir = config?.context?.workingDir;
      if (!workingDir) {
        throw new Error(
          "Context with workingDir is required for file operations"
        );
      }

      // Coerce filePath to string to handle cases where model passes incorrect types
      const filePathString = String(filePath ?? '');
      if (!filePathString || filePathString.trim() === '') {
        throw new Error('The "filePath" parameter is required');
      }

      // Validate the path to prevent directory traversal
      const resolvedPath = path.resolve(workingDir, filePathString);
      const resolvedWorkingDir = path.resolve(workingDir);
      const relativePath = path.relative(resolvedWorkingDir, resolvedPath);

      if (relativePath.startsWith("..")) {
        throw new Error(
          `File path "${filePathString}" attempts to escape the working directory sandbox`
        );
      }

      // Check if it's a media file
      if (isImageFile(resolvedPath) || isAudioFile(resolvedPath)) {
        return JSON.stringify({ error: "media_file", fileType: isImageFile(resolvedPath) ? "image" : "audio", filePath: filePathString, message: "Media files cannot be read as text" });
      }

      // Check if it's a binary file
      if (isBinaryFile(resolvedPath)) {
        return JSON.stringify({ error: "binary_file", fileType: path.extname(filePathString), filePath: filePathString, message: "Binary files cannot be read as text" });
      }

      // Check if it's a text file
      const isText = await isTextFile(resolvedPath);
      if (!isText) {
        return JSON.stringify({ error: "not_text_file", filePath: filePathString, message: "File is not a text file and cannot be read" });
      }

      // Read file content within range using streaming
      const { lines, totalLines } = await readLinesInRange(resolvedPath, viewRange);

      logger.timingEnd(timingId, "TOOL", "view completed");

      if (lines.length === 0) {
        return JSON.stringify({ filePath: filePathString, totalLines: 0, viewRange: viewRange ?? null, lines: [], isEmpty: true });
      }

      return formatViewAsJson(lines, filePathString, viewRange, totalLines);
    } catch (error) {
      logger.error(
        "TOOL",
        "view failed",
        error instanceof Error ? error : new Error(String(error)),
        { filePath }
      );

      return formatToolError({
        operation: "view",
        path: filePath,
        cause: error,
        suggestion: getToolSuggestion("view", filePath),
      });
    }
  },
  {
    name: "view",
    description:
      "Read the contents of a file. Use this to examine the content of a specific file.",
    schema: z.object({
      filePath: z.string().describe("The path to the file to read"),
      viewRange: z
        .tuple([z.number(), z.number()])
        .optional()
        .describe(
          "Optional tuple of [start, end] line numbers to display. Use -1 for end of file."
        ),
    }),
  }
);
