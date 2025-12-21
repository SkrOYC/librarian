import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { fileReadTool } from '../src/tools/file-reading.tool';

// Test suite for modernized FileReadTool
test('modern FileReadTool should read file content with structured parameters', async () => {
  // Create a temporary file for testing
  const testFile = path.join(process.cwd(), 'test_modern_file_read.txt');
  const testContent = 'This is test content for the modernized file reading tool.';
  fs.writeFileSync(testFile, testContent);
  
  // Test the modern tool with structured parameters
  const result = await fileReadTool.invoke({
    filePath: testFile
  });
  
  expect(result).to.include(testContent);
  expect(result).to.include('Content of file');
  
  // Clean up
  fs.unlinkSync(testFile);
});

test('modern FileReadTool should handle non-existent files', async () => {
  const result = await fileReadTool.invoke({
    filePath: 'non_existent_file.txt'
  });
  expect(result).to.include('Error reading file');
});

test('modern FileReadTool should handle invalid file paths', async () => {
  const result = await fileReadTool.invoke({
    filePath: '../invalid_dir/file.txt'
  });
  expect(result).to.include('contains invalid path characters');
});

test('modern FileReadTool should handle binary files', async () => {
  // Create a temporary binary file
  const testFile = path.join(process.cwd(), 'test_binary.bin');
  const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03]); // Binary data with null byte
  fs.writeFileSync(testFile, binaryContent);
  
  const result = await fileReadTool.invoke({
    filePath: testFile
  });
  
  expect(result).to.include('not a text file');
  
  // Clean up
  fs.unlinkSync(testFile);
});

test('modern FileReadTool should handle image files', async () => {
  // Create a temporary image file
  const testFile = path.join(process.cwd(), 'test_image.png');
  fs.writeFileSync(testFile, 'fake png content');
  
  const result = await fileReadTool.invoke({
    filePath: testFile
  });
  
  expect(result).to.include('media file');
  expect(result).to.include('image');
  
  // Clean up
  fs.unlinkSync(testFile);
});

test('modern FileReadTool should truncate large files', async () => {
  // Create a large temporary file
  const testFile = path.join(process.cwd(), 'test_large.txt');
  const largeContent = 'x'.repeat(60000); // 60KB content
  fs.writeFileSync(testFile, largeContent);
  
  const result = await fileReadTool.invoke({
    filePath: testFile
  });
  
  expect(result).to.include('File content is too large');
  expect(result).to.include('Content truncated due to length');
  expect(result).to.not.include(largeContent); // Should not contain full content
  
  // Clean up
  fs.unlinkSync(testFile);
});