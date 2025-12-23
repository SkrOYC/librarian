#!/usr/bin/env bun
/**
 * Quick verification script to test sandboxing end-to-end
 */

import { fileListTool } from './src/tools/file-listing.tool.js';
import { fileReadTool } from './src/tools/file-reading.tool.js';
import { fileFindTool } from './src/tools/file-finding.tool.js';
import { grepContentTool } from './src/tools/grep-content.tool.js';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

async function testSandboxing() {
  const sandboxDir = path.join(process.cwd(), 'verification-sandbox');

  // Clean up
  if (existsSync(sandboxDir)) {
    rmSync(sandboxDir, { recursive: true, force: true });
  }

  // Create sandbox and test content
  mkdirSync(sandboxDir, { recursive: true });
  mkdirSync(path.join(sandboxDir, 'src'));
  mkdirSync(path.join(sandboxDir, 'other-dir'));
  writeFileSync(path.join(sandboxDir, 'src', 'test.js'), 'export const x = 42;');
  writeFileSync(path.join(sandboxDir, 'other-dir', 'secret.txt'), 'This should not be accessible');

  console.log('🧪 Testing sandbox boundary enforcement...\n');

  // Test 1: List files in sandbox with context
  console.log('Test 1: List files in sandbox (should succeed)');
  const listResult = await fileListTool.invoke({
    directoryPath: '.',
    includeHidden: false,
  }, {
    context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
  });
  console.log(`✓ Listing succeeded: ${listResult.includes('src') ? 'Found src directory' : 'Test failed'}`);

  // Test 2: Try to escape sandbox via .. (should fail)
  console.log('\nTest 2: Try to escape sandbox via ../ (should fail)');
  const escapeResult = await fileListTool.invoke({
    directoryPath: '../other-dir',
    includeHidden: false,
  }, {
    context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
  });
  console.log(`✓ Security ENFORCED: ${escapeResult.includes('attempts to escape') ? 'Correctly rejected' : 'Security FAILED: ' + escapeResult}`);

  // Test 3: Try to escape sandbox with absolute path (should fail)
  console.log('\nTest 3: Try to escape sandbox with absolute path (should fail)');
  const absPathResult = await fileReadTool.invoke({
    filePath: path.join(sandboxDir, '..', 'secret.txt'),
  }, {
    context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
  });
  console.log(`✓ Security ENFORCED: ${absPathResult.includes('attempts to escape') ? 'Correctly rejected' : 'Security FAILED: ' + absPathResult}`);

  // Test 4: Find files within sandbox (should succeed)
  console.log('\nTest 4: Find files within sandbox (should succeed)');
  const findResult = await fileFindTool.invoke({
    searchPath: '.',
    patterns: ['*.js'],
  }, {
    context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
  });
  console.log(`✓ Finding succeeded: ${findResult.includes('test.js') ? 'Found test.js' : 'Test failed'}`);

  // Test 5: Grep within sandbox (should succeed)
  console.log('\nTest 5: Grep content within sandbox (should succeed)');
  const grepResult = await grepContentTool.invoke({
    searchPath: '.',
    query: 'const',
    patterns: ['*.js'],
  }, {
    context: { workingDir: sandboxDir, group: 'test', technology: 'test' }
  });
  console.log(`✓ Grep succeeded: ${grepResult.includes('const x') ? 'Found pattern' : 'Test failed'}`);

  console.log('\n🧪 Sandbox Verification Complete!');
  console.log('Cleaning up test directory...');

  // Clean up
  rmSync(sandboxDir, { recursive: true, force: true });
}

testSandboxing().catch(console.error);
