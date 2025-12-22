import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { fileFindTool } from '../src/tools/file-finding.tool';

// Test suite for modernized FileFindTool
test('modern FileFindTool should find files with structured parameters', async () => {
  // Create a temporary directory and files for testing
  const testDir = path.join(process.cwd(), 'test_modern_find');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  const testFile1 = path.join(testDir, 'test.txt');
  const testFile2 = path.join(testDir, 'example.js');
  const testFile3 = path.join(testDir, 'readme.md');
  fs.writeFileSync(testFile1, 'Test content');
  fs.writeFileSync(testFile2, 'JavaScript content');
  fs.writeFileSync(testFile3, 'Markdown content');
  
  // Test modern tool with structured parameters
  const result = await fileFindTool.invoke({
    searchPath: testDir,
    patterns: ['test.txt']
  });
  
  expect(result).to.include('Found 1 files');
  expect(result).to.include('test.txt');
  expect(result).to.not.include('example.js');
  expect(result).to.not.include('readme.md');
  
  // Clean up
  fs.unlinkSync(testFile1);
  fs.unlinkSync(testFile2);
  fs.unlinkSync(testFile3);
  fs.rmdirSync(testDir);
});

test('modern FileFindTool should handle multiple patterns', async () => {
  // Create a temporary directory and files for testing
  const testDir = path.join(process.cwd(), 'test_modern_find_multi');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  const testFile1 = path.join(testDir, 'test.txt');
  const testFile2 = path.join(testDir, 'example.js');
  const testFile3 = path.join(testDir, 'readme.md');
  fs.writeFileSync(testFile1, 'Test content');
  fs.writeFileSync(testFile2, 'JavaScript content');
  fs.writeFileSync(testFile3, 'Markdown content');
  
  // Test with multiple patterns
  const result = await fileFindTool.invoke({
    searchPath: testDir,
    patterns: ['*.txt', '*.md']
  });
  
  expect(result).to.include('Found 2 files');
  expect(result).to.include('test.txt');
  expect(result).to.include('readme.md');
  expect(result).to.not.include('example.js');
  
  // Clean up
  fs.unlinkSync(testFile1);
  fs.unlinkSync(testFile2);
  fs.unlinkSync(testFile3);
  fs.rmdirSync(testDir);
});

test('modern FileFindTool should handle invalid search paths', async () => {
  const result = await fileFindTool.invoke({
    searchPath: '../invalid_dir',
    patterns: ['*.txt']
  });
  expect(result).to.include('contains invalid path characters');
});

test('modern FileFindTool should support exclude patterns', async () => {
  // Create a temporary directory and files for testing
  const testDir = path.join(process.cwd(), 'test_modern_find_exclude');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  const testFile1 = path.join(testDir, 'test.txt');
  const testFile2 = path.join(testDir, 'exclude.txt');
  fs.writeFileSync(testFile1, 'Test content');
  fs.writeFileSync(testFile2, 'Exclude content');
  
  // Test with exclude pattern
  const result = await fileFindTool.invoke({
    searchPath: testDir,
    patterns: ['*.txt'],
    exclude: ['exclude.txt']
  });
  
  expect(result).to.include('Found 1 files');
  expect(result).to.include('test.txt');
  expect(result).to.not.include('exclude.txt');
  
  // Clean up
  fs.unlinkSync(testFile1);
  fs.unlinkSync(testFile2);
  fs.rmdirSync(testDir);
});

test('modern FileFindTool should support non-recursive search', async () => {
  // Create a temporary directory structure
  const testDir = path.join(process.cwd(), 'test_modern_find_nonrecursive');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  const subDir = path.join(testDir, 'subdir');
  fs.mkdirSync(subDir);
  
  const testFile1 = path.join(testDir, 'test.txt');
  const testFile2 = path.join(subDir, 'subtest.txt');
  fs.writeFileSync(testFile1, 'Test content');
  fs.writeFileSync(testFile2, 'Sub test content');
  
  // Test with non-recursive search
  const result = await fileFindTool.invoke({
    searchPath: testDir,
    patterns: ['*.txt'],
    recursive: false
  });
  
  expect(result).to.include('Found 1 files');
  expect(result).to.include('test.txt');
  expect(result).to.not.include('subtest.txt');
  
  // Clean up
  fs.unlinkSync(testFile1);
  fs.unlinkSync(testFile2);
  fs.rmdirSync(subDir);
  fs.rmdirSync(testDir);
});

test('modern FileFindTool should support include hidden files', async () => {
  // Create a temporary directory and files for testing
  const testDir = path.join(process.cwd(), 'test_modern_find_hidden');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  const testFile1 = path.join(testDir, 'test.txt');
  const testFile2 = path.join(testDir, '.hidden.txt');
  fs.writeFileSync(testFile1, 'Test content');
  fs.writeFileSync(testFile2, 'Hidden content');
  
  // Test without including hidden files
  const resultWithoutHidden = await fileFindTool.invoke({
    searchPath: testDir,
    patterns: ['*.txt'],
    includeHidden: false
  });
  expect(resultWithoutHidden).to.include('Found 1 files');
  expect(resultWithoutHidden).to.include('test.txt');
  expect(resultWithoutHidden).to.not.include('.hidden.txt');
  
  // Test with including hidden files
  const resultWithHidden = await fileFindTool.invoke({
    searchPath: testDir,
    patterns: ['*.txt'],
    includeHidden: true
  });
  expect(resultWithHidden).to.include('Found 2 files');
  expect(resultWithHidden).to.include('test.txt');
  expect(resultWithHidden).to.include('.hidden.txt');
  
  // Clean up
  fs.unlinkSync(testFile1);
  fs.unlinkSync(testFile2);
  fs.rmdirSync(testDir);
});