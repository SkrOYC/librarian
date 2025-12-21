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
    .command('explore')
    .description('Explore technologies or groups')
    .argument('<query>', 'The question or exploration query')
    .option('-t, --tech <technology>', 'Specific technology to explore')
    .option('-g, --group <group>', 'Technology group to explore')
    .option('-c, --config <path>', 'Path to configuration file')
    .action(async (query, options) => {
      try {
        const config = await loadConfig(options.config);
        const librarian = new Librarian(config);
        await librarian.initialize();

        if (options.tech) {
          const techDetails = librarian.resolveTechnology(options.tech);
          if (!techDetails) {
            throw new Error(`Technology ${options.tech} not found in configuration`);
          }
          const result = await librarian.queryRepository(techDetails.name, query);
          console.log(result);
        } else if (options.group) {
          console.log(`Exploring all technologies in group: ${options.group}`);
          // This will be fully implemented when the agent supports multi-repo exploration
          // For now, let's just find the technologies in the group and query them
          const technologies = config.technologies[options.group];
          if (!technologies) {
            throw new Error(`Group ${options.group} not found in configuration`);
          }
          for (const techName of Object.keys(technologies)) {
            console.log(`\n--- ${techName} ---`);
            const result = await librarian.queryRepository(techName, query);
            console.log(result);
          }
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
        const config = await loadConfig(options.config);
        
        const groupsToDisplay = options.group 
          ? { [options.group]: config.technologies[options.group] }
          : config.technologies;

        if (options.group && !config.technologies[options.group]) {
          throw new Error(`Group ${options.group} not found in configuration`);
        }

        console.log('Available Technologies:');
        for (const [groupName, techs] of Object.entries(groupsToDisplay)) {
          if (!techs || Object.keys(techs).length === 0) continue;
          
          console.log(`\n[${groupName}]`);
          for (const [techName, details] of Object.entries(techs)) {
            const desc = details.description ? ` - ${details.description}` : '';
            const branch = details.branch ? ` (${details.branch})` : '';
            console.log(`  - ${techName}${branch}${desc}`);
          }
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
