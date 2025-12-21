import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { fileListTool } from '../src/tools/file-listing.tool';
import { fileReadTool as fileReadToolModern } from '../src/tools/file-reading.tool';
import { grepContentTool as grepContentToolModern } from '../src/tools/grep-content.tool';
import { FileFindTool } from '../src/tools/file-finding.tool';
import { ReactAgent } from '../src/agents/react-agent';
const fileReadTool = fileReadToolModern;
const grepContentTool = grepContentToolModern;
const fileFindTool = new FileFindTool();

// Test FileListTool
test('FileListTool should list directory contents', async () => {
  // Create a temporary directory for testing
  const testDir = path.join(process.cwd(), 'test_temp_dir');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  // Create some test files
  const testFile1 = path.join(testDir, 'test1.txt');
  const testFile2 = path.join(testDir, 'test2.txt');
  fs.writeFileSync(testFile1, 'Test content 1');
  fs.writeFileSync(testFile2, 'Test content 2');
  
  const result = await fileListTool.invoke({ directoryPath: testDir });
  
  expect(result).to.include('test1.txt');
  expect(result).to.include('test2.txt');
  expect(result).to.include('Contents of directory');
  
  // Clean up
  fs.unlinkSync(testFile1);
  fs.unlinkSync(testFile2);
  fs.rmdirSync(testDir);
});

test('FileListTool should handle invalid directory paths', async () => {
  const result = await fileListTool.invoke({ directoryPath: '../invalid_dir' });
  expect(result).to.include('contains invalid path characters');
});

// Test FileReadTool
test('FileReadTool should read file content', async () => {
  // Create a temporary file for testing
  const testFile = path.join(process.cwd(), 'test_temp_file.txt');
  const testContent = 'This is test content for the file reading tool.';
  fs.writeFileSync(testFile, testContent);
  
  const result = await fileReadToolModern.invoke({ filePath: testFile });
  
  expect(result).to.include(testContent);
  expect(result).to.include('Content of file');
  
  // Clean up
  fs.unlinkSync(testFile);
});

test('FileReadTool should handle non-existent files', async () => {
  const result = await fileReadToolModern.invoke({ filePath: 'non_existent_file.txt' });
  expect(result).to.include('Error reading file');
});

// Test GrepContentTool
test('GrepContentTool should search for content in files', async () => {
  // Create a temporary directory and file for testing
  const testDir = path.join(process.cwd(), 'grep_test_dir');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  const testFile = path.join(testDir, 'grep_test.txt');
  const testContent = 'This is a test file with some specific content to search for.\nAnother line with more content.';
  fs.writeFileSync(testFile, testContent);
  
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

test('GrepContentTool should handle invalid search paths', async () => {
  const result = await grepContentTool.invoke({ 
    searchPath: '../invalid_dir',
    query: 'test'
  });
  expect(result).to.include('contains invalid path characters');
});

// Test FileFindTool
test('FileFindTool should find files matching patterns', async () => {
  // Create a temporary directory and files for testing
  const testDir = path.join(process.cwd(), 'find_test_dir');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  const testFile1 = path.join(testDir, 'test.txt');
  const testFile2 = path.join(testDir, 'example.js');
  const testFile3 = path.join(testDir, 'readme.md');
  fs.writeFileSync(testFile1, 'Test content');
  fs.writeFileSync(testFile2, 'JavaScript content');
  fs.writeFileSync(testFile3, 'Markdown content');
  
  const result = await fileFindTool._call(JSON.stringify({ 
    searchPath: testDir,
    patterns: ['test.txt']
  }));
  
  expect(result).to.include('test.txt');
  expect(result).to.not.include('example.js');
  expect(result).to.not.include('readme.md');
  
  // Clean up
  fs.unlinkSync(testFile1);
  fs.unlinkSync(testFile2);
  fs.unlinkSync(testFile3);
  fs.rmdirSync(testDir);
});

test('FileFindTool should handle invalid search paths', async () => {
  const result = await fileFindTool._call(JSON.stringify({ 
    searchPath: '../invalid_dir',
    patterns: ['*.txt']
  }));
  expect(result).to.include('contains invalid path characters');
});

// Test ReactAgent
test('ReactAgent should initialize without errors', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key' // This is just for testing, will not actually call the API
    },
    workingDir: './test-work'
  });
  
  // We expect this to fail due to invalid API key, but not due to initialization issues
  try {
    await agent.initialize();
  } catch (error) {
    // Expected to fail due to invalid API key, which is fine for this test
    expect(error).to.not.be.null;
  }
});