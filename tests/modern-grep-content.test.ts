/**
 * Modern Grep Content Tool Tests
 * Converted to Bun Test framework
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { grepTool } from '../src/tools/grep-content.tool.js';

describe('Modern Grep Content Tool', () => {
  let testDir: string;
  let testContext: { workingDir: string; group: string; technology: string };

  beforeEach(() => {
    testDir = path.join(process.cwd(), `test-modern-grep-${Date.now()}`);
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

  it('should search content with structured parameters', async () => {
    // Create test file
    const testFile = path.join(testDir, 'grep_test.txt');
    const testContent = 'This is a test file with some specific content to search for.\nAnother line with more content.';
    fs.writeFileSync(testFile, testContent);

    // Test modern tool with structured parameters
    const result = await grepTool.invoke({
      searchPath: testDir,
      query: 'specific content'
    }, { context: testContext });

    expect(result).toContain('Found');
    expect(result).toContain('grep_test.txt');
    expect(result).toContain('specific content');

    // Clean up
    fs.unlinkSync(testFile);
  });

  it('should handle invalid search paths', async () => {
    const result = await grepTool.invoke({
      searchPath: '../invalid_dir',
      query: 'test'
    }, { context: testContext });
    expect(result).toContain('attempts to escape the working directory sandbox');
  });

  it('should handle missing query parameter', async () => {
    // Test with empty query which should fail at runtime
    const result = await grepTool.invoke({
      searchPath: '.',
      query: ''
    }, { context: testContext });
    expect(result).toContain('parameter is required');
  });

  it('should handle case sensitivity option', async () => {
    const testFile = path.join(testDir, 'case_test.txt');
    const testContent = 'Function hello() { return "Hello World"; }\nfunction test() { return "test case"; }';
    fs.writeFileSync(testFile, testContent);

    // Case sensitive search
    const caseSensitiveResult = await grepTool.invoke({
      searchPath: testDir,
      query: 'function',
      caseSensitive: true
    }, { context: testContext });

    // Case insensitive search
    const caseInsensitiveResult = await grepTool.invoke({
      searchPath: testDir,
      query: 'function',
      caseSensitive: false
    }, { context: testContext });

    expect(caseSensitiveResult).toContain('function');
    expect(caseInsensitiveResult).toContain('function');
    expect(caseInsensitiveResult).toContain('Function');

    // Clean up
    fs.unlinkSync(testFile);
  });

  it('should handle regex patterns', async () => {
    const testFile = path.join(testDir, 'regex_test.txt');
    const testContent = 'const test123 = 456; const abc = 789; const test456 = 123;';
    fs.writeFileSync(testFile, testContent);

    const regexResult = await grepTool.invoke({
      searchPath: testDir,
      query: '\\d+',
      regex: true
    }, { context: testContext });

    expect(regexResult).toContain('Found');
    expect(regexResult).toContain('test123');
    expect(regexResult).toContain('456');
    expect(regexResult).toContain('789');
    expect(regexResult).toContain('test456');
    expect(regexResult).toContain('123');

    // Clean up
    fs.unlinkSync(testFile);
  });

  it('should handle file patterns', async () => {
    const testFile1 = path.join(testDir, 'test.js');
    const testFile2 = path.join(testDir, 'test.txt');
    const testFile3 = path.join(testDir, 'test.md');
    fs.writeFileSync(testFile1, 'JavaScript function test');
    fs.writeFileSync(testFile2, 'Text file test');
    fs.writeFileSync(testFile3, 'Markdown test');

    const result = await grepTool.invoke({
      searchPath: testDir,
      query: 'test',
      patterns: ['*.js', '*.txt']
    }, { context: testContext });

    expect(result).toContain('test.js');
    expect(result).toContain('test.txt');
    expect(result).not.toContain('test.md');

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
    fs.unlinkSync(testFile3);
  });

  it('should handle recursive search', async () => {
    const subDir = path.join(testDir, 'subdir');
    fs.mkdirSync(subDir, { recursive: true });

    const testFile1 = path.join(testDir, 'root.txt');
    const testFile2 = path.join(subDir, 'nested.txt');
    fs.writeFileSync(testFile1, 'Root level test');
    fs.writeFileSync(testFile2, 'Nested level test');

    const recursiveResult = await grepTool.invoke({
      searchPath: testDir,
      query: 'test',
      recursive: true
    }, { context: testContext });

    const nonRecursiveResult = await grepTool.invoke({
      searchPath: testDir,
      query: 'test',
      recursive: false
    }, { context: testContext });

    expect(recursiveResult).toContain('root.txt');
    expect(recursiveResult).toContain('nested.txt');
    expect(nonRecursiveResult).toContain('root.txt');
    expect(nonRecursiveResult).not.toContain('nested.txt');

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
    fs.rmdirSync(subDir);
  });

  it('should handle maxResults limit', async () => {
    // Create multiple files with matches
    for (let i = 1; i <= 10; i++) {
      const testFile = path.join(testDir, `test${i}.txt`);
      fs.writeFileSync(testFile, `Content with test${i}`);
    }

    const result = await grepTool.invoke({
      searchPath: testDir,
      query: 'test',
      maxResults: 3
    }, { context: testContext });

    expect(result).toContain('Found 3 matches');
    
    // Clean up
    for (let i = 1; i <= 10; i++) {
      const testFile = path.join(testDir, `test${i}.txt`);
      fs.unlinkSync(testFile);
    }
  });

  it('should handle special characters in query', async () => {
    const testFile = path.join(testDir, 'special.txt');
    const specialContent = 'Content with émojis 🚀 and unicode 中文 characters';
    fs.writeFileSync(testFile, specialContent);

    const result = await grepTool.invoke({
      searchPath: testDir,
      query: 'émojis 🚀'
    }, { context: testContext });

    expect(result).toContain('special.txt');
    expect(result).toContain('émojis 🚀');

    // Clean up
    fs.unlinkSync(testFile);
  });

  it('should handle empty search results', async () => {
    const testFile = path.join(testDir, 'empty.txt');
    fs.writeFileSync(testFile, 'Some content here');

    const result = await grepTool.invoke({
      searchPath: testDir,
      query: 'nonexistentterm'
    }, { context: testContext });

    expect(result).toContain('No matches found');

    // Clean up
    fs.unlinkSync(testFile);
  });

  it('should handle concurrent searches', async () => {
    const testFile1 = path.join(testDir, 'concurrent1.txt');
    const testFile2 = path.join(testDir, 'concurrent2.txt');
    fs.writeFileSync(testFile1, 'Concurrent content 1');
    fs.writeFileSync(testFile2, 'Concurrent content 2');

    // Run multiple searches concurrently
    const [result1, result2] = await Promise.all([
      grepTool.invoke({
        searchPath: testDir,
        query: 'content 1'
      }, { context: testContext }),
      grepTool.invoke({
        searchPath: testDir,
        query: 'content 2'
      }, { context: testContext })
    ]);

    expect(result1).toContain('concurrent1.txt');
    expect(result1).toContain('content 1');
    expect(result2).toContain('concurrent2.txt');
    expect(result2).toContain('content 2');

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
  });

  it('should handle line number context', async () => {
    const testFile = path.join(testDir, 'linenumbers.txt');
    const multiLineContent = 'Line 1: First line\nLine 2: Second line\nLine 3: Third line with match\nLine 4: Fourth line';
    fs.writeFileSync(testFile, multiLineContent);

    const result = await grepTool.invoke({
      searchPath: testDir,
      query: 'Third'
    }, { context: testContext });

    expect(result).toContain('linenumbers.txt');
    expect(result).toContain('3→Line 3');
    expect(result).toContain('Third line');

    // Clean up
    fs.unlinkSync(testFile);
  });
});
