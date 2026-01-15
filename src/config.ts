import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import type { LibrarianConfig } from './index.js';
import { logger } from './utils/logger.js';
import { expandTilde } from './utils/path-utils.js';
import os from 'node:os';

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
    type: z.enum(['openai', 'anthropic', 'google', 'openai-compatible', 'anthropic-compatible', 'claude-code', 'gemini-cli']),
    apiKey: z.string().optional(), // Optional - will be loaded from .env or not needed for claude-code/gemini-cli
    model: z.string().optional(),
    baseURL: z.string().optional(),
  }).optional(),
  // Support README style keys
  llm_provider: z.enum(['openai', 'anthropic', 'google', 'openai-compatible', 'anthropic-compatible', 'claude-code', 'gemini-cli']).optional(),
  llm_model: z.string().optional(),
  base_url: z.string().optional(),
  workingDir: z.string().default('./librarian_work'),
  repos_path: z.string().optional(),
});

/**
 * Load environment variables from a .env file using Bun native APIs
 * Supports simple KEY=VALUE format, comments (#), and quoted values
 */
async function loadEnvFile(envPath: string): Promise<Record<string, string>> {
  logger.debug('CONFIG', "Loading .env file", { envPath: envPath.replace(os.homedir(), '~') });

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

function validateApiKey(config: LibrarianConfig, envPath: string, errors: string[]): void {
  const isCliProvider = config.aiProvider.type === 'claude-code' || config.aiProvider.type === 'gemini-cli';
  if (!isCliProvider && (!config.aiProvider.apiKey || config.aiProvider.apiKey.trim() === '')) {
    const errorMsg = `API key is missing or empty. Please set LIBRARIAN_API_KEY in ${envPath}`;
    errors.push(errorMsg);
    logger.debug('CONFIG', 'Validation failed: API key missing', { envPath: envPath.replace(os.homedir(), '~') });
  }
}

function validateBaseUrlForCompatibleProviders(config: LibrarianConfig, errors: string[]): void {
  if (config.aiProvider.type === 'openai-compatible' && !config.aiProvider.baseURL) {
    const errorMsg = 'base_url is required for openai-compatible providers';
    errors.push(errorMsg);
    logger.debug('CONFIG', 'Validation failed: base_url missing for openai-compatible provider');
  }

  if (config.aiProvider.type === 'anthropic-compatible') {
    if (!config.aiProvider.baseURL) {
      const errorMsg = 'base_url is required for anthropic-compatible providers';
      errors.push(errorMsg);
      logger.debug('CONFIG', 'Validation failed: base_url missing for anthropic-compatible provider');
    }
    if (!config.aiProvider.model) {
      const errorMsg = 'model is required for anthropic-compatible providers';
      errors.push(errorMsg);
      logger.debug('CONFIG', 'Validation failed: model missing for anthropic-compatible provider');
    }
  }
}

function validateReposPath(config: LibrarianConfig, errors: string[]): void {
  if (!config.repos_path) {
    errors.push('repos_path is required in configuration');
  }
}

function validateTechnologies(config: LibrarianConfig, errors: string[]): void {
  const hasTechnologies = config.technologies && Object.keys(config.technologies).length > 0;
  if (!hasTechnologies) {
    errors.push('No technologies defined in configuration');
    // Continue to validate group names even if empty - this is intentional
    // to catch path traversal in group names if any are defined
  }

  if (!config.technologies) {
    return;
  }

  for (const [groupName, group] of Object.entries(config.technologies)) {
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

      const isRemoteUrl = tech.repo.startsWith('http://') || tech.repo.startsWith('https://');
      const isFileUrl = tech.repo.startsWith('file://');
      const hasProtocol = tech.repo.includes('://');
      if (!(isRemoteUrl || isFileUrl) && hasProtocol) {
        const errorMsg = `Technology "${techName}" has invalid repo URL: ${tech.repo}. Must be http://, https://, file://, or a local path`;
        errors.push(errorMsg);
        logger.debug('CONFIG', 'Validation failed: invalid repo URL', { techName, groupName, repoUrl: tech.repo });
      }
    }
  }
}

