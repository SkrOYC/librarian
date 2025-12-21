#!/usr/bin/env node

import { Command } from 'commander';
import { Librarian, LibrarianConfig } from './index.js';
import fs from 'fs';
import path from 'path';
import { loadConfig } from './config.js';

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
  .command('config')
  .description('Display or update configuration')
  .option('-p, --path', 'Show config file path')
  .action((options) => {
    if (options.path) {
      console.log('Config file path: ./librarian.yaml');
    }
  });

program.parse();