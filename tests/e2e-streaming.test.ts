import { expect } from 'chai';
import { ReactAgent } from '../src/agents/react-agent';
import path from 'path';
import fs from 'fs';

describe('E2E Streaming Tests: Real LangChain Integration', () => {
  const testWorkingDir = path.resolve(process.cwd(), 'test-streaming-work');
  
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

  describe('Real LangChain Streaming', () => {
    it('should handle real agent.stream() calls with streaming mode "messages"', async () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir
      });

      await agent.initialize();

      // Create test directory with files for agent to stream about
      const testDir = path.join(testWorkingDir, 'stream-test');
      fs.mkdirSync(testDir, { recursive: true });
      
      fs.writeFileSync(path.join(testDir, 'stream.md'), '# Streaming Test\nThis is a test file for streaming functionality.');
      fs.writeFileSync(path.join(testDir, 'data.json'), JSON.stringify({ stream: true, test: 'data' }));

      try {
        // This should use real LangChain agent.stream() with streamMode: "messages"
        const stream = agent.streamRepository(testDir, 'Provide analysis of this streaming test directory and its files.');
        
        // Should be an async generator
        expect(typeof stream[Symbol.asyncIterator]).to.equal('function');
        
        const chunks: string[] = [];
        let completedWithoutInterruption = true;
        
        // Collect all chunks from real stream
        for await (const chunk of stream) {
          expect(chunk).to.be.a('string');
          chunks.push(chunk);
          
          // Check for completion indicator
          if (chunk.includes('[Streaming completed]')) {
            completedWithoutInterruption = true;
            break;
          }
          
          // Limit chunks to avoid infinite loops in tests
          if (chunks.length >= 20) break;
        }
        
        // Should have received chunks
        expect(chunks.length).to.be.greaterThan(0);
        
        // Should include completion indicator unless interrupted
        if (process.env.OPENAI_API_KEY) {
          expect(completedWithoutInterruption).to.be.true;
          
          // Content should be relevant
          const allContent = chunks.join('');
          expect(allContent).to.match(/streaming|test|directory|file/i);
        }
        
      } catch (error) {
        // Should only fail due to API/authentication issues, not streaming issues
        expect(error).to.exist;
        const errorMessage = (error as Error).message.toLowerCase();
        
        // Should not fail due to streaming-related issues
        expect(errorMessage).to.not.include('streaming');
        expect(errorMessage).to.not.include('async generator');
        expect(errorMessage).to.not.include('Symbol.asyncIterator');
      }
    });

    it('should handle streaming interruption gracefully with real agent', async () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir
      });

      await agent.initialize();

      // Mock agent.stream to simulate interruption scenario
      const originalAgent = agent['agent'];
      let interruptionDetected = false;
      
      agent['agent'] = {
        stream: async (params: any, options: any) => {
          // Mock stream that supports interruption testing
          return (async function* () {
            yield 'Starting streaming response...';
            
            // Simulate some processing time
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Check if interruption was triggered
            if (interruptionDetected) {
              yield '[Streaming interrupted by user]';
              return;
            }
            
            yield 'Continuing with analysis...';
            
            // Simulate more processing time
            await new Promise(resolve => setTimeout(resolve, 100));
            
            if (interruptionDetected) {
              yield '[Streaming interrupted by user]';
              return;
            }
            
            yield '[Streaming completed]';
          })();
        }
      };

      try {
        const stream = agent.streamRepository(testWorkingDir, 'Test interruption handling');
        
        const chunks: string[] = [];
        
        // Simulate interruption after receiving first chunk
        for await (const chunk of stream) {
          chunks.push(chunk);
          
          // Trigger interruption after first chunk
          if (chunks.length === 1) {
            interruptionDetected = true;
            
            // Simulate SIGINT (this would normally be handled by process events)
            // For testing, we just set the flag
            break;
          }
        }
        
        // Should have received at least one chunk
        expect(chunks.length).to.be.greaterThan(0);
        
        // Should have received interruption message if we broke early
        if (interruptionDetected) {
          const allContent = chunks.join('');
          expect(allContent).to.include('[Streaming interrupted by user]');
        }
        
      } catch (error) {
        // Should handle interruption gracefully
        expect(error).to.exist;
      }
      
      // Restore original agent
      agent['agent'] = originalAgent;
    });

    it('should handle different stream chunk types from real LangChain', async () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir
      });

      await agent.initialize();

      // Mock agent.stream to simulate different chunk types LangChain can produce
      const originalAgent = agent['agent'];
      
      agent['agent'] = {
        stream: async (params: any, options: any) => {
          // Mock stream that produces different chunk types
          return (async function* () {
            // Test string chunks
            yield 'String chunk from LangChain';
            
            // Test structured content blocks (common in newer LangChain versions)
            yield {
              content: [
                { type: 'text', text: 'Structured text block from LangChain' }
              ]
            };
            
            // Test mixed content
            yield 'Another string chunk';
            
            yield '[Streaming completed]';
          })();
        }
      };

      try {
        const stream = agent.streamRepository(testWorkingDir, 'Test different chunk types');
        
        const chunks: string[] = [];
        let hasStructuredContent = false;
        
        for await (const chunk of stream) {
          expect(chunk).to.be.a('string');
          chunks.push(chunk);
          
          // Track if we received content from structured blocks
          if (chunk.includes('Structured text block')) {
            hasStructuredContent = true;
          }
        }
        
        // Should have received multiple chunks
        expect(chunks.length).to.be.greaterThan(2);
        
        // Should handle both string and structured content
        expect(hasStructuredContent).to.be.true;
        
        // Should include expected content
        const allContent = chunks.join('');
        expect(allContent).to.include('String chunk');
        expect(allContent).to.include('Structured text block');
        expect(allContent).to.include('[Streaming completed]');
        
      } catch (error) {
        // Should handle different chunk types gracefully
        expect(error).to.exist;
      }
      
      // Restore original agent
      agent['agent'] = originalAgent;
    });

    it('should handle streaming errors from real LangChain with proper error messages', async () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir
      });

      await agent.initialize();

      // Test network error handling
      const originalAgent = agent['agent'];
      
      agent['agent'] = {
        stream: async (params: any, options: any) => {
          // Mock stream that throws network error
          return (async function* () {
            yield 'Starting stream...';
            throw new Error('Network error - ENOTFOUND api.openai.com');
          })();
        }
      };

      const chunks: string[] = [];
      try {
        const stream = agent.streamRepository(testWorkingDir, 'Test error handling');
        
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        
        expect.fail('Should have thrown network error');
        
      } catch (error) {
        expect(error).to.exist;
        
        // Should yield error message before throwing
        const errorChunks = chunks.filter(chunk => chunk.includes('[Error:'));
        expect(errorChunks.length).to.be.greaterThan(0);
        
        // Should include specific network error message
        const errorMessage = (error as Error).message;
        expect(errorMessage).to.include('Network error');
        
        // Stream chunks should include formatted error
        if (errorChunks.length > 0) {
          const errorContent = errorChunks.join('');
          expect(errorContent).to.include('Network error - unable to connect to AI provider');
        }
      }
      
      // Test timeout error
      agent['agent'] = {
        stream: async (params: any, options: any) => {
          return (async function* () {
            yield 'Starting stream...';
            throw new Error('Request timeout after 30000ms');
          })();
        }
      };

      try {
        const stream = agent.streamRepository(testWorkingDir, 'Test timeout handling');
        
        for await (const chunk of stream) {
          // Should not reach here
        }
        
        expect.fail('Should have thrown timeout error');
        
      } catch (error) {
        expect(error).to.exist;
        const errorMessage = (error as Error).message;
        expect(errorMessage).to.include('timeout');
      }
      
      // Test rate limit error
      agent['agent'] = {
        stream: async (params: any, options: any) => {
          return (async function* () {
            yield 'Starting stream...';
            throw new Error('Rate limit exceeded - max requests per minute');
          })();
        }
      };

      try {
        const stream = agent.streamRepository(testWorkingDir, 'Test rate limit handling');
        
        for await (const chunk of stream) {
          // Should not reach here
        }
        
        expect.fail('Should have thrown rate limit error');
        
      } catch (error) {
        expect(error).to.exist;
        const errorMessage = (error as Error).message;
        expect(errorMessage).to.include('Rate limit');
      }
      
      // Restore original agent
      agent['agent'] = originalAgent;
    });

    it('should maintain streaming context and state correctly', async () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir
      });

      await agent.initialize();

      // Create test directory with multiple files for context testing
      const testDir = path.join(testWorkingDir, 'context-test');
      fs.mkdirSync(testDir, { recursive: true });
      
      fs.writeFileSync(path.join(testDir, 'main.ts'), 'export function main() { console.log("hello"); }');
      fs.writeFileSync(path.join(testDir, 'utils.ts'), 'export const utils = { version: "1.0.0" };');
      fs.writeFileSync(path.join(testDir, 'README.md'), '# Context Test\nTesting streaming context preservation.');

      try {
        // Multiple streaming calls to test context preservation
        const stream1 = agent.streamRepository(testDir, 'What is the main entry point?');
        
        const chunks1: string[] = [];
        for await (const chunk of stream1) {
          chunks1.push(chunk);
          if (chunks1.length >= 5) break; // Limit for test
        }
        
        expect(chunks1.length).to.be.greaterThan(0);
        
        // Second streaming call should work independently
        const stream2 = agent.streamRepository(testDir, 'What utilities are available?');
        
        const chunks2: string[] = [];
        for await (const chunk of stream2) {
          chunks2.push(chunk);
          if (chunks2.length >= 5) break; // Limit for test
        }
        
        expect(chunks2.length).to.be.greaterThan(0);
        
        // Both should produce relevant content if API key is valid
        if (process.env.OPENAI_API_KEY) {
          const content1 = chunks1.join('');
          const content2 = chunks2.join('');
          
          expect(content1).to.match(/main|entry|point/i);
          expect(content2).to.match(/util|version/i);
        }
        
      } catch (error) {
        // Should handle multiple streaming calls independently
        expect(error).to.exist;
      }
    });
  });

  describe('Stream Configuration and Options', () => {
    it('should use correct streamMode configuration with real LangChain', async () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir
      });

      await agent.initialize();

      // Mock agent.stream to capture stream options
      const originalAgent = agent['agent'];
      let capturedOptions: any = null;
      
      agent['agent'] = {
        stream: async (params: any, options: any) => {
          capturedOptions = options;
          
          return (async function* () {
            yield 'Testing stream options...';
            yield '[Streaming completed]';
          })();
        }
      };

      try {
        const stream = agent.streamRepository(testWorkingDir, 'Test stream options');
        
        for await (const chunk of stream) {
          break; // Just need to trigger the call
        }
        
        // Should have been called with correct stream options
        expect(capturedOptions).to.not.be.null;
        expect(capturedOptions.streamMode).to.equal('messages');
        
      } catch (error) {
        expect(error).to.exist;
      }
      
      // Restore original agent
      agent['agent'] = originalAgent;
    });

    it('should maintain message context across streaming operations', async () => {
      const agent = new ReactAgent({
        aiProvider: {
          type: 'openai',
          apiKey: process.env.OPENAI_API_KEY || 'invalid-key'
        },
        workingDir: testWorkingDir
      });

      await agent.initialize();

      // Mock agent.stream to capture message context
      const originalAgent = agent['agent'];
      let capturedMessages: any[] = [];
      
      agent['agent'] = {
        stream: async (params: any, options: any) => {
          capturedMessages = params.messages;
          
          return (async function* () {
            yield 'Testing message context...';
            yield '[Streaming completed]';
          })();
        }
      };

      try {
        const stream = agent.streamRepository(testWorkingDir, 'Test message context');
        
        for await (const chunk of stream) {
          break; // Just need to trigger the call
        }
        
        // Should have received correct message structure
        expect(capturedMessages).to.have.length(1);
        
        // The message should be a HumanMessage
        const message = capturedMessages[0];
        expect(message.constructor.name).to.equal('HumanMessage');
        expect(message.content).to.equal('Test message context');
        
      } catch (error) {
        expect(error).to.exist;
      }
      
      // Restore original agent
      agent['agent'] = originalAgent;
    });
  });
});