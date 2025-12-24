import { tool } from "langchain";
import * as z from "zod";
import fs from "fs/promises";
import path from "path";
import { logger } from "../utils/logger.js";
import { isTextFile } from "../utils/file-utils.js";

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
		return await fs.readFile(filePath, "utf8");
	} catch (error: unknown) {
		const errorMessage =
			error instanceof Error ? error.message : "Unknown error";
		throw new Error(`Failed to read file: ${errorMessage}`);
	}
}

// Create the modernized tool using the tool() function
export const fileReadTool = tool(
	async ({ filePath }, config) => {
		const timingId = logger.timingStart("fileRead");

		logger.info("TOOL", "file_read called", { filePath });

		try {
			// Get working directory from config context - required for security
			const workingDir = config?.context?.workingDir;
			if (!workingDir) {
				throw new Error(
					"Context with workingDir is required for file operations",
				);
			}
			logger.debug("TOOL", "Working directory", {
				workingDir: workingDir.replace(process.env.HOME || "", "~"),
			});

			// Validate the path to prevent directory traversal
			const resolvedPath = path.resolve(workingDir, filePath);
			const resolvedWorkingDir = path.resolve(workingDir);
			const relativePath = path.relative(resolvedWorkingDir, resolvedPath);

			logger.debug("TOOL", "Path validation", {
				resolvedPath: resolvedPath.replace(process.env.HOME || "", "~"),
				resolvedWorkingDir: resolvedWorkingDir.replace(
					process.env.HOME || "",
					"~",
				),
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

			// Limit content size to avoid overwhelming the AI
			const maxContentLength = 50000; // 50KB limit
			if (content.length > maxContentLength) {
				logger.debug("TOOL", "File content truncated", {
					filePath,
					originalSize: content.length,
					maxSize: maxContentLength,
				});
				logger.timingEnd(timingId, "TOOL", "file_read completed (truncated)");
				return `File content is too large (${content.length} characters). First ${maxContentLength} characters:\n\n${content.substring(0, maxContentLength)}\n\n[Content truncated due to length]`;
			}

			logger.timingEnd(timingId, "TOOL", "file_read completed");
			logger.debug("TOOL", "File read successful", {
				filePath,
				contentLength: content.length,
			});

			return `Content of file: ${filePath}\n\n${content}`;
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
		}),
	},
);
