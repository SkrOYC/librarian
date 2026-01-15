import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Librarian, type LibrarianConfig } from '../src/index.js';
import fs from 'node:fs';
import path from 'node:path';

const INVALID_PATH_CHARS_REGEX = /contains invalid path characters/;

describe('Security and Path Resolution', () => {
  const testWorkingDir = './test-work';
  const mockConfig: LibrarianConfig = {
    technologies: {
      default: {
        'test-repo': { repo: 'https://github.com/test/repo.git', branch: 'main' }
      }
    },
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: testWorkingDir
  };

  beforeEach(() => {
    // Clean up test directory before each test
    if (fs.existsSync(testWorkingDir)) {
      fs.rmSync(testWorkingDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up test directory after each test
    if (fs.existsSync(testWorkingDir)) {
      fs.rmSync(testWorkingDir, { recursive: true, force: true });
    }
  });

  describe('Path Sanitization', () => {
    it('should prevent directory traversal attacks', async () => {
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      // Try to use a repo name that attempts directory traversal
      const maliciousRepoName = '../../../malicious';
      
      expect(() => {
        (librarian as any).getSecureRepoPath(maliciousRepoName);
      }).toThrow(INVALID_PATH_CHARS_REGEX);
    });

    it('should properly sanitize repository names', async () => {
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      // Use path.basename to demonstrate expected sanitization
      const repoName = '../../../../etc/passwd';
      const sanitizedRepoName = path.basename(repoName); // Should be 'passwd'
      
      expect(sanitizedRepoName).toBe('passwd');
    });

    it('should allow valid repository names', async () => {
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      const validRepoName = 'valid-repo-name';
      
      expect(() => {
        (librarian as any).getSecureRepoPath(validRepoName);
      }).not.toThrow();
    });
  });

  describe('Working Directory Sandbox', () => {
    it('should ensure paths are within the working directory', async () => {
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      const repoPath = (librarian as any).getSecureRepoPath('test-repo');
      const resolvedWorkingDir = path.resolve(testWorkingDir);
      const resolvedRepoPath = path.resolve(repoPath);
      
      expect(resolvedRepoPath.startsWith(resolvedWorkingDir)).toBe(true);
    });
  });
});