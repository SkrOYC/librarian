#!/usr/bin/env node

import { Command } from 'commander';
import { Librarian } from './index.js';
import { loadConfig } from './config.js';
import fs from 'fs';

export function createProgram() {
  const program = new Command();

  program
    .name('librarian')
    .description('CLI to interact with technology repositories using AI')
    .version('0.1.0');

  program
    .command('query')
    .description('Query a repository with a question')
    .argument('<repo-name>', 'Name of the repository to query')
    .argument('<query>', 'The question to ask about the repository')
    .option('-c, --config <path>', 'Path to configuration file', 'librarian.yaml')
    .action(async (repoName, query, options) => {
      try {
        const config = await loadConfig(options.config);
        const librarian = new Librarian(config);
        await librarian.initialize();
        const result = await librarian.queryRepository(repoName, query);
        console.log(result);
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
    .command('explore')
    .description('Explore technologies or groups')
    .argument('<query>', 'The question or exploration query')
    .option('-t, --tech <technology>', 'Specific technology to explore')
    .option('-g, --group <group>', 'Technology group to explore')
    .option('-c, --config <path>', 'Path to configuration file', 'librarian.yaml')
    .action(async (query, options) => {
      // Implementation will come in Task 3/5/6
      console.log(`Exploring: ${query}`);
    });

  program
    .command('list')
    .description('List available technologies')
    .option('-g, --group <group>', 'Filter technologies by group')
    .option('-c, --config <path>', 'Path to configuration file', 'librarian.yaml')
    .action(async (options) => {
      // Implementation will come in Task 4/6
      console.log('Listing technologies');
    });

  program
    .command('config')
    .description('Display or update configuration')
    .option('-p, --path', 'Show config file path')
    .action((options) => {
      if (options.path) {
        console.log('Config file path: ./librarian.yaml');
      }
    });

  return program;
}

if (import.meta.main) {
  createProgram().parse();
}
