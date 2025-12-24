/**
 * File utility functions
 * Shared utilities for file type detection and file operations
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Check if a file is text-based
 * Uses extension detection and binary content detection
 */
export async function isTextFile(filePath: string): Promise<boolean> {
  const textExtensions = new Set([
    '.txt', '.js', '.ts', '.jsx', '.tsx', '.json', '.yaml', '.yml', '.md',
    '.html', '.htm', '.css', '.scss', '.sass', '.less', '.py', '.rb', '.java',
    '.cpp', '.c', '.h', '.hpp', '.go', '.rs', '.php', '.sql', '.xml', '.csv',
    '.toml', '.lock', '.sh', '.bash', '.zsh', '.env', '.dockerfile', 'dockerfile',
    '.gitignore', '.npmrc', '.prettierrc', '.eslintrc', '.editorconfig', '.jsonc'
  ]);

  const ext = path.extname(filePath).toLowerCase();
  if (textExtensions.has(ext)) {
    return true;
  }

  // For files without extensions or unknown extensions, check for null bytes
  try {
    const buffer = await fs.readFile(filePath);
    for (let i = 0; i < Math.min(512, buffer.length); i++) {
      if (buffer[i] === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}
