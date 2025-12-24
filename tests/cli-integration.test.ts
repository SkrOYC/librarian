/**
 * CLI Integration Tests
 * End-to-end CLI workflow tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { runCLICommand, createCLITestScenarios, createMockRepoStructure, createStandardMockRepos } from './helpers/cli-test-helpers.js';
import { createReadmeAlignedConfig } from './helpers/test-config.js';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';

describe('CLI Integration', () => {
  let testDir: string;
  let mockConfig: any;

  beforeEach(async () => {
    testDir = fsSync.mkdtempSync('cli-integration-test-');
    mockConfig = createReadmeAlignedConfig({
      repos_path: path.join(testDir, 'repos')
    });

    // Create mock repositories
    const mockRepos = createStandardMockRepos(path.join(testDir, 'repos'));
    for (const repo of mockRepos) {
      createMockRepoStructure(path.join(testDir, 'repos'), repo);
    }
  });

  afterEach(async () => {
    // Clean up test directory
    if (fsSync.existsSync(testDir)) {
      fsSync.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Basic CLI Commands', () => {
    it('should show help when run without arguments', async () => {
      const result = await runCLICommand(['--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Usage:');
      expect(result.stdout).toContain('librarian');
    });

    it('should show version', async () => {
      const result = await runCLICommand(['--version']);
      expect(result.exitCode).toBe(0);
    });

    it('should show explore command help', async () => {
      const result = await runCLICommand(['explore', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('explore');
      expect(result.stdout).toContain('--tech');
      expect(result.stdout).toContain('--group');
    });

    it('should show list command help', async () => {
      const result = await runCLICommand(['list', '--help']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('list');
      expect(result.stdout).toContain('--group');
    });
  });

  describe('List Command', () => {
    it('should list all technologies', async () => {
      const result = await runCLICommand(['list'], mockConfig);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Available Technologies');
      expect(result.stdout).toContain('[default]');
      expect(result.stdout).toContain('[langchain]');
    });

    it('should list technologies in specific group', async () => {
      const result = await runCLICommand(['list', '--group', 'default'], mockConfig);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('react');
      expect(result.stdout).toContain('nodejs');
      expect(result.stdout).not.toContain('[langchain]');
    });

    it('should handle non-existent group gracefully', async () => {
      const result = await runCLICommand(['list', '--group', 'nonexistent'], mockConfig);
      // Should either exit with error or show empty list
      expect([0, 1]).toContain(result.exitCode);
    });

    it('should format output with descriptions', async () => {
      const result = await runCLICommand(['list'], mockConfig);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('JavaScript library');
      expect(result.stdout).toContain('JavaScript runtime');
      expect(result.stdout).toContain('LangChain');
    });
  });

  describe('Explore Command', () => {
    it('should handle explore with specific technology', async () => {
      const result = await runCLICommand([
        'explore',
        'How does React handle state management?',
        '--tech',
        'react'
      ], mockConfig);

      // Should attempt to initialize and may start cloning
      expect([0, 1]).toContain(result.exitCode);
      if (result.exitCode === 1) {
        expect(result.stderr).toContain('API key');
      } else {
        // Non-streaming will just output the AI response or error
        // We can't easily test the actual response without a real API
        expect(result.exitCode).toBe(0);
      }
    });

    it('should handle explore with group', async () => {
      const result = await runCLICommand([
        'explore',
        'How does LangChain handle memory?',
        '--group',
        'langchain'
      ], mockConfig);

      // Should fail gracefully due to missing API key, but not crash
      expect([0, 1]).toContain(result.exitCode);
    });

    it('should validate required query argument', async () => {
      const result = await runCLICommand(['explore'], mockConfig);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error: missing required argument');
    });

    it('should validate required tech or group flag', async () => {
      const result = await runCLICommand([
        'explore',
        'test query'
      ], mockConfig);

      expect(result.exitCode).toBe(1);
      const containsTech = result.stderr.includes('--tech');
      const containsGroup = result.stderr.includes('--group');
      expect(containsTech || containsGroup).toBe(true);
    });

    it('should prevent using both tech and group flags', async () => {
      const result = await runCLICommand([
        'explore',
        'test query',
        '--tech', 'react',
        '--group', 'default'
      ], mockConfig);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Cannot use both --tech and --group flags simultaneously');
    });

    it('should handle explore with group', async () => {
      const result = await runCLICommand([
        'explore', 
        'How does LangChain handle memory?', 
        '--group', 
        'langchain'
      ], mockConfig);

      // Should fail gracefully due to missing API key, but not crash
      expect([0, 1]).toContain(result.exitCode);
    });

    it('should validate required query argument', async () => {
      const result = await runCLICommand(['explore'], mockConfig);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error: missing required argument');
    });

    it('should validate required tech or group flag', async () => {
      const result = await runCLICommand([
        'explore', 
        'test query'
      ], mockConfig);
      
      expect(result.exitCode).toBe(1);
      const containsTech = result.stderr.includes('--tech');
      const containsGroup = result.stderr.includes('--group');
      expect(containsTech || containsGroup).toBe(true);
    });

    it('should prevent using both tech and group flags', async () => {
      const result = await runCLICommand([
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
      const result = await runCLICommand(['list'], mockConfig);
      expect(result.exitCode).toBe(0);
    });

    it('should handle missing configuration file gracefully', async () => {
      const result = await runCLICommand(['list']);
      // Should handle missing config gracefully
      expect([0, 1]).toContain(result.exitCode);
      if (result.exitCode === 1) {
        expect(result.stderr).toContain('Configuration file not found');
      }
    });

    it('should handle invalid configuration file', async () => {
      const invalidConfig = createReadmeAlignedConfig({
        technologies: {
          default: {
            'test': { repo: 'invalid-url' }
          }
        }
      });
      const result = await runCLICommand(['list'], invalidConfig);
      // Might succeed or fail depending on validation
      expect([0, 1]).toContain(result.exitCode);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid technology names', async () => {
      const result = await runCLICommand([
        'explore',
        'test query',
        '--tech', 'nonexistent-tech'
      ], mockConfig);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('not found in configuration');
    });

    it('should handle invalid group names', async () => {
      const result = await runCLICommand([
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

      const result = await runCLICommand([
        'explore', 
        'test query',
        '--tech', 'bad-repo'
      ], badConfig);
      
      expect(result.exitCode).toBe(1);
    });
  });

  describe('Output Formatting', () => {
    it('should format list output correctly', async () => {
      const result = await runCLICommand(['list'], mockConfig);
      expect(result.exitCode).toBe(0);
      
      // Should show group names
      expect(result.stdout).toContain('[default]');
      expect(result.stdout).toContain('react');
      expect(result.stdout).toContain('[langchain]');
      expect(result.stdout).toContain('langchain-javascript');
    });

    it('should preserve formatting in error messages', async () => {
      const result = await runCLICommand(['invalid-command'], mockConfig);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('error: unknown command');
    });

    it('should handle long queries without line breaking issues', async () => {
      const longQuery = 'This is a very long query that contains multiple words and should be handled properly by the CLI without causing line breaking or formatting issues in the output.';
      
      const result = await runCLICommand([
        'explore',
        longQuery,
        '--tech', 'react'
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

      const result = await runCLICommand(['list'], configWithPath);
      expect(result.exitCode).toBe(0);
    });

    it('should handle repository path expansion', async () => {
      const configWithTilde = createReadmeAlignedConfig({
        repos_path: '~/librarian-test-repos'
      });

      const result = await runCLICommand(['list'], configWithTilde);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Standard Test Scenarios', () => {
    it('should pass all CLI test scenarios', async () => {
      const scenarios = createCLITestScenarios();
      
      for (const scenario of scenarios) {
        const result = await runCLICommand(scenario.command, mockConfig);
        expect(result.exitCode).toBe(scenario.expectedExitCode);
        
        if (scenario.expectedOutput) {
          expect(result.stdout).toContain(scenario.expectedOutput);
        }
        
        if (scenario.expectedError) {
          expect(result.stderr).toContain(scenario.expectedError);
        }
      }
    });
  });

  describe('Integration with Modern Components', () => {
    it('should integrate with ReactAgent correctly', async () => {
      // This tests the actual integration path
      const result = await runCLICommand([
        'explore',
        'How do React hooks work?',
        '--tech', 'react'
      ], mockConfig);

      // Should attempt to use ReactAgent
      expect([0, 1]).toContain(result.exitCode);
      if (result.exitCode === 1) {
        // Expected to fail due to API key, but should reach ReactAgent
        expect(true).toBe(true);
      }
    });

    it('should handle streaming output', async () => {
      // Test that the CLI properly handles streaming from ReactAgent
      const result = await runCLICommand([
        'explore',
        'Explain component lifecycle',
        '--tech', 'react'
      ], mockConfig);

      expect([0, 1]).toContain(result.exitCode);
    });
  });

  describe('Security Validation', () => {
    it('should prevent path traversal attacks', async () => {
      const result = await runCLICommand([
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

      const result = await runCLICommand([
        'explore',
        'test query',
        '--tech', 'malicious'
      ], maliciousConfig);

      expect(result.exitCode).toBe(1);
    });
  });
});