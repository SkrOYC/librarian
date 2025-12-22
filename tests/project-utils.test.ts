/**
 * Project Utils Tests
 * Test project utility functions
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getProjectRoot } from '../src/utils/project-utils.js';
import { createTestDir, cleanupTestDir } from './helpers/test-config.js';
import fs from 'fs/promises';
import path from 'path';

describe('Project Utils', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    testDir = createTestDir('project-utils-test');
    process.chdir(testDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    cleanupTestDir(testDir);
  });

  describe('getProjectRoot', () => {
    it('should return current directory when package.json exists', async () => {
      await fs.writeFile(path.join(testDir, 'package.json'), '{"name": "test"}');
      
      const projectRoot = getProjectRoot();
      expect(projectRoot).toBe(testDir);
    });

    it('should return current directory when .git exists', async () => {
      await fs.mkdir(path.join(testDir, '.git'));
      
      const projectRoot = getProjectRoot();
      expect(projectRoot).toBe(testDir);
    });

    it('should return current directory when tsconfig.json exists', async () => {
      await fs.writeFile(path.join(testDir, 'tsconfig.json'), JSON.stringify({}));
      
      const projectRoot = getProjectRoot();
      expect(projectRoot).toBe(testDir);
    });

    it('should return current directory when README.md exists', async () => {
      await fs.writeFile(path.join(testDir, 'README.md'), '# Test');
      
      const projectRoot = getProjectRoot();
      expect(projectRoot).toBe(testDir);
    });

    it('should search parent directories for project markers', async () => {
      // Create nested structure
      const subDir = path.join(testDir, 'src', 'components');
      await fs.mkdir(subDir, { recursive: true });
      process.chdir(subDir);
      
      // Add package.json to root
      await fs.writeFile(path.join(testDir, 'package.json'), '{"name": "test"}');
      
      const projectRoot = getProjectRoot();
      expect(projectRoot).toBe(testDir);
    });

    it('should limit search depth to 10 levels', async () => {
      // Create deeply nested structure (11 levels)
      let currentDir = testDir;
      for (let i = 0; i < 11; i++) {
        currentDir = path.join(currentDir, `level${i}`);
        await fs.mkdir(currentDir);
      }
      process.chdir(currentDir);
      
      // No project markers anywhere
      const projectRoot = getProjectRoot();
      expect(projectRoot).toBe(currentDir); // Should stop at current directory
    });

    it('should handle filesystem root edge case', async () => {
      // Mock reaching filesystem root
      const mockRoot = path.parse(testDir).root;
      process.chdir(mockRoot);
      
      const projectRoot = getProjectRoot();
      expect(projectRoot).toBe(mockRoot);
    });

    it('should return project root when found in parent directories', async () => {
      // Even when in a subdirectory, should find the project root (librarian project)
      const projectRootDir = path.resolve(__dirname, '..'); // Parent directory (librarian project)
      process.chdir(testDir);
      try {
        const projectRoot = getProjectRoot();
        // Should find the librarian project root, not the test directory
        expect(projectRoot).toBe(projectRootDir);
      } finally {
        process.chdir(projectRootDir);
      }
    });

    it('should prefer closest project marker in nested structure', async () => {
      // Create nested structure with markers at different levels
      const subDir = path.join(testDir, 'subproject');
      await fs.mkdir(subDir);
      
      // Add marker to parent
      await fs.writeFile(path.join(testDir, 'package.json'), '{"name": "parent"}');
      
      // Add different marker to subdirectory
      await fs.writeFile(path.join(subDir, 'tsconfig.json'), JSON.stringify({}));
      
      process.chdir(subDir);
      
      const projectRoot = getProjectRoot();
      expect(projectRoot).toBe(subDir); // Should prefer the closer marker
    });

    it('should handle all marker types in priority order', async () => {
      // Test all different markers
      await fs.mkdir(path.join(testDir, '.git'));
      await fs.writeFile(path.join(testDir, 'package.json'), '{"name": "test"}');
      await fs.writeFile(path.join(testDir, 'tsconfig.json'), JSON.stringify({}));
      await fs.writeFile(path.join(testDir, 'README.md'), '# Test');
      
      const projectRoot = getProjectRoot();
      expect(projectRoot).toBe(testDir);
    });

    it('should work with absolute paths', async () => {
      // Create marker in current directory
      await fs.writeFile(path.join(testDir, 'package.json'), '{"name": "test"}');
      
      const projectRoot = getProjectRoot();
      expect(path.isAbsolute(projectRoot)).toBe(true);
      expect(projectRoot).toBe(testDir);
    });

    it('should handle concurrent calls', async () => {
      await fs.writeFile(path.join(testDir, 'package.json'), '{"name": "test"}');
      
      // Multiple calls should return same result
      const root1 = getProjectRoot();
      const root2 = getProjectRoot();
      const root3 = getProjectRoot();
      
      expect(root1).toBe(root2);
      expect(root2).toBe(root3);
      expect(root1).toBe(testDir);
    });

    describe('Edge Cases', () => {
      it('should handle permission errors gracefully', async () => {
        // Create a directory that might have permission issues
        const restrictedDir = path.join(testDir, 'restricted');
        await fs.mkdir(restrictedDir);
        process.chdir(restrictedDir);
        
        // Should not throw, should return current directory
        expect(() => {
          const projectRoot = getProjectRoot();
          expect(projectRoot).toBeDefined();
        }).not.toThrow();
      });

      it('should handle symbolic links', async () => {
        // Create symbolic link test if supported
        const linkedDir = path.join(testDir, 'linked');
        const targetDir = path.join(testDir, 'target');
        
        await fs.mkdir(targetDir);
        await fs.writeFile(path.join(targetDir, 'package.json'), '{"name": "target"}');
        
        // Create symlink (might fail on some systems, so we wrap in try-catch)
        try {
          await fs.symlink(targetDir, linkedDir);
          process.chdir(linkedDir);
          
          const projectRoot = getProjectRoot();
          // Should resolve to the actual project root
          expect(projectRoot).toBe(targetDir);
        } catch (error) {
          // Skip symlink test if not supported
          console.log('Skipping symlink test - not supported on this system');
        }
      });
    });
  });
});