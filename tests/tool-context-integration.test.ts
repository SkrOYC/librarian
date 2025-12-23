/**
 * React Agent Context Integration Tests
 * Tests for verifying tools receive and use context correctly
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { fileListTool } from '../src/tools/file-listing.tool.js';
import { fileReadTool } from '../src/tools/file-reading.tool.js';
import { grepContentTool } from '../src/tools/grep-content.tool.js';
import { fileFindTool } from '../src/tools/file-finding.tool.js';
import { createContext } from '../src/agents/context-schema.js';
import path from 'path';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { rm } from 'fs/promises';

describe('Tool Context Integration', () => {
  let testDir: string;

  beforeAll(() => {
    testDir = path.join(process.cwd(), 'test-sandbox');
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe('Context Passing to Tools', () => {
    it('should pass context to file_list tool', async () => {
      const context = createContext('/sandbox/test', 'test-group', 'test-tech', 'development');

      const result = await fileListTool.invoke({
        directoryPath: '.',
        includeHidden: false,
      }, {
        context,
      });

      expect(result).toContain('Contents of directory');
      expect(result).toContain('/sandbox/test');
    });

    it('should pass context to file_read tool', async () => {
      const context = createContext('/sandbox/test', 'test-group', 'test-tech');

      const result = await fileReadTool.invoke({
        filePath: 'test.txt',
      }, {
        context,
      });

      expect(result).toContain('test.txt');
      expect(result).toContain('/sandbox/test');
    });

    it('should pass context to file_find tool', async () => {
      const context = createContext('/sandbox/test', 'test-group', 'test-tech');

      const result = await fileFindTool.invoke({
        searchPath: '.',
        patterns: ['*.ts'],
      }, {
        context,
      });

      expect(result).toContain('Found');
    });

    it('should pass context to grep_content tool', async () => {
      const context = createContext('/sandbox/test', 'test-group', 'test-tech');

      const result = await grepContentTool.invoke({
        searchPath: '.',
        query: 'test',
        patterns: ['*.ts'],
      }, {
        context,
      });

      expect(result === 'test.ts' || result === 'No matches').toBe(true);
    });

    it('should use context.workingDir in tool path resolution', async () => {
      const context = createContext('/custom/sandbox', 'custom', 'test');

      const result = await fileListTool.invoke({
        directoryPath: '.',
      }, {
        context,
      });

      // Tool should use context.workingDir for path resolution
      expect(result).toContain('/custom/sandbox');
    });

    it('should work without context (backward compatibility)', async () => {
      const result = await fileListTool.invoke({
        directoryPath: '.',
      }, {
        context: undefined,
      });

      expect(result).toBeDefined();
      expect(result).toContain(process.cwd().replace(process.env.HOME || '', '~'));
    });
  });

  describe('Context Object Structure', () => {
    it('should accept all required context fields', () => {
      const context = createContext('/sandbox', 'test', 'react');

      expect(context.workingDir).toBe('/sandbox');
      expect(context.group).toBe('test');
      expect(context.technology).toBe('react');
    });

    it('should accept optional environment field', () => {
      const context = createContext('/sandbox', 'test', 'react', 'production');

      expect(context.workingDir).toBe('/sandbox');
      expect(context.group).toBe('test');
      expect(context.technology).toBe('react');
      expect(context.environment).toBe('production');
    });

    it('should allow omitting optional fields', () => {
      const context = createContext('/sandbox', 'test', 'react');

      expect(context.workingDir).toBe('/sandbox');
      expect(context.group).toBe('test');
      expect(context.technology).toBe('react');
      expect(context.environment).toBeUndefined();
    });
  });

  describe('Context Validation', () => {
    it('should not throw for valid context structure', async () => {
      const validContext = createContext('/valid/sandbox', 'test', 'react');

      // Should not throw for valid context
      const result = await fileListTool.invoke({
        directoryPath: '.',
      }, {
        context: validContext,
      });

      expect(result).toBeDefined();
    });
  });

  describe('Sandboxing Behavior', () => {
    it('should handle path traversal gracefully', async () => {
      const context = createContext('/restricted/sandbox', 'test', 'tech');

      // Try to access files outside sandbox
      const result = await fileListTool.invoke({
        directoryPath: '..',
      }, {
        context,
      });

      // Tool should handle this gracefully (not crash)
      expect(result).toBeDefined();
      // The result should not contain paths outside sandbox
      expect(result).not.toContain('../');
      expect(result).not.toContain(process.cwd());
    });

    it('should preserve context across tool calls', async () => {
      const context = createContext('/preserved/sandbox', 'preserved', 'preserved');

      const listResult = await fileListTool.invoke({
        directoryPath: '.',
      }, {
        context,
      });

      const readResult = await fileReadTool.invoke({
        filePath: 'test.txt',
      }, {
        context,
      });

      // Both results should reference the same preserved sandbox
      expect(listResult).toContain('/preserved/sandbox');
      expect(readResult).toContain('/preserved/sandbox');
    });
  });
});
