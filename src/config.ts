import fs from 'fs';
import path from 'path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { LibrarianConfig } from './index.js';

import os from 'os';

const TechnologySchema = z.object({
  repo: z.string().optional(),
  name: z.string().optional(), // For README style
  branch: z.string().default('main'),
  description: z.string().optional(),
});

const GroupSchema = z.record(z.string(), TechnologySchema);

const ConfigSchema = z.object({
  technologies: z.record(z.string(), GroupSchema).optional(),
  repositories: z.record(z.string(), z.string()).optional(), // For backward compatibility
  aiProvider: z.object({
    type: z.enum(['openai', 'anthropic', 'google', 'openai-compatible']),
    apiKey: z.string(),
    model: z.string().optional(),
    baseURL: z.string().optional(),
  }).optional(),
  // Support README style keys
  llm_provider: z.enum(['openai', 'anthropic', 'google', 'openai-compatible']).optional(),
  llm_model: z.string().optional(),
  base_url: z.string().optional(),
  workingDir: z.string().default('./librarian_work'),
  repos_path: z.string().optional(),
});

function expandTilde(filePath: string): string {
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

export async function loadConfig(configPath?: string): Promise<LibrarianConfig> {
  const defaultPath = path.join(os.homedir(), '.config', 'librarian', 'config.yaml');
  const actualPath = configPath ? expandTilde(configPath) : defaultPath;

  // Check if config file exists
  if (!fs.existsSync(actualPath)) {
    throw new Error(`Configuration file not found: ${actualPath}`);
  }

  // Read and parse the YAML file
  const configFileContent = fs.readFileSync(actualPath, 'utf8');
  const parsedConfig = parse(configFileContent);

  // Validate the configuration
  const validatedConfig = ConfigSchema.parse(parsedConfig);

  // Migration logic for technologies
  let technologies: any = validatedConfig.technologies;

  if (validatedConfig.repositories && !technologies) {
    const defaultGroup: Record<string, { repo: string, branch: string }> = {};
    for (const [name, repo] of Object.entries(validatedConfig.repositories)) {
      defaultGroup[name] = { repo, branch: 'main' };
    }
    technologies = {
      default: defaultGroup
    };
  }

  if (technologies) {
    // Normalize repo/name
    for (const group of Object.values(technologies)) {
      for (const tech of Object.values(group as any)) {
        const t = tech as any;
        if (!t.repo && t.name) {
          t.repo = t.name;
        }
      }
    }
  }

  if (!technologies) {
    technologies = { default: {} };
  }

  // Migration logic for AI provider
  let aiProvider = validatedConfig.aiProvider;

  if (!aiProvider && validatedConfig.llm_provider) {
    aiProvider = {
      type: validatedConfig.llm_provider,
      apiKey: (process.env.LIBRARIAN_API_KEY || process.env.OPENAI_API_KEY || ''), 
      model: validatedConfig.llm_model,
      baseURL: validatedConfig.base_url
    };
  }

  if (!aiProvider) {
    // Default fallback if nothing provided
    aiProvider = {
      type: 'openai',
      apiKey: process.env.OPENAI_API_KEY || '',
      model: 'gpt-4o'
    };
  }

  return {
    ...validatedConfig,
    technologies,
    aiProvider,
    repos_path: validatedConfig.repos_path ? expandTilde(validatedConfig.repos_path) : undefined,
    workingDir: expandTilde(validatedConfig.workingDir)
  } as LibrarianConfig;
}

export async function createDefaultConfig(configPath: string): Promise<void> {
  const defaultConfig: LibrarianConfig = {
    technologies: {
      default: {
        'react': { repo: 'https://github.com/facebook/react.git', description: 'React UI Library' },
        'node': { repo: 'https://github.com/nodejs/node.git', description: 'Node.js Runtime' }
      }
    },
    aiProvider: {
      type: 'openai',
      apiKey: 'your-api-key-here',
      model: 'gpt-4o'
    },
    workingDir: './librarian_work',
    repos_path: './repositories'
  };

  const yamlString = stringify(defaultConfig);
  fs.writeFileSync(configPath, yamlString);
}