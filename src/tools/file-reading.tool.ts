import { tool } from "langchain";
import * as z from "zod";
import fs from 'fs/promises';
import path from 'path';

// Check if file is an image file
function isImageFile(filePath: string): boolean {
  const imageExtensions = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tiff', '.tif'
  ]);
  const ext = path.extname(filePath).toLowerCase();
  return imageExtensions.has(ext);
}

// Check if file is an audio file
function isAudioFile(filePath: string): boolean {
  const audioExtensions = new Set([
    '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma', '.opus', '.webm'
  ]);
  const ext = path.extname(filePath).toLowerCase();
  return audioExtensions.has(ext);
}

// Check if file is text-based
async function isTextFile(filePath: string): Promise<boolean> {
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
  
  // For files without extensions or unknown extensions, try to detect if it's text
  try {
    const buffer = await fs.readFile(filePath, { encoding: 'binary', flag: 'r' });
      // Check first few bytes for null bytes which indicate binary content
      const bufferContent = Buffer.from(buffer);
      for (let i = 0; i < Math.min(512, bufferContent.length); i++) {
        if (bufferContent[i] === 0) return false; // Found null byte, likely binary
      }
    return true;
  } catch {
    return false;
  }
}

// Safe file read with encoding detection
async function readFileContent(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to read file: ${errorMessage}`);
  }
}

// Create the modernized tool using the tool() function
export const fileReadTool = tool(
  async ({ filePath }, config) => {
    try {
      // Get working directory from config context or default to process.cwd()
      const workingDir = config?.context?.workingDir || process.cwd();

      // Validate the path to prevent directory traversal
      if (filePath.includes('../') || filePath.includes('..\\') || filePath.startsWith('..')) {
        throw new Error(`File path "${filePath}" contains invalid path characters`);
      }

      const resolvedPath = path.resolve(workingDir, filePath);
      const resolvedWorkingDir = path.resolve(workingDir);

      if (!resolvedPath.startsWith(resolvedWorkingDir)) {
        throw new Error(`File path "${filePath}" attempts to escape the working directory sandbox`);
      }

      // Check if it's a media file
      if (isImageFile(resolvedPath) || isAudioFile(resolvedPath)) {
        return `This is a media file (${isImageFile(resolvedPath) ? 'image' : 'audio'}). Media files cannot be read as text. Path: ${filePath}`;
      }

      // Check if it's a text file
      const isText = await isTextFile(resolvedPath);
      if (!isText) {
        return `This file is not a text file and cannot be read as text. Path: ${filePath}`;
      }

      // Read file content
      const content = await readFileContent(resolvedPath);
      
      // Limit content size to avoid overwhelming the AI
      const maxContentLength = 50000; // 50KB limit
      if (content.length > maxContentLength) {
        return `File content is too large (${content.length} characters). First ${maxContentLength} characters:\n\n${content.substring(0, maxContentLength)}\n\n[Content truncated due to length]`;
      }

      return `Content of file: ${filePath}\n\n${content}`;
    } catch (error) {
      return `Error reading file: ${(error as Error).message}`;
    }
  },
  {
    name: "file_read",
    description: "Read the contents of a file. Use this to examine the content of a specific file.",
    schema: z.object({
      filePath: z.string().describe("The path to the file to read, relative to the working directory"),
    }),
  }
);