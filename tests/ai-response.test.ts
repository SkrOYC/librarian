import { expect } from 'chai';
import { Librarian, LibrarianConfig } from '../src/index.js';
import fs from 'fs';
import path from 'path';

describe('AI Query/Response Mechanism', () => {
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

  describe('Repository Content Reading', () => {
    it('should read repository contents correctly', async () => {
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      // Create a test repository structure
      const repoPath = path.join(testWorkingDir, 'test-repo');
      fs.mkdirSync(repoPath, { recursive: true });
      fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test Repo');
      fs.writeFileSync(path.join(repoPath, 'index.js'), 'console.log("hello");');
      
      // Test the private method by accessing it through the class
      const files = (librarian as any).walkDirectory(repoPath);
      expect(files).to.include(path.join(repoPath, 'README.md'));
      expect(files).to.include(path.join(repoPath, 'index.js'));
    });
  });

  describe('Path Sanitization', () => {
    it('should prevent directory traversal', async () => {
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      expect(() => {
        (librarian as any).getSecureRepoPath('../../../etc/passwd');
      }).to.throw(/contains invalid path characters/);
    });
  });
});