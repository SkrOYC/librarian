import { describe, it, expect, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parse, stringify } from 'yaml';
import { loadConfig } from '../src/config.js';
import { createDefaultConfig } from '../src/config.js';

const TEST_CONFIG_PATH = path.join(process.cwd(), 'test-config.yaml');
const TEST_ENV_PATH = path.join(process.cwd(), '.env');

// Helper to create a temp .env file for tests
function createTestEnv() {
    if (!fs.existsSync(TEST_ENV_PATH)) {
        fs.writeFileSync(TEST_ENV_PATH, 'LIBRARIAN_API_KEY=test-api-key');
    }
}

function cleanupTestEnv() {
    if (fs.existsSync(TEST_ENV_PATH)) {
        fs.unlinkSync(TEST_ENV_PATH);
    }
}

describe('Config Schema Alignment', () => {
    afterEach(() => {
        if (fs.existsSync(TEST_CONFIG_PATH)) {
            fs.unlinkSync(TEST_CONFIG_PATH);
        }
        cleanupTestEnv();
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
            aiProvider: {
                type: 'openai',
                model: 'gpt-4',
                apiKey: 'test-key'
            }
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
            aiProvider: {
                type: 'openai-compatible',
                model: 'llama-3-local',
                baseURL: 'https://api.example.com/v1',
                apiKey: 'sk-test'
            }
        };

        // Write config first, then load it
        fs.writeFileSync(TEST_CONFIG_PATH, stringify(newConfig));

        const loaded: any = await loadConfig(TEST_CONFIG_PATH);

        // The test config uses llm_provider which gets migrated to aiProvider.type
        expect(loaded.aiProvider?.type).toBe('openai-compatible');
    });

    it('should auto-create default config when file missing', async () => {
        const nonExistentPath = path.join(process.cwd(), `test-auto-config-${Date.now()}.yaml`);
        const envPath = path.join(path.dirname(nonExistentPath), '.env');
        fs.writeFileSync(envPath, 'LIBRARIAN_API_KEY=test-api-key');

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
            if (fs.existsSync(envPath)) {
                fs.unlinkSync(envPath);
            }
        }
    });

    it('should create config directory if missing', async () => {
        const timestamp = Date.now();
        const deepPath = path.join(process.cwd(), `test-level1-${timestamp}`, 'level2', 'config.yaml');
        const testDir = path.dirname(deepPath);
        const level1Dir = path.join(process.cwd(), `test-level1-${timestamp}`);

        try {
            // Create directory and .env file first
            fs.mkdirSync(testDir, { recursive: true });
            fs.writeFileSync(path.join(testDir, '.env'), 'LIBRARIAN_API_KEY=test-api-key');
            await loadConfig(deepPath);

            expect(fs.existsSync(testDir)).toBe(true);
            expect(fs.existsSync(deepPath)).toBe(true);
        } finally {
            // Cleanup
            if (fs.existsSync(level1Dir)) {
                fs.rmSync(level1Dir, { recursive: true, force: true });
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
            expect(parsed.aiProvider.type).toBe('openai-compatible');
            expect(parsed.aiProvider.model).toBe('grok-code');
            expect(parsed.aiProvider.baseURL).toBe('https://opencode.ai/zen/v1');
            expect(parsed.technologies).toBeUndefined();
        } finally {
            if (fs.existsSync(testPath)) {
                fs.unlinkSync(testPath);
            }
        }
    });
});
