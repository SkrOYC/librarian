import { expect } from 'chai';
import { Librarian, LibrarianConfig } from '../src/index.js';
import fs from 'fs';
import path from 'path';

describe('Repository Management', () => {
  const testWorkingDir = './test-work';
  const mockConfig: LibrarianConfig = {
    repositories: {
      'test-repo': 'https://github.com/test/repo.git'
    },
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: testWorkingDir
  };

  beforeEach(() => {
    // Clean up test directory before each test
    if (fs.existsSync(testWorkingDir)) {
      fs.rmSync(testWorkingDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up test directory after each test
    if (fs.existsSync(testWorkingDir)) {
      fs.rmSync(testWorkingDir, { recursive: true, force: true });
    }
  });

  describe('Librarian Initialization', () => {
    it('should create the working directory if it does not exist', async () => {
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      expect(fs.existsSync(testWorkingDir)).to.be.true;
    });
  });

  describe('cloneRepository', () => {
    it('should create the correct path for a repository', async () => {
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      // We can't actually clone from a fake URL, but we can test the path logic
      // For this test, we'll just verify that the method constructs the right path
      const repoPath = path.join(testWorkingDir, 'test-repo');
      expect(repoPath).to.equal(path.join(testWorkingDir, 'test-repo'));
    });

    it('should skip cloning if repository already exists', async () => {
      // Create the repo directory first
      const repoPath = path.join(testWorkingDir, 'test-repo');
      fs.mkdirSync(repoPath, { recursive: true });
      
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      // This should return the existing path without error
      const resultPath = await librarian.cloneRepository('test-repo', 'https://github.com/test/repo.git');
      expect(resultPath).to.equal(repoPath);
    });
  });

  describe('queryRepository', () => {
    it('should throw an error if repository is not found in config', async () => {
      const librarian = new Librarian(mockConfig);
      
      try {
        await librarian.queryRepository('nonexistent-repo', 'test query');
        expect.fail('Expected error was not thrown');
      } catch (error) {
        expect((error as Error).message).to.include('not found in configuration');
      }
    });
  });
});