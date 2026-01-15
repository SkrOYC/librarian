import { tool } from "langchain";
import { z } from "zod";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Glob } from "bun";
import { logger } from "../utils/logger.js";
import { isTextFile } from "../utils/file-utils.js";
import { formatSearchResults, type SearchMatch } from "../utils/format-utils.js";

/**
 * Searches for content in a single file using a streaming approach.
 * This is memory-efficient for large files as it avoids loading the entire file.
 */
async function searchFileContentStreaming(
	filePath: string,
	regex: RegExp,
	contextBefore = 0,
	contextAfter = 0,
	maxMatches: number,
): Promise<SearchMatch[]> {
	const file = Bun.file(filePath);
	const stream = file.stream();
	const reader = stream.getReader();
	const decoder = new TextDecoder();

	const matches: SearchMatch[] = [];
	const allLines: string[] = []; // We still need some lines for context, but we keep it reasonable
	let currentLineIdx = 0;
	let partialLine = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				if (partialLine) {
					allLines.push(partialLine);
					processLine(partialLine, currentLineIdx, matches, allLines, regex, contextBefore, contextAfter);
				}
				break;
			}

			const chunk = decoder.decode(value, { stream: true });
			const chunkLines = (partialLine + chunk).split("\n");
			partialLine = chunkLines.pop() || "";

			for (const line of chunkLines) {
				allLines.push(line);
				processLine(line, currentLineIdx, matches, allLines, regex, contextBefore, contextAfter);
				currentLineIdx++;

				if (matches.length >= maxMatches) {
					await reader.cancel();
					return matches;
				}
			}
		}
	} finally {
		reader.releaseLock();
	}

	return matches;
}

function processLine(
	line: string,
	lineIdx: number,
	matches: SearchMatch[],
	allLines: string[],
	regex: RegExp,
	contextBefore: number,
	contextAfter: number,
): void {
	regex.lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = regex.exec(line)) !== null) {
		const searchMatch: SearchMatch = {
			line: lineIdx + 1,
			column: match.index + 1,
			text: line,
		};

		if (contextBefore > 0 || contextAfter > 0) {
			// Extract context. Note: after context might not be available yet if we're streaming.
			// But since we want to return results file-by-file, we'll need to handle after context.
			// Actually, the previous implementation also had this "future" context issue if it was truly streaming.
			// However, for grep we typically want the full context. 
			// Let's refine the streaming logic: collect lines, detect matches, then extract context once we have enough lines.
		}

		matches.push(searchMatch);
		if (!regex.global) break;
	}
}

/**
 * Robust non-streaming search for context-aware grep.
 * While streaming is good for huge files, contextAfter requires looking ahead or buffering.
 * Since Librarian typically works on source code files (KB to low MBs), loading the file into memory
 * but processing it efficiently is a balanced trade-off for accurate context.
 */
async function searchFileWithContext(
	filePath: string,
	regex: RegExp,
	contextBefore = 0,
	contextAfter = 0,
): Promise<SearchMatch[]> {
	const content = await Bun.file(filePath).text();
	const lines = content.split("\n");
	const matches: SearchMatch[] = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		regex.lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = regex.exec(line)) !== null) {
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
			if (!regex.global) break;
		}
	}

	return matches;
}

// Find files matching a pattern in a directory using Bun.Glob
async function findFilesToSearch(
	dirPath: string,
	patterns: string[],
	recursive: boolean,
	includeHidden: boolean,
): Promise<string[]> {
	const foundFiles: string[] = [];
	for (const pattern of patterns) {
		const effectivePattern = recursive && !pattern.includes("/") && !pattern.includes("**")
			? `**/${pattern}`
			: pattern;
		
		const glob = new Glob(effectivePattern);
		for await (const file of glob.scan({
			cwd: dirPath,
			onlyFiles: true,
			dot: includeHidden,
		})) {
			const fullPath = path.resolve(dirPath, file);
			if (!foundFiles.includes(fullPath)) {
				foundFiles.push(fullPath);
			}
		}
	}
	return foundFiles;
}

function compileSearchRegex(
	query: string,
	regex: boolean,
	caseSensitive: boolean,
): RegExp {
	const flags = caseSensitive ? "g" : "gi";

	if (regex) {
		try {
			return new RegExp(query, flags);
		} catch (e) {
			throw new Error(`Invalid regex pattern: ${(e as Error).message}`);
		}
	}

	const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(escapedQuery, flags);
}

// Create the modernized tool using the tool() function
export const grepTool = tool(
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
		const timingId = logger.timingStart("grep");

		logger.info("TOOL", "grep called", {
			searchPath,
			query,
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

			if (!query) {
				throw new Error('The "query" parameter is required');
			}

			// Validate path
			const resolvedPath = path.resolve(workingDir, searchPath);
			const resolvedWorkingDir = path.resolve(workingDir);
			const relativePath = path.relative(resolvedWorkingDir, resolvedPath);

			if (relativePath.startsWith("..")) {
				throw new Error(
					`Search path "${searchPath}" attempts to escape the working directory sandbox`,
				);
			}

			const stats = await stat(resolvedPath);
			if (!stats.isDirectory()) {
				throw new Error(`Search path "${searchPath}" is not a directory`);
			}

			const filesToSearch = await findFilesToSearch(
				resolvedPath,
				patterns,
				recursive,
				false, // includeHidden
			);

			const searchRegex = compileSearchRegex(query, regex, caseSensitive);
			const results: Array<{ path: string; matches: SearchMatch[] }> = [];
			let totalMatches = 0;

			for (const file of filesToSearch) {
				if (totalMatches >= maxResults) break;

				if (await isTextFile(file)) {
					try {
						const fileMatches = await searchFileWithContext(
							file,
							searchRegex,
							contextBefore,
							contextAfter,
						);

						if (fileMatches.length > 0) {
							const remainingSlot = maxResults - totalMatches;
							const limitedMatches = fileMatches.slice(0, remainingSlot);
							
							results.push({ 
								path: path.relative(workingDir, file), 
								matches: limitedMatches 
							});
							totalMatches += limitedMatches.length;
						}
					} catch {
						// Silent fail for unreadable files
					}
				}
			}

			logger.timingEnd(timingId, "TOOL", "grep completed");

			if (results.length === 0) {
				return `No matches found for query "${query}" in the searched files`;
			}

			return formatSearchResults(results);
		} catch (error) {
			logger.error(
				"TOOL",
				"grep failed",
				error instanceof Error ? error : new Error(String(error)),
				{ searchPath, query },
			);
			return `Error searching content: ${(error as Error).message}`;
		}
	},
	{
		name: "grep",
		description: `A powerful search tool built on ripgrep

Usage:
- ALWAYS use grep for search tasks.
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
					"Whether the search should be case-sensitive. Defaults to `false`",
				),
			regex: z
				.boolean()
				.optional()
				.default(false)
				.describe(
					"Whether the query should be treated as a regular expression. Defaults to `false`",
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
