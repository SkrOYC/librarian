import fs from 'fs';
import path from 'path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { LibrarianConfig } from './index.js';
import { logger } from './utils/logger.js';
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
  logger.debug('CONFIG', `Loading .env file`, { envPath: envPath.replace(os.homedir(), '~') });

  const envFile = Bun.file(envPath);

  // Check if .env file exists
  if (!(await envFile.exists())) {
    logger.debug('CONFIG', '.env file not found, continuing without it');
    return {};
  }

  logger.info('CONFIG', '.env file found and loading');

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

  logger.debug('CONFIG', `.env loaded: ${Object.keys(env).length} variables`);
  return env;
}

/**
 * Validate the configuration and exit with error if invalid
 */
function validateConfig(config: LibrarianConfig, envPath: string): void {
  logger.debug('CONFIG', 'Validating configuration');
  const errors: string[] = [];

  // Validate API key is present and non-empty
  if (!config.aiProvider.apiKey || config.aiProvider.apiKey.trim() === '') {
    const errorMsg = `API key is missing or empty. Please set LIBRARIAN_API_KEY in ${envPath}`;
    errors.push(errorMsg);
    logger.debug('CONFIG', 'Validation failed: API key missing', { envPath: envPath.replace(os.homedir(), '~') });
  }

  // Validate base_url for openai-compatible providers
  if (config.aiProvider.type === 'openai-compatible' && !config.aiProvider.baseURL) {
    const errorMsg = 'base_url is required for openai-compatible providers';
    errors.push(errorMsg);
    logger.debug('CONFIG', 'Validation failed: base_url missing for openai-compatible provider');
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
        logger.debug('CONFIG', 'Validation failed: group name contains path traversal', { groupName });
      }

      for (const [techName, tech] of Object.entries(group)) {
        if (!tech.repo) {
          const errorMsg = `Technology "${techName}" in group "${groupName}" is missing required "repo" field`;
          errors.push(errorMsg);
          logger.debug('CONFIG', 'Validation failed: missing repo field', { techName, groupName });
          continue;
        }

        // Validate repo URL format - allow http/https URLs or local/file paths
        const isRemoteUrl = tech.repo.startsWith('http://') || tech.repo.startsWith('https://');
        const isFileUrl = tech.repo.startsWith('file://');
        const hasProtocol = tech.repo.includes('://');
        if (!isRemoteUrl && !isFileUrl && hasProtocol) {
          const errorMsg = `Technology "${techName}" has invalid repo URL: ${tech.repo}. Must be http://, https://, file://, or a local path`;
          errors.push(errorMsg);
          logger.debug('CONFIG', 'Validation failed: invalid repo URL', { techName, groupName, repoUrl: tech.repo });
        }
      }
    }
  }

  // Output errors and exit if any found
  if (errors.length > 0) {
    logger.error('CONFIG', 'Configuration validation failed', undefined, { errorCount: errors.length });
    console.error('Configuration validation failed:');
    errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  } else {
    logger.info('CONFIG', 'Configuration validation passed');
  }
}

export async function loadConfig(configPath?: string): Promise<LibrarianConfig> {
  const defaultPath = path.join(os.homedir(), '.config', 'librarian', 'config.yaml');
  const actualPath = configPath ? expandTilde(configPath) : defaultPath;

  logger.info('CONFIG', 'Loading configuration', { configPath: actualPath.replace(os.homedir(), '~') });

  // Load environment variables from .env file
  const envPath = path.join(os.homedir(), '.config', 'librarian', '.env');
  const envVars = await loadEnvFile(envPath);

  // Check if config file exists
  if (!fs.existsSync(actualPath)) {
    logger.info('CONFIG', 'Config file not found, creating default config');
    try {
      await createDefaultConfig(actualPath);
      logger.info('CONFIG', 'Default config created successfully');
      // Silent - no console output as requested
    } catch (error) {
      logger.error('CONFIG', 'Failed to create default config', error instanceof Error ? error : new Error(String(error)), { actualPath: actualPath.replace(os.homedir(), '~') });
      console.error(`Failed to create default config at ${actualPath}: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  // Read and parse the YAML file
  const configFileContent = fs.readFileSync(actualPath, 'utf8');
  logger.debug('CONFIG', 'Config file read successfully', { fileSize: configFileContent.length });

  const parsedConfig = parse(configFileContent);

  // Validate the configuration
  const validatedConfig = ConfigSchema.parse(parsedConfig);
  logger.debug('CONFIG', 'Config schema validation passed');

  // Migration logic for technologies
  let technologies: any = validatedConfig.technologies;

  if (validatedConfig.repositories && !technologies) {
    logger.info('CONFIG', 'Migrating from deprecated "repositories" format to "technologies" format');
    const defaultGroup: Record<string, { repo: string, branch: string }> = {};
    for (const [name, repo] of Object.entries(validatedConfig.repositories)) {
      defaultGroup[name] = { repo, branch: 'main' };
    }
    technologies = {
      default: defaultGroup
    };
    logger.debug('CONFIG', 'Migration completed', { techCount: Object.keys(defaultGroup).length });
  }

  if (technologies) {
    // Normalize repo/name
    for (const group of Object.values(technologies)) {
      for (const tech of Object.values(group as any)) {
        const t = tech as any;
        if (!t.repo && t.name) {
          logger.debug('CONFIG', 'Normalizing technology: using "name" as "repo"', { name: t.name });
          t.repo = t.name;
        }
      }
    }
    logger.debug('CONFIG', 'Technologies normalized', { groupCount: Object.keys(technologies).length });
  }

  if (!technologies) {
    logger.debug('CONFIG', 'No technologies found, creating empty default group');
    technologies = { default: {} };
  }

  // Migration logic for AI provider
  let aiProvider = validatedConfig.aiProvider;

  if (!aiProvider && validatedConfig.llm_provider) {
    logger.info('CONFIG', 'Migrating from deprecated "llm_provider" format to "aiProvider" format');
    aiProvider = {
      type: validatedConfig.llm_provider,
      apiKey: envVars.LIBRARIAN_API_KEY || '', // Load from .env file
      model: validatedConfig.llm_model,
      baseURL: validatedConfig.base_url
    };
  }

  if (!aiProvider) {
    // Default fallback if nothing provided
    logger.debug('CONFIG', 'No AI provider found, using default OpenAI configuration');
    aiProvider = {
      type: 'openai',
      apiKey: envVars.LIBRARIAN_API_KEY || '',
      model: 'gpt-4o'
    };
  }

  // Set API key from .env if not already set
  if (!aiProvider.apiKey && envVars.LIBRARIAN_API_KEY) {
    logger.debug('CONFIG', 'API key loaded from .env');
    aiProvider.apiKey = envVars.LIBRARIAN_API_KEY;
  }

  const config = {
    ...validatedConfig,
    technologies,
    aiProvider,
    repos_path: aiProvider ? (validatedConfig.repos_path ? expandTilde(validatedConfig.repos_path) : undefined) : (validatedConfig.repos_path ? expandTilde(validatedConfig.repos_path) : undefined),
    workingDir: expandTilde(validatedConfig.workingDir)
  } as LibrarianConfig;

  // Validate configuration
  validateConfig(config, envPath);

  logger.info('CONFIG', 'Config loaded successfully', {
    aiProviderType: config.aiProvider.type,
    model: config.aiProvider.model,
    techGroupsCount: Object.keys(config.technologies || {}).length,
    reposPath: config.repos_path ? config.repos_path.replace(os.homedir(), '~') : 'workingDir'
  });

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