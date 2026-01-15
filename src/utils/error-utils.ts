import path from "node:path";

/**
 * Standardized error handling for Librarian tools.
 * Aligned with file-editor's professional and objective tone.
 */

export interface ToolErrorOptions {
	operation: string;
	path?: string;
	suggestion?: string;
	cause?: unknown;
}

/**
 * Formats a system error into a professional, actionable message.
 */
export function formatToolError(options: ToolErrorOptions): string {
	const { operation, path: targetPath, suggestion, cause } = options;
	
	let message = `${operation} failed`;
	if (targetPath) {
		message += `: ${targetPath}`;
	}

	if (cause && typeof cause === "object" && "code" in cause) {
		const code = (cause as { code: string }).code;
		
		switch (code) {
			case "ENOENT":
				message = `Path not found: ${targetPath || "unknown"}`;
				break;
			case "EACCES":
			case "EPERM":
				message = `Permission denied: ${targetPath || "unknown"}`;
				break;
			case "ENOTDIR":
				message = `Path is not a directory: ${targetPath || "unknown"}`;
				break;
			case "EISDIR":
				message = `Path is a directory, not a file: ${targetPath || "unknown"}`;
				break;
			default:
				if ("message" in cause) {
					message += `. ${cause.message}`;
				}
		}
	} else if (cause instanceof Error) {
		message += `. ${cause.message}`;
	}

	if (suggestion) {
		message += `\n\nSuggestion: ${suggestion}`;
	}

	return message;
}

/**
 * Creates a helpful suggestion based on common failure scenarios.
 */
export function getToolSuggestion(operation: string, targetPath?: string): string | undefined {
	if (operation === "view" && targetPath) {
		const ext = path.extname(targetPath).toLowerCase();
		if ([".png", ".jpg", ".pdf"].includes(ext)) {
			return "This file appears to be a binary or media file. Only text files can be read.";
		}
		return "Ensure the file path is correct and the file is a text file.";
	}
	
	if (operation === "list") {
		return "Check if the directory exists and you have permissions to read it.";
	}

	if (operation === "grep") {
		return "Try a simpler search pattern or verify the search path.";
	}

	if (operation === "find") {
		return "Check if the search path exists and the patterns are valid glob patterns.";
	}

	return undefined;
}
