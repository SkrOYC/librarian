import { tool } from "langchain";
import { z } from "zod";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";
import { isTextFile } from "../utils/file-utils.js";
import { formatSearchResults, type SearchMatch } from "../utils/format-utils.js";

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

// Search for content in a single file with context
function searchFileContent(
	content: string,
	regex: RegExp,
	contextBefore = 0,
	contextAfter = 0,
): SearchMatch[] {
	const lines = content.split("\n");
	const matches: SearchMatch[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) {
			continue;
		}

		const match = regex.exec(line);

		if (match) {
			const searchMatch: SearchMatch = {
				line: i + 1,
				column: match.index + 1,
				text: line,
			};

			if (contextBefore > 0 || contextAfter > 0) {
				searchMatch.context = {
					before: lines.slice(Math.max(0, i - contextBefore), i),
					after: lines.slice(i + 1, Math.min(lines.length, i + 1 + contextAfter)),
				};
			}

			matches.push(searchMatch);
			regex.lastIndex = 0;
		}
	}

	return matches;
}

// Find files matching a pattern in a directory
async function findFiles(
	dirPath: string,
	pattern: string,
	recursive = true,
): Promise<string[]> {
	const foundFiles: string[] = [];

	const entries = await readdir(dirPath, { withFileTypes: true });

	for (const entry of entries) {
		const fullPath = path.join(dirPath, entry.name);

		if (entry.isDirectory()) {
			if (recursive) {
				const subDirFiles = await findFiles(fullPath, pattern, recursive);
				foundFiles.push(...subDirFiles);
			}
		} else if (
			entry.isFile() &&
			(pattern === "*" || entry.name.includes(pattern.replace(/\*/g, "")))
		) {
			foundFiles.push(fullPath);
		}
	}

	return foundFiles;
}

async function validateAndResolvePath(
	workingDir: string,
	searchPath: string,
): Promise<string> {
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

	const stats = await stat(resolvedPath);
	if (!stats.isDirectory()) {
		logger.error("TOOL", "Search path is not a directory", undefined, {
			searchPath,
		});
		throw new Error(`Search path "${searchPath}" is not a directory`);
	}

	return resolvedPath;
}

async function findFilesToSearch(
	resolvedPath: string,
	patterns: string[],
	recursive: boolean,
): Promise<string[]> {
	let filesToSearch: string[] = [];
	for (const pattern of patterns) {
		const foundFiles = await findFiles(resolvedPath, pattern, recursive);
		filesToSearch = [...filesToSearch, ...foundFiles];
	}

	logger.debug("TOOL", "Files to search", {
		count: filesToSearch.length,
		patterns,
	});

	return filesToSearch;
}

function compileSearchRegex(
	query: string,
	regex: boolean,
	caseSensitive: boolean,
): RegExp {
	const flags = caseSensitive ? "gm" : "gim";

	if (regex) {
		try {
			const searchRegex = new RegExp(query, flags);
			logger.debug("TOOL", "Regex pattern compiled", { query, flags });
			return searchRegex;
		} catch (e) {
			logger.error(
				"TOOL",
				"Invalid regex pattern",
				e instanceof Error ? e : new Error(String(e)),
				{ query },
			);
			throw new Error(`Invalid regex pattern: ${(e as Error).message}`);
		}
	}

	const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const searchRegex = new RegExp(escapedQuery, flags);
	logger.debug("TOOL", "Escaped query compiled to regex", {
		originalQuery: query,
		flags,
	});

	return searchRegex;
}

async function performGrepSearch(
	filesToSearch: string[],
	searchRegex: RegExp,
	maxResults: number,
	contextBefore = 0,
	contextAfter = 0,
): Promise<Array<{ path: string; matches: SearchMatch[] }>> {
	const results: Array<{ path: string; matches: SearchMatch[] }> = [];
	let totalMatches = 0;

	for (const file of filesToSearch) {
		if (totalMatches >= maxResults) {
			break;
		}
		if (await isTextFile(file)) {
			try {
				const content = await readFileContent(file);
				const fileMatches = searchFileContent(
					content,
					searchRegex,
					contextBefore,
					contextAfter,
				);
				if (fileMatches.length > 0) {
					const limitedMatches = fileMatches.slice(
						0,
						maxResults - totalMatches,
					);
					results.push({ path: file, matches: limitedMatches });
					totalMatches += limitedMatches.length;
				}
			} catch {
				// Silent fail for unreadable files
			}
		}
	}

	return results;
}

// Create the modernized tool using the tool() function
export const grepContentTool = tool(
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
		},
		config,
	) => {
		const timingId = logger.timingStart("grepContent");

		logger.info("TOOL", "grep_content called", {
			searchPath,
			queryLength: query.length,
			patterns,
			caseSensitive,
			regex,
			recursive,
			maxResults,
			contextBefore,
			contextAfter,
		});

		try {
			const workingDir = config?.context?.workingDir;
			if (!workingDir) {
				throw new Error(
					"Context with workingDir is required for file operations",
				);
			}
			logger.debug("TOOL", "Working directory", {
				workingDir: workingDir.replace(Bun.env.HOME || "", "~"),
			});

			if (!query) {
				logger.error("TOOL", "Query parameter missing", undefined, {});
				throw new Error('The "query" parameter is required');
			}

			const resolvedPath = await validateAndResolvePath(workingDir, searchPath);
			const filesToSearch = await findFilesToSearch(
				resolvedPath,
				patterns,
				recursive,
			);

			const searchRegex = compileSearchRegex(query, regex, caseSensitive);
			const results = await performGrepSearch(
				filesToSearch,
				searchRegex,
				maxResults,
				contextBefore,
				contextAfter,
			);

			logger.timingEnd(timingId, "TOOL", "grep_content completed");
			logger.debug("TOOL", "Search completed", {
				filesSearched: filesToSearch.length,
				filesWithMatches: results.length,
				totalMatches: results.reduce((sum, r) => sum + r.matches.length, 0),
			});

			if (results.length === 0) {
				return `No matches found for query "${query}" in the searched files`;
			}

			return formatSearchResults(results);
		} catch (error) {
			logger.error(
				"TOOL",
				"grep_content failed",
				error instanceof Error ? error : new Error(String(error)),
				{ searchPath, query },
			);
			return `Error searching content: ${(error as Error).message}`;
		}
	},
	{
		name: "grep_content",
		description: `A powerful search tool built on ripgrep

Usage:
- ALWAYS use grep_content for search tasks.
- Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
- Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
- Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use \`interface{}\` to find \`interface{}\` in Go code)
`,
		schema: z.object({
			searchPath: z.string().describe("The directory path to search in"),
			query: z
				.string()
				.describe(
					"The search query - the text or pattern to look for in files",
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
					"Whether the search should be case-sensitive. Defaults to \`false\`",
				),
			regex: z
				.boolean()
				.optional()
				.default(false)
				.describe(
					"Whether the query should be treated as a regular expression. Defaults to \`false\`",
				),
			recursive: z
				.boolean()
				.optional()
				.default(true)
				.describe(
					"Whether to search recursively in subdirectories. Defaults to \`true\`",
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
					"Number of lines of context to show before each match. Defaults to 0",
				),
			contextAfter: z
				.number()
				.optional()
				.default(0)
				.describe(
					"Number of lines of context to show after each match. Defaults to 0",
				),
		}),
	},
);
