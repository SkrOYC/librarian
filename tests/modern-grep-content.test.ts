import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { grepContentTool } from '../src/tools/grep-content.tool';

// Test suite for modernized GrepContentTool
test('modern GrepContentTool should search content with structured parameters', async () => {
  // Create a temporary directory and file for testing
  const testDir = path.join(process.cwd(), 'test_modern_grep');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  const testFile = path.join(testDir, 'grep_test.txt');
  const testContent = 'This is a test file with some specific content to search for.\nAnother line with more content.';
  fs.writeFileSync(testFile, testContent);
  
  // Test modern tool with structured parameters
  const result = await grepContentTool.invoke({
    searchPath: testDir,
    query: 'specific content'
  });
  
  expect(result).to.include('Found');
  expect(result).to.include('grep_test.txt');
  expect(result).to.include('specific content');
  
  // Clean up
  fs.unlinkSync(testFile);
  fs.rmdirSync(testDir);
});

test('modern GrepContentTool should handle invalid search paths', async () => {
  const result = await grepContentTool.invoke({
    searchPath: '../invalid_dir',
    query: 'test'
  });
  expect(result).to.include('contains invalid path characters');
});

test('modern GrepContentTool should handle missing query parameter', async () => {
  // This test needs to be done differently since Zod will validate at compile time
  // Instead, let's test with empty query which should fail at runtime
  const result = await grepContentTool.invoke({
    searchPath: '.',
    query: ''
  });
  expect(result).to.include('parameter is required');
});

test('modern GrepContentTool should support case sensitive search', async () => {
  // Create a temporary directory and file for testing
  const testDir = path.join(process.cwd(), 'test_modern_grep_case');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  const testFile = path.join(testDir, 'case_test.txt');
  const testContent = 'Test Case Sensitivity\nTHIS IS UPPERCASE\ntest lowercase';
  fs.writeFileSync(testFile, testContent);
  
  // Test case sensitive search
  const result = await grepContentTool.invoke({
    searchPath: testDir,
    query: 'Test',
    caseSensitive: true
  });
  
  expect(result).to.include('Found 1 matches'); // Only the first "Test" should match
  
  // Clean up
  fs.unlinkSync(testFile);
  fs.rmdirSync(testDir);
});

test('modern GrepContentTool should support regex patterns', async () => {
  // Create a temporary directory and file for testing
  const testDir = path.join(process.cwd(), 'test_modern_grep_regex');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  const testFile = path.join(testDir, 'regex_test.txt');
  const testContent = 'Version 1.2.3\nAnother line with version 2.0.0\nNo version here';
  fs.writeFileSync(testFile, testContent);
  
  // Test regex search
  const result = await grepContentTool.invoke({
    searchPath: testDir,
    query: '\\d+\\.\\d+\\.\\d+', // version pattern
    regex: true
  });
  
  expect(result).to.include('Found 2 matches');
  
  // Clean up
  fs.unlinkSync(testFile);
  fs.rmdirSync(testDir);
});

test('modern GrepContentTool should limit results', async () => {
  // Create a temporary directory and file for testing
  const testDir = path.join(process.cwd(), 'test_modern_grep_limit');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  const testFile = path.join(testDir, 'limit_test.txt');
  const testContent = 'match1\nmatch2\nmatch3\nmatch4\nmatch5';
  fs.writeFileSync(testFile, testContent);
  
  // Test with maxResults limit
  const result = await grepContentTool.invoke({
    searchPath: testDir,
    query: 'match',
    maxResults: 2
  });
  
  expect(result).to.include('Found 2 matches');
  expect(result).to.not.include('match3'); // Should be truncated
  
  // Clean up
  fs.unlinkSync(testFile);
  fs.rmdirSync(testDir);
});