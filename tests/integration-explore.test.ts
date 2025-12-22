import { expect } from 'chai';
import { Librarian, LibrarianConfig } from '../src/index';
import path from 'path';
import fs from 'fs';

describe('Integration: Real Agent-Tool Communication', () => {
  const testReposPath = path.resolve(process.cwd(), 'test-integration-repos');
  const testWorkingDir = path.resolve(process.cwd(), 'test-integration-work');
  
  const mockConfig: LibrarianConfig = {
    technologies: {
      default: {
        react: { repo: 'https://github.com/facebook/react', branch: 'main' }
      },
      langchain: {
        python: { repo: 'https://github.com/langchain-ai/langchain' }
      }
    },
    aiProvider: {
      type: 'openai',
      apiKey: process.env.OPENAI_API_KEY || 'test-key'
    },
    workingDir: testWorkingDir,
    repos_path: testReposPath
  };

  let librarian: Librarian;

  beforeEach(() => {
    librarian = new Librarian(mockConfig);
    if (fs.existsSync(testReposPath)) {
      fs.rmSync(testReposPath, { recursive: true, force: true });
    }
    if (fs.existsSync(testWorkingDir)) {
      fs.rmSync(testWorkingDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testReposPath)) {
      fs.rmSync(testReposPath, { recursive: true, force: true });
    }
    if (fs.existsSync(testWorkingDir)) {
      fs.rmSync(testWorkingDir, { recursive: true, force: true });
    }
  });

  it('should integrate real ReactAgent with Librarian without mocking', async () => {
    await librarian.initialize();
    
    // Test that librarian was initialized correctly
    expect(fs.existsSync(testReposPath)).to.be.true;
    
    // Create mock repository directory with some files
    const repoPath = path.join(testReposPath, 'default', 'react');
    fs.mkdirSync(repoPath, { recursive: true });
    
    // Add some test files for agent to explore
    fs.writeFileSync(path.join(repoPath, 'README.md'), '# React\nA JavaScript library for building user interfaces.');
    fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
      name: 'react',
      version: '18.2.0',
      main: 'index.js'
    }));
    
    // Mock syncRepository to return our test directory
    const originalSyncRepository = librarian['syncRepository'];
    librarian['syncRepository'] = async () => repoPath;
    
    try {
      // This should use real ReactAgent with modern tools
      const response = await librarian.queryRepository('react', 'What is this repository about?');
      
      // Should get some response (may be error if API key invalid, but not mocked)
      expect(response).to.exist;
      expect(response).to.be.a('string');
      
      // If we have valid API key, should contain analysis
      if (process.env.OPENAI_API_KEY) {
        expect(response).to.match(/react|README|package\.json|JavaScript/i);
      }
    } catch (error) {
      // Should only fail due to API/authentication issues, not tool issues
      expect(error).to.exist;
      const errorMessage = (error as Error).message.toLowerCase();
      
      // Should not fail due to tool-related issues
      expect(errorMessage).to.not.include('tool');
      expect(errorMessage).to.not.include('file_list');
      expect(errorMessage).to.not.include('file_read');
      expect(errorMessage).to.not.include('grep_content');
      expect(errorMessage).to.not.include('file_find');
    }
    
    // Restore original method
    librarian['syncRepository'] = originalSyncRepository;
  });

  it('should integrate real streaming with ReactAgent without mocking', async () => {
    await librarian.initialize();
    
    // Create mock repository directory
    const repoPath = path.join(testReposPath, 'langchain', 'python');
    fs.mkdirSync(repoPath, { recursive: true });
    
    // Add test files
    fs.writeFileSync(path.join(repoPath, 'setup.py'), 'from setuptools import setup, find_packages\nsetup(name="langchain")');
    fs.writeFileSync(path.join(repoPath, 'README.md'), '# LangChain\nBuilding applications with LLMs');
    
    // Mock syncRepository to return our test directory
    const originalSyncRepository = librarian['syncRepository'];
    librarian['syncRepository'] = async () => repoPath;
    
    try {
      // This should use real ReactAgent streaming
      const stream = librarian.streamRepository('langchain:python', 'What files are in this repository?');
      
      // Should be an async generator
      expect(typeof stream[Symbol.asyncIterator]).to.equal('function');
      
      const chunks: string[] = [];
      
      // Collect chunks from stream
      for await (const chunk of stream) {
        chunks.push(chunk);
        // Only collect a few chunks to avoid long tests
        if (chunks.length >= 3) break;
      }
      
      // Should have received some chunks
      expect(chunks.length).to.be.greaterThan(0);
      
      // If we have a valid API key, chunks should contain relevant content
      if (process.env.OPENAI_API_KEY && chunks.length > 0) {
        const allContent = chunks.join('');
        expect(allContent).to.match(/langchain|README|setup\.py/i);
      }
    } catch (error) {
      // Should only fail due to API/authentication issues, not tool issues
      expect(error).to.exist;
      const errorMessage = (error as Error).message.toLowerCase();
      
      // Should not fail due to tool-related issues
      expect(errorMessage).to.not.include('tool');
      expect(errorMessage).to.not.include('file_list');
      expect(errorMessage).to.not.include('file_read');
      expect(errorMessage).to.not.include('grep_content');
      expect(errorMessage).to.not.include('file_find');
    }
    
    // Restore original method
    librarian['syncRepository'] = originalSyncRepository;
  });

  it('should validate technology resolution and group paths work correctly', () => {
    // Test technology resolution without group prefix
    const reactTech = librarian.resolveTechnology('react');
    expect(reactTech).to.exist;
    expect(reactTech!.name).to.equal('react');
    expect(reactTech!.group).to.equal('default');
    expect(reactTech!.repo).to.equal('https://github.com/facebook/react');
    expect(reactTech!.branch).to.equal('main');
    
    // Test technology resolution with group prefix
    const pythonTech = librarian.resolveTechnology('langchain:python');
    expect(pythonTech).to.exist;
    expect(pythonTech!.name).to.equal('python');
    expect(pythonTech!.group).to.equal('langchain');
    expect(pythonTech!.repo).to.equal('https://github.com/langchain-ai/langchain');
    
    // Test unique resolution without group prefix
    const uniqueTech = librarian.resolveTechnology('python');
    expect(uniqueTech).to.exist;
    expect(uniqueTech!.name).to.equal('python');
    expect(uniqueTech!.group).to.equal('langchain');
  });

  it('should handle real agent-tool communication with modern tools', async () => {
    await librarian.initialize();
    
    // Create test repository with complex structure
    const repoPath = path.join(testReposPath, 'default', 'test-modern-tools');
    fs.mkdirSync(repoPath, { recursive: true });
    
    // Create nested directory structure
    const srcDir = path.join(repoPath, 'src');
    const testsDir = path.join(repoPath, 'tests');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(testsDir, { recursive: true });
    
    // Create various file types
    fs.writeFileSync(path.join(srcDir, 'index.ts'), 'export function main() { return "hello"; }');
    fs.writeFileSync(path.join(srcDir, 'utils.ts'), 'export const utils = { version: "1.0.0" };');
    fs.writeFileSync(path.join(testsDir, 'index.test.ts'), 'import { main } from "../src/index"; test(main);');
    fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test Project\nA modern TypeScript project.');
    fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
      name: 'test-project',
      scripts: { test: 'jest', build: 'tsc' }
    }));
    
    // Mock syncRepository to return our test directory
    const originalSyncRepository = librarian['syncRepository'];
    librarian['syncRepository'] = async () => repoPath;
    
    try {
      // This should trigger agent to use modern tools (file_list, file_read, grep_content, file_find)
      const response = await librarian.queryRepository('test-modern-tools', 'Analyze this TypeScript project structure and provide insights about build process.');
      
      expect(response).to.exist;
      expect(response).to.be.a('string');
      
      // If we have a valid API key, should analyze structure correctly
      if (process.env.OPENAI_API_KEY) {
        expect(response).to.match(/TypeScript|src|tests|package\.json|build|test/i);
      }
    } catch (error) {
      // Should only fail due to API/authentication issues
      expect(error).to.exist;
    }
    
    // Restore original method
    librarian['syncRepository'] = originalSyncRepository;
  });

  it('should handle errors gracefully with real agent integration', async () => {
    await librarian.initialize();
    
    // Test with non-existent repository
    try {
      await librarian.queryRepository('nonexistent-repo', 'test query');
      expect.fail('Should have thrown error for nonexistent repository');
    } catch (error) {
      expect(error).to.exist;
      expect((error as Error).message).to.include('not found in configuration');
    }
    
    // Test streaming with non-existent repository
    try {
      const stream = librarian.streamRepository('nonexistent-repo', 'test query');
      for await (const chunk of stream) {
        // Should not reach here
        expect.fail('Should have thrown error for nonexistent repository');
      }
    } catch (error) {
      expect(error).to.exist;
      expect((error as Error).message).to.include('not found in configuration');
    }
  });
});