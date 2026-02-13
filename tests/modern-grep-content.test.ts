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

    // Check JSON format
    const parsed = JSON.parse(result);
    expect(parsed.totalMatches).toBe(1);
    expect(parsed.results[0].path).toContain('grep_test.txt');
    expect(parsed.results[0].matches[0].text).toContain('specific content');

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

  it('should handle non-existent search path', async () => {
    const result = await grepTool.invoke({
      searchPath: './nonexistent_subdir',
      query: 'test'
    }, { context: testContext });
    expect(result).toContain('does not exist');
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

    // Check JSON format
    const parsed = JSON.parse(regexResult);
    expect(parsed.totalMatches).toBe(1);
    expect(parsed.results[0].matches[0].text).toContain('test123');

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

    // Check JSON format
    const parsed = JSON.parse(result);
    expect(parsed.totalMatches).toBe(3);
    
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

    // Check JSON format
    const parsed = JSON.parse(result);
    expect(parsed.totalMatches).toBe(0);
    expect(parsed.results).toEqual([]);

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

    // Check JSON format
    const parsed = JSON.parse(result);
    expect(parsed.results[0].path).toContain('linenumbers.txt');
    expect(parsed.results[0].matches[0].line).toBe(3);
    expect(parsed.results[0].matches[0].text).toContain('Third');

    // Clean up
    fs.unlinkSync(testFile);
  });

  it('should handle exclude parameter', async () => {
    const testFile1 = path.join(testDir, 'include.txt');
    const testFile2 = path.join(testDir, 'exclude.txt');
    const subDir = path.join(testDir, 'dist');
    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir);
    const testFile3 = path.join(subDir, 'bundle.js');
    
    fs.writeFileSync(testFile1, 'Match here');
    fs.writeFileSync(testFile2, 'Match here');
    fs.writeFileSync(testFile3, 'Match here');

    const result = await grepTool.invoke({
      searchPath: '.',
      query: 'Match here',
      exclude: ['exclude.txt', 'dist/**']
    }, { context: testContext });

    expect(result).toContain('include.txt');
    expect(result).not.toContain('exclude.txt');
    expect(result).not.toContain('dist/bundle.js');

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
    fs.unlinkSync(testFile3);
    fs.rmdirSync(subDir);
  });

  it('should handle includeHidden parameter', async () => {
    const normalFile = path.join(testDir, 'normal.txt');
    const hiddenFile = path.join(testDir, '.hidden.txt');
    
    fs.writeFileSync(normalFile, 'Match here');
    fs.writeFileSync(hiddenFile, 'Match here');

    const resultWithoutHidden = await grepTool.invoke({
      searchPath: '.',
      query: 'Match here',
      includeHidden: false
    }, { context: testContext });

    const resultWithHidden = await grepTool.invoke({
      searchPath: '.',
      query: 'Match here',
      includeHidden: true
    }, { context: testContext });

    expect(resultWithoutHidden).toContain('normal.txt');
    expect(resultWithoutHidden).not.toContain('.hidden.txt');
    expect(resultWithHidden).toContain('normal.txt');
    expect(resultWithHidden).toContain('.hidden.txt');

    // Clean up
    fs.unlinkSync(normalFile);
    fs.unlinkSync(hiddenFile);
  });

  it('should handle context lines correctly with streaming search', async () => {
    const testFile = path.join(testDir, 'context_test.txt');
    const lines = [
      'Line 1',
      'Line 2',
      'Target Match',
      'Line 4',
      'Line 5'
    ];
    fs.writeFileSync(testFile, lines.join('\n'));

    const result = await grepTool.invoke({
      searchPath: '.',
      query: 'Target Match',
      contextBefore: 2,
      contextAfter: 2
    }, { context: testContext });

    // Check JSON format
    const parsed = JSON.parse(result);
    const match = parsed.results[0].matches[0];
    expect(match.line).toBe(3);
    expect(match.text).toBe('Target Match');
    expect(match.contextBefore).toContain('Line 1');
    expect(match.contextBefore).toContain('Line 2');
    expect(match.contextAfter).toContain('Line 4');
    expect(match.contextAfter).toContain('Line 5');

    // Clean up
    fs.unlinkSync(testFile);
  });
});
