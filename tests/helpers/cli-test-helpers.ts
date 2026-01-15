/**
 * CLI Test Helpers
 * CLI testing utilities and mock command execution
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { ReadmeConfig, MockRepo } from './test-config.js';
import fs from 'node:fs';
import path from 'node:path';

// Type for bun:test expect object
type BunTestExpect = ReturnType<typeof import('bun:test').expect>;

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
  private readonly testDir: string;
  private configPath?: string;
  private outputCapture: OutputCapture = { stdout: [], stderr: [] };

  constructor(testDir: string) {
    // Ensure testDir is absolute to avoid path resolution issues when cwd changes
    this.testDir = path.resolve(testDir);
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
        if (!techConfig) continue;
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
   * Run CLI command and capture output
   */
  runCommand(args: string[], config?: ReadmeConfig): Promise<TestResult> {
    // If config is provided, set it up before running
    if (config) {
      this.setConfig(config);
    }

    return new Promise((resolve) => {
      const startTime = Date.now();

      // Use the built CLI from dist/
      const cliPath = path.join(process.cwd(), 'dist', 'cli.js');

      // If we have a config file set up, insert --config option after the command
      // The --config option is command-specific, so it needs to come after the command name
      let commandArgs = args;
      if (this.configPath && args.length > 0) {
        const command = args[0];
        // Only add --config for commands that support it (list, explore)
        if (command === 'list' || command === 'explore') {
          commandArgs = [command, '--config', this.configPath, ...args.slice(1)];
        }
      }

      const child: ChildProcess = spawn('bun', [cliPath, ...commandArgs], {
        cwd: this.testDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';

      if (child.stdout) {
        child.stdout.on('data', (data) => {
          const chunk = data.toString();
          stdout += chunk;
          this.outputCapture.stdout.push(chunk);
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (data) => {
          const chunk = data.toString();
          stderr += chunk;
          this.outputCapture.stderr.push(chunk);
        });
      }

      child.on('close', (code) => {
        const duration = Date.now() - startTime;
        resolve({
          exitCode: code || 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          duration
        });
      });

      child.on('error', (error) => {
        const duration = Date.now() - startTime;
        resolve({
          exitCode: 1,
          stdout: stdout.trim(),
          stderr: error.message,
          duration
        });
      });
    });
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
export function createStandardMockRepos(_basePath: string): MockRepo[] {
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
  expect: BunTestExpect,
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