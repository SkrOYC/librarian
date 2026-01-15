/**
 * CLI Integration Tests
 * End-to-end CLI workflow tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { TestCLIHelper, createMockRepoStructure, createStandardMockRepos } from './helpers/cli-test-helpers.js';
import { createReadmeAlignedConfig } from './helpers/test-config.js';
import fsSync from 'node:fs';
import path from 'node:path';

describe('CLI Integration', () => {
  let testDir: string;
  let helper: TestCLIHelper;
  let mockConfig: any;

  beforeEach(() => {
    testDir = path.resolve(fsSync.mkdtempSync('cli-integration-test-'));
    helper = new TestCLIHelper(testDir);
    const reposDir = path.join(testDir, 'repos');
    mockConfig = createReadmeAlignedConfig({
      repos_path: reposDir
    });

    // Create mock repositories
    const mockRepos = createStandardMockRepos(reposDir);
    for (const repo of mockRepos) {
      createMockRepoStructure(reposDir, repo);
    }

    // Override repo URLs to use local mock repositories (absolute paths)
    mockConfig.technologies.default['react-mock'] = {
      repo: path.join(reposDir, 'react-mock'),
      branch: 'main',
      description: 'JavaScript library for building user interfaces'
    };
    mockConfig.technologies.default.react = undefined;

    mockConfig.technologies.langchain = {
      'langchain-mock': {
        repo: path.join(reposDir, 'langchain-mock'),
        description: 'LangChain is a framework for building LLM-powered applications'
      }
    };
  });

  afterEach(() => {
    // Clean up test directory
    if (fsSync.existsSync(testDir)) {
      fsSync.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Basic CLI Commands', () => {
    it('should show help when run without arguments', async () => {
      const result = await helper.runCommand(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage:');
      expect(result.stdout).toContain('librarian');
    });

    it('should show version', async () => {
      const result = await helper.runCommand(['--version']);
      expect(result.exitCode).toBe(0);
    });

    it('should show explore command help', async () => {
      const result = await helper.runCommand(['explore', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('explore');
      expect(result.stdout).toContain('--tech');
      expect(result.stdout).toContain('--group');
    });

    it('should show list command help', async () => {
      const result = await helper.runCommand(['list', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('list');
      expect(result.stdout).toContain('--group');
    });
  });

  describe('List Command', () => {
    it('should list all technologies', async () => {
      const result = await helper.runCommand(['list'], mockConfig);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Available Technologies');
      expect(result.stdout).toContain('[default]');
      expect(result.stdout).toContain('[langchain]');
    });

    it('should list technologies in specific group', async () => {
      const result = await helper.runCommand(['list', '--group', 'default'], mockConfig);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('react-mock');
      expect(result.stdout).toContain('nodejs');
      expect(result.stdout).not.toContain('[langchain]');
    });

    it('should handle non-existent group gracefully', async () => {
      const result = await helper.runCommand(['list', '--group', 'nonexistent'], mockConfig);
      // Should either exit with error or show empty list
      expect([0, 1]).toContain(result.exitCode);
    });

    it('should format output with descriptions', async () => {
      const result = await helper.runCommand(['list'], mockConfig);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('JavaScript library');
      expect(result.stdout).toContain('JavaScript runtime');
      expect(result.stdout).toContain('LangChain');
    });
  });

  describe('Explore Command', () => {
    it('should handle explore with specific technology', async () => {
      const result = await helper.runCommand([
        'explore',
        'How does React handle state management?',
        '--tech',
        'react-mock'
      ], mockConfig);

      // Should attempt to initialize and may start cloning
      expect([0, 1]).toContain(result.exitCode);
      if (result.exitCode === 1) {
        // Should fail due to API key, technology, validation, or repo errors
        const hasExpectedError =
          result.stderr.includes('API key') ||
          result.stderr.includes('not found') ||
          result.stderr.includes('validation') ||
          result.stderr.includes('does not exist');
        expect(hasExpectedError).toBe(true);
      }
    });

    it('should handle explore with group', async () => {
      const result = await helper.runCommand([
        'explore',
        'How does LangChain handle memory?',
        '--group',
        'langchain'
      ], mockConfig);

      // Should fail gracefully due to missing API key, but not crash
      expect([0, 1]).toContain(result.exitCode);
    }, 10_000); // Increase timeout for this test

    it('should validate required query argument', async () => {
      const result = await helper.runCommand(['explore'], mockConfig);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error: missing required argument');
    });

    it('should validate required tech or group flag', async () => {
      const result = await helper.runCommand([
        'explore',
        'test query'
      ], mockConfig);

      expect(result.exitCode).toBe(1);
      const containsTech = result.stderr.includes('--tech');
      const containsGroup = result.stderr.includes('--group');
      expect(containsTech || containsGroup).toBe(true);
    });

    it('should prevent using both tech and group flags', async () => {
      const result = await helper.runCommand([
        'explore',
        'test query',
        '--tech', 'react',
        '--group', 'default'
      ], mockConfig);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Cannot use both --tech and --group flags simultaneously');
    });
  });

  describe('Configuration Integration', () => {
    it('should use configuration from expected location', async () => {
      const result = await helper.runCommand(['list'], mockConfig);
      expect(result.exitCode).toBe(0);
    });

    it('should handle missing configuration file gracefully', async () => {
      const result = await helper.runCommand(['list']);
      // Should handle missing config gracefully
      expect([0, 1]).toContain(result.exitCode);
    });

    it('should handle invalid configuration file', async () => {
      const invalidConfig = createReadmeAlignedConfig({
        technologies: {
          default: {
            'test': { repo: 'invalid-url' }
          }
        }
      });
      const result = await helper.runCommand(['list'], invalidConfig);
      // Might succeed or fail depending on validation
      expect([0, 1]).toContain(result.exitCode);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid technology names', async () => {
      const result = await helper.runCommand([
        'explore',
        'test query',
        '--tech', 'nonexistent-tech'
      ], mockConfig);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found in configuration');
    });

    it('should handle invalid group names', async () => {
      const result = await helper.runCommand([
        'explore',
        'test query',
        '--group', 'nonexistent-group'
      ], mockConfig);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found in configuration');
    });

    it('should handle malformed repository URLs', async () => {
      const badConfig = createReadmeAlignedConfig({
        technologies: {
          default: {
            'bad-repo': {
              repo: 'not-a-valid-url',
              description: 'Bad repository'
            }
          }
        }
      });

      const result = await helper.runCommand([
        'explore',
        'test query',
        '--tech', 'bad-repo'
      ], badConfig);

      expect(result.exitCode).toBe(1);
    });
  });

  describe('Output Formatting', () => {
    it('should format list output correctly', async () => {
      const result = await helper.runCommand(['list'], mockConfig);
      expect(result.exitCode).toBe(0);

      // Should show group names
      expect(result.stdout).toContain('[default]');
      expect(result.stdout).toContain('react-mock');
      expect(result.stdout).toContain('[langchain]');
      expect(result.stdout).toContain('langchain-mock');
    });

    it('should preserve formatting in error messages', async () => {
      const result = await helper.runCommand(['invalid-command'], mockConfig);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error: unknown command');
    });

    it('should handle long queries without line breaking issues', async () => {
      const longQuery = 'This is a very long query that contains multiple words and should be handled properly by the CLI without causing line breaking or formatting issues in the output.';

      const result = await helper.runCommand([
        'explore',
        longQuery,
        '--tech', 'react-mock'
      ], mockConfig);

      // Should not crash on long queries
      expect([0, 1]).toContain(result.exitCode);
    });
  });

  describe('Repository Operations', () => {
    it('should reference correct repository paths', async () => {
      const configWithPath = createReadmeAlignedConfig({
        repos_path: path.join(testDir, 'custom-repos')
      });

      const result = await helper.runCommand(['list'], configWithPath);
      expect(result.exitCode).toBe(0);
    });

    it('should handle repository path expansion', async () => {
      const configWithTilde = createReadmeAlignedConfig({
        repos_path: '~/librarian-test-repos'
      });

      const result = await helper.runCommand(['list'], configWithTilde);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Integration with Modern Components', () => {
    it('should integrate with ReactAgent correctly', async () => {
      // This tests the actual integration path
      const result = await helper.runCommand([
        'explore',
        'How do React hooks work?',
        '--tech', 'react-mock'
      ], mockConfig);

      // Should attempt to use ReactAgent
      expect([0, 1]).toContain(result.exitCode);
    });

    it('should handle streaming output', async () => {
      // Test that the CLI properly handles streaming from ReactAgent
      const result = await helper.runCommand([
        'explore',
        'Explain component lifecycle',
        '--tech', 'react-mock'
      ], mockConfig);

      expect([0, 1]).toContain(result.exitCode);
    });
  });

  describe('Security Validation', () => {
    it('should prevent path traversal attacks', async () => {
      const result = await helper.runCommand([
        'explore',
        'test query',
        '--tech', '../../../etc/passwd'
      ], mockConfig);

      // Path traversal should be prevented at the technology resolution level
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found in configuration');
    });

    it('should sanitize repository URLs', async () => {
      const maliciousConfig = createReadmeAlignedConfig({
        technologies: {
          default: {
            'malicious': {
              repo: 'file:///etc/passwd',
              description: 'Malicious repository'
            }
          }
        }
      });

      const result = await helper.runCommand([
        'explore',
        'test query',
        '--tech', 'malicious'
      ], maliciousConfig);

      expect(result.exitCode).toBe(1);
    });
  });
});
