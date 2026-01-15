#!/usr/bin/env bun

import { Command } from 'commander';
import { Librarian } from './index.js';
import { loadConfig } from './config.js';
import { logger } from './utils/logger.js';
import { expandTilde } from './utils/path-utils.js';
import path from 'node:path';
import os from 'node:os';

async function handleStreamingOutput(stream: AsyncIterable<string>): Promise<void> {
  try {
    for await (const chunk of stream) {
      Bun.stdout.write(new TextEncoder().encode(chunk));
    }
  } catch (error) {
    console.error('\nStreaming interrupted or failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

async function handleTechnologyQuery(
  librarian: Librarian,
  techName: string,
  query: string,
  noStream: boolean,
): Promise<void> {
  if (noStream) {
    const result = await librarian.queryRepository(techName, query);
    console.log(result);
    logger.info('CLI', 'Explore query completed (non-streaming)');
  } else {
    await handleStreamingOutput(librarian.streamRepository(techName, query));
  }
}

async function handleGroupQuery(
  librarian: Librarian,
  groupName: string,
  query: string,
  noStream: boolean,
): Promise<void> {
  if (noStream) {
    const result = await librarian.queryGroup(groupName, query);
    console.log(result);
    logger.info('CLI', 'Explore group query completed (non-streaming)');
  } else {
    await handleStreamingOutput(librarian.streamGroup(groupName, query));
  }
}

function displayTechnologies(groups: Record<string, Record<string, { description?: string; branch?: string }>>): void {
  console.log('Available Technologies:');
  for (const [groupName, techs] of Object.entries(groups)) {
    if (!techs || Object.keys(techs).length === 0) {
      continue;
    }

    console.log(`\n[${groupName}]`);
    for (const [techName, details] of Object.entries(techs)) {
      const desc = details.description ? ` - ${details.description}` : '';
      const branch = details.branch ? ` (${details.branch})` : '';
      console.log(`  - ${techName}${branch}${desc}`);
    }
  }
}

export function createProgram() {
  const program = new Command();

  program
    .name('librarian')
    .description('CLI to interact with technology repositories using AI')
    .version('0.1.0')
    .option('--debug', 'Enable debug logging');

  program
    .command('explore')
    .description('Explore technologies or groups')
    .argument('<query>', 'The question or exploration query')
    .option('-t, --tech <technology>', 'Specific technology to explore')
    .option('-g, --group <group>', 'Technology group to explore')
    .option('-c, --config <path>', 'Path to configuration file')
    .option('--no-stream', 'Disable streaming output (streaming is enabled by default)')
    .action(async (query, options) => {
      try {
        // Set debug mode from global options
        const programOptions = program.opts();
        logger.setDebugMode(programOptions.debug);

        // Log command execution
        logger.info('CLI', 'Starting explore command', {
          queryLength: query.length,
          tech: options.tech || null,
          group: options.group || null,
          noStream: options.noStream,
          debug: programOptions.debug
        });

        // Validate: only one of --tech or --group should be specified
        if (options.tech && options.group) {
          logger.error('CLI', 'Cannot use both --tech and --group flags simultaneously');
          console.error('Error: Cannot use both --tech and --group flags simultaneously');
          process.exit(1);
        }

        const config = await loadConfig(options.config);
        const librarian = new Librarian(config);
        await librarian.initialize();

        if (options.tech) {
          const techDetails = librarian.resolveTechnology(options.tech);
          if (!techDetails) {
            throw new Error(`Technology ${options.tech} not found in configuration`);
          }

          await handleTechnologyQuery(librarian, techDetails.name, query, options.noStream);
        } else if (options.group) {
          await handleGroupQuery(librarian, options.group, query, options.noStream);
        } else {
          console.error('Error: Either --tech or --group must be specified');
          process.exit(1);
        }
      } catch (error: unknown) {
        if (error instanceof Error) {
          console.error('Error:', error.message);
        } else {
          console.error('Error:', String(error));
        }
        process.exit(1);
      }
    });

  program
    .command('list')
    .description('List available technologies')
    .option('-g, --group <group>', 'Filter technologies by group')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (options) => {
      try {
        // Set debug mode from global options
        const programOptions = program.opts();
        logger.setDebugMode(programOptions.debug);

        logger.info('CLI', 'Starting list command', { group: options.group || null });

        const config = await loadConfig(options.config);

        const groupsToDisplay = options.group
          ? { [options.group]: config.technologies[options.group]! }
          : config.technologies;

        if (options.group && !config.technologies[options.group]) {
          throw new Error(`Group ${options.group} not found in configuration`);
        }

        displayTechnologies(groupsToDisplay);

        logger.info('CLI', 'List command completed');
      } catch (error: unknown) {
        logger.error('CLI', 'List command failed', error instanceof Error ? error : undefined);
        if (error instanceof Error) {
          console.error('Error:', error.message);
        } else {
          console.error('Error:', String(error));
        }
        process.exit(1);
      }
    });

  program
    .command('config')
    .description('Display or update configuration')
    .option('-p, --path', 'Show config file path')
    .option('-c, --config <path>', 'Path to configuration file')
    .action((options) => {
      // Set debug mode from global options
      const programOptions = program.opts();
      logger.setDebugMode(programOptions.debug);

      logger.info('CLI', 'Starting config command', { path: options.path });

      if (options.path) {
        const configPath = options.config
          ? path.resolve(expandTilde(options.config))
          : path.join(os.homedir(), '.config', 'librarian', 'config.yaml');
        console.log(`Config file path: ${configPath}`);
        logger.info('CLI', 'Config path displayed', { configPath: configPath.replace(os.homedir(), '~') });
      }
    });

  // Handle uncaught errors globally for CLI
  program.hook('preAction', (thisCommand) => {
    // Set debug mode before each command
    const opts = thisCommand.opts();
    if (opts.debug !== undefined) {
      logger.setDebugMode(opts.debug);
    }
  });

  return program;
}

if (import.meta.main) {
  createProgram().parse();
}
