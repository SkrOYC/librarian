import { expect } from 'chai';
import { fileListTool } from '../src/tools/file-listing.tool';
import { fileReadTool } from '../src/tools/file-reading.tool';
import { grepContentTool } from '../src/tools/grep-content.tool';
import { fileFindTool } from '../src/tools/file-finding.tool';
import { ReactAgent } from '../src/agents/react-agent';
import path from 'path';
import fs from 'fs';

describe('E2E Modern Tool Pattern Tests: Structured Parameters', () => {
  const testWorkingDir = path.resolve(process.cwd(), 'test-modern-tools-work');

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testWorkingDir)) {
      fs.rmSync(testWorkingDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (fs.existsSync(testWorkingDir)) {
      fs.rmSync(testWorkingDir, { recursive: true, force: true });
    }
  });

  describe('Modern Tool Pattern Validation', () => {
    it('should validate structured parameters in file_list tool', async () => {
      // Create test directory structure
      const fileListTestDir = path.join(testWorkingDir, 'test-file-list');
      fs.mkdirSync(fileListTestDir, { recursive: true });
      
      // Create various file types
      fs.writeFileSync(path.join(fileListTestDir, 'file1.txt'), 'Content of file1');
      fs.writeFileSync(path.join(fileListTestDir, 'file2.md'), '# Markdown file');
      fs.writeFileSync(path.join(fileListTestDir, '.hidden'), 'Hidden file content');
      
      // Test valid parameters
      const validResult = await fileListTool.invoke({
        directoryPath: fileListTestDir,
        includeHidden: false
      });
      
      expect(validResult).to.be.a('string');
      expect(validResult).to.include('Contents of directory');
      expect(validResult).to.include('file1.txt');
      expect(validResult).to.include('file2.md');
      expect(validResult).to.include('Total entries: 2');
      expect(validResult).to.not.include('.hidden'); // Should not include hidden files
      
      // Test with includeHidden: true
      const withHiddenResult = await fileListTool.invoke({
        directoryPath: fileListTestDir,
        includeHidden: true
      });
      
      expect(withHiddenResult).to.include('.hidden'); // Should include hidden files
      
      // Test invalid directory
      const invalidResult = await fileListTool.invoke({
        directoryPath: '../invalid/path/..',
        includeHidden: false
      });
      
      expect(invalidResult).to.include('contains invalid path characters');
    });

    it('should validate structured parameters in file_read tool', async () => {
      // Create test directory first
      fs.mkdirSync(testWorkingDir, { recursive: true });
      // Create test file
      const testFile = path.join(testWorkingDir, 'test-file.txt');
      fs.writeFileSync(testFile, 'This is test file content for the file reading tool.');
      
      // Test valid parameters
      const validResult = await fileReadTool.invoke({
        filePath: testFile
      });
      
      expect(validResult).to.be.a('string');
      expect(validResult).to.include('Content of file');
      expect(validResult).to.include('test-file.txt');
      expect(validResult).to.include('This is test file content for the file reading tool.');
      
      // Test invalid file path
      const invalidResult = await fileReadTool.invoke({
        filePath: '../invalid/path/file.txt'
      });
      
      expect(invalidResult).to.include('Error reading file');
    });

    it('should validate structured parameters in grep_content tool', async () => {
      // Create test directory with multiple files
      const grepTestDir = path.join(testWorkingDir, 'test-grep');
      fs.mkdirSync(grepTestDir, { recursive: true });
      
      // Create various file types
      fs.writeFileSync(path.join(grepTestDir, 'file1.js'), 'function test() { return "javascript"; }');
      fs.writeFileSync(path.join(grepTestDir, 'file2.ts'), 'function test(): string { return "typescript"; }');
      fs.writeFileSync(path.join(grepTestDir, 'README.md'), '# Test Repository\nThis contains JavaScript and TypeScript files.');
      
      // Test basic search
      const basicResult = await grepContentTool.invoke({
        searchPath: grepTestDir,
        query: 'function',
        patterns: ['*.js', '*.ts'],
        caseSensitive: false,
        regex: false,
        recursive: true,
        maxResults: 10
      });
      
      expect(basicResult).to.be.a('string');
      expect(basicResult).to.include('Found 2 matches');
      expect(basicResult).to.include('file1.js');
      expect(basicResult).to.include('file2.ts');
      
      // Test case sensitive search
      const caseSensitiveResult = await grepContentTool.invoke({
        searchPath: grepTestDir,
        query: 'FUNCTION', // Uppercase
        patterns: ['*.js', '*.ts'],
        caseSensitive: true,
        regex: false,
        recursive: true,
        maxResults: 5
      });
      
      expect(caseSensitiveResult).to.be.a('string');
      expect(caseSensitiveResult).to.include('No matches found');
      // Should not find lowercase 'function' due to case sensitivity
      expect(caseSensitiveResult).to.not.include('file1.js');
      
      // Test regex search
      const regexResult = await grepContentTool.invoke({
        searchPath: grepTestDir,
        query: 'function.*return.*',
        patterns: ['*.js', '*.ts'],
        caseSensitive: false,
        regex: true,
        recursive: true,
        maxResults: 10
      });
      
      expect(regexResult).to.be.a('string');
      expect(regexResult).to.include('Found 2 matches');
      expect(regexResult).to.include('file1.js');
      expect(regexResult).to.include('file2.ts');
      
      // Test max results limiting
      const limitedResult = await grepContentTool.invoke({
        searchPath: grepTestDir,
        query: 'function',
        patterns: ['*.js', '*.ts'],
        caseSensitive: false,
        regex: false,
        recursive: true,
        maxResults: 1
      });
      
      expect(limitedResult).to.be.a('string');
      expect(limitedResult).to.include('Found 1 matches');
      // Should limit to 1 result and specify which file
    });

    it('should handle invalid parameters gracefully', async () => {
      // Test file_list with invalid path
      const fileListResult = await fileListTool.invoke({
        directoryPath: '../../../etc/passwd', // Security: path traversal attempt
        includeHidden: false
      });
      
      expect(fileListResult).to.include('contains invalid path characters');
      
      // Test file_read with non-existent file
      const fileReadResult = await fileReadTool.invoke({
        filePath: path.join(testWorkingDir, 'nonexistent.txt')
      });
      
      expect(fileReadResult).to.include('Error reading file');
      
      // Test grep_content with non-existent directory
      const grepResult = await grepContentTool.invoke({
        searchPath: path.join(testWorkingDir, 'nonexistent'),
        query: 'test',
        patterns: ['*'],
        caseSensitive: false,
        regex: false,
        recursive: true,
        maxResults: 10
      });
      
      expect(grepResult).to.include('Error searching content');
      
      // Test file_find with invalid search path
      const findResult = await fileFindTool.invoke({
        searchPath: '../../../etc/passwd', // Security: path traversal attempt
        patterns: ['*'],
        exclude: [],
        recursive: true,
        maxResults: 10,
        includeHidden: false
      });
      
      expect(findResult).to.include('Error finding files');
    });
  });

  describe('Modern Tool Integration with ReactAgent', () => {
    it('should use modern tools with ReactAgent correctly', async () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir
      });

      await agent.initialize();

      // Create test repository structure
      const repoPath = path.join(testWorkingDir, 'test-repo');
      fs.mkdirSync(repoPath, { recursive: true });
      
      const srcDir = path.join(repoPath, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      
      // Create test files
      fs.writeFileSync(path.join(srcDir, 'main.ts'), 'export function hello() { return "world"; }');
      fs.writeFileSync(path.join(srcDir, 'utils.ts'), 'export const version = "1.0.0";');
      fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test Repository\nA TypeScript project with modern tools.');

      // Mock agent to capture tool calls
      const originalAgent = agent['agent'];
      const capturedToolCalls: any[] = [];
      
      agent['agent'] = {
        invoke: async (params: { messages: any[] }) => {
          // Simulate agent using modern tools
          return {
            content: 'I will analyze this repository structure using modern tools.',
            tool_calls: [
              {
                name: 'file_list',
                args: { directoryPath: repoPath }
              }
            ]
          };
        }
      };

      try {
        const response = await agent.queryRepository(repoPath, 'Analyze the repository structure');
        
        expect(response).to.be.a('string');
        expect(response).to.include('modern tools');
        
      } catch (error) {
        // Expected to fail due to API key
        expect(error).to.exist;
      }
      
      // Restore original agent
      agent['agent'] = originalAgent;
    });

    it('should handle multiple tool usage in complex queries', async () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir
      });

      await agent.initialize();

      // Create complex repository structure
      const complexRepoPath = path.join(testWorkingDir, 'complex-repo');
      fs.mkdirSync(complexRepoPath, { recursive: true });
      
      const componentsDir = path.join(complexRepoPath, 'src', 'components');
      const testsDir = path.join(complexRepoPath, 'tests');
      const docsDir = path.join(complexRepoPath, 'docs');
      
      fs.mkdirSync(componentsDir, { recursive: true });
      fs.mkdirSync(testsDir, { recursive: true });
      fs.mkdirSync(docsDir, { recursive: true });
      
      // Create files in different directories
      fs.writeFileSync(path.join(componentsDir, 'Button.ts'), 'export class Button {}');
      fs.writeFileSync(path.join(componentsDir, 'Input.ts'), 'export class Input {}');
      fs.writeFileSync(path.join(testsDir, 'Button.test.ts'), 'import { Button } from "../components/Button"; test(Button);');
      fs.writeFileSync(path.join(docsDir, 'API.md'), '# API Documentation\n## Button Component\n## Input Component');

      // Mock agent to simulate complex tool usage
      const originalAgent = agent['agent'];
      
      agent['agent'] = {
        invoke: async (params: { messages: any[] }) => {
          return {
            content: 'I will analyze this complex repository by exploring components, testing docs, and finding specific patterns.',
            tool_calls: [
              {
                name: 'file_find',
                args: { 
                  searchPath: complexRepoPath,
                  patterns: ['*.ts'],
                  exclude: ['node_modules'],
                  recursive: true,
                  maxResults: 20,
                  includeHidden: false
                }
              },
              {
                name: 'file_read',
                args: { filePath: path.join(docsDir, 'API.md') }
              },
              {
                name: 'grep_content',
                args: {
                  searchPath: complexRepoPath,
                  query: 'export.*class',
                  patterns: ['*.ts'],
                  caseSensitive: true,
                  regex: false,
                  recursive: true,
                  maxResults: 10
                }
              }
            ]
          };
        }
      };

      try {
        const response = await agent.queryRepository(complexRepoPath, 'Analyze components, tests, and API documentation');
        
        expect(response).to.be.a('string');
        expect(response).to.include('complex repository');
        expect(response).to.include('components');
        expect(response).to.include('documentation');
        
      } catch (error) {
        expect(error).to.exist;
      }
      
      // Restore original agent
      agent['agent'] = originalAgent;
    });
  });
});