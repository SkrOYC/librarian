import { describe, it, expect, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parse, stringify } from 'yaml';
import { loadConfig } from '../src/config.js';
import { createDefaultConfig } from '../src/config.js';

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

    it('should auto-create default config when file missing', async () => {
        const nonExistentPath = path.join(process.cwd(), `test-auto-config-${Date.now()}.yaml`);

        try {
            const config: any = await loadConfig(nonExistentPath);

            expect(fs.existsSync(nonExistentPath)).toBe(true);
            expect(config.aiProvider.type).toBe('openai-compatible');
            expect(config.aiProvider.model).toBe('grok-code');
            expect(config.aiProvider.baseURL).toBe('https://opencode.ai/zen/v1');
            expect(config.repos_path).toBe(path.join(os.homedir(), '.local/share/librarian/repos'));
        } finally {
            if (fs.existsSync(nonExistentPath)) {
                fs.unlinkSync(nonExistentPath);
            }
        }
    });

    it('should create config directory if missing', async () => {
        const deepPath = path.join(process.cwd(), `test-level1-${Date.now()}`, 'level2', 'config.yaml');
        const testDir = path.dirname(deepPath);

        try {
            await loadConfig(deepPath);

            expect(fs.existsSync(testDir)).toBe(true);
            expect(fs.existsSync(deepPath)).toBe(true);
        } finally {
            // Cleanup
            const level1 = path.join(process.cwd(), `test-level1-${Date.now()}`);
            if (fs.existsSync(level1)) {
                fs.rmSync(level1, { recursive: true, force: true });
            }
        }
    });

    it('should create proper YAML syntax', async () => {
        const testPath = path.join(process.cwd(), `test-yaml-${Date.now()}.yaml`);

        try {
            await createDefaultConfig(testPath);
            const content = fs.readFileSync(testPath, 'utf8');
            const parsed = parse(content);

            expect(parsed).toBeDefined();
            expect(parsed.repos_path).toBe('~/.local/share/librarian/repos');
            expect(parsed.llm_provider).toBe('openai-compatible');
            expect(parsed.llm_model).toBe('grok-code');
            expect(parsed.base_url).toBe('https://opencode.ai/zen/v1');
            expect(parsed.technologies).toBeUndefined();
        } finally {
            if (fs.existsSync(testPath)) {
                fs.unlinkSync(testPath);
            }
        }
    });
});
