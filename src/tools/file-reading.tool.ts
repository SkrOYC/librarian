import { tool } from "langchain";
import { z } from "zod";
import path from "node:path";
import { logger } from "../utils/logger.js";
import { isTextFile } from "../utils/file-utils.js";
import { withLineNumbers } from "../utils/format-utils.js";

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

/**
 * Reads lines from a file within a specific range using a streaming approach.
 * This is memory-efficient for large files as it avoids loading the entire file.
 */
async function readLinesInRange(
	filePath: string,
	viewRange?: [number, number],
): Promise<{ lines: string[]; totalLines: number }> {
	const file = Bun.file(filePath);
	const stream = file.stream();
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	
	let lines: string[] = [];
	let currentLine = 1;
	let startLine = viewRange ? viewRange[0] : 1;
	let endLine = viewRange ? viewRange[1] : -1;
	let totalLines = 0;
	
	let partialLine = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			if (partialLine || currentLine === 1) {
				totalLines++;
				if (currentLine >= startLine && (endLine === -1 || currentLine <= endLine)) {
					lines.push(partialLine);
				}
			}
			break;
		}

		const chunk = decoder.decode(value, { stream: true });
		const chunkLines = (partialLine + chunk).split("\n");
		partialLine = chunkLines.pop() || "";

		for (const line of chunkLines) {
			totalLines++;
			if (currentLine >= startLine && (endLine === -1 || currentLine <= endLine)) {
				lines.push(line);
			}
			currentLine++;
		}
	}

	return { lines, totalLines };
}

// Create the modernized tool using the tool() function
export const fileReadTool = tool(
	async ({ filePath, viewRange }, config) => {
		const timingId = logger.timingStart("fileRead");

		logger.info("TOOL", "file_read called", { filePath, viewRange });

		try {
			// Get working directory from config context - required for security
			const workingDir = config?.context?.workingDir;
			if (!workingDir) {
				throw new Error(
					"Context with workingDir is required for file operations",
				);
			}

			// Validate the path to prevent directory traversal
			const resolvedPath = path.resolve(workingDir, filePath);
			const resolvedWorkingDir = path.resolve(workingDir);
			const relativePath = path.relative(resolvedWorkingDir, resolvedPath);

			if (relativePath.startsWith("..")) {
				throw new Error(
					`File path "${filePath}" attempts to escape the working directory sandbox`,
				);
			}

			// Check if it's a media file
			if (isImageFile(resolvedPath) || isAudioFile(resolvedPath)) {
				return `This is a media file (${isImageFile(resolvedPath) ? "image" : "audio"}). Media files cannot be read as text. Path: ${filePath}`;
			}

			// Check if it's a text file
			const isText = await isTextFile(resolvedPath);
			if (!isText) {
				return `This file is not a text file and cannot be read as text. Path: ${filePath}`;
			}

			// Read file content within range using streaming
			const { lines, totalLines } = await readLinesInRange(resolvedPath, viewRange);

			if (lines.length === 0 && totalLines === 0) {
				return `Content of file: ${filePath}\n\n[File is empty]`;
			}

			// Format content with correct line numbers
			const startLine = viewRange ? Math.max(1, viewRange[0]) : 1;
			const formattedContent = withLineNumbers(lines, startLine);

			logger.timingEnd(timingId, "TOOL", "file_read completed");
			
			const rangeInfo = viewRange 
				? ` (lines ${startLine} to ${viewRange[1] === -1 ? totalLines : Math.min(totalLines, viewRange[1])})` 
				: "";

			return `Content of file: ${filePath}${rangeInfo}\n\n${formattedContent}`;
		} catch (error) {
			logger.error(
				"TOOL",
				"file_read failed",
				error instanceof Error ? error : new Error(String(error)),
				{ filePath },
			);
			return `Error reading file: ${(error as Error).message}`;
		}
	},
	{
		name: "file_read",
		description:
			"Read the contents of a file. Use this to examine the content of a specific file.",
		schema: z.object({
			filePath: z.string().describe("The path to the file to read"),
			viewRange: z
				.tuple([z.number(), z.number()])
				.optional()
				.describe(
					"Optional tuple of [start, end] line numbers to display. Use -1 for end of file.",
				),
		}),
	},
);
