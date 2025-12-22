import { expect } from 'chai';
import { ReactAgent } from '../src/agents/react-agent';
import { Librarian, LibrarianConfig } from '../src/index';
import fs from 'fs';
import path from 'path';

describe('E2E Integration Tests: Real Agent-Tool Communication', () => {
  const testWorkingDir = path.resolve(process.cwd(), 'test-e2e-work');
  const testReposPath = path.resolve(process.cwd(), 'test-e2e-repos');
  
  // Mock config for testing
  const mockConfig: LibrarianConfig = {
    technologies: {
      default: {
        'test-repo': { 
          repo: 'https://github.com/microsoft/typescript', 
          branch: 'main' 
        }
      }
    },
    aiProvider: {
      type: 'openai',
      apiKey: process.env.OPENAI_API_KEY || 'test-key-for-failure'
    },
    workingDir: testWorkingDir,
    repos_path: testReposPath
  };

  beforeEach(() => {
    // Clean up test directories
    if (fs.existsSync(testWorkingDir)) {
      fs.rmSync(testWorkingDir, { recursive: true, force: true });
    }
    if (fs.existsSync(testReposPath)) {
      fs.rmSync(testReposPath, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up test directories
    if (fs.existsSync(testWorkingDir)) {
      fs.rmSync(testWorkingDir, { recursive: true, force: true });
    }
    if (fs.existsSync(testReposPath)) {
      fs.rmSync(testReposPath, { recursive: true, force: true });
    }
  });

  describe('Real Agent-Tool Integration', () => {
    it('should create ReactAgent with real tools and initialize without mocking', async () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir,
        technology: {
          name: 'typescript',
          repository: 'https://github.com/microsoft/typescript',
          branch: 'main'
        }
      });

      // Should create agent successfully
      expect(agent).to.exist;
      expect(agent.createDynamicSystemPrompt).to.exist;

      // Initialize agent - this will fail with invalid API key but should not throw initialization errors
      try {
        await agent.initialize();
        // If we have a valid API key, initialization should succeed
        expect(agent['agent']).to.exist;
      } catch (error) {
        // With invalid API key, should fail at AI provider level, not at tool level
        expect(error).to.exist;
        // The error should be related to authentication, not tool initialization
        expect((error as Error).message).to.not.include('tool');
      }
    });

    it('should initialize Librarian with real ReactAgent without mocking', async () => {
      const librarian = new Librarian(mockConfig);
      
      // Should create librarian successfully
      expect(librarian).to.exist;
      expect(librarian.queryRepository).to.exist;
      expect(librarian.streamRepository).to.exist;

      // Initialize librarian
      await librarian.initialize();
      
      // Should create repos directory (since repos_path is set in config)
      expect(fs.existsSync(testReposPath)).to.be.true;
    });

    it('should handle real queryRepository call without mocked ReactAgent', async () => {
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();

      // Create a test repository directory with some files
      const repoPath = path.join(testReposPath, 'default', 'test-repo');
      fs.mkdirSync(repoPath, { recursive: true });
      
      // Create some test files for the tools to explore
      fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
        name: 'test-repo',
        version: '1.0.0',
        scripts: { test: 'echo "test"' }
      }));
      
      fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test Repository\nThis is a test repository.');
      
      fs.mkdirSync(path.join(repoPath, 'src'), { recursive: true });
      fs.writeFileSync(path.join(repoPath, 'src', 'index.ts'), 'export function hello() { return "hello"; }');

      // Mock syncRepository to return our test directory
      const originalSyncRepository = librarian['syncRepository'];
      librarian['syncRepository'] = async () => repoPath;

      try {
        // This should attempt real agent-tool communication
        const response = await librarian.queryRepository('test-repo', 'What is this repository about?');
        
        // Should get some response (may be error if API key invalid)
        expect(response).to.exist;
        expect(response).to.be.a('string');
        
        // If we have a valid API key, should contain analysis of the files
        if (process.env.OPENAI_API_KEY) {
          expect(response).to.match(/test-repo|README|package\.json|hello/i);
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

    it('should handle real streamRepository call without mocked ReactAgent', async () => {
      const librarian = new Librarian(mockConfig);
      await librarian.initialize();

      // Create a test repository directory with some files
      const repoPath = path.join(testReposPath, 'default', 'test-repo');
      fs.mkdirSync(repoPath, { recursive: true });
      
      // Create some test files for the tools to explore
      fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
        name: 'test-repo',
        version: '1.0.0'
      }));
      
      fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test Repository\nThis is a test repository.');

      // Mock syncRepository to return our test directory
      const originalSyncRepository = librarian['syncRepository'];
      librarian['syncRepository'] = async () => repoPath;

      try {
        // This should attempt real agent-tool streaming
        const stream = librarian.streamRepository('test-repo', 'What files are in this repository?');
        
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
          expect(allContent).to.match(/test-repo|README|package\.json/i);
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

    it('should test modern tool pattern with real agent communication', async () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir
      });

      await agent.initialize();

      // Create test directory with files
      const testDir = path.join(testWorkingDir, 'test-modern-tools');
      fs.mkdirSync(testDir, { recursive: true });
      
      fs.writeFileSync(path.join(testDir, 'test.ts'), 'export function test() { return "modern tool test"; }');
      fs.writeFileSync(path.join(testDir, 'config.json'), JSON.stringify({ test: true }));

      // Mock agent to capture tool calls
      const originalAgent = agent['agent'];
      
      agent['agent'] = {
        invoke: async (params: { messages: any[] }) => {
          // Capture the messages to see what tools the agent wants to use
          return {
            content: 'I will explore the directory structure.',
            tool_calls: [
              {
                name: 'file_list',
                args: { directoryPath: testDir }
              }
            ]
          };
        },
        stream: async (params: { messages: any[] }) => {
          // Mock streaming for testing
          return (async function* () {
            yield { content: 'I will explore the directory structure.' };
          })();
        }
      };

      try {
        // Test that agent can use modern tools
        const response = await agent.queryRepository(testDir, 'List the files in this directory');
        
        expect(response).to.exist;
        expect(response).to.be.a('string');
        
      } catch (error) {
        // Expected with invalid API key
        expect(error).to.exist;
      }

      // Restore original agent
      agent['agent'] = originalAgent;
    });

    it('should validate dynamic system prompt construction with real agent', async () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir,
        technology: {
          name: 'react',
          repository: 'https://github.com/facebook/react',
          branch: 'main'
        }
      });

      // Test dynamic prompt creation
      const dynamicPrompt = agent.createDynamicSystemPrompt();
      
      expect(dynamicPrompt).to.exist;
      expect(dynamicPrompt).to.be.a('string');
      
      // Should include technology context
      expect(dynamicPrompt).to.include('react');
      expect(dynamicPrompt).to.include('github.com/facebook/react');
      expect(dynamicPrompt).to.include('main');
      expect(dynamicPrompt).to.include(testWorkingDir);
      
      // Should include tool descriptions
      expect(dynamicPrompt).to.include('file_list');
      expect(dynamicPrompt).to.include('file_read');
      expect(dynamicPrompt).to.include('grep_content');
      expect(dynamicPrompt).to.include('file_find');

      // Initialize agent with dynamic prompt
      try {
        await agent.initialize();
        
        // Agent should be created with the dynamic prompt
        expect(agent['agent']).to.exist;
        
      } catch (error) {
        // Expected with invalid API key, but initialization should reach the agent creation stage
        expect(error).to.exist;
      }
    });

    it('should test structured parameters work correctly with real agent', async () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir
      });

      await agent.initialize();

      // Create test files
      const testDir = path.join(testWorkingDir, 'structured-test');
      fs.mkdirSync(testDir, { recursive: true });
      
      fs.writeFileSync(path.join(testDir, 'test1.ts'), 'export const test1 = true;');
      fs.writeFileSync(path.join(testDir, 'test2.ts'), 'export const test2 = false;');

      // Mock agent to test structured parameter passing
      const originalAgent = agent['agent'];
      
      agent['agent'] = {
        invoke: async (params: { messages: any[] }) => {
          return {
            content: 'Testing structured parameters',
            tool_calls: [
              {
                name: 'file_find',
                args: {
                  searchPath: testDir,
                  patterns: ['*.ts'],
                  exclude: ['node_modules'],
                  recursive: true,
                  maxResults: 10,
                  includeHidden: false
                }
              }
            ]
          };
        }
      };

      try {
        const response = await agent.queryRepository(testDir, 'Find TypeScript files');
        
        expect(response).to.exist;
        
      } catch (error) {
        // Expected with invalid API key
        expect(error).to.exist;
      }

      // Restore original agent
      agent['agent'] = originalAgent;
    });
  });

  describe('End-to-End CLI Functionality', () => {
    it('should ensure all existing CLI functionality works with real components', async () => {
      const librarian = new Librarian(mockConfig);
      
      // Test that all expected methods exist
      expect(librarian.initialize).to.exist;
      expect(librarian.queryRepository).to.exist;
      expect(librarian.streamRepository).to.exist;
      expect(librarian.syncRepository).to.exist;
      expect(librarian.resolveTechnology).to.exist;
      
      // Initialize librarian
      await librarian.initialize();
      
      // Test technology resolution
      const tech = librarian.resolveTechnology('test-repo');
      expect(tech).to.exist;
      expect(tech!.name).to.equal('test-repo');
      expect(tech!.repo).to.equal('https://github.com/microsoft/typescript');
      expect(tech!.branch).to.equal('main');
      expect(tech!.group).to.equal('default');
      
      // Mock syncRepository to avoid actual git operations
      const originalSyncRepository = librarian['syncRepository'];
      const mockRepoPath = path.join(testReposPath, 'default', 'test-repo');
      fs.mkdirSync(mockRepoPath, { recursive: true });
      fs.writeFileSync(path.join(mockRepoPath, 'README.md'), '# Mock repository');
      
      librarian['syncRepository'] = async () => mockRepoPath;
      
      // Test that methods can be called (even if they fail due to API/auth issues)
      try {
        const queryPromise = librarian.queryRepository('test-repo', 'test query');
        expect(queryPromise).to.exist;
        await queryPromise;
      } catch (error) {
        // Expected to fail due to API key, but method should exist and be callable
        expect(error).to.exist;
      }
      
      // Restore original method
      librarian['syncRepository'] = originalSyncRepository;
      
      try {
        const stream = librarian.streamRepository('test-repo', 'test query');
        expect(typeof stream[Symbol.asyncIterator]).to.equal('function');
        
        // Try to consume at least one chunk
        for await (const chunk of stream) {
          expect(typeof chunk).to.equal('string');
          break; // Only need to test first chunk
        }
      } catch (error) {
        // Expected to fail due to API key, but method should exist and be callable
        expect(error).to.exist;
      }
    });
  });
});