/**
 * Path utility functions
 * Shared utilities for path manipulation
 */

import path from 'path';
import os from 'os';

/**
 * Expand tilde (~) in file paths to home directory
 */
export function expandTilde(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}
