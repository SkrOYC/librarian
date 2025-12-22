import { describe, it, expect, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { loadConfig } from '../src/config.js';
import { stringify } from 'yaml';

const TEST_CONFIG_PATH = path.join(process.cwd(), 'test-config.yaml');

describe('Config Schema Alignment', () => {
    afterEach(() => {
        if (fs.existsSync(TEST_CONFIG_PATH)) {
            fs.unlinkSync(TEST_CONFIG_PATH);
        }
    });

    it('should support nested technology groups with branch and description', async () => {
        const newConfig = {
            technologies: {
                default: {
                    react: {
                        repo: 'https://github.com/facebook/react.git',
                        branch: 'main',
                        description: 'UI Library'
                    }
                },
                backend: {
                    node: {
                        repo: 'https://github.com/nodejs/node.git',
                        // branch should be optional, default fallback handled in logic not schema usually, 
                        // but schema should allow it
                        description: 'Runtime'
                    }
                }
            },
            repos_path: './my-repos',
            llm_provider: 'openai',
            llm_model: 'gpt-4',
            apiKey: 'test-key'
        };

        fs.writeFileSync(TEST_CONFIG_PATH, stringify(newConfig));

        // This should fail currently because the schema expects 'repositories' and doesn't know 'technologies'
        const loaded: any = await loadConfig(TEST_CONFIG_PATH);

        expect(loaded.technologies).toBeDefined();
        expect(loaded.technologies.default.react.repo).toBe('https://github.com/facebook/react.git');
        expect(loaded.technologies.default.react.branch).toBe('main');
        expect(loaded.technologies.default.react.description).toBe('UI Library');
        expect(loaded.repos_path).toBe('./my-repos');
    });

    it('should support openai-compatible provider', async () => {
        const newConfig = {
            technologies: {
                default: {
                    demo: { repo: 'http://example.com' }
                }
            },
            repos_path: './libs',
            llm_provider: 'openai-compatible',
            llm_model: 'llama-3-local',
            apiKey: 'sk-test'
        };

        fs.writeFileSync(TEST_CONFIG_PATH, stringify(newConfig));

        const loaded: any = await loadConfig(TEST_CONFIG_PATH);
        expect(loaded.llm_provider).toBe('openai-compatible');
    });

    it('should migrate old configuration with repositories map', async () => {
        const oldConfig = {
            repositories: {
                react: 'https://github.com/facebook/react.git',
                node: 'https://github.com/nodejs/node.git'
            },
            llm_provider: 'openai',
            llm_model: 'gpt-4',
            apiKey: 'old-key'
        };

        fs.writeFileSync(TEST_CONFIG_PATH, stringify(oldConfig));

        const loaded: any = await loadConfig(TEST_CONFIG_PATH);

        expect(loaded.technologies.default.react.repo).toBe('https://github.com/facebook/react.git');
        expect(loaded.technologies.default.node.repo).toBe('https://github.com/nodejs/node.git');
    });
});
