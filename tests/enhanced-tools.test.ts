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

      expect(result).toContain('3→Line 3');
      expect(result).toContain('4→Line 4');
      expect(result).toContain('5→Line 5');
      expect(result).not.toContain('2→Line 2');
      expect(result).not.toContain('6→Line 6');
      // Verify NO header
      expect(result).not.toContain('Content of file');
    });

    it('should handle -1 as end of file', async () => {
      const result = await viewTool.invoke({
        filePath: 'multiline.txt',
        viewRange: [8, -1]
      }, { context: testContext });

      expect(result).toContain('8→Line 8');
      expect(result).toContain('9→Line 9');
      expect(result).toContain('10→Line 10');
    });
  });

  describe('list recursive', () => {
    it('should list files recursively up to maxDepth with indentation', async () => {
      const result = await listTool.invoke({
        directoryPath: '.',
        recursive: true,
        maxDepth: 2
      }, { context: testContext });

      expect(result).toContain('subdir/');
      expect(result).toContain('multiline.txt (10 lines)');
      // Check for indentation in the new tree format
      expect(result).toContain('  nested.txt (1 lines)');
      // Check for relative path in header
      expect(result).toContain('Contents of directory: .');
    });

    it('should not recurse beyond maxDepth', async () => {
      const result = await listTool.invoke({
        directoryPath: '.',
        recursive: true,
        maxDepth: 1
      }, { context: testContext });

      expect(result).toContain('subdir/');
      expect(result).not.toContain('  nested.txt');
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

      expect(result).toContain('4→Line 4');
      expect(result).toContain('5→Line 5');
      expect(result).toContain('6→Line 6');
      expect(result).not.toContain('3→Line 3');
      expect(result).not.toContain('7→Line 7');
      // Verify relative path
      expect(result).toContain('multiline.txt');
      expect(result).not.toContain(testDir);
    });
  });
});
