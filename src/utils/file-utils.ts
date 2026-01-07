/**
 * File utility functions
 * Shared utilities for file type detection and file operations
 */

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
     const buffer = await Bun.file(filePath).arrayBuffer();
     const uint8Array = new Uint8Array(buffer);
     for (let i = 0; i < Math.min(512, uint8Array.length); i++) {
       if (uint8Array[i] === 0) return false;
     }
     return true;
   } catch {
     return false;
   }
}
