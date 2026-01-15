import { tool } from "langchain";
import { z } from "zod";
import path from "node:path";
import { logger } from "../utils/logger.js";
import { isTextFile } from "../utils/file-utils.js";
import { formatContentWithRange } from "../utils/format-utils.js";

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

// Safe file read with encoding detection
async function readFileContent(filePath: string): Promise<string> {
	try {
		return await Bun.file(filePath).text();
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		throw new Error(`Failed to read file: ${errorMessage}`);
	}
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
			logger.debug("TOOL", "Working directory", {
				workingDir: workingDir.replace(Bun.env.HOME || "", "~"),
			});

			// Validate the path to prevent directory traversal
			const resolvedPath = path.resolve(workingDir, filePath);
			const resolvedWorkingDir = path.resolve(workingDir);
			const relativePath = path.relative(resolvedWorkingDir, resolvedPath);

			logger.debug("TOOL", "Path validation", {
				resolvedPath: resolvedPath.replace(Bun.env.HOME || "", "~"),
				resolvedWorkingDir: resolvedWorkingDir.replace(Bun.env.HOME || "", "~"),
				relativePath,
				validated: !relativePath.startsWith(".."),
			});

			if (relativePath.startsWith("..")) {
				logger.error(
					"PATH",
					"File path escapes working directory sandbox",
					undefined,
					{ filePath, relativePath },
				);
				throw new Error(
					`File path "${filePath}" attempts to escape the working directory sandbox`,
				);
			}

			// Check if it's a media file
			if (isImageFile(resolvedPath) || isAudioFile(resolvedPath)) {
				logger.debug("TOOL", "File is media file", {
					filePath,
					fileType: isImageFile(resolvedPath) ? "image" : "audio",
				});
				return `This is a media file (${isImageFile(resolvedPath) ? "image" : "audio"}). Media files cannot be read as text. Path: ${filePath}`;
			}

			// Check if it's a text file
			const isText = await isTextFile(resolvedPath);
			if (!isText) {
				logger.debug("TOOL", "File is not a text file", { filePath });
				return `This file is not a text file and cannot be read as text. Path: ${filePath}`;
			}

			logger.debug("TOOL", "File type validated as text", { filePath });

			// Read file content
			const content = await readFileContent(resolvedPath);

			// Format content with line range and line numbers
			const formattedContent = formatContentWithRange(content, viewRange);

			// Limit content size to avoid overwhelming the AI
			const maxContentLength = 50_000; // 50KB limit
			let result = `Content of file: ${filePath}\n\n`;
			
			if (formattedContent.length > maxContentLength) {
				logger.debug("TOOL", "File content truncated", {
					filePath,
					originalSize: formattedContent.length,
					maxSize: maxContentLength,
				});
				logger.timingEnd(timingId, "TOOL", "file_read completed (truncated)");
				result += `[File content is too large (${formattedContent.length} characters). Showing first ${maxContentLength} characters]\n\n`;
				result += `${formattedContent.substring(0, maxContentLength)}\n\n[Content truncated due to length]`;
				return result;
			}

			logger.timingEnd(timingId, "TOOL", "file_read completed");
			logger.debug("TOOL", "File read successful", {
				filePath,
				contentLength: formattedContent.length,
			});

			result += formattedContent;
			return result;
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
