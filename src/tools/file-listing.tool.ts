import { tool } from "langchain";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";
import { isTextFile } from "../utils/file-utils.js";
import { formatDirectoryTree } from "../utils/format-utils.js";

// Define types for file system operations
interface FileSystemEntry {
	name: string;
	path: string;
	isDirectory: boolean;
	size?: number | undefined;
	modified?: Date | undefined;
	permissions?: string | undefined;
	lineCount?: number | undefined;
}

interface DirectoryListing {
	entries: FileSystemEntry[];
	totalCount: number;
	filteredCount?: number;
}

// Get line count for a file
async function getFileLineCount(filePath: string): Promise<number> {
	try {
		if (await isTextFile(filePath)) {
			const content = await Bun.file(filePath).text();
			return content.split("\n").length;
		}
		return 0;
	} catch {
		return 0;
	}
}

// Simplified function to check if a file should be ignored (basic .gitignore handling)
async function shouldIgnoreFile(filePath: string): Promise<boolean> {
	const basename = path.basename(filePath);

	// Basic checks for common files/directories to ignore
	if (basename.startsWith(".") && basename !== ".env") {
		// Check for common gitignored items
		const ignoredItems = [
			"node_modules",
			".git",
			".DS_Store",
			".idea",
			".vscode",
			".pytest_cache",
		];
		if (ignoredItems.includes(basename)) {
			return true;
		}
	}

	// Check for common build/output directories
	const commonBuildDirs = ["dist", "build", "out", "target", "coverage"];
	if (
		commonBuildDirs.includes(basename) &&
		(await fs
			.stat(filePath)
			.then((s) => s.isDirectory())
			.catch(() => false))
	) {
		return true;
	}

	return false;
}

/**
 * List directory contents with metadata
 */
async function listDirectory(
	dirPath: string,
	includeHidden = false,
	recursive = false,
	maxDepth = 1,
	currentDepth = 0,
): Promise<FileSystemEntry[]> {
	if (currentDepth >= maxDepth) {
		return [];
	}

	const entries = await fs.readdir(dirPath, { withFileTypes: true });
	const fileEntries: FileSystemEntry[] = [];

	for (const entry of entries) {
		if (!includeHidden && entry.name.startsWith(".")) {
			continue;
		}

		const fullPath = path.join(dirPath, entry.name);

		try {
			// Check if file should be ignored
			if (!includeHidden && (await shouldIgnoreFile(fullPath))) {
				continue;
			}

			const stats = await fs.stat(fullPath);
			const name = path.basename(fullPath);

			const metadata: FileSystemEntry = {
				name: recursive && currentDepth > 0 ? path.relative(dirPath, fullPath) : name,
				path: fullPath,
				isDirectory: stats.isDirectory(),
				size: stats.isFile() ? stats.size : undefined,
				modified: stats.mtime,
				permissions: stats.mode?.toString(8),
			};

			if (!metadata.isDirectory) {
				metadata.lineCount = await getFileLineCount(fullPath);
			}

			fileEntries.push(metadata);

			if (metadata.isDirectory && recursive && currentDepth + 1 < maxDepth) {
				const subEntries = await listDirectory(
					fullPath,
					includeHidden,
					recursive,
					maxDepth,
					currentDepth + 1,
				);
				
				for (const subEntry of subEntries) {
					fileEntries.push({
						...subEntry,
						name: `${name}/${subEntry.name}`
					});
				}
			}
		} catch {
			// Skip files that can't be accessed or have metadata errors
		}
	}

	// Sort: directories first, then by name
	if (currentDepth === 0) {
		fileEntries.sort((a, b) => {
			if (a.isDirectory !== b.isDirectory) {
				return a.isDirectory ? -1 : 1;
			}
			return a.name.localeCompare(b.name);
		});
	}

	return fileEntries;
}

// Create the modernized tool using the tool() function
export const fileListTool = tool(
	async ({ directoryPath = ".", includeHidden = false, recursive = false, maxDepth = 1 }, config) => {
		const timingId = logger.timingStart("fileList");

		logger.info("TOOL", "file_list called", { directoryPath, includeHidden, recursive, maxDepth });

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

			// Validate path to prevent directory traversal
			const resolvedPath = path.resolve(workingDir, directoryPath);
			const resolvedWorkingDir = path.resolve(workingDir);
			const relativePath = path.relative(resolvedWorkingDir, resolvedPath);

			logger.debug("TOOL", "Path validation", {
				resolvedPath: resolvedPath.replace(Bun.env.HOME || "", "~"),
				resolvedWorkingDir: resolvedWorkingDir.replace(Bun.env.HOME || "", "~"),
				relativePath,
				validated: !relativePath.startsWith(".."),
			});

			// Check if resolved path escapes working directory
			if (relativePath.startsWith("..")) {
				logger.error(
					"PATH",
					"Directory path escapes working directory sandbox",
					undefined,
					{ directoryPath, relativePath },
				);
				throw new Error(
					`Directory path "${directoryPath}" attempts to escape working directory sandbox`,
				);
			}

			// List the directory
			const entries = await listDirectory(resolvedPath, includeHidden, recursive, maxDepth);

			// Format the result for the AI
			const treeOutput = formatDirectoryTree(entries);
			
			let result = `Contents of directory: ${resolvedPath}\n\n`;
			result += `Total entries: ${entries.length}\n\n`;
			result += treeOutput;

			logger.timingEnd(timingId, "TOOL", "file_list completed");
			logger.debug("TOOL", "Directory listing successful", {
				directoryPath,
				entryCount: entries.length,
			});

			return result;
		} catch (error) {
			logger.error(
				"TOOL",
				"list failed",
				error instanceof Error ? error : new Error(String(error)),
				{ directoryPath },
			);
			return `Error listing directory: ${(error as Error).message}`;
		}
	},
	{
		name: "list",
		description:
			"List the contents of a directory with metadata. Use this to understand the structure of a repository or directory.",
		schema: z.object({
			directoryPath: z.string().describe("The directory path to list"),
			includeHidden: z
				.boolean()
				.optional()
				.default(false)
				.describe(
					"Whether to include hidden files and directories. Defaults to \`false\`",
				),
			recursive: z
				.boolean()
				.optional()
				.default(false)
				.describe("Whether to list subdirectories recursively. Defaults to \`false\`"),
			maxDepth: z
				.number()
				.optional()
				.default(1)
				.describe("Maximum depth for recursive listing. Defaults to 1"),
		}),
	},
);
