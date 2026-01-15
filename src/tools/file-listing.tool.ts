import { tool } from "langchain";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";
import { getFileLineCount } from "../utils/file-utils.js";
import { formatDirectoryTree, type FileSystemEntry } from "../utils/format-utils.js";

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
 * Improved listDirectory that sorts siblings before recursing to maintain DFS tree order
 */
async function listDirectoryDFS(
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
	
	// Filter entries first
	const filteredEntries = [];
	for (const entry of entries) {
		if (!includeHidden && entry.name.startsWith(".")) continue;
		const fullPath = path.join(dirPath, entry.name);
		if (!includeHidden && (await shouldIgnoreFile(fullPath))) continue;
		filteredEntries.push(entry);
	}

	// Sort: directories first, then by name
	filteredEntries.sort((a, b) => {
		if (a.isDirectory() !== b.isDirectory()) {
			return a.isDirectory() ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});

	const fileEntries: FileSystemEntry[] = [];

	for (const entry of filteredEntries) {
		const fullPath = path.join(dirPath, entry.name);
		try {
			const stats = await fs.stat(fullPath);
			const metadata: FileSystemEntry = {
				name: entry.name,
				path: fullPath,
				isDirectory: stats.isDirectory(),
				size: stats.isFile() ? stats.size : undefined,
				depth: currentDepth,
			};

			if (!metadata.isDirectory) {
				metadata.lineCount = await getFileLineCount(fullPath);
			}

			fileEntries.push(metadata);

			if (metadata.isDirectory && recursive && currentDepth + 1 < maxDepth) {
				const subEntries = await listDirectoryDFS(
					fullPath,
					includeHidden,
					recursive,
					maxDepth,
					currentDepth + 1,
				);
				fileEntries.push(...subEntries);
			}
		} catch {
			// Skip files that can't be accessed
		}
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

			// Validate path to prevent directory traversal
			const resolvedPath = path.resolve(workingDir, directoryPath);
			const resolvedWorkingDir = path.resolve(workingDir);
			const relativePath = path.relative(resolvedWorkingDir, resolvedPath);

			// Check if resolved path escapes working directory
			if (relativePath.startsWith("..")) {
				throw new Error(
					`Directory path "${directoryPath}" attempts to escape working directory sandbox`,
				);
			}

			// List the directory using DFS to maintain tree order
			const entries = await listDirectoryDFS(resolvedPath, includeHidden, recursive, maxDepth);

			// Format the result for the AI
			const treeOutput = formatDirectoryTree(entries);
			
			let result = `Contents of directory: ${resolvedPath}\n\n`;
			result += `Total entries: ${entries.length}\n\n`;
			result += treeOutput;

			logger.timingEnd(timingId, "TOOL", "file_list completed");
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
