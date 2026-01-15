import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { listTool } from '../src/tools/file-listing.tool.js';

describe('List Tool with GitIgnore', () => {
  let testDir: string;
  let testContext: { workingDir: string; group: string; technology: string };

  beforeEach(() => {
    testDir = path.join(process.cwd(), `test-list-gitignore-${Date.now()}`);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    testContext = { workingDir: testDir, group: 'test', technology: 'test' };
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should respect .gitignore in the working directory', async () => {
    // Create structure
    fs.mkdirSync(path.join(testDir, 'src'));
    fs.mkdirSync(path.join(testDir, 'dist'));
    fs.writeFileSync(path.join(testDir, 'src/index.js'), 'console.log("hi")');
    fs.writeFileSync(path.join(testDir, 'dist/bundle.js'), 'console.log("bundle")');
    fs.writeFileSync(path.join(testDir, '.gitignore'), 'dist/');

    const result = await listTool.invoke({
      directoryPath: '.',
      recursive: true,
      maxDepth: 2
    }, { context: testContext });

    expect(result).toContain('src/');
    expect(result).toContain('index.js');
    expect(result).not.toContain('dist/');
    expect(result).not.toContain('bundle.js');
  });

  it('should return standardized error messages', async () => {
    const result = await listTool.invoke({
      directoryPath: 'nonexistent'
    }, { context: testContext });

    expect(result).toContain('Path not found: nonexistent');
    expect(result).toContain('Suggestion:');
  });
});
