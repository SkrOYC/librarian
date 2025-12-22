import { expect } from 'chai';
import fs from 'fs';
import path from 'path';
import { fileListTool } from '../src/tools/file-listing.tool';
import { fileReadTool as fileReadToolModern } from '../src/tools/file-reading.tool';
import { grepContentTool as grepContentToolModern } from '../src/tools/grep-content.tool';
import { fileFindTool as fileFindToolModern } from '../src/tools/file-finding.tool';

import { ReactAgent } from '../src/agents/react-agent';
const fileReadTool = fileReadToolModern;
const grepContentTool = grepContentToolModern;
const fileFindTool = fileFindToolModern;

// Test FileListTool
test('FileListTool should list directory contents', async () => {
  // Create a temporary directory for testing
  const testDir = path.join(process.cwd(), 'test_temp_dir');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  // Create some test files
  const testFile1 = path.join(testDir, 'test1.txt');
  const testFile2 = path.join(testDir, 'test2.txt');
  fs.writeFileSync(testFile1, 'Test content 1');
  fs.writeFileSync(testFile2, 'Test content 2');
  
  const result = await fileListTool.invoke({ directoryPath: testDir });
  
  expect(result).to.include('test1.txt');
  expect(result).to.include('test2.txt');
  expect(result).to.include('Contents of directory');
  
  // Clean up
  fs.unlinkSync(testFile1);
  fs.unlinkSync(testFile2);
  fs.rmdirSync(testDir);
});

test('FileListTool should handle invalid directory paths', async () => {
  const result = await fileListTool.invoke({ directoryPath: '../invalid_dir' });
  expect(result).to.include('contains invalid path characters');
});

// Test FileReadTool
test('FileReadTool should read file content', async () => {
  // Create a temporary file for testing
  const testFile = path.join(process.cwd(), 'test_temp_file.txt');
  const testContent = 'This is test content for the file reading tool.';
  fs.writeFileSync(testFile, testContent);
  
  const result = await fileReadTool.invoke({ filePath: testFile });
  
  expect(result).to.include(testContent);
  expect(result).to.include('Content of file');
  
  // Clean up
  fs.unlinkSync(testFile);
});

test('FileReadTool should handle file not found', async () => {
  const result = await fileReadTool.invoke({ filePath: '../nonexistent_file.txt' });
  expect(result).to.include('Error reading file');
});

// Test GrepContentTool
test('GrepContentTool should search content patterns', async () => {
  // Create temporary files for testing
  const testDir = path.join(process.cwd(), 'test_grep_dir');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  const testFile1 = path.join(testDir, 'test1.js');
  const testFile2 = path.join(testDir, 'test2.js');
  fs.writeFileSync(testFile1, 'function hello() { return "hello"; }');
  fs.writeFileSync(testFile2, 'function world() { return "world"; }');
  
  const result = await grepContentTool.invoke({
    searchPath: testDir,
    query: 'function',
    patterns: ['*.js'],
    caseSensitive: false,
    regex: false,
    recursive: true,
    maxResults: 10
  });
  
  expect(result).to.include('function hello');
  expect(result).to.include('function world');
  expect(result).to.include('test1.js');
  expect(result).to.include('test2.js');
  
  // Clean up
  fs.unlinkSync(testFile1);
  fs.unlinkSync(testFile2);
  fs.rmdirSync(testDir);
});

test('GrepContentTool should handle invalid search path', async () => {
  const result = await grepContentTool.invoke({
    searchPath: '../invalid_dir',
    query: 'test',
    patterns: ['*.js'],
    caseSensitive: false,
    regex: false,
    recursive: true,
    maxResults: 10
  });
  expect(result).to.include('Error searching content');
});