function reportErrors(errors: string[]): void {
  if (errors.length > 0) {
    logger.error('CONFIG', 'Configuration validation failed', undefined, { errorCount: errors.length });
    console.error('Configuration validation failed:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  } else {
    logger.info('CONFIG', 'Configuration validation passed');
  }
}

/**
 * Validate the configuration and exit with error if invalid
 */
function validateConfig(config: LibrarianConfig, envPath: string): void {
  logger.debug('CONFIG', 'Validating configuration');
  const errors: string[] = [];

  validateApiKey(config, envPath, errors);
  validateBaseUrlForCompatibleProviders(config, errors);
  validateReposPath(config, errors);
  validateTechnologies(config, errors);

  reportErrors(errors);
}

type TechnologiesType = z.infer<typeof ConfigSchema>['technologies'];

function normalizeTechnologies(technologies: TechnologiesType): TechnologiesType {
  if (!technologies) {
    return undefined;
  }

  for (const group of Object.values(technologies ?? {})) {
    for (const tech of Object.values(group ?? {})) {
      if (!tech.repo && tech.name) {
        logger.debug('CONFIG', 'Normalizing technology: using "name" as "repo"', { name: tech.name });
        tech.repo = tech.name;
      }
    }
  }
  logger.debug('CONFIG', 'Technologies normalized', { groupCount: Object.keys(technologies).length });
  return technologies;
}

function buildAiProvider(validatedConfig: z.infer<typeof ConfigSchema>, envVars: Record<string, string>): LibrarianConfig['aiProvider'] {
  if (validatedConfig.aiProvider) {
    const { type, model, baseURL } = validatedConfig.aiProvider;
    return {
      type,
      apiKey: validatedConfig.aiProvider.apiKey || envVars.LIBRARIAN_API_KEY || '',
      ...(model && { model }),
      ...(baseURL && { baseURL })
    };
  }

  if (validatedConfig.llm_provider) {
    logger.debug('CONFIG', 'Using README-style llm_* keys for AI provider');
    return {
      type: validatedConfig.llm_provider,
      apiKey: envVars.LIBRARIAN_API_KEY || '',
      ...(validatedConfig.llm_model && { model: validatedConfig.llm_model }),
      ...(validatedConfig.base_url && { baseURL: validatedConfig.base_url })
    };
  }

  logger.error('CONFIG', 'AI provider is required in configuration');
  console.error('Configuration error: llm_provider (or aiProvider) is required in config.yaml');
  process.exit(1);
}

export async function loadConfig(configPath?: string): Promise<LibrarianConfig> {
  const defaultPath = path.join(os.homedir(), '.config', 'librarian', 'config.yaml');
  const actualPath = configPath ? expandTilde(configPath) : defaultPath;

  logger.info('CONFIG', 'Loading configuration', { configPath: actualPath.replace(os.homedir(), '~') });

  const configDir = path.dirname(actualPath);
  const envPath = path.join(configDir, '.env');
  const envVars = await loadEnvFile(envPath);

  if (!(await Bun.file(actualPath).exists())) {
    logger.info('CONFIG', 'Config file not found, creating default config');
    try {
      await createDefaultConfig(actualPath);
      logger.info('CONFIG', 'Default config created successfully');
    } catch (error) {
      logger.error('CONFIG', 'Failed to create default config', error instanceof Error ? error : new Error(String(error)), { actualPath: actualPath.replace(os.homedir(), '~') });
      console.error(`Failed to create default config at ${actualPath}: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  const configFileContent = await Bun.file(actualPath).text();
  logger.debug('CONFIG', 'Config file read successfully', { fileSize: configFileContent.length });

  const parsedConfig = parse(configFileContent);
  const validatedConfig = ConfigSchema.parse(parsedConfig);
  logger.debug('CONFIG', 'Config schema validation passed');

  const technologies = normalizeTechnologies(validatedConfig.technologies);
  const aiProvider = buildAiProvider(validatedConfig, envVars);

  logger.debug('CONFIG', 'API key source', {
    fromEnv: !!envVars.LIBRARIAN_API_KEY,
    fromConfig: !!validatedConfig.aiProvider?.apiKey
  });

  const config = {
    ...validatedConfig,
    technologies: technologies || { default: {} },
    aiProvider,
    repos_path: validatedConfig.repos_path ? expandTilde(validatedConfig.repos_path) : undefined,
    workingDir: expandTilde(validatedConfig.workingDir)
  } as LibrarianConfig;

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
    aiProvider: {
      type: "openai-compatible",
      model: "grok-code",
      baseURL: "https://opencode.ai/zen/v1"
    }
  };

   // Ensure directory exists
   const configDir = path.dirname(configPath);
   await mkdir(configDir, { recursive: true });

   // Write YAML file
   const yamlString = stringify(defaultConfig);
   await Bun.write(configPath, yamlString);
}