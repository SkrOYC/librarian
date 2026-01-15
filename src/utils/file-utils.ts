/**
 * File utility functions
 * Shared utilities for file type detection and file operations
 */

import path from "node:path";

/**
 * Check if a file is text-based
 * Uses extension detection and binary content detection
 */
export async function isTextFile(filePath: string): Promise<boolean> {
	const textExtensions = new Set([
		".txt",
		".js",
		".ts",
		".jsx",
		".tsx",
		".json",
		".yaml",
		".yml",
		".md",
		".html",
		".htm",
		".css",
		".scss",
		".sass",
		".less",
		".py",
		".rb",
		".java",
		".cpp",
		".c",
		".h",
		".hpp",
		".go",
		".rs",
		".php",
		".sql",
		".xml",
		".csv",
		".toml",
		".lock",
		".sh",
		".bash",
		".zsh",
		".env",
		".dockerfile",
		"dockerfile",
		".gitignore",
		".npmrc",
		".prettierrc",
		".eslintrc",
		".editorconfig",
		".jsonc",
	]);

	const ext = path.extname(filePath).toLowerCase();
	if (textExtensions.has(ext)) {
		return true;
	}

	// For files without extensions or unknown extensions, check for null bytes
	try {
		const file = Bun.file(filePath);
		if (file.size === 0) return true;

		// Read only the first 512 bytes for binary check
		const buffer = await file.slice(0, 512).arrayBuffer();
		const uint8Array = new Uint8Array(buffer);
		for (let i = 0; i < uint8Array.length; i++) {
			if (uint8Array[i] === 0) {
				return false;
			}
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Counts the number of lines in a file using a memory-efficient streaming approach.
 * Handles empty files and trailing newlines correctly.
 */
export async function getFileLineCount(filePath: string): Promise<number> {
	try {
		const file = Bun.file(filePath);
		if (file.size === 0) return 0;

		const stream = file.stream();
		const reader = stream.getReader();
		let count = 0;
		let lastByte = -1;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			for (let i = 0; i < value.length; i++) {
				lastByte = value[i];
				if (lastByte === 10) {
					// '\n'
					count++;
				}
			}
		}

		// If the file doesn't end with a newline, count the last line
		if (lastByte !== 10 && lastByte !== -1) {
			count++;
		}

		return count;
	} catch {
		return 0;
	}
}
