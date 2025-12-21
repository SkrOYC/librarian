import fs from 'fs';
import path from 'path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { LibrarianConfig } from './index.js';

const TechnologySchema = z.object({
  repo: z.string(),
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

export async function loadConfig(configPath: string): Promise<LibrarianConfig> {
  // Check if config file exists
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file not found: ${configPath}`);
  }

  // Read and parse the YAML file
  const configFileContent = fs.readFileSync(configPath, 'utf8');
  const parsedConfig = parse(configFileContent);

  // Validate the configuration
  const validatedConfig = ConfigSchema.parse(parsedConfig);

  // Migration logic for technologies
  let technologies = validatedConfig.technologies;

  if (validatedConfig.repositories && !technologies) {
    const defaultGroup: Record<string, { repo: string, branch: string }> = {};
    for (const [name, repo] of Object.entries(validatedConfig.repositories)) {
      defaultGroup[name] = { repo, branch: 'main' };
    }
    technologies = {
      default: defaultGroup
    };
  }

  if (!technologies) {
    technologies = { default: {} };
  }

  // Migration logic for AI provider
  let aiProvider = validatedConfig.aiProvider;

  if (!aiProvider && validatedConfig.llm_provider) {
    aiProvider = {
      type: validatedConfig.llm_provider,
      apiKey: (process.env.LIBRARIAN_API_KEY || ''), // Should probably handle API key differently if not in config
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
    aiProvider
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