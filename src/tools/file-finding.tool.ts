import { tool } from "langchain";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { Glob } from "bun";
import { logger } from "../utils/logger.js";

// Create the modernized tool using the tool() function
export const findTool = tool(
	async (
		{
			searchPath = ".",
			patterns,
			exclude = [],
			recursive = true,
			maxResults = 100,
			includeHidden = false,
		},
		config,
	) => {
		const timingId = logger.timingStart("find");

		logger.info("TOOL", "find called", {
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

			// Validate the path to prevent directory traversal
			const resolvedPath = path.resolve(workingDir, searchPath);
			const resolvedWorkingDir = path.resolve(workingDir);
			const relativePath = path.relative(resolvedWorkingDir, resolvedPath);

			if (relativePath.startsWith("..")) {
				throw new Error(
					`Search path "${searchPath}" attempts to escape the working directory sandbox`,
				);
			}

			// Validate that the search path exists and is a directory
			const stats = await fs.stat(resolvedPath);
			if (!stats.isDirectory()) {
				throw new Error(`Search path "${searchPath}" is not a directory`);
			}

			const foundFiles: string[] = [];
			const excludeGlobs = exclude.map((pattern) => new Glob(pattern));

			// Process each pattern using Bun's native Glob for accuracy and performance
			for (const pattern of patterns) {
				if (foundFiles.length >= maxResults) break;

				// If recursive and no directory component in pattern, prepend **/
				const effectivePattern =
					recursive && !pattern.includes("/") && !pattern.includes("**")
						? `**/${pattern}`
						: pattern;

				const glob = new Glob(effectivePattern);

				// Scan using resolvedPath as cwd
				for await (const file of glob.scan({
					cwd: resolvedPath,
					onlyFiles: true,
					dot: includeHidden,
				})) {
					if (foundFiles.length >= maxResults) break;

					// file is relative to resolvedPath
					const fullPath = path.resolve(resolvedPath, file);
					const relativeToWorkingDir = path.relative(resolvedWorkingDir, fullPath);

					// Check if file should be excluded
					const isExcluded = excludeGlobs.some((eg) => eg.match(relativeToWorkingDir));
					if (isExcluded) continue;

					if (!foundFiles.includes(relativeToWorkingDir)) {
						foundFiles.push(relativeToWorkingDir);
					}
				}
			}

			logger.timingEnd(timingId, "TOOL", "find completed");

			if (foundFiles.length === 0) {
				return `No files found matching patterns: ${patterns.join(", ")}`;
			}

			foundFiles.sort();

			// Format results relative to working directory
			let output = `Found ${foundFiles.length} files matching patterns [${patterns.join(", ")}]:\n\n`;
			output += foundFiles.join("\n");

			return output;
		} catch (error) {
			logger.error(
				"TOOL",
				"find failed",
				error instanceof Error ? error : new Error(String(error)),
				{ searchPath, patterns },
			);
			return `Error finding files: ${(error as Error).message}`;
		}
	},
	{
		name: "find",
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
