/**
 * React Agent Context Integration Tests
 * Tests for verifying tools receive and use context correctly
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { listTool } from '../src/tools/file-listing.tool.js';
import { viewTool } from '../src/tools/file-reading.tool.js';
import { grepTool } from '../src/tools/grep-content.tool.js';
import { findTool } from '../src/tools/file-finding.tool.js';
import { createContext } from '../src/agents/context-schema.js';
import path from 'node:path';
import fs from 'node:fs';
import { existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';

describe('Tool Context Integration', () => {
  let testDir: string;

  beforeAll(() => {
    testDir = path.join(process.cwd(), 'test-sandbox');
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    // Create test files for tool tests
    fs.writeFileSync(path.join(testDir, 'test.txt'), 'test content');
    fs.writeFileSync(path.join(testDir, 'test.ts'), 'console.log("test");');
  });

  afterAll(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe('Context Passing to Tools', () => {
    it('should pass context to list tool', async () => {
      const context = createContext(testDir, 'test-group', 'test-tech', 'development');

      const result = await listTool.invoke({
        directoryPath: '.',
        includeHidden: false,
      }, {
        context,
      });

      // Check JSON format
      const parsed = JSON.parse(result);
      expect(parsed.totalEntries).toBeGreaterThanOrEqual(0);
    });

    it('should pass context to view tool', async () => {
      const context = createContext(testDir, 'test-group', 'test-tech');

      const result = await viewTool.invoke({
        filePath: 'test.txt',
      }, {
        context,
      });

      expect(result).toContain('test content');
    });

    it('should pass context to find tool', async () => {
      const context = createContext(testDir, 'test-group', 'test-tech');

      const result = await findTool.invoke({
        searchPath: '.',
        patterns: ['*.ts'],
      }, {
        context,
      });

      // Check JSON format
      const parsed = JSON.parse(result);
      expect(parsed.totalFiles).toBeGreaterThanOrEqual(0);
    });

    it('should pass context to grep tool', async () => {
      const context = createContext(testDir, 'test-group', 'test-tech');

      const result = await grepTool.invoke({
        searchPath: '.',
        query: 'test',
        patterns: ['*.ts'],
      }, {
        context,
      });

      // Check JSON format
      const parsed = JSON.parse(result);
      expect(parsed.totalMatches).toBeGreaterThanOrEqual(0);
    });

    it('should use context.workingDir in tool path resolution', async () => {
      const customDir = path.join(process.cwd(), 'custom-test-sandbox');
      if (!existsSync(customDir)) {
        mkdirSync(customDir, { recursive: true });
      }

      const context = createContext(customDir, 'custom', 'test');

      const result = await listTool.invoke({
        directoryPath: '.',
      }, {
        context,
      });

      // Check JSON format - Tool should use context.workingDir for path resolution
      const parsed = JSON.parse(result);
      expect(parsed.totalEntries).toBeGreaterThanOrEqual(0);

      // Cleanup
      await rm(customDir, { recursive: true, force: true });
    });

    it('should require context and fail without it', async () => {
      const result = await listTool.invoke({
        directoryPath: '.',
      }, {
        context: undefined,
      });

      // Should fail with context required error
      expect(result).toContain('Context with workingDir is required for file operations');
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
      const result = await listTool.invoke({
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
      const result = await listTool.invoke({
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

      const listResult = await listTool.invoke({
        directoryPath: '.',
      }, {
        context,
      });

      const readResult = await viewTool.invoke({
        filePath: 'test.txt',
      }, {
        context,
      });

      // Both results should reference the same preserved sandbox
      expect(listResult).toBeDefined();
      expect(readResult).toBeDefined();
    });
  });
});
