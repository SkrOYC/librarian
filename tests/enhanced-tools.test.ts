import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { viewTool } from '../src/tools/file-reading.tool.js';
import { listTool } from '../src/tools/file-listing.tool.js';
import { grepTool } from '../src/tools/grep-content.tool.js';

describe('New Tooling Features', () => {
  const testDir = path.join(process.cwd(), 'test-new-features');
  const testContext = { workingDir: testDir, group: 'test', technology: 'test' };

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
    
    // Create a multi-line file for reading and grepping
    fs.writeFileSync(path.join(testDir, 'multiline.txt'), 
      'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10'
    );

    // Create a nested structure for listing
    fs.mkdirSync(path.join(testDir, 'subdir'));
    fs.writeFileSync(path.join(testDir, 'subdir', 'nested.txt'), 'Nested content');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('view viewRange', () => {
    it('should read only the specified line range', async () => {
      const result = await viewTool.invoke({
        filePath: 'multiline.txt',
        viewRange: [3, 5]
      }, { context: testContext });

      // Check JSON format
      const parsed = JSON.parse(result);
      expect(parsed.lines.map((l: any) => l.lineNumber)).toEqual([3, 4, 5]);
      expect(parsed.lines.map((l: any) => l.content)).toEqual(['Line 3', 'Line 4', 'Line 5']);
    });

    it('should handle -1 as end of file', async () => {
      const result = await viewTool.invoke({
        filePath: 'multiline.txt',
        viewRange: [8, -1]
      }, { context: testContext });

      // Check JSON format
      const parsed = JSON.parse(result);
      expect(parsed.lines.map((l: any) => l.lineNumber)).toEqual([8, 9, 10]);
      expect(parsed.lines.map((l: any) => l.content)).toEqual(['Line 8', 'Line 9', 'Line 10']);
    });
  });

  describe('list recursive', () => {
    it('should list files recursively up to maxDepth with indentation', async () => {
      const result = await listTool.invoke({
        directoryPath: '.',
        recursive: true,
        maxDepth: 2
      }, { context: testContext });

      // Check JSON format
      const parsed = JSON.parse(result);
      const entryNames = parsed.entries.map((e: any) => e.name);
      expect(entryNames).toContain('subdir');
      expect(entryNames).toContain('multiline.txt');
      expect(entryNames).toContain('nested.txt');
    });

    it('should not recurse beyond maxDepth', async () => {
      const result = await listTool.invoke({
        directoryPath: '.',
        recursive: true,
        maxDepth: 1
      }, { context: testContext });

      // Check JSON format
      const parsed = JSON.parse(result);
      const entryNames = parsed.entries.map((e: any) => e.name);
      expect(entryNames).toContain('subdir');
      expect(entryNames).not.toContain('nested.txt');
    });
  });

  describe('grep context', () => {
    it('should include context lines around matches', async () => {
      const result = await grepTool.invoke({
        searchPath: '.',
        query: 'Line 5',
        contextBefore: 1,
        contextAfter: 1
      }, { context: testContext });

      // Check JSON format
      const parsed = JSON.parse(result);
      const match = parsed.results[0].matches[0];
      expect(match.line).toBe(5);
      expect(match.contextBefore).toContain('Line 4');
      expect(match.contextAfter).toContain('Line 6');
      expect(parsed.results[0].path).toContain('multiline.txt');
    });
  });
});
