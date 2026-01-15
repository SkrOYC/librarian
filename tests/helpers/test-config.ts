/**
 * Test Configuration Utilities
 * Centralized test configuration factory with README-aligned structures
 */

import type { LibrarianConfig } from '../../src/index.js';
import fs from 'node:fs';
import path from 'node:path';

// Type for bun:test expect object
type BunTestExpect = ReturnType<typeof import('bun:test').expect>;

// README-aligned configuration types
export interface ReadmeConfig {
  repos_path: string;
  technologies: {
    [group: string]: {
      [tech: string]: {
        repo: string;
        branch?: string;
        description?: string;
      };
    };
  };
  llm_provider: 'openai' | 'anthropic' | 'google' | 'openai-compatible';
  llm_model?: string;
  base_url?: string;
}

export interface TestConfig {
  workingDir: string;
  reposPath?: string;
  mockAPIKey?: string;
}

export interface MockRepo {
  name: string;
  group: string;
  files: Record<string, string>;
}

// Common test constants
export const TEST_CONSTANTS = {
  MOCK_API_KEY: 'test-api-key-12345',
  DEFAULT_WORKING_DIR: './test-work',
  DEFAULT_REPOS_PATH: './test-repos',
  MOCK_REPO_URL: 'https://github.com/test/mock-repo.git',
  DEFAULT_BRANCH: 'main'
} as const;

/**
 * Create README-aligned configuration for testing
 */
export function createReadmeAlignedConfig(overrides: Partial<ReadmeConfig> = {}): ReadmeConfig {
  const defaultConfig: ReadmeConfig = {
    repos_path: '~/.local/share/librarian/repos',
    technologies: {
      default: {
        react: {
          repo: 'https://github.com/facebook/react.git',
          branch: 'main',
          description: 'JavaScript library for building user interfaces'
        },
        nodejs: {
          repo: 'https://github.com/nodejs/node.git',
          branch: 'main',
          description: 'JavaScript runtime environment'
        }
      },
      langchain: {
        'langchain-javascript': {
          repo: 'https://github.com/langchain-ai/langchainjs',
          description: 'LangChain is a framework for building LLM-powered applications'
        },
        'langgraph-javascript': {
          repo: 'https://github.com/langchain-ai/langgraphjs',
          description: 'LangGraph is low-level orchestration framework for LLM applications'
        }
      }
    },
    llm_provider: 'openai',
    llm_model: 'gpt-4'
  };

  // Deep merge for technologies
  const mergedTechnologies = overrides.technologies
    ? { ...defaultConfig.technologies, ...overrides.technologies }
    : defaultConfig.technologies;

  // Only include defaults for properties not explicitly provided
  const result: ReadmeConfig = {
    repos_path: overrides.repos_path ?? defaultConfig.repos_path,
    technologies: mergedTechnologies,
    llm_provider: overrides.llm_provider ?? defaultConfig.llm_provider,
    ...(overrides.llm_model !== undefined && { llm_model: overrides.llm_model }),
    ...(overrides.base_url !== undefined && { base_url: overrides.base_url })
  };

  return result;
}

/**
 * Create Librarian configuration for testing
 */
export function createTestLibrarianConfig(overrides: Partial<LibrarianConfig> = {}): LibrarianConfig {
  const defaultConfig: LibrarianConfig = {
    technologies: {
      default: {
        'test-repo': { 
          repo: 'https://github.com/test/repo.git',
          branch: 'main',
          description: 'Test repository for unit testing'
        }
      }
    },
    aiProvider: {
      type: 'openai',
      apiKey: TEST_CONSTANTS.MOCK_API_KEY,
      model: 'gpt-4'
    },
    workingDir: TEST_CONSTANTS.DEFAULT_WORKING_DIR,
    repos_path: TEST_CONSTANTS.DEFAULT_REPOS_PATH
  };

  return { ...defaultConfig, ...overrides };
}

/**
 * Create temporary test directory
 */
export function createTestDir(baseName = 'test'): string {
  const testDir = path.join(process.cwd(), `${baseName}-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  return testDir;
}

/**
 * Clean up test directory
 */
export function cleanupTestDir(testDir: string): void {
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

/**
 * Mock configuration builder class for fluent interface
 */
export class MockConfigBuilder {
  private readonly config: ReadmeConfig;

  constructor() {
    this.config = createReadmeAlignedConfig();
  }

  withTechnologies(technologies: ReadmeConfig['technologies']): MockConfigBuilder {
    this.config.technologies = technologies;
    return this;
  }

  withLLMProvider(provider: ReadmeConfig['llm_provider']): MockConfigBuilder {
    this.config.llm_provider = provider;
    return this;
  }

  withLLMModel(model: string): MockConfigBuilder {
    this.config.llm_model = model;
    return this;
  }

  withReposPath(reposPath: string): MockConfigBuilder {
    this.config.repos_path = reposPath;
    return this;
  }

  withBaseUrl(baseUrl: string): MockConfigBuilder {
    this.config.base_url = baseUrl;
    return this;
  }

  build(): ReadmeConfig {
    return { ...this.config };
  }
}

/**
 * Assert README configuration structure
 * Note: This function requires expect to be imported in the test file
 */
export function assertReadmeConfig(actual: ReadmeConfig, expected: ReadmeConfig, expect: BunTestExpect): void {
  expect(actual).toBeDefined();
  expect(actual.repos_path).toBe(expected.repos_path);
  expect(actual.llm_provider).toBe(expected.llm_provider);
  expect(actual.technologies).toEqual(expected.technologies);

  if (expected.llm_model) {
    expect(actual.llm_model).toBe(expected.llm_model);
  }

  if (expected.base_url) {
    expect(actual.base_url).toBe(expected.base_url);
  }
}

/**
 * Create test environment setup
 */
export function setupTestEnvironment(): {
  testDir: string;
  config: LibrarianConfig;
  readmeConfig: ReadmeConfig;
} {
  const testDir = createTestDir();
  const config = createTestLibrarianConfig({ workingDir: testDir });
  const readmeConfig = createReadmeAlignedConfig();

  return { testDir, config, readmeConfig };
}

/**
 * Teardown test environment
 */
export function teardownTestEnvironment(testDir: string): void {
  cleanupTestDir(testDir);
}