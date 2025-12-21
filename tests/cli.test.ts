import { describe, it, expect } from 'bun:test';
import { createProgram } from '../src/cli';

describe('CLI Commands', () => {
  it('should have an explore command', () => {
    const program = createProgram();
    const command = program.commands.find(c => c.name() === 'explore');
    expect(command).toBeDefined();
    expect(command?.description()).toBe('Explore technologies or groups');
  });

  it('should support --tech flag in explore command', () => {
    const program = createProgram();
    const command = program.commands.find(c => c.name() === 'explore');
    const option = command?.options.find(o => o.long === '--tech');
    expect(option).toBeDefined();
    expect(option?.description).toBe('Specific technology to explore');
  });

  it('should support --group flag in explore command', () => {
    const program = createProgram();
    const command = program.commands.find(c => c.name() === 'explore');
    const option = command?.options.find(o => o.long === '--group');
    expect(option).toBeDefined();
    expect(option?.description).toBe('Technology group to explore');
  });

  it('should have a list command', () => {
    const program = createProgram();
    const command = program.commands.find(c => c.name() === 'list');
    expect(command).toBeDefined();
    expect(command?.description()).toBe('List available technologies');
  });

  it('should support --group flag in list command', () => {
    const program = createProgram();
    const command = program.commands.find(c => c.name() === 'list');
    const option = command?.options.find(o => o.long === '--group');
    expect(option).toBeDefined();
    expect(option?.description).toBe('Filter technologies by group');
  });

  it('should not have a query command', () => {
    const program = createProgram();
    const command = program.commands.find(c => c.name() === 'query');
    expect(command).toBeUndefined();
  });
});
