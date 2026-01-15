/**
 * Modern File Listing Tool Tests
 * Converted to Bun Test framework
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { listTool } from '../src/tools/file-listing.tool.js';

describe('Modern File Listing Tool', () => {
  let testDir: string;
  let testContext: { workingDir: string; group: string; technology: string };

  beforeEach(() => {
    testDir = path.join(process.cwd(), `test-modern-filelist-${Date.now()}`);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    testContext = { workingDir: testDir, group: 'test', technology: 'test' };
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should list directory with structured parameters', async () => {
    // Create test files
    const testFile1 = path.join(testDir, 'test1.txt');
    const testFile2 = path.join(testDir, 'test2.txt');
    fs.writeFileSync(testFile1, 'Test content 1');
    fs.writeFileSync(testFile2, 'Test content 2');

    // Test modern tool with structured parameters
    const result = await listTool.invoke({
      directoryPath: testDir,
      includeHidden: false
    }, { context: testContext });

    expect(result).toContain('test1.txt');
    expect(result).toContain('test2.txt');
    expect(result).toContain('Contents of directory');

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
  });

  it('should handle invalid directory paths', async () => {
    const result = await listTool.invoke({
      directoryPath: '../invalid_dir',
      includeHidden: false
    }, { context: testContext });
    expect(result).toContain('attempts to escape working directory sandbox');
  });

  it('should include hidden files when requested', async () => {
    const testFile1 = path.join(testDir, 'test.txt');
    const testFile2 = path.join(testDir, '.hidden.txt');
    fs.writeFileSync(testFile1, 'Test content');
    fs.writeFileSync(testFile2, 'Hidden content');

    const includeHiddenResult = await listTool.invoke({
      directoryPath: testDir,
      includeHidden: true
    }, { context: testContext });

    const excludeHiddenResult = await listTool.invoke({
      directoryPath: testDir,
      includeHidden: false
    }, { context: testContext });

    expect(includeHiddenResult).toContain('test.txt');
    expect(includeHiddenResult).toContain('.hidden.txt');
    expect(excludeHiddenResult).toContain('test.txt');
    expect(excludeHiddenResult).not.toContain('.hidden.txt');

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
  });

  it('should handle empty directories', async () => {
    const result = await listTool.invoke({
      directoryPath: testDir,
      includeHidden: false
    }, { context: testContext });

    expect(result).toContain('Contents of directory');
    expect(result).toContain('Total entries: 0');
  });

  it('should handle subdirectories', async () => {
    const subDir = path.join(testDir, 'subdir');
    fs.mkdirSync(subDir, { recursive: true });

    const testFile1 = path.join(testDir, 'test.txt');
    const testFile2 = path.join(subDir, 'nested.txt');
    fs.writeFileSync(testFile1, 'Test content');
    fs.writeFileSync(testFile2, 'Nested content');

    const result = await listTool.invoke({
      directoryPath: testDir,
      includeHidden: false
    }, { context: testContext });

    expect(result).toContain('test.txt');
    expect(result).toContain('subdir');

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
    fs.rmdirSync(subDir);
  });

  it('should handle permission errors gracefully', async () => {
    const result = await listTool.invoke({
      directoryPath: '/root/nonexistent',
      includeHidden: false
    }, { context: testContext });

    expect(result).toContain('list failed');
    expect(result).toContain('directory');
  });

  it('should handle special characters in file names', async () => {
    const testFile1 = path.join(testDir, 'file-with-special-chars.txt');
    const testFile2 = path.join(testDir, 'file_with_underscores.js');
    const testFile3 = path.join(testDir, 'file-with-dashes.md');
    fs.writeFileSync(testFile1, 'Special chars content');
    fs.writeFileSync(testFile2, 'Underscores content');
    fs.writeFileSync(testFile3, 'Dashes content');

    const result = await listTool.invoke({
      directoryPath: testDir,
      includeHidden: false
    }, { context: testContext });

    expect(result).toContain('file-with-special-chars.txt');
    expect(result).toContain('file_with_underscores.js');
    expect(result).toContain('file-with-dashes.md');

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
    fs.unlinkSync(testFile3);
  });

  it('should handle file information display', async () => {
    const testFile = path.join(testDir, 'test.txt');
    fs.writeFileSync(testFile, 'Test content');

    const result = await listTool.invoke({
      directoryPath: testDir,
      includeHidden: false
    }, { context: testContext });

    expect(result).toContain('test.txt');
    expect(result).toContain('Contents of directory');

    // Clean up
    fs.unlinkSync(testFile);
  });

  it('should handle concurrent operations', async () => {
    const testFile1 = path.join(testDir, 'concurrent1.txt');
    const testFile2 = path.join(testDir, 'concurrent2.txt');
    fs.writeFileSync(testFile1, 'Content 1');
    fs.writeFileSync(testFile2, 'Content 2');

    // Run multiple listing operations concurrently
    const [result1, result2] = await Promise.all([
      listTool.invoke({
        directoryPath: testDir,
        includeHidden: false
      }, { context: testContext }),
      listTool.invoke({
        directoryPath: testDir,
        includeHidden: true
      }, { context: testContext })
    ]);

    expect(result1).toContain('concurrent1.txt');
    expect(result1).toContain('concurrent2.txt');
    expect(result2).toContain('concurrent1.txt');
    expect(result2).toContain('concurrent2.txt');
    expect(result2).toEqual(result1); // Same parameters should produce same results

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
  });

  it('should handle recursive listing with maxDepth', async () => {
    const level1Dir = path.join(testDir, 'level1');
    const level2Dir = path.join(level1Dir, 'level2');
    fs.mkdirSync(level2Dir, { recursive: true });

    fs.writeFileSync(path.join(testDir, 'root.txt'), 'Root file');
    fs.writeFileSync(path.join(level1Dir, 'level1.txt'), 'Level 1 file');
    fs.writeFileSync(path.join(level2Dir, 'level2.txt'), 'Level 2 file');

    // Test with maxDepth=1 (list starting directory contents, don't recurse)
    const result1 = await listTool.invoke({
      directoryPath: testDir,
      recursive: true,
      maxDepth: 1
    }, { context: testContext });

    expect(result1).toContain('root.txt');
    expect(result1).toContain('level1/'); // Directory header shown, but contents not recursed
    expect(result1).not.toContain('level1.txt'); // Not recursed, so not shown
    expect(result1).not.toContain('level2/');

    // Test with maxDepth=2 (list starting directory + 1 level deep)
    const result2 = await listTool.invoke({
      directoryPath: testDir,
      recursive: true,
      maxDepth: 2
    }, { context: testContext });

    expect(result2).toContain('root.txt');
    expect(result2).toContain('level1/');
    expect(result2).toContain('level1.txt'); // Recursed into level1
    expect(result2).not.toContain('level2/'); // Not recursed into level2
    expect(result2).not.toContain('level2.txt');

    // Clean up
    fs.unlinkSync(path.join(testDir, 'root.txt'));
    fs.unlinkSync(path.join(level1Dir, 'level1.txt'));
    fs.unlinkSync(path.join(level2Dir, 'level2.txt'));
    fs.rmdirSync(level2Dir);
    fs.rmdirSync(level1Dir);
  });
});