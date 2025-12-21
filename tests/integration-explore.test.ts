import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Librarian, LibrarianConfig } from '../src/index';
import path from 'path';
import fs from 'fs';

// Mock ReactAgent to avoid LLM calls
mock.module('../src/agents/react-agent', () => {
  return {
    ReactAgent: class {
      constructor() {}
      async initialize() {}
      async queryRepository(repoPath: string, query: string) {
        return `Mocked response for ${query} in ${repoPath}`;
      }
    }
  };
});

describe('Integration: Explore Workflow', () => {
  const testReposPath = path.resolve(process.cwd(), 'test-integration-repos');
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

  it('should flow through explore --tech correctly', async () => {
    // We need to mock syncRepository to avoid actual cloning
    const syncMock = mock(() => Promise.resolve(path.join(testReposPath, 'default', 'react')));
    librarian.syncRepository = syncMock;

    // Currently Librarian.queryRepository doesn't use ReactAgent yet.
    // This integration test will help us verify the switch to ReactAgent.
    
    // We'll simulate what the CLI does
    const techDetails = librarian.resolveTechnology('react');
    expect(techDetails).toBeDefined();
    
    // For now, let's just test that syncRepository is called with correct tech
    const repoPath = await librarian.syncRepository(techDetails!.name);
    expect(repoPath).toContain('default/react');
    expect(syncMock).toHaveBeenCalled();
  });

  it('should support exploring a group', async () => {
    // This is more of a CLI level test but we can test resolveTechnology and group path logic
    const groupPath = librarian['getSecureGroupPath']('langchain');
    expect(groupPath).toContain('langchain');
    
    const pythonTech = librarian.resolveTechnology('langchain:python');
    expect(pythonTech).toBeDefined();
    expect(pythonTech!.group).toBe('langchain');
  });

  it('should resolve technology without group prefix if unique', () => {
    const tech = librarian.resolveTechnology('python');
    expect(tech).toBeDefined();
    expect(tech!.group).toBe('langchain');
  });
});
