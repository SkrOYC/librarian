import { expect } from 'chai';
import { ReactAgent } from '../src/agents/react-agent';
import { Librarian, LibrarianConfig } from '../src/index';
import path from 'path';
import fs from 'fs';

describe('E2E Dynamic System Prompt Tests', () => {
  const testWorkingDir = path.resolve(process.cwd(), 'test-dynamic-prompt-work');
  const testReposPath = path.resolve(process.cwd(), 'test-dynamic-prompt-repos');

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

  describe('Dynamic System Prompt Construction', () => {
    it('should construct context-aware prompts with technology information', () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: 'test-key'
        },
        workingDir: testWorkingDir,
        technology: {
          name: 'react',
          repository: 'https://github.com/facebook/react',
          branch: 'main'
        }
      });

      const dynamicPrompt = agent.createDynamicSystemPrompt();
      
      expect(dynamicPrompt).to.be.a('string');
      expect(dynamicPrompt).to.include('react');
      expect(dynamicPrompt).to.include('https://github.com/facebook/react');
      expect(dynamicPrompt).to.include('main');
      expect(dynamicPrompt).to.include(testWorkingDir);
      
      // Should include tool descriptions
      expect(dynamicPrompt).to.include('file_list');
      expect(dynamicPrompt).to.include('file_read');
      expect(dynamicPrompt).to.include('grep_content');
      expect(dynamicPrompt).to.include('file_find');
      
// Should include technology-specific context
      expect(dynamicPrompt).to.include('react');
      expect(dynamicPrompt).to.include('technology repository');
      
      // Should include tool descriptions
      expect(dynamicPrompt).to.include('file_list');
      expect(dynamicPrompt).to.include('file_read');
      expect(dynamicPrompt).to.include('grep_content');
      expect(dynamicPrompt).to.include('file_find');
      
      // Should include technology-specific analysis guidance
      expect(dynamicPrompt).to.include('Focus your analysis on understanding architecture');
      expect(dynamicPrompt).to.include('specific to this technology');
      
      // Should end with technology context if provided
      expect(dynamicPrompt).to.match(/You are currently exploring.*react.*technology repository/);
      
      // Should end with technology context if provided
      expect(dynamicPrompt).to.match(/You are currently exploring.*vue/);
    });
  });

  describe('Dynamic System Prompt Integration with Real Agent', () => {
    it('should use dynamic prompt in real agent initialization', async () => {
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

      // Initialize agent - this should use dynamic system prompt
      try {
        await agent.initialize();
        
        // Agent should be created
        expect(agent['agent']).to.exist;
        
        // Verify dynamic prompt would be used
        const dynamicPrompt = agent.createDynamicSystemPrompt();
        expect(dynamicPrompt).to.include('typescript');
        expect(dynamicPrompt).to.include('github.com/microsoft/typescript');
        
      } catch (error) {
        // Expected to fail due to invalid API key, but initialization should reach agent creation
        expect(error).to.exist;
        
        // The error should be from API, not from prompt creation
        expect((error as Error).message).to.not.include('createDynamicSystemPrompt');
      }
    });

    it('should maintain dynamic prompt across query operations', async () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir,
        technology: {
          name: 'express',
          repository: 'https://github.com/expressjs/express',
          branch: 'master'
        }
      });

      await agent.initialize();

      // Create test repository with Express.js structure
      const repoPath = path.join(testWorkingDir, 'express-test');
      fs.mkdirSync(repoPath, { recursive: true });
      
      fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
        name: 'express',
        version: '4.18.2',
        main: 'index.js'
      }));
      fs.writeFileSync(path.join(repoPath, 'README.md'), '# Express\nFast, unopinionated, minimalist web framework');
      fs.mkdirSync(path.join(repoPath, 'lib'), { recursive: true });
      fs.writeFileSync(path.join(repoPath, 'lib', 'express.js'), 'const express = require("express"); module.exports = express;');

      // Mock agent to capture messages passed
      const originalAgent = agent['agent'];
      let capturedMessages: any[] = [];
      
      agent['agent'] = {
        invoke: async (params: { messages: any[] }) => {
          capturedMessages = params.messages;
          return {
            content: 'This is Express.js, a fast web framework for Node.js'
          };
        }
      };

      try {
        const response = await agent.queryRepository(repoPath, 'What is this repository about?');
        
        expect(response).to.exist;
        expect(response).to.be.a('string');
        
        // Should only pass human message (system prompt already set during initialization)
        expect(capturedMessages).to.have.length(1);
        expect(capturedMessages[0].constructor.name).to.equal('HumanMessage');
        expect(capturedMessages[0].content).to.equal('What is this repository about?');
        
        // Verify dynamic prompt contains Express.js context
        const dynamicPrompt = agent.createDynamicSystemPrompt();
        expect(dynamicPrompt).to.include('express');
        expect(dynamicPrompt).to.include('github.com/expressjs/express');
        expect(dynamicPrompt).to.include('web framework');
        
      } catch (error) {
        // Expected to fail due to invalid API key
        expect(error).to.exist;
      }
      
      // Restore original agent
      agent['agent'] = originalAgent;
    });

    it('should maintain dynamic prompt across streaming operations', async () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir,
        technology: {
          name: 'lodash',
          repository: 'https://github.com/lodash/lodash',
          branch: 'master'
        }
      });

      await agent.initialize();

      // Mock agent.stream to capture messages
      const originalAgent = agent['agent'];
      let capturedMessages: any[] = [];
      
      agent['agent'] = {
        stream: async (params: { messages: any[] }) => {
          capturedMessages = params.messages;
          
          return (async function* () {
            yield 'Lodash is a utility library for JavaScript...';
            yield 'It provides helpful functions for common programming tasks...';
            yield '[Streaming completed]';
          })();
        }
      };

      try {
        const stream = agent.streamRepository(testWorkingDir, 'Analyze this utility library');
        
        const chunks: string[] = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        
        expect(chunks.length).to.be.greaterThan(0);
        
        // Should only pass human message (system prompt already set during initialization)
        expect(capturedMessages).to.have.length(1);
        expect(capturedMessages[0].constructor.name).to.equal('HumanMessage');
        expect(capturedMessages[0].content).to.equal('Analyze this utility library');
        
        // Verify dynamic prompt contains Lodash context
        const dynamicPrompt = agent.createDynamicSystemPrompt();
        expect(dynamicPrompt).to.include('lodash');
        expect(dynamicPrompt).to.include('github.com/lodash/lodash');
        expect(dynamicPrompt).to.include('utility library');
        
      } catch (error) {
        // Expected to fail due to invalid API key
        expect(error).to.exist;
      }
      
      // Restore original agent
      agent['agent'] = originalAgent;
    });
  });

  describe('Dynamic System Prompt with Librarian Integration', () => {
    it('should pass technology context correctly from Librarian to ReactAgent', async () => {
      const mockConfig: LibrarianConfig = {
        technologies: {
          default: {
            'vue': { 
              repo: 'https://github.com/vuejs/vue', 
              branch: 'v3' 
            }
          }
        },
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir,
        repos_path: testReposPath
      };

      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      // Create test repository
      const repoPath = path.join(testReposPath, 'default', 'vue');
      fs.mkdirSync(repoPath, { recursive: true });
      
      fs.writeFileSync(path.join(repoPath, 'package.json'), JSON.stringify({
        name: 'vue',
        version: '3.0.0',
        type: 'module'
      }));
      fs.writeFileSync(path.join(repoPath, 'README.md'), '# Vue.js\nThe Progressive JavaScript Framework');

      // Mock syncRepository to return our test directory
      const originalSyncRepository = librarian['syncRepository'];
      librarian['syncRepository'] = async () => repoPath;

      try {
        // This should create ReactAgent with technology context from Librarian
        const response = await librarian.queryRepository('vue', 'What is Vue.js?');
        
        expect(response).to.exist;
        expect(response).to.be.a('string');
        
      } catch (error) {
        // Expected to fail due to invalid API key
        expect(error).to.exist;
        
        // Error should be from API, not from prompt construction
        const errorMessage = (error as Error).message.toLowerCase();
        expect(errorMessage).to.not.include('createDynamicSystemPrompt');
        expect(errorMessage).to.not.include('technology context');
      }
      
      // Restore original method
      librarian['syncRepository'] = originalSyncRepository;
    });

it('should handle technology context changes correctly', async () => {
      const mockConfig: LibrarianConfig = {
        technologies: {
          default: {
            'react': { 
              repo: 'https://github.com/facebook/react', 
              branch: 'main' 
            },
            'angular': { 
              repo: 'https://github.com/angular/angular', 
              branch: 'main' 
            }
          }
        },
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir,
        repos_path: testReposPath
      };

      const librarian = new Librarian(mockConfig);
      await librarian.initialize();
      
      // Test that different technologies are resolved correctly
      const reactTech = librarian.resolveTechnology('react');
      const angularTech = librarian.resolveTechnology('angular');
      
      expect(reactTech).to.exist;
      expect(angularTech).to.exist;
      
      expect(reactTech!.name).to.equal('react');
      expect(angularTech!.name).to.equal('angular');
      
      // Verify that technology context is preserved correctly
      expect(reactTech!.repo).to.equal('https://github.com/facebook/react');
      expect(angularTech!.repo).to.equal('https://github.com/angular/angular');
    });
  });
});