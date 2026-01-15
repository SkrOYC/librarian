import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { GitIgnoreService } from '../src/utils/gitignore-service.js';

describe('GitIgnoreService', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(process.cwd(), `test-gitignore-${Date.now()}`);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should not ignore anything if no .gitignore exists', async () => {
    const service = new GitIgnoreService(testDir);
    await service.initialize();
    
    expect(service.shouldIgnore(path.join(testDir, 'test.txt'))).toBe(false);
  });

  it('should ignore files matching simple patterns', async () => {
    fs.writeFileSync(path.join(testDir, '.gitignore'), 'ignored.txt\n*.log');
    
    const service = new GitIgnoreService(testDir);
    await service.initialize();
    
    expect(service.shouldIgnore(path.join(testDir, 'ignored.txt'))).toBe(true);
    expect(service.shouldIgnore(path.join(testDir, 'test.log'))).toBe(true);
    expect(service.shouldIgnore(path.join(testDir, 'safe.txt'))).toBe(false);
  });

  it('should handle negation patterns', async () => {
    fs.writeFileSync(path.join(testDir, '.gitignore'), '*.txt\n!important.txt');
    
    const service = new GitIgnoreService(testDir);
    await service.initialize();
    
    expect(service.shouldIgnore(path.join(testDir, 'other.txt'))).toBe(true);
    expect(service.shouldIgnore(path.join(testDir, 'important.txt'))).toBe(false);
  });

  it('should handle negation patterns that come before ignore patterns', async () => {
    // This is the critical case: negation before ignore should still work
    fs.writeFileSync(path.join(testDir, '.gitignore'), '!important.txt\n*.txt');
    
    const service = new GitIgnoreService(testDir);
    await service.initialize();
    
    expect(service.shouldIgnore(path.join(testDir, 'important.txt'))).toBe(false);
    expect(service.shouldIgnore(path.join(testDir, 'other.txt'))).toBe(true);
  });

  it('should handle multiple negation patterns', async () => {
    fs.writeFileSync(path.join(testDir, '.gitignore'), '*.log\n!important.log\n!debug.log\n*.txt');
    
    const service = new GitIgnoreService(testDir);
    await service.initialize();
    
    expect(service.shouldIgnore(path.join(testDir, 'error.log'))).toBe(true);
    expect(service.shouldIgnore(path.join(testDir, 'important.log'))).toBe(false);
    expect(service.shouldIgnore(path.join(testDir, 'debug.log'))).toBe(false);
    expect(service.shouldIgnore(path.join(testDir, 'notes.txt'))).toBe(true);
  });

  it('should handle directory patterns', async () => {
    fs.writeFileSync(path.join(testDir, '.gitignore'), 'dist/');
    
    const service = new GitIgnoreService(testDir);
    await service.initialize();
    
    expect(service.shouldIgnore(path.join(testDir, 'dist'), true)).toBe(true);
    expect(service.shouldIgnore(path.join(testDir, 'dist/bundle.js'))).toBe(true);
    expect(service.shouldIgnore(path.join(testDir, 'src/main.js'))).toBe(false);
  });

  it('should handle patterns with wildcards in subdirectories', async () => {
    fs.writeFileSync(path.join(testDir, '.gitignore'), '**/node_modules/');
    
    const service = new GitIgnoreService(testDir);
    await service.initialize();
    
    expect(service.shouldIgnore(path.join(testDir, 'node_modules'), true)).toBe(true);
    expect(service.shouldIgnore(path.join(testDir, 'packages/app/node_modules'), true)).toBe(true);
    expect(service.shouldIgnore(path.join(testDir, 'src/index.js'))).toBe(false);
  });
});
