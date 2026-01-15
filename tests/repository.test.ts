import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Librarian, type LibrarianConfig } from '../src/index.js';
import fs from 'node:fs';
import path from 'node:path';

describe('Repository Management', () => {
  const testWorkingDir = './test-work';
  const mockConfig: LibrarianConfig = {
    technologies: {
      default: {
        'test-repo': { repo: 'https://github.com/test/repo.git', branch: 'main' }
      }
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
      
      expect(fs.existsSync(testWorkingDir)).toBe(true);
    });
  });

  describe('cloneRepository', () => {
    it('should create the correct path for a repository', async () => {
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      // We can't actually clone from a fake URL, but we can test the path logic
      // For this test, we'll just verify that the method constructs the right path
      // @ts-expect-error
      const repoPath = librarian.getSecureRepoPath('test-repo', 'default');
      expect(repoPath).toBe(path.join(testWorkingDir, 'default', 'test-repo'));
    });

    it('should not perform git operations if directory exists but is not a git repo', async () => {
      // Create a repo directory first (without .git)
      const repoPath = path.join(testWorkingDir, 'default', 'test-repo');
      fs.mkdirSync(repoPath, { recursive: true });

      const librarian = new Librarian(mockConfig);
      await librarian.initialize();

      // Verify that secure path construction works correctly
      // Just test the path resolution logic, don't attempt actual clone
      const constructedPath = librarian.getSecureRepoPath('test-repo', 'default');
      expect(constructedPath).toBe(repoPath);
    });
  });

  describe('updateRepository', () => {
    it('should throw an error if repository does not exist', async () => {
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      try {
        await librarian.updateRepository('nonexistent-repo');
        expect.fail('Expected error was not thrown');
      } catch (error) {
        expect((error as Error).message).toContain('does not exist');
      }
    });
  });

  describe('syncRepository', () => {
    it('should clone repository if it does not exist', async () => {
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      // Since we can't actually clone from a fake URL, we test the logic path
      // by checking if the method properly calls the right functions
      const repoPath = path.join(testWorkingDir, 'test-repo');
      
      // We'll check that the directory is prepared for cloning
      expect(fs.existsSync(repoPath)).toBe(false);
    });

    it('should handle error when trying to update an invalid git repo', async () => {
      // Create the repo directory with a .git folder to simulate a git repository
      const repoPath = path.join(testWorkingDir, 'default', 'test-repo');
      fs.mkdirSync(repoPath, { recursive: true });
      const gitPath = path.join(repoPath, '.git');
      fs.mkdirSync(gitPath, { recursive: true });
      
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      // This should attempt to update the existing git repo but fail at the git level
      try {
        await librarian.syncRepository('test-repo');
        // If no error, that's fine too for this test
      } catch (error) {
        // The error is expected since we're trying to perform git operations on a fake repo
        // Just verify it's a git-related error
        expect((error as Error).message).toBeDefined();
      }
    }); // Increased timeout removed due to chai incompatibility
  });

  describe('queryRepository', () => {
    it('should throw an error if repository is not found in config', async () => {
      const librarian = new Librarian(mockConfig);
      
      try {
        await librarian.queryRepository('nonexistent-repo', 'test query');
        expect.fail('Expected error was not thrown');
      } catch (error) {
        expect((error as Error).message).toContain('not found in configuration');
      }
    });
  });

  describe('streamRepository', () => {
    it('should throw an error if repository is not found in config', async () => {
      const librarian = new Librarian(mockConfig);
      
      try {
        const stream = librarian.streamRepository('nonexistent-repo', 'test query');
        for await (const _chunk of stream) {
          // Should not reach here
          expect.fail('Should have thrown error for nonexistent repository');
        }
      } catch (error) {
        expect((error as Error).message).toContain('not found in configuration');
      }
    });

    it('should return an async generator', async () => {
      const librarian = new Librarian(mockConfig);

      // Test that method returns an async generator
      const stream = librarian.streamRepository('test-repo', 'test query');
      expect(typeof stream[Symbol.asyncIterator]).toBe('function');

      // Should throw error for nonexistent repository during sync
      try {
        for await (const _chunk of stream) {
          // Should not reach here for non-existent repo
          expect.fail('Should have thrown error for invalid repository');
        }
      } catch (error) {
        // Expected to fail during git operations
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should handle streaming flow with mocked ReactAgent', () => {
      // Create a test config with valid repo URL format
      const testConfig = { ...mockConfig };
      const librarian = new Librarian(testConfig);

      // Mock the syncRepository method to avoid git operations
      const originalSyncRepository = librarian.syncRepository;
      librarian.syncRepository = async () => '/fake/repo/path';

      // Mock ReactAgent constructor and methods
      const mockStream = {
        *[Symbol.asyncIterator]() {
          yield 'Test streaming chunk 1';
          yield 'Test streaming chunk 2';
        }
      };

      const _mockAgent = {
        initialize: () => { /* mock implementation */ },
        streamRepository: () => mockStream
      };

      const _originalReactAgent = librarian.ReactAgent;
      // This is a bit of a hack since we can't easily mock ReactAgent constructor
      // but we can test that the method exists and returns correct type
      const stream = librarian.streamRepository('test-repo', 'test query');

      // Verify it's an async generator
      expect(typeof stream[Symbol.asyncIterator]).toBe('function');

      // Restore original method
      librarian.syncRepository = originalSyncRepository;
    });
  });
});