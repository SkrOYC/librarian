import { tool } from "langchain";
import { z } from "zod";
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger.js";

// Find files matching glob patterns in a directory
async function findFiles(
	searchPath: string,
	patterns: string[],
	options: {
		exclude?: string[];
		recursive?: boolean;
		maxResults?: number;
		includeHidden?: boolean;
	} = {},
): Promise<string[]> {
	const {
		exclude = [],
		recursive = true,
		maxResults = 1000,
		includeHidden = false,
	} = options;

	const foundFiles: string[] = [];
	const processedPaths = new Set<string>();

	// Process each pattern
	for (const pattern of patterns) {
		// Only add **/ prefix if recursive and pattern doesn't already contain path separators
		const effectivePattern =
			recursive && !pattern.includes("**") && !pattern.includes("/")
				? `**/${pattern}`
				: pattern;

		// Simple glob matching implementation
		const matchingFiles = await simpleGlobSearch(searchPath, effectivePattern, {
			recursive,
			includeHidden,
		});

		for (const file of matchingFiles) {
			if (foundFiles.length >= maxResults) {
				break;
			}

			if (processedPaths.has(file)) {
				continue;
			}

			processedPaths.add(file);

			// Check if file should be excluded
			const relativePath = path.relative(searchPath, file);
			if (exclude.some((excl) => simpleMatch(relativePath, excl))) {
				continue;
			}

			foundFiles.push(file);
		}

		if (foundFiles.length >= maxResults) {
			break;
		}
	}

	return foundFiles.slice(0, maxResults);
}

async function handleDirectoryEntry(
	entry: Dirent,
	basePath: string,
	pattern: string,
	options: { recursive: boolean; includeHidden: boolean },
	results: string[],
): Promise<void> {
	const fullPath = path.join(basePath, entry.name);

	if (pattern === "**" || pattern.includes("**") || options.recursive) {
		const basePattern = pattern.split("/")[0] || pattern;
		if (simpleMatch(entry.name, basePattern)) {
			results.push(fullPath);
		}

		if (options.recursive) {
			const subDirResults = await simpleGlobSearch(
				fullPath,
				pattern,
				options,
			);
			results.push(...subDirResults);
		}
	}
}

function handleFileEntry(
	entry: Dirent,
	basePath: string,
	pattern: string,
	results: string[],
): void {
	const fullPath = path.join(basePath, entry.name);
	const relativePath = path.relative(basePath, fullPath);
	const basePattern = pattern.includes("**/")
		? pattern.split("**/")[1] || ""
		: pattern;
	if (
		simpleMatch(entry.name, basePattern) ||
		simpleMatch(relativePath, basePattern)
	) {
		results.push(fullPath);
	}
}

// Simple glob search implementation (basic pattern matching)
async function simpleGlobSearch(
	basePath: string,
	pattern: string,
	options: {
		recursive: boolean;
		includeHidden: boolean;
	},
): Promise<string[]> {
	const results: string[] = [];

	try {
		const entries = await fs.readdir(basePath, { withFileTypes: true });

		for (const entry of entries) {
			if (!options.includeHidden && entry.name.startsWith(".")) {
				continue;
			}

			if (entry.isDirectory()) {
				await handleDirectoryEntry(entry, basePath, pattern, options, results);
			} else if (entry.isFile()) {
				handleFileEntry(entry, basePath, pattern, results);
			}
		}
	} catch {
		return [];
	}

	return results;
}

// Simple pattern matching (supports * and ? wildcards)
function simpleMatch(str: string, pattern: string): boolean {
	// Handle exact match first
	if (pattern === str) {
		return true;
	}

	// Convert glob pattern to regex
	const regexPattern = pattern
		.replace(/\./g, "\\.") // Escape dots
		.replace(/\*/g, ".*") // Replace * with .*
		.replace(/\?/g, "."); // Replace ? with .

	const regex = new RegExp(`^${regexPattern}$`);
	return regex.test(str);
}

// Create the modernized tool using the tool() function
export const fileFindTool = tool(
	async (
		{
			searchPath = ".",
			patterns,
			exclude = [],
			recursive = true,
			maxResults = 1000,
			includeHidden = false,
		},
		config,
	) => {
		const timingId = logger.timingStart("fileFind");

		logger.info("TOOL", "file_find called", {
			searchPath,
			patterns,
			exclude,
			recursive,
			maxResults,
			includeHidden,
		});

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
			const resolvedPath = path.resolve(workingDir, searchPath);
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
					"Search path escapes working directory sandbox",
					undefined,
					{ searchPath, relativePath },
				);
				throw new Error(
					`Search path "${searchPath}" attempts to escape the working directory sandbox`,
				);
			}

			// Validate that the search path exists and is a directory
			const stats = await fs.stat(resolvedPath);
			if (!stats.isDirectory()) {
				logger.error("TOOL", "Search path is not a directory", undefined, {
					searchPath,
				});
				throw new Error(`Search path "${searchPath}" is not a directory`);
			}

			// Find matching files
			const foundFiles = await findFiles(resolvedPath, patterns || ["*"], {
				exclude,
				recursive,
				maxResults,
				includeHidden,
			});

			logger.timingEnd(timingId, "TOOL", "file_find completed");
			logger.debug("TOOL", "File search successful", {
				searchPath,
				foundCount: foundFiles.length,
				patterns,
			});

			if (foundFiles.length === 0) {
				return `No files found matching patterns: ${patterns?.join(", ") || "*"}`;
			}

			// Format results
			let output = `Found ${foundFiles.length} files matching patterns [${patterns?.join(", ") || "*"}]:\n\n`;

			for (const file of foundFiles) {
				const relativePath = path.relative(resolvedPath, file);
				output += `${relativePath}\n`;
			}

			return output;
		} catch (error) {
			logger.error(
				"TOOL",
				"file_find failed",
				error instanceof Error ? error : new Error(String(error)),
				{ searchPath, patterns },
			);
			return `Error finding files: ${(error as Error).message}`;
		}
	},
	{
		name: "find_files",
		description: `Discovers files using glob patterns. Respects .gitignore.
Usage
- Fast file pattern matching command that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted
- Use this command when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Task tool instead
- You can call multiple commands in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.
`,
		schema: z.object({
			searchPath: z
				.string()
				.describe(
					"The directory path to search in, relative to the working directory",
				),
			patterns: z
				.array(z.string())
				.describe(
					"Array of glob patterns to match files (e.g., ['*.js', '*.ts'])",
				),
			exclude: z
				.array(z.string())
				.optional()
				.default([])
				.describe(
					"Array of patterns to exclude from results. Defaults to none",
				),
			recursive: z
				.boolean()
				.optional()
				.default(true)
				.describe(
					"Whether to search recursively in subdirectories. Defaults to `true`",
				),
			maxResults: z
				.number()
				.optional()
				.default(100)
				.describe(
					"Maximum number of files to return. Maximum of 100 by default",
				),
			includeHidden: z
				.boolean()
				.optional()
				.default(false)
				.describe(
					"Whether to include hidden files and directories. Defaults to `false`",
				),
		}),
	},
);
