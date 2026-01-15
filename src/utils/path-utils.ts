/**
 * Path utility functions
 * Shared utilities for path manipulation
 */

import os from "node:os";
import path from "node:path";

/**
 * Expand tilde (~) in file paths to home directory
 */
export function expandTilde(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}
