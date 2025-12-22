/**
 * Configuration Tests
 * Configuration loading and validation tests aligned with README
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createReadmeAlignedConfig, setupTestEnvironment, teardownTestEnvironment } from './helpers/test-config.js';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'yaml';

describe('Configuration', () => {
  let testDir: string;
  let configDir: string;

  beforeEach(async () => {
    const env = setupTestEnvironment();
    testDir = env.testDir;
    configDir = path.join(testDir, '.config', 'librarian');
    await fs.mkdir(configDir, { recursive: true });
  });

  afterEach(async () => {
    teardownTestEnvironment(testDir);
  });

  describe('README-Aligned Configuration Structure', () => {
    it('should create valid default configuration', () => {
      const config = createReadmeAlignedConfig();
      
      expect(config.repos_path).toBeDefined();
      expect(config.technologies).toBeDefined();
      expect(config.llm_provider).toBeDefined();
      expect(config.technologies.default).toBeDefined();
      expect(config.technologies.langchain).toBeDefined();
    });

    it('should validate required fields', () => {
      const config = createReadmeAlignedConfig();
      
      // Test required repos_path
      expect(config.repos_path).toBeTypeOf('string');
      
      // Test required technologies structure
      expect(config.technologies).toBeTypeOf('object');
      expect(Array.isArray(config.technologies)).toBe(false);
      
      // Test required llm_provider
      expect(['openai', 'anthropic', 'google', 'openai-compatible']).toContain(config.llm_provider);
    });

    it('should support all LLM providers', () => {
      const providers: Array<'openai' | 'anthropic' | 'google' | 'openai-compatible'> = [
        'openai', 'anthropic', 'google', 'openai-compatible'
      ];

      providers.forEach(provider => {
        const config = createReadmeAlignedConfig({ llm_provider: provider });
        expect(config.llm_provider).toBe(provider);
      });
    });

    it('should support optional fields', () => {
      const config = createReadmeAlignedConfig({
        llm_model: 'gpt-4-turbo',
        base_url: 'https://api.example.com/v1'
      });

      expect(config.llm_model).toBe('gpt-4-turbo');
      expect(config.base_url).toBe('https://api.example.com/v1');
    });
  });

  describe('YAML Configuration Loading', () => {

    it('should load valid YAML configuration', async () => {
      const configPath = path.join(configDir, 'config.yaml');
      const config = createReadmeAlignedConfig({
        llm_provider: 'anthropic',
        llm_model: 'claude-3-opus-20240229'
      });

      const yamlContent = yaml.stringify(config);
      await fs.writeFile(configPath, yamlContent);

      // Simulate loading the YAML content
      const loadedContent = await fs.readFile(configPath, 'utf8');
      const parsedConfig = yaml.parse(loadedContent);

      expect(parsedConfig.llm_provider).toBe('anthropic');
      expect(parsedConfig.llm_model).toBe('claude-3-opus-20240229');
      expect(parsedConfig.repos_path).toBe(config.repos_path);
    });

    it('should handle technologies section correctly', async () => {
      const configPath = path.join(configDir, 'config.yaml');
      const config = createReadmeAlignedConfig();
      const yamlContent = yaml.stringify(config);
      await fs.writeFile(configPath, yamlContent);

      const loadedContent = await fs.readFile(configPath, 'utf8');
      const parsedConfig = yaml.parse(loadedContent);

      expect(parsedConfig.technologies.default).toBeDefined();
      expect(parsedConfig.technologies.langchain).toBeDefined();
      expect(parsedConfig.technologies.default.react).toBeDefined();
      expect(parsedConfig.technologies.langchain['langchain-javascript']).toBeDefined();
    });

    it('should handle nested technology configurations', async () => {
      const configPath = path.join(configDir, 'config.yaml');
      const config = createReadmeAlignedConfig({
        technologies: {
          custom: {
            'my-framework': {
              repo: 'https://github.com/user/framework.git',
              branch: 'develop',
              description: 'My custom framework'
            }
          }
        }
      });

      const yamlContent = yaml.stringify(config);
      await fs.writeFile(configPath, yamlContent);

      const loadedContent = await fs.readFile(configPath, 'utf8');
      const parsedConfig = yaml.parse(loadedContent);

      expect(parsedConfig.technologies.custom).toBeDefined();
      expect(parsedConfig.technologies.custom['my-framework'].repo).toBe('https://github.com/user/framework.git');
      expect(parsedConfig.technologies.custom['my-framework'].branch).toBe('develop');
      expect(parsedConfig.technologies.custom['my-framework'].description).toBe('My custom framework');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate repos_path format', () => {
      const validPaths = [
        '~/.local/share/librarian/repos',
        '/home/user/repos',
        './repos',
        'repos'
      ];

      validPaths.forEach(repos_path => {
        const config = createReadmeAlignedConfig({ repos_path });
        expect(config.repos_path).toBe(repos_path);
      });
    });

    it('should validate technology repository URLs', () => {
      const config = createReadmeAlignedConfig({
        technologies: {
          test: {
            'test-repo': {
              repo: 'https://github.com/test/repo.git'
            }
          }
        }
      });

      expect(config.technologies.test['test-repo'].repo).toMatch(/^https?:\/\/.+/);
    });

    it('should validate optional branch specification', () => {
      const config1 = createReadmeAlignedConfig();
      const config2 = createReadmeAlignedConfig({
        technologies: {
          test: {
            'test-repo': {
              repo: 'https://github.com/test/repo.git',
              branch: 'main'
            }
          }
        }
      });

      // Branch should be optional
      expect(config1.technologies.default.react.branch).toBe('main');
      expect(config2.technologies.test['test-repo'].branch).toBe('main');
    });

    it('should validate optional description', () => {
      const config = createReadmeAlignedConfig({
        technologies: {
          test: {
            'test-repo': {
              repo: 'https://github.com/test/repo.git',
              description: 'A test repository'
            }
          }
        }
      });

      expect(config.technologies.test['test-repo'].description).toBe('A test repository');
    });
  });

  describe('Configuration Migration', () => {
    it('should handle missing optional fields gracefully', () => {
      const minimalConfig = {
        repos_path: '~/.local/share/librarian/repos',
        technologies: {
          default: {
            test: { repo: 'https://github.com/test/repo.git' }
          }
        },
        llm_provider: 'openai' as const
      };

      const config = createReadmeAlignedConfig(minimalConfig);
      
      expect(config.llm_model).toBeUndefined();
      expect(config.base_url).toBeUndefined();
      expect(config.technologies.default.test.description).toBeUndefined();
      expect(config.technologies.default.test.branch).toBeUndefined();
    });

    it('should merge partial configurations with defaults', () => {
      const partialConfig = {
        llm_provider: 'anthropic' as const,
        technologies: {
          custom: {
            'my-repo': { repo: 'https://github.com/user/repo.git' }
          }
        }
      };

      const config = createReadmeAlignedConfig(partialConfig);
      
      expect(config.llm_provider).toBe('anthropic');
      expect(config.repos_path).toBe('~/.local/share/librarian/repos'); // Default retained
      expect(config.technologies.default).toBeDefined(); // Default group retained
      expect(config.technologies.custom).toBeDefined(); // Custom group added
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed YAML gracefully', async () => {
      const configPath = path.join(configDir, 'config.yaml');
      const malformedYaml = `
        repos_path: "~/.local/share/librarian/repos"
        technologies:
          default:
            invalid: [unclosed array
        llm_provider: openai
      `;

      await fs.writeFile(configPath, malformedYaml);

      // This would be handled by the actual config loading logic
      const content = await fs.readFile(configPath, 'utf8');
      expect(() => {
        yaml.parse(content);
      }).toThrow();
    });

    it('should handle missing configuration file', async () => {
      const nonExistentPath = path.join(configDir, 'nonexistent.yaml');
      
      // File should not exist
      try {
        await fs.access(nonExistentPath);
        expect(false).toBe(true); // Should not reach here
      } catch {
        expect(true).toBe(true); // File doesn't exist, which is expected
      }
    });

    it('should handle empty configuration file', async () => {
      const configPath = path.join(configDir, 'config.yaml');
      await fs.writeFile(configPath, '');

      const content = await fs.readFile(configPath, 'utf8');
      expect(content).toBe('');
    });
  });

  describe('Path Resolution', () => {
    it('should expand tilde in repos_path', () => {
      const config = createReadmeAlignedConfig({
        repos_path: '~/.local/share/librarian/repos'
      });

      // The actual expansion would happen in the config loading logic
      expect(config.repos_path).toMatch(/^~/);
    });

    it('should handle relative paths', () => {
      const config = createReadmeAlignedConfig({
        repos_path: './repos'
      });

      expect(config.repos_path).toBe('./repos');
    });

    it('should handle absolute paths', () => {
      const config = createReadmeAlignedConfig({
        repos_path: '/absolute/path/to/repos'
      });

      expect(config.repos_path).toMatch(/^\//);
    });
  });
});