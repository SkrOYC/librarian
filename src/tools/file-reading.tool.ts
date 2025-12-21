import { Tool } from "@langchain/core/tools";
import fs from 'fs/promises';
import path from 'path';

// Define types for file system operations
interface FileSystemEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number | undefined;
  modified?: Date | undefined;
  permissions?: string | undefined;
  lineCount?: number | undefined;
}

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
      // Check the first few bytes for null bytes which indicate binary content
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

// Define the tool using LangChain's Tool class
export class FileReadTool extends Tool {
  name = "file_read";
  description = "Read the contents of a file. Use this to examine the content of a specific file.";

  constructor() {
    super();
  }

  async _call(input: string): Promise<string> {
    try {
      // Parse the input JSON string
      const parsedInput = JSON.parse(input);
      const { filePath } = parsedInput;

      // Validate the path to prevent directory traversal
      if (filePath.includes('../') || filePath.includes('..\\') || filePath.startsWith('..')) {
        throw new Error(`File path "${filePath}" contains invalid path characters`);
      }

      const resolvedPath = path.resolve(filePath);
      const workingDir = process.cwd(); // In a real implementation, this would be from config
      const resolvedWorkingDir = path.resolve(workingDir);

      if (!resolvedPath.startsWith(resolvedWorkingDir)) {
        throw new Error(`File path "${filePath}" attempts to escape the working directory sandbox`);
      }

      // Check if it's a media file
      if (isImageFile(resolvedPath) || isAudioFile(resolvedPath)) {
        return `This is a media file (${isImageFile(resolvedPath) ? 'image' : 'audio'}). Media files cannot be read as text. Path: ${resolvedPath}`;
      }

      // Check if it's a text file
      const isText = await isTextFile(resolvedPath);
      if (!isText) {
        return `This file is not a text file and cannot be read as text. Path: ${resolvedPath}`;
      }

      // Read the file content
      const content = await readFileContent(resolvedPath);
      
      // Limit the content size to avoid overwhelming the AI
      const maxContentLength = 50000; // 50KB limit
      if (content.length > maxContentLength) {
        return `File content is too large (${content.length} characters). First ${maxContentLength} characters:\n\n${content.substring(0, maxContentLength)}\n\n[Content truncated due to length]`;
      }

      return `Content of file: ${resolvedPath}\n\n${content}`;
    } catch (error) {
      return `Error reading file: ${(error as Error).message}`;
    }
  }
}