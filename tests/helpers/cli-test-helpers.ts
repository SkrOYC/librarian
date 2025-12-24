/**
 * CLI Test Helpers
 * CLI testing utilities and mock command execution
 */

import { spawn, ChildProcess } from 'child_process';
import { ReadmeConfig, MockRepo } from './test-config.js';
import fs from 'fs';
import path from 'path';

export interface CLICommandTest {
  command: string[];
  expectedExitCode: number;
  expectedOutput?: string;
  expectedError?: string;
}

export interface TestResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

export interface OutputCapture {
  stdout: string[];
  stderr: string[];
}

/**
 * CLI testing helper class
 */
export class TestCLIHelper {
  private testDir: string;
  private configPath?: string;
  private outputCapture: OutputCapture = { stdout: [], stderr: [] };

  constructor(testDir: string) {
    this.testDir = testDir;
  }

  /**
   * Create a test configuration file
   */
  setConfig(config: ReadmeConfig): void {
    const configDir = path.join(this.testDir, '.config', 'librarian');
    fs.mkdirSync(configDir, { recursive: true });

    this.configPath = path.join(configDir, 'config.yaml');
    const yamlContent = this.configToYaml(config);
    fs.writeFileSync(this.configPath, yamlContent);

    // Create .env file with test API key
    const envPath = path.join(configDir, '.env');
    fs.writeFileSync(envPath, 'LIBRARIAN_API_KEY=test-api-key-for-testing');
  }

  /**
   * Convert config object to YAML string
   */
  private configToYaml(config: ReadmeConfig): string {
    const yamlSections: string[] = [];
    
    yamlSections.push(`repos_path: "${config.repos_path}"`);
    yamlSections.push('');
    yamlSections.push('technologies:');
    
    for (const [groupName, technologies] of Object.entries(config.technologies)) {
      yamlSections.push(`  ${groupName}:`);
      for (const [techName, techConfig] of Object.entries(technologies)) {
        yamlSections.push(`    ${techName}:`);
        yamlSections.push(`      repo: "${techConfig.repo}"`);
        if (techConfig.branch !== undefined) {
          yamlSections.push(`      branch: "${techConfig.branch}"`);
        }
        if (techConfig.description !== undefined) {
          yamlSections.push(`      description: "${techConfig.description}"`);
        }
      }
    }

    yamlSections.push('');
    yamlSections.push(`llm_provider: ${config.llm_provider}`);

    if (config.llm_model !== undefined) {
      yamlSections.push(`llm_model: ${config.llm_model}`);
    }

    if (config.base_url !== undefined) {
      yamlSections.push(`base_url: "${config.base_url}"`);
    }
    
    return yamlSections.join('\n');
  }



  /**
   * Get captured output
   */
  captureOutput(): OutputCapture {
    return { ...this.outputCapture };
  }

  /**
   * Reset captured output
   */
  resetOutput(): void {
    this.outputCapture = { stdout: [], stderr: [] };
  }

  /**
   * Cleanup test environment
   */
  cleanup(): void {
    if (this.configPath && fs.existsSync(this.configPath)) {
      fs.unlinkSync(this.configPath);
    }
  }
}

/**
 * Run CLI command with optional configuration
 */
export async function runCLICommand(
  args: string[],
  config?: ReadmeConfig
): Promise<TestResult> {
  const testDir = fs.mkdtempSync('librarian-test-');
  const helper = new TestCLIHelper(testDir);

  try {
    if (config) {
      helper.setConfig(config);
    }

    const result = await helper.runCommand(args);
    return result;
  } finally {
    helper.cleanup();
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

/**
 * Create mock repository structure for testing
 */
export function createMockRepoStructure(basePath: string, repo: MockRepo): void {
  const repoPath = path.join(basePath, repo.group, repo.name);

  // Create repository directory
  fs.mkdirSync(repoPath, { recursive: true });

  // Create files
  for (const [filePath, content] of Object.entries(repo.files)) {
    const fullPath = path.join(repoPath, filePath);
    const dirPath = path.dirname(fullPath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    fs.writeFileSync(fullPath, content);
  }
}

/**
 * Create standard mock repositories
 */
export function createStandardMockRepos(basePath: string): MockRepo[] {
  return [
    {
      name: 'react-mock',
      group: 'default',
      files: {
        'README.md': '# React Mock\nA mock React repository for testing.',
        'package.json': JSON.stringify({
          name: 'react-mock',
          version: '1.0.0',
          main: 'index.js'
        }, null, 2),
        'src/index.js': '// React mock entry point\nexport const React = {};',
        'src/components/Button.js': '// Button component\nexport const Button = () => {};'
      }
    },
    {
      name: 'langchain-mock',
      group: 'langchain',
      files: {
        'README.md': '# LangChain Mock\nA mock LangChain repository for testing.',
        'package.json': JSON.stringify({
          name: 'langchain-mock',
          version: '1.0.0'
        }, null, 2),
        'src/index.js': '// LangChain mock entry point\nexport const LangChain = {};',
        'src/agents/BaseAgent.js': '// Base agent implementation\nexport class BaseAgent {}'
      }
    }
  ];
}

/**
 * Assert CLI command result
 * Note: This function requires expect to be imported in the test file
 */
export function assertCLIResult(
  result: TestResult, 
  expected: CLICommandTest,
  expect: any
): void {
  if (expected.expectedExitCode !== undefined) {
    expect(result.exitCode).toBe(expected.expectedExitCode);
  }
  
  if (expected.expectedOutput) {
    expect(result.stdout).toContain(expected.expectedOutput);
  }
  
  if (expected.expectedError) {
    expect(result.stderr).toContain(expected.expectedError);
  }
}

/**
 * Create CLI test scenarios
 */
export function createCLITestScenarios(): CLICommandTest[] {
  return [
    {
      command: ['list'],
      expectedExitCode: 0,
      expectedOutput: 'default'
    },
    {
      command: ['list', '--help'],
      expectedExitCode: 0,
      expectedOutput: 'Usage:'
    },
    {
      command: ['explore', '--help'],
      expectedExitCode: 0,
      expectedOutput: 'Usage:'
    },
    {
      command: ['--help'],
      expectedExitCode: 0,
      expectedOutput: 'librarian'
    }
  ];
}