import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Librarian, LibrarianConfig } from '../src/index';
import path from 'path';
import fs from 'fs';

describe('Path Resolution and Sandboxing', () => {
  const testReposPath = './test-repos';
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
      apiKey: 'test-key'
    },
    workingDir: './old-work',
    repos_path: testReposPath
  };

  let librarian: Librarian;

  beforeEach(() => {
    librarian = new Librarian(mockConfig);
    if (fs.existsSync(testReposPath)) {
      fs.rmSync(testReposPath, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testReposPath)) {
      fs.rmSync(testReposPath, { recursive: true, force: true });
    }
  });

  it('should resolve tech path to {repos_path}/{group}/{tech}', () => {
    // We need to expose or test the internal path resolution
    // For now let's assume we'll have a getTechPath and getGroupPath
    const techDetails = librarian.resolveTechnology('react');
    expect(techDetails).toBeDefined();
    
    // @ts-ignore - testing internal/private-ish logic if needed or public API
    const repoPath = librarian['getSecureRepoPath'](techDetails!.name, techDetails!.group);
    const expectedPath = path.join(testReposPath, 'default', 'react');
    expect(path.resolve(repoPath)).toBe(path.resolve(expectedPath));
  });

  it('should resolve group path to {repos_path}/{group}', () => {
    // @ts-ignore
    const groupPath = librarian['getSecureGroupPath']('langchain');
    const expectedPath = path.join(testReposPath, 'langchain');
    expect(path.resolve(groupPath)).toBe(path.resolve(expectedPath));
  });

  it('should prevent directory traversal in tech name', () => {
    expect(() => {
      // @ts-ignore
      librarian['getSecureRepoPath']('../evil', 'default');
    }).toThrow();
  });

  it('should prevent directory traversal in group name', () => {
    expect(() => {
      // @ts-ignore
      librarian['getSecureGroupPath']('../evil');
    }).toThrow();
  });
});
