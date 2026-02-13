/**
 * Modern File Finding Tool Tests
 * Converted to Bun Test framework
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { findTool } from '../src/tools/file-finding.tool.js';

describe('Modern File Finding Tool', () => {
  let testDir: string;
  let testContext: { workingDir: string; group: string; technology: string };

  beforeEach(() => {
    testDir = path.join(process.cwd(), `test-modern-find-${Date.now()}`);
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

  it('should find files with structured parameters', async () => {
    // Create test files
    const testFile1 = path.join(testDir, 'test.txt');
    const testFile2 = path.join(testDir, 'example.js');
    const testFile3 = path.join(testDir, 'readme.md');
    fs.writeFileSync(testFile1, 'Test content');
    fs.writeFileSync(testFile2, 'JavaScript content');
    fs.writeFileSync(testFile3, 'Markdown content');

    // Test modern tool with structured parameters
    const result = await findTool.invoke({
      searchPath: testDir,
      patterns: ['test.txt']
    }, { context: testContext });

    // Check JSON format
    const parsed = JSON.parse(result);
    expect(parsed.totalFiles).toBe(1);
    expect(parsed.files).toContain('test.txt');
    expect(parsed.files).not.toContain('example.js');
    expect(parsed.files).not.toContain('readme.md');

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
    fs.unlinkSync(testFile3);
  });

  it('should handle multiple patterns', async () => {
    const testFile1 = path.join(testDir, 'test.txt');
    const testFile2 = path.join(testDir, 'example.js');
    const testFile3 = path.join(testDir, 'readme.md');
    fs.writeFileSync(testFile1, 'Test content');
    fs.writeFileSync(testFile2, 'JavaScript content');
    fs.writeFileSync(testFile3, 'Markdown content');

    const result = await findTool.invoke({
      searchPath: testDir,
      patterns: ['*.txt', '*.js']
    }, { context: testContext });

    // Check JSON format
    const parsed = JSON.parse(result);
    expect(parsed.totalFiles).toBe(2);
    expect(parsed.files).toContain('test.txt');
    expect(parsed.files).toContain('example.js');
    expect(parsed.files).not.toContain('readme.md');

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
    fs.unlinkSync(testFile3);
  });

  it('should handle exclude patterns', async () => {
    const testFile1 = path.join(testDir, 'test.txt');
    const testFile2 = path.join(testDir, 'example.js');
    const testFile3 = path.join(testDir, 'test.min.js');
    fs.writeFileSync(testFile1, 'Test content');
    fs.writeFileSync(testFile2, 'JavaScript content');
    fs.writeFileSync(testFile3, 'Minified content');

    const result = await findTool.invoke({
      searchPath: testDir,
      patterns: ['*.*'],
      exclude: ['*.min.*']
    }, { context: testContext });

    expect(result).toContain('test.txt');
    expect(result).toContain('example.js');
    expect(result).not.toContain('test.min.js');

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
    fs.unlinkSync(testFile3);
  });

  it('should handle recursive directory exclusion', async () => {
    const subDir = path.join(testDir, 'node_modules');
    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir);
    const testFile1 = path.join(testDir, 'src.ts');
    const testFile2 = path.join(subDir, 'dep.ts');
    
    fs.writeFileSync(testFile1, 'src');
    fs.writeFileSync(testFile2, 'dep');

    const result = await findTool.invoke({
      searchPath: '.',
      patterns: ['**/*.ts'],
      exclude: ['**/node_modules/**']
    }, { context: testContext });

    expect(result).toContain('src.ts');
    expect(result).not.toContain('node_modules/dep.ts');

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
    fs.rmdirSync(subDir);
  });

  it('should handle recursive search', async () => {
    const subDir = path.join(testDir, 'subdir');
    fs.mkdirSync(subDir, { recursive: true });

    const testFile1 = path.join(testDir, 'test.txt');
    const testFile2 = path.join(subDir, 'nested.js');
    fs.writeFileSync(testFile1, 'Test content');
    fs.writeFileSync(testFile2, 'Nested content');

    const result = await findTool.invoke({
      searchPath: testDir,
      patterns: ['*.*'],
      recursive: true
    }, { context: testContext });

    // Check JSON format - Files include directory prefix now
    const parsed = JSON.parse(result);
    expect(parsed.files.some((f: string) => f.endsWith('test.txt'))).toBe(true);
    expect(parsed.files.some((f: string) => f.endsWith('nested.js'))).toBe(true);
    expect(parsed.totalFiles).toBe(2);

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
    fs.rmdirSync(subDir);
  });

  it('should handle non-recursive search', async () => {
    const subDir = path.join(testDir, 'subdir');
    fs.mkdirSync(subDir, { recursive: true });

    const testFile1 = path.join(testDir, 'test.txt');
    const testFile2 = path.join(subDir, 'nested.js');
    fs.writeFileSync(testFile1, 'Test content');
    fs.writeFileSync(testFile2, 'Nested content');

    const result = await findTool.invoke({
      searchPath: testDir,
      patterns: ['*.*'],
      recursive: false
    }, { context: testContext });

    // Check JSON format
    const parsed = JSON.parse(result);
    expect(parsed.files).toContain('test.txt');
    expect(parsed.files).not.toContain('nested.js');
    expect(parsed.totalFiles).toBe(1);

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
    fs.rmdirSync(subDir);
  });

  it('should handle maxResults limit', async () => {
    // Create multiple files
    for (let i = 1; i <= 15; i++) {
      const testFile = path.join(testDir, `test${i}.txt`);
      fs.writeFileSync(testFile, `Content ${i}`);
    }

    const result = await findTool.invoke({
      searchPath: testDir,
      patterns: ['*.txt'],
      maxResults: 5
    }, { context: testContext });

    // Check JSON format
    const parsed = JSON.parse(result);
    expect(parsed.totalFiles).toBe(5);
    expect(parsed.files.some((f: string) => f.includes('test1.txt'))).toBe(true);
    expect(parsed.files.some((f: string) => f.includes('test5.txt'))).toBe(true);

    // Clean up
    for (let i = 1; i <= 15; i++) {
      const testFile = path.join(testDir, `test${i}.txt`);
      fs.unlinkSync(testFile);
    }
  });

  it('should handle includeHidden option', async () => {
    const testFile1 = path.join(testDir, 'test.txt');
    const testFile2 = path.join(testDir, '.hidden.txt');
    fs.writeFileSync(testFile1, 'Test content');
    fs.writeFileSync(testFile2, 'Hidden content');

    const includeHiddenResult = await findTool.invoke({
      searchPath: testDir,
      patterns: ['*.txt'],
      includeHidden: true
    }, { context: testContext });

    const excludeHiddenResult = await findTool.invoke({
      searchPath: testDir,
      patterns: ['*.txt'],
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

  it('should handle non-existent search path', async () => {
    const result = await findTool.invoke({
      searchPath: './nonexistent_subdir',
      patterns: ['*.*']
    }, { context: testContext });

    expect(result).toContain('does not exist');
    expect(result).toContain('nonexistent_subdir');
  });

  it('should handle empty patterns array', async () => {
    const result = await findTool.invoke({
      searchPath: testDir,
      patterns: []
    }, { context: testContext });

    expect(result).toContain('patterns');
  });

  it('should handle empty results', async () => {
    const result = await findTool.invoke({
      searchPath: testDir,
      patterns: ['*.nonexistent']
    }, { context: testContext });

    // Check JSON format
    const parsed = JSON.parse(result);
    expect(parsed.totalFiles).toBe(0);
    expect(parsed.files).toEqual([]);
  });

  it('should handle special characters in patterns', async () => {
    const testFile1 = path.join(testDir, 'test-special_file.txt');
    const testFile2 = path.join(testDir, 'test_special-file.js');
    fs.writeFileSync(testFile1, 'Special content 1');
    fs.writeFileSync(testFile2, 'Special content 2');

    const result = await findTool.invoke({
      searchPath: testDir,
      patterns: ['test-special_*.*']
    }, { context: testContext });

    // Check JSON format
    const parsed = JSON.parse(result);
    expect(parsed.files).toContain('test-special_file.txt');
    expect(parsed.totalFiles).toBe(1);  // Pattern doesn't match test_special-file.js

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
  });
});
