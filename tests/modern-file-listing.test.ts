import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
// This will import the modernized tool after implementation
import { fileListTool } from '../src/tools/file-listing.tool';

// Test suite for modernized FileListTool
test('modern FileListTool should list directory with structured parameters', async () => {
  // Create a temporary directory for testing
  const testDir = path.join(process.cwd(), 'test_modern_filelist');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  // Create some test files
  const testFile1 = path.join(testDir, 'test1.txt');
  const testFile2 = path.join(testDir, 'test2.txt');
  fs.writeFileSync(testFile1, 'Test content 1');
  fs.writeFileSync(testFile2, 'Test content 2');
  
  // Test the modern tool with structured parameters
  const result = await fileListTool.invoke({
    directoryPath: testDir,
    includeHidden: false
  });
  
  expect(result).to.include('test1.txt');
  expect(result).to.include('test2.txt');
  expect(result).to.include('Contents of directory');
  
  // Clean up
  fs.unlinkSync(testFile1);
  fs.unlinkSync(testFile2);
  fs.rmdirSync(testDir);
});

test('modern FileListTool should handle invalid directory paths', async () => {
  const result = await fileListTool.invoke({
    directoryPath: '../invalid_dir',
    includeHidden: false
  });
  expect(result).to.include('contains invalid path characters');
});

test('modern FileListTool should include hidden files when requested', async () => {
  // Create a temporary directory for testing
  const testDir = path.join(process.cwd(), 'test_modern_hidden');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  // Create test files including hidden ones
  const testFile1 = path.join(testDir, 'visible.txt');
  const testFile2 = path.join(testDir, '.hidden.txt');
  fs.writeFileSync(testFile1, 'Visible content');
  fs.writeFileSync(testFile2, 'Hidden content');
  
  // Test without including hidden files
  const resultWithoutHidden = await fileListTool.invoke({
    directoryPath: testDir,
    includeHidden: false
  });
  expect(resultWithoutHidden).to.include('visible.txt');
  expect(resultWithoutHidden).to.not.include('.hidden.txt');
  
  // Test with including hidden files
  const resultWithHidden = await fileListTool.invoke({
    directoryPath: testDir,
    includeHidden: true
  });
  expect(resultWithHidden).to.include('visible.txt');
  expect(resultWithHidden).to.include('.hidden.txt');
  
  // Clean up
  fs.unlinkSync(testFile1);
  fs.unlinkSync(testFile2);
  fs.rmdirSync(testDir);
});

test('modern FileListTool should use default working directory', async () => {
  // Test calling without explicit directoryPath (should default to '.')
  const result = await fileListTool.invoke({
    includeHidden: false
  });
  
  expect(result).to.include('Contents of directory');
  expect(result).to.include('Total entries');
});