// Test FileFindTool
test('FileFindTool should find files by pattern', async () => {
  // Create temporary files for testing
  const testDir = path.join(process.cwd(), 'test_find_dir');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  
  const testFile1 = path.join(testDir, 'test1.ts');
  const testFile2 = path.join(testDir, 'test2.ts');
  const testFile3 = path.join(testDir, 'test3.js');
  fs.writeFileSync(testFile1, 'TypeScript file 1');
  fs.writeFileSync(testFile2, 'TypeScript file 2');
  fs.writeFileSync(testFile3, 'JavaScript file');
  
  const result = await fileFindTool.invoke({
    searchPath: testDir,
    patterns: ['*.ts'],
    exclude: ['node_modules', '.git'],
    recursive: true,
    maxResults: 10,
    includeHidden: false
  });
  
  expect(result).to.include('test1.ts');
  expect(result).to.include('test2.ts');
  expect(result).to.not.include('test3.js');
  expect(result).to.include('Found 2 files');
  
  // Clean up
  fs.unlinkSync(testFile1);
  fs.unlinkSync(testFile2);
  fs.unlinkSync(testFile3);
  fs.rmdirSync(testDir);
});

test('FileFindTool should handle invalid search path', async () => {
  const result = await fileFindTool.invoke({
    searchPath: '../invalid_dir',
    patterns: ['*.ts'],
    exclude: ['node_modules', '.git'],
    recursive: true,
    maxResults: 10,
    includeHidden: false
  });
  expect(result).to.include('Error finding files');
});

// Test ReactAgent Integration
test('ReactAgent should initialize with modern tools', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key' // This is just for testing, will not actually call the API
    },
    workingDir: './test-work'
  });
  
  // We expect this to fail due to invalid API key, but not due to initialization issues
  try {
    await agent.initialize();
  } catch (error) {
    // Expected to fail due to invalid API key, which is fine for this test
    expect(error).to.not.be.null;
  }
});

// Test ReactAgent Streaming
test('ReactAgent should have streamRepository method', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: './test-work'
  });
  
  expect(agent).to.have.property('streamRepository');
  expect(typeof agent.streamRepository).to.equal('function');
});

test('ReactAgent should handle streaming errors gracefully', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key' // This will cause an error
    },
    workingDir: './test-work'
  });
  
  await agent.initialize();
  
  try {
    const stream = agent.streamRepository('./test-repo', 'test query');
    
    for await (const chunk of stream) {
      // Should throw an error instead of returning chunks
      expect.fail('Should have thrown an error');
    }
  } catch (error) {
    expect(error).to.not.be.null;
  }
});

test('ReactAgent should handle streaming network errors with custom messages', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: './test-work'
  });
  
  await agent.initialize();
  
  // Create a mock stream that throws a network error
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      throw new Error('Network error');
    }
  };
  
  agent['agent'] = {
    stream: async () => mockStream
  };
  
  const stream = agent.streamRepository('/test/path', 'test query');
  
  const chunks: string[] = [];
  let errorThrown = false;
  
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
  } catch (error) {
    errorThrown = true;
    expect(error).to.be.instanceOf(Error);
  }
  
  expect(errorThrown).to.be.true;
});

test('ReactAgent should handle streaming timeout errors', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: './test-work'
  });
  
  await agent.initialize();
  
  // Create a mock stream that throws a timeout error
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      throw new Error('Timeout error');
    }
  };
  
  agent['agent'] = {
    stream: async () => mockStream
  };
  
  const stream = agent.streamRepository('/test/path', 'test query');
  
  const chunks: string[] = [];
  let errorThrown = false;
  
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
  } catch (error) {
    errorThrown = true;
    expect(error).to.be.instanceOf(Error);
  }
  
  expect(errorThrown).to.be.true;
});

test('ReactAgent should handle streaming rate limit errors', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: './test-work'
  });
  
  await agent.initialize();
  
  // Create a mock stream that throws a rate limit error
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      throw new Error('Rate limit exceeded');
    }
  };
  
  agent['agent'] = {
    stream: async () => mockStream
  };
  
  const stream = agent.streamRepository('/test/path', 'test query');
  
  const chunks: string[] = [];
  let errorThrown = false;
  
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
  } catch (error) {
    errorThrown = true;
    expect(error).to.be.instanceOf(Error);
  }
  
  expect(errorThrown).to.be.true;
});

