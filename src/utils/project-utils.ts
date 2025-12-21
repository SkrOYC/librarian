import path from 'path';

/**
 * Get the project root directory
 * This function tries to find the project root by looking for common project markers
 * like package.json, .git directory, etc.
 */
export function getProjectRoot(): string {
  let currentDir = process.cwd();
  
  // Limit search depth to prevent infinite loops
  for (let i = 0; i < 10; i++) {
    // Check for common project root markers
    if (
      require('fs').existsSync(path.join(currentDir, 'package.json')) ||
      require('fs').existsSync(path.join(currentDir, '.git')) ||
      require('fs').existsSync(path.join(currentDir, 'tsconfig.json')) ||
      require('fs').existsSync(path.join(currentDir, 'README.md'))
    ) {
      return currentDir;
    }
    
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached the root of the filesystem
      break;
    }
    currentDir = parentDir;
  }
  
  // If no project root found, return the current working directory
  return process.cwd();
}