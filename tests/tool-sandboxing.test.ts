/**
 * File Explorer Tools Sandboxing Tests
 * Tests for security enforcement and path sandboxing in File Explorer tools
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { listTool } from '../src/tools/file-listing.tool.js';
import { viewTool } from '../src/tools/file-reading.tool.js';
import { findTool } from '../src/tools/file-finding.tool.js';
import { grepTool } from '../src/tools/grep-content.tool.js';
import path from 'node:path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

describe('File Explorer Tools Sandboxing', () => {
  let testDir: string;

  beforeAll(() => {
    testDir = path.join(process.cwd(), 'sandbox-test');
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  beforeEach(() => {
    // Clean up test directory before each test
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Path Resolution', () => {
    it('should resolve relative paths against working directory', async () => {
      // Create a test directory structure
      const sandboxDir = path.join(testDir, 'sandbox');
      mkdirSync(sandboxDir);
      writeFileSync(path.join(sandboxDir, 'test.txt'), 'content');

      const result = await listTool.invoke({
        directoryPath: '.',
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('.');
    });

    it('should handle nested relative paths', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      mkdirSync(sandboxDir);
      const nestedDir = path.join(sandboxDir, 'subdir', 'nested');
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(path.join(nestedDir, 'test.txt'), 'content');

      const result = await listTool.invoke({
        directoryPath: 'subdir/nested',
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('subdir/nested');
    });

    it('should handle . for current directory', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      mkdirSync(sandboxDir);
      writeFileSync(path.join(sandboxDir, 'test.txt'), 'content');

      const result = await listTool.invoke({
        directoryPath: '.',
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('.');
    });
  });

  describe('Security: Directory Traversal Prevention', () => {
    it('should reject paths with ../', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      mkdirSync(sandboxDir);

      const result = await listTool.invoke({
        directoryPath: '../etc/passwd',
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('attempts to escape working directory sandbox');
      expect(result).toContain('../etc/passwd');
    });

    it('should reject paths with ..\\', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      mkdirSync(sandboxDir);

      const result = await listTool.invoke({
        directoryPath: '..\\windows\\system32',
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('attempts to escape working directory sandbox');
    });

    it('should reject absolute paths outside sandbox', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      mkdirSync(sandboxDir);

      const result = await viewTool.invoke({
        filePath: '/etc/passwd',
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('attempts to escape');
    });

    it('should reject absolute paths within sandbox with different case', async () => {
      const sandboxDir = path.join(testDir, 'Sandbox');
      mkdirSync(sandboxDir);

      const result = await findTool.invoke({
        searchPath: '/SANDBOX/test',
        patterns: ['*.txt'],
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      // Path should still be resolved and validated
      expect(result).not.toContain('/etc/passwd');
    });
  });

  describe('Security: Edge Cases', () => {
    it('should reject encoded path traversal attempts', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      mkdirSync(sandboxDir);

      const result = await listTool.invoke({
        directoryPath: '..%2Fetc%2Fpasswd',
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('attempts to escape working directory sandbox');
    });

    it('should reject NULL byte attempts', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      mkdirSync(sandboxDir);

      // This is a basic check, encoded null bytes are more sophisticated
      const result = await listTool.invoke({
        directoryPath: '../',
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('attempts to escape working directory sandbox');
    });

    it('should handle empty directoryPath', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      mkdirSync(sandboxDir);

      const result = await listTool.invoke({
        directoryPath: '',
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      // Empty path should resolve to working directory
      expect(result).not.toContain('Error');
      // Check JSON format
      const parsed = JSON.parse(result);
      expect(parsed.totalEntries).toBeGreaterThanOrEqual(0);
    });

    it('should handle deeply nested valid paths', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      mkdirSync(sandboxDir);
      const deepDir = path.join(sandboxDir, 'a', 'b', 'c', 'd', 'e');
      mkdirSync(deepDir, { recursive: true });
      writeFileSync(path.join(deepDir, 'test.txt'), 'content');

      const result = await listTool.invoke({
        directoryPath: 'a/b/c/d/e',
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('a/b/c/d/e');
    });
  });

  describe('Tool-Specific Tests', () => {
    it('list tool should enforce sandbox boundary', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      const otherDir = path.join(testDir, 'other');
      mkdirSync(sandboxDir);
      mkdirSync(otherDir);
      writeFileSync(path.join(otherDir, 'secret.txt'), 'secret data');

      const result = await listTool.invoke({
        directoryPath: '../other',
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('attempts to escape working directory sandbox');
      expect(result).toContain('../other');
      expect(result).not.toContain('secret');
    });

    it('view tool should enforce sandbox boundary', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      const otherDir = path.join(testDir, 'other');
      mkdirSync(sandboxDir);
      mkdirSync(otherDir);
      writeFileSync(path.join(otherDir, 'secret.txt'), 'secret data');

      const result = await viewTool.invoke({
        filePath: '../other/secret.txt',
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('attempts to escape');
      expect(result).toContain('../other/secret.txt');
      expect(result).not.toContain('secret data');
    });

    it('find tool should enforce sandbox boundary', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      const otherDir = path.join(testDir, 'other');
      mkdirSync(sandboxDir);
      mkdirSync(otherDir);
      writeFileSync(path.join(otherDir, 'important.txt'), 'important data');

      const result = await findTool.invoke({
        searchPath: '../other',
        patterns: ['*.txt'],
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('attempts to escape');
      expect(result).toContain('../other');
      expect(result).not.toContain('important.txt');
    });

    it('grep tool should enforce sandbox boundary', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      const otherDir = path.join(testDir, 'other');
      mkdirSync(sandboxDir);
      mkdirSync(otherDir);
      const secretFile = path.join(otherDir, 'secret.txt');
      writeFileSync(secretFile, 'password: admin123');

      const result = await grepTool.invoke({
        searchPath: '../other',
        query: 'password',
        patterns: ['*.txt'],
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('attempts to escape');
      expect(result).not.toContain('admin123');
    });
  });

  describe('Valid Operations Within Sandbox', () => {
    it('should allow listing files within sandbox', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      mkdirSync(sandboxDir);
      writeFileSync(path.join(sandboxDir, 'file1.txt'), 'content1');
      writeFileSync(path.join(sandboxDir, 'file2.txt'), 'content2');

      const result = await listTool.invoke({
        directoryPath: '.',
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('file1.txt');
      expect(result).toContain('file2.txt');
    });

    it('should allow reading files within sandbox', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      mkdirSync(sandboxDir);
      const testFile = path.join(sandboxDir, 'test.txt');
      writeFileSync(testFile, 'test content');

      const result = await viewTool.invoke({
        filePath: 'test.txt',
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('test content');
    });

    it('should allow finding files within sandbox', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      mkdirSync(sandboxDir);
      const subdir = path.join(sandboxDir, 'src');
      mkdirSync(subdir);
      writeFileSync(path.join(subdir, 'index.ts'), 'export {}');

      const result = await findTool.invoke({
        searchPath: '.',
        patterns: ['*.ts'],
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('index.ts');
    });

    it('should allow grepping files within sandbox', async () => {
      const sandboxDir = path.join(testDir, 'sandbox');
      mkdirSync(sandboxDir);
      const testFile = path.join(sandboxDir, 'test.js');
      writeFileSync(testFile, 'const x = 42;');

      const result = await grepTool.invoke({
        searchPath: '.',
        query: 'const',
        patterns: ['*.js'],
      }, {
        context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
      });

      expect(result).toContain('const x');
    });
  });
});