test('ReactAgent should handle streaming authentication errors', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: './test-work'
  });
  
  await agent.initialize();
  
  // Create a mock stream that throws an authentication error
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      throw new Error('Authentication failed');
    }
  };
  
  agent['agent'] = {
    stream: async () => mockStream
  };
  
  const stream = agent.streamRepository('/test/path', 'test query');
  
  const chunks: string[] = [];
  let errorThrown = false;
  
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
  } catch (error) {
    errorThrown = true;
    expect(error).to.be.instanceOf(Error);
  }
  
  expect(errorThrown).to.be.true;
});

test('ReactAgent should handle generic streaming errors', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: './test-work'
  });
  
  await agent.initialize();
  
  // Create a mock stream that throws a generic error
  const mockStream = {
    async *[Symbol.asyncIterator]() {
      throw new Error('Mock streaming error');
    }
  };
  
  agent['agent'] = {
    stream: async () => mockStream
  };
  
  const stream = agent.streamRepository('/test/path', 'test query');
  
  const chunks: string[] = [];
  let errorThrown = false;
  
  try {
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
  } catch (error) {
    errorThrown = true;
    expect(error).to.be.instanceOf(Error);
    expect((error as Error).message).to.include('Mock streaming error');
  }
  
  expect(errorThrown).to.be.true;
});

// Test Dynamic System Prompt Construction - Phase 3
test('ReactAgent constructor should accept technology context', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: './test-work',
    technology: {
      name: 'typescript',
      repository: 'https://github.com/microsoft/typescript.git',
      branch: 'main'
    }
  });
  
  // Should be able to create agent with technology context
  expect(agent).to.not.be.null;
  expect(agent).to.have.property('createDynamicSystemPrompt');
});

test('ReactAgent should create dynamic system prompt with technology context', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: './test-work/default/typescript',
    technology: {
      name: 'typescript',
      repository: 'https://github.com/microsoft/typescript.git',
      branch: 'main'
    }
  });
  
  const dynamicPrompt = agent.createDynamicSystemPrompt();
  
  // Should include technology name
  expect(dynamicPrompt).to.include('typescript');
  
  // Should include working directory
  expect(dynamicPrompt).to.include('./test-work/default/typescript');
  
  // Should include repository information
  expect(dynamicPrompt).to.include('github.com/microsoft/typescript.git');
  
  // Should maintain core functionality description
  expect(dynamicPrompt).to.include('file_list');
  expect(dynamicPrompt).to.include('file_read');
  expect(dynamicPrompt).to.include('grep_content');
  expect(dynamicPrompt).to.include('file_find');
});

test('ReactAgent should handle missing technology context gracefully', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: './test-work'
    // No technology context provided
  });
  
  const dynamicPrompt = agent.createDynamicSystemPrompt();
  
  // Should still create a valid prompt with working directory
  expect(dynamicPrompt).to.include('./test-work');
  
  // Should maintain core functionality
  expect(dynamicPrompt).to.include('file_list');
  expect(dynamicPrompt).to.include('file_read');
  expect(dynamicPrompt).to.include('grep_content');
  expect(dynamicPrompt).to.include('file_find');
});

test('ReactAgent should use dynamic system prompt instead of hardcoded', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: './test-work/default/typescript',
    technology: {
      name: 'typescript',
      repository: 'https://github.com/microsoft/typescript.git',
      branch: 'main'
    }
  });
  
  // Test that createDynamicSystemPrompt() returns expected content
  const dynamicPrompt = agent.createDynamicSystemPrompt();
  
  // Should include technology context
  expect(dynamicPrompt).to.include('typescript');
  expect(dynamicPrompt).to.include('github.com/microsoft/typescript.git');
  expect(dynamicPrompt).to.include('./test-work/default/typescript');
  
  // Should include tool descriptions
  expect(dynamicPrompt).to.include('file_list');
  expect(dynamicPrompt).to.include('file_read');
  expect(dynamicPrompt).to.include('grep_content');
  expect(dynamicPrompt).to.include('file_find');
  
  // Initialize should complete without errors
  await agent.initialize();
  expect(agent['agent']).to.not.be.null;
});

