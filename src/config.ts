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
    apiKey: z.string().optional(), // Optional - will be loaded from .env
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

/**
 * Load environment variables from a .env file using Bun native APIs
 * Supports simple KEY=VALUE format, comments (#), and quoted values
 */
async function loadEnvFile(envPath: string): Promise<Record<string, string>> {
  const envFile = Bun.file(envPath);

  // Check if .env file exists
  if (!(await envFile.exists())) {
    return {};
  }

  // Read file content
  const content = await envFile.text();
  const env: Record<string, string> = {};

  // Parse line by line
  for (const line of content.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Parse KEY=VALUE
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) {
      continue; // Skip malformed lines
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    // Remove quotes from value
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

/**
 * Validate the configuration and exit with error if invalid
 */
function validateConfig(config: LibrarianConfig, envPath: string): void {
  const errors: string[] = [];

  // Validate API key is present and non-empty
  if (!config.aiProvider.apiKey || config.aiProvider.apiKey.trim() === '') {
    errors.push(`API key is missing or empty. Please set LIBRARIAN_API_KEY in ${envPath}`);
  }

  // Validate base_url for openai-compatible providers
  if (config.aiProvider.type === 'openai-compatible' && !config.aiProvider.baseURL) {
    errors.push('base_url is required for openai-compatible providers');
  }

  // Validate repos_path is present
  if (!config.repos_path) {
    errors.push('repos_path is required in configuration');
  }

  // Validate at least one technology exists
  const hasTechnologies = config.technologies && Object.keys(config.technologies).length > 0;
  if (!hasTechnologies) {
    errors.push('No technologies defined in configuration');
  }

  // Validate each technology has a valid repo URL
  if (config.technologies) {
    for (const [groupName, group] of Object.entries(config.technologies)) {
      // Validate group name doesn't contain path traversal
      if (groupName.includes('..')) {
        errors.push(`Group name "${groupName}" contains invalid path characters`);
      }

      for (const [techName, tech] of Object.entries(group)) {
        if (!tech.repo) {
          errors.push(`Technology "${techName}" in group "${groupName}" is missing required "repo" field`);
          continue;
        }

        // Validate repo URL format
        if (!tech.repo.startsWith('http://') && !tech.repo.startsWith('https://')) {
          errors.push(`Technology "${techName}" has invalid repo URL: ${tech.repo}. Must start with http:// or https://`);
        }
      }
    }
  }

  // Output errors and exit if any found
  if (errors.length > 0) {
    console.error('Configuration validation failed:');
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  }
}

export async function loadConfig(configPath?: string): Promise<LibrarianConfig> {
  const defaultPath = path.join(os.homedir(), '.config', 'librarian', 'config.yaml');
  const actualPath = configPath ? expandTilde(configPath) : defaultPath;

  // Load environment variables from .env file
  const envPath = path.join(os.homedir(), '.config', 'librarian', '.env');
  const envVars = await loadEnvFile(envPath);

  // Check if config file exists
  if (!fs.existsSync(actualPath)) {
    try {
      await createDefaultConfig(actualPath);
      // Silent - no console output as requested
    } catch (error) {
      console.error(`Failed to create default config at ${actualPath}: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
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
      apiKey: envVars.LIBRARIAN_API_KEY || '', // Load from .env file
      model: validatedConfig.llm_model,
      baseURL: validatedConfig.base_url
    };
  }

  if (!aiProvider) {
    // Default fallback if nothing provided
    aiProvider = {
      type: 'openai',
      apiKey: envVars.LIBRARIAN_API_KEY || '',
      model: 'gpt-4o'
    };
  }

  // Set API key from .env if not already set
  if (!aiProvider.apiKey && envVars.LIBRARIAN_API_KEY) {
    aiProvider.apiKey = envVars.LIBRARIAN_API_KEY;
  }

  const config = {
    ...validatedConfig,
    technologies,
    aiProvider,
    repos_path: validatedConfig.repos_path ? expandTilde(validatedConfig.repos_path) : undefined,
    workingDir: expandTilde(validatedConfig.workingDir)
  } as LibrarianConfig;

  // Validate configuration
  validateConfig(config, envPath);

  return config;
}

export async function createDefaultConfig(configPath: string): Promise<void> {
  const defaultConfig = {
    repos_path: "~/.local/share/librarian/repos",
    llm_provider: "openai-compatible",
    llm_model: "grok-code",
    base_url: "https://opencode.ai/zen/v1"
  };

  // Ensure directory exists
  const configDir = path.dirname(configPath);
  fs.mkdirSync(configDir, { recursive: true });

  // Write YAML file
  const yamlString = stringify(defaultConfig);
  fs.writeFileSync(configPath, yamlString);
}