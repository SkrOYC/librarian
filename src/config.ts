import fs from 'fs';
import path from 'path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { LibrarianConfig } from './index.js';

const ConfigSchema = z.object({
  repositories: z.record(z.string(), z.string()),
  aiProvider: z.object({
    type: z.enum(['openai', 'anthropic', 'google']),
    apiKey: z.string(),
    model: z.string().optional(),
  }),
  workingDir: z.string().default('./librarian_work'),
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

  return validatedConfig as LibrarianConfig;
}

export async function createDefaultConfig(configPath: string): Promise<void> {
  const defaultConfig: LibrarianConfig = {
    repositories: {
      'react': 'https://github.com/facebook/react.git',
      'node': 'https://github.com/nodejs/node.git'
    },
    aiProvider: {
      type: 'openai',
      apiKey: 'your-api-key-here',
      model: 'gpt-4'
    },
    workingDir: './librarian_work'
  };

  const yamlString = stringify(defaultConfig);
  fs.writeFileSync(configPath, yamlString);
}