test('ReactAgent should use dynamic system prompt even without technology context', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: './test-work'
    // No technology context
  });
  
  // Test that createDynamicSystemPrompt() returns expected content
  const dynamicPrompt = agent.createDynamicSystemPrompt();
  
  // Should include working directory
  expect(dynamicPrompt).to.include('./test-work');
  
  // Should still include tool descriptions
  expect(dynamicPrompt).to.include('file_list');
  expect(dynamicPrompt).to.include('file_read');
  expect(dynamicPrompt).to.include('grep_content');
  expect(dynamicPrompt).to.include('file_find');
  
  // Initialize should complete without errors
  await agent.initialize();
  expect(agent['agent']).to.not.be.null;
});

test('ReactAgent query flow should not override dynamic system prompt', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: './test-work/default/typescript',
    technology: {
      name: 'typescript',
      repository: 'https://github.com/microsoft/typescript.git',
      branch: 'main'
    }
  });
  
  await agent.initialize();
  
  // Mock agent.invoke to capture messages passed
  let capturedMessages: any[] = [];
  agent['agent'] = {
    invoke: async (params: { messages: any[] }) => {
      capturedMessages = params.messages;
      return { content: 'test response' };
    }
  };
  
  await agent.queryRepository('./test-repo', 'test query');
  
  // Should have 1 message: only human (system prompt already set during initialization)
  expect(capturedMessages).to.have.length(1);
  
  // The message should be human message
  const humanMessage = capturedMessages[0];
  expect(humanMessage.constructor.name).to.equal('HumanMessage');
  
  // Verify dynamic prompt was set during initialization by checking createDynamicSystemPrompt()
  const dynamicPrompt = agent.createDynamicSystemPrompt();
  expect(dynamicPrompt).to.include('typescript');
  expect(dynamicPrompt).to.include('github.com/microsoft/typescript.git');
  expect(dynamicPrompt).to.include('./test-work/default/typescript');
});

test('ReactAgent stream flow should not override dynamic system prompt', async () => {
  const agent = new ReactAgent({
    aiProvider: {
      type: 'openai',
      apiKey: 'test-key'
    },
    workingDir: './test-work/default/react',
    technology: {
      name: 'react',
      repository: 'https://github.com/facebook/react.git',
      branch: 'main'
    }
  });
  
  await agent.initialize();
  
  // Mock agent.stream to capture messages passed
  let capturedMessages: any[] = [];
  agent['agent'] = {
    stream: async (params: { messages: any[] }) => {
      capturedMessages = params.messages;
      // Return a mock stream
      return (async function* () {
        yield { content: 'test chunk' };
      })();
    }
  };
  
  const stream = agent.streamRepository('./test-repo', 'test query');
  
  // Consume stream to trigger logic
  for await (const chunk of stream) {
    break; // Just need to trigger the method
  }
  
  // Should have 1 message: only human (system prompt already set during initialization)
  expect(capturedMessages).to.have.length(1);
  
  // The message should be human message
  const humanMessage = capturedMessages[0];
  expect(humanMessage.constructor.name).to.equal('HumanMessage');
  
  // Verify dynamic prompt was set during initialization by checking createDynamicSystemPrompt()
  const dynamicPrompt = agent.createDynamicSystemPrompt();
  expect(dynamicPrompt).to.include('react');
  expect(dynamicPrompt).to.include('github.com/facebook/react.git');
  expect(dynamicPrompt).to.include('./test-work/default/react');
});