import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Librarian, type LibrarianConfig } from '../src/index.js';
import fs from 'node:fs';

describe('AI Provider Integration', () => {
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

  describe('AI Provider Configuration', () => {
    it('should create an AI model based on the configuration', () => {
      const librarian = new Librarian(mockConfig);
      // We can't easily test the actual AI model creation without real API keys,
      // but we can verify that the constructor doesn't throw an error
      expect(librarian).toBeInstanceOf(Librarian);
    });

    it('should support OpenAI provider configuration', () => {
      const config: LibrarianConfig = {
        ...mockConfig,
        aiProvider: {
          type: 'openai',
          apiKey: 'test-key',
          model: 'gpt-4o'
        }
      };
      
      const librarian = new Librarian(config);
      expect(librarian).toBeInstanceOf(Librarian);
    });

    it('should support Anthropic provider configuration', () => {
      const config: LibrarianConfig = {
        ...mockConfig,
        aiProvider: {
          type: 'anthropic',
          apiKey: 'test-key',
          model: 'claude-3-sonnet-20240229'
        }
      };
      
      const librarian = new Librarian(config);
      expect(librarian).toBeInstanceOf(Librarian);
    });

    it('should support Google provider configuration', () => {
      const config: LibrarianConfig = {
        ...mockConfig,
        aiProvider: {
          type: 'google',
          apiKey: 'test-key',
          model: 'models/gemini-pro'  // Google requires "models/" prefix
        }
      };
      
      const librarian = new Librarian(config);
      expect(librarian).toBeInstanceOf(Librarian);
    });

    it('should throw an error for unsupported provider type', () => {
      const config: LibrarianConfig = {
        ...mockConfig,
        aiProvider: {
          type: 'unsupported' as any,
          apiKey: 'test-key'
        }
      };
      
      expect(() => new Librarian(config)).toThrow('Unsupported AI provider type: unsupported');
    });
  });

  describe('Librarian Initialization', () => {
    it('should initialize without errors', async () => {
      const librarian = new Librarian(mockConfig);
      const result = await librarian.initialize();
      expect(result).toBeUndefined();
    });
  });
});