/**
 * Modern File Listing Tool Tests
 * Converted to Bun Test framework
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { fileListTool } from '../src/tools/file-listing.tool.js';

describe('Modern File Listing Tool', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(process.cwd(), `test-modern-filelist-${Date.now()}`);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
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
    const result = await fileListTool.invoke({
      directoryPath: testDir,
      includeHidden: false
    });
    
    expect(result).toContain('test1.txt');
    expect(result).toContain('test2.txt');
    expect(result).toContain('Contents of directory');
    
    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
  });

  it('should handle invalid directory paths', async () => {
    const result = await fileListTool.invoke({
      directoryPath: '../invalid_dir',
      includeHidden: false
    });
    expect(result).toContain('attempts to escape working directory sandbox');
  });

  it('should include hidden files when requested', async () => {
    const testFile1 = path.join(testDir, 'test.txt');
    const testFile2 = path.join(testDir, '.hidden.txt');
    fs.writeFileSync(testFile1, 'Test content');
    fs.writeFileSync(testFile2, 'Hidden content');
    
    const includeHiddenResult = await fileListTool.invoke({
      directoryPath: testDir,
      includeHidden: true
    });
    
    const excludeHiddenResult = await fileListTool.invoke({
      directoryPath: testDir,
      includeHidden: false
    });
    
    expect(includeHiddenResult).toContain('test.txt');
    expect(includeHiddenResult).toContain('.hidden.txt');
    expect(excludeHiddenResult).toContain('test.txt');
    expect(excludeHiddenResult).not.toContain('.hidden.txt');
    
    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
  });

  it('should handle empty directories', async () => {
    const result = await fileListTool.invoke({
      directoryPath: testDir,
      includeHidden: false
    });
    
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
    
    const result = await fileListTool.invoke({
      directoryPath: testDir,
      includeHidden: false
    });
    
    expect(result).toContain('test.txt');
    expect(result).toContain('subdir');
    
    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
    fs.rmdirSync(subDir);
  });

  it('should handle permission errors gracefully', async () => {
    const result = await fileListTool.invoke({
      directoryPath: '/root/nonexistent',
      includeHidden: false
    });
    
    expect(result).toContain('Error');
    expect(result).toContain('directory');
  });

  it('should handle special characters in file names', async () => {
    const testFile1 = path.join(testDir, 'file-with-special-chars.txt');
    const testFile2 = path.join(testDir, 'file_with_underscores.js');
    const testFile3 = path.join(testDir, 'file-with-dashes.md');
    fs.writeFileSync(testFile1, 'Special chars content');
    fs.writeFileSync(testFile2, 'Underscores content');
    fs.writeFileSync(testFile3, 'Dashes content');
    
    const result = await fileListTool.invoke({
      directoryPath: testDir,
      includeHidden: false
    });
    
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
    
    const result = await fileListTool.invoke({
      directoryPath: testDir,
      includeHidden: false
    });
    
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
      fileListTool.invoke({
        directoryPath: testDir,
        includeHidden: false
      }),
      fileListTool.invoke({
        directoryPath: testDir,
        includeHidden: true
      })
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
});