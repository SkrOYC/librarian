/**
 * Modern File Reading Tool Tests
 * Converted to Bun Test framework
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { viewTool } from '../src/tools/file-reading.tool.js';

describe('Modern File Reading Tool', () => {
  let testContext: { workingDir: string; group: string; technology: string };

  beforeEach(() => {
    testContext = { workingDir: process.cwd(), group: 'test', technology: 'test' };
    // Clean up any existing test files
    const testFiles = ['test_modern_file_read.txt', 'test_binary.bin'];
    for (const file of testFiles) {
      const filePath = path.join(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  });

  afterEach(() => {
    // Clean up all test files after each test
    const testFiles = [
      'test_modern_file_read.txt',
      'test_binary.bin',
      'test_large.txt',
      'test-special-émojis-🚀.txt',
      'test_empty.txt',
      'test_path.txt'
    ];
    for (const file of testFiles) {
      const filePath = path.join(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  });

  it('should read file content with structured parameters', async () => {
    // Create a temporary file for testing
    const testFile = path.join(process.cwd(), 'test_modern_file_read.txt');
    const testContent = 'This is test content for modernized file reading tool.';
    fs.writeFileSync(testFile, testContent);

    // Test modern tool with structured parameters
    const result = await viewTool.invoke({
      filePath: testFile
    }, { context: testContext });

    expect(result).toContain(testContent);
    // Verify NO header
    expect(result).not.toContain('Content of file');

    // Clean up
    fs.unlinkSync(testFile);
  });

  it('should handle non-existent files', async () => {
    const result = await viewTool.invoke({
      filePath: 'non_existent_file.txt'
    }, { context: testContext });
    expect(result).toContain('not found');
  });

  it('should handle invalid file paths', async () => {
    const result = await viewTool.invoke({
      filePath: '../invalid_dir/file.txt'
    }, { context: testContext });
    expect(result).toContain('attempts to escape the working directory sandbox');
  });

  it('should handle binary files', async () => {
    // Create a temporary binary file
    const testFile = path.join(process.cwd(), 'test_binary.bin');
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03]); // Binary data with null byte
    fs.writeFileSync(testFile, binaryContent);

    const result = await viewTool.invoke({
      filePath: testFile
    }, { context: testContext });

    expect(result).toContain('not a text file');
  });

  it('should handle large files efficiently', async () => {
    const testFile = path.join(process.cwd(), 'test_large.txt');
    const largeContent = 'A'.repeat(50_000); // 50KB file
    fs.writeFileSync(testFile, largeContent);

    const startTime = Date.now();
    const result = await viewTool.invoke({
      filePath: testFile
    }, { context: testContext });
    const endTime = Date.now();

    expect(result).toContain(largeContent.substring(0, 100)); // Should contain part of the content
    expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
  });

  it('should handle files with special characters', async () => {
    const testFile = path.join(process.cwd(), 'test-special-émojis-🚀.txt');
    const specialContent = 'Content with special chars: émojis 🚀 unicode 中文';
    fs.writeFileSync(testFile, specialContent);

    const result = await viewTool.invoke({
      filePath: testFile
    }, { context: testContext });

    expect(result).toContain(specialContent);
  });

  it('should handle empty files', async () => {
    const testFile = path.join(process.cwd(), 'test_empty.txt');
    fs.writeFileSync(testFile, '');

    const result = await viewTool.invoke({
      filePath: testFile
    }, { context: testContext });

    expect(result).toContain('empty');
  });

  it('should handle different file types', async () => {
    const testFiles = [
      { name: 'test.js', content: 'console.log("test");' },
      { name: 'test.json', content: '{"test": true}' },
      { name: 'test.md', content: '# Test Markdown' },
      { name: 'test.xml', content: '<?xml version="1.0"?><test>content</test>' }
    ];

    for (const testFile of testFiles) {
      const filePath = path.join(process.cwd(), testFile.name);
      fs.writeFileSync(filePath, testFile.content);

      const result = await viewTool.invoke({
        filePath
      }, { context: testContext });

      // Check JSON format
      const parsed = JSON.parse(result);
      expect(parsed.lines.some((l: any) => l.content.includes(testFile.content))).toBe(true);

      // Clean up
      fs.unlinkSync(filePath);
    }
  });

  it('should handle permission errors gracefully', async () => {
    const result = await viewTool.invoke({
      filePath: '/root/protected.txt'
    }, { context: testContext });

    expect(result).toContain('view failed');
    expect(result).toContain('working directory sandbox');
  });

  it('should handle concurrent file reading', async () => {
    const testFile1 = path.join(process.cwd(), 'test_concurrent1.txt');
    const testFile2 = path.join(process.cwd(), 'test_concurrent2.txt');
    fs.writeFileSync(testFile1, 'Concurrent content 1');
    fs.writeFileSync(testFile2, 'Concurrent content 2');

    // Read files concurrently
    const [result1, result2] = await Promise.all([
      viewTool.invoke({ filePath: testFile1 }, { context: testContext }),
      viewTool.invoke({ filePath: testFile2 }, { context: testContext })
    ]);

    expect(result1).toContain('Concurrent content 1');
    expect(result2).toContain('Concurrent content 2');

    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
  });

  it('should handle path resolution', async () => {
    const testFile = path.join(process.cwd(), 'test_path.txt');
    const relativeFile = './test_path.txt';
    fs.writeFileSync(testFile, 'Path resolution test');

    const result1 = await viewTool.invoke({
      filePath: testFile
    }, { context: testContext });

    const result2 = await viewTool.invoke({
      filePath: relativeFile
    }, { context: testContext });

    expect(result1).toContain('Path resolution test');
    expect(result2).toContain('Path resolution test');
  });

  describe('viewRange validation', () => {
    let testFile: string;

    beforeEach(() => {
      testFile = path.join(process.cwd(), 'test_viewrange.txt');
      fs.writeFileSync(testFile, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7\nLine 8\nLine 9\nLine 10');
    });

    afterEach(() => {
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    });

    it('should reject viewRange with start less than 1', async () => {
      const result = await viewTool.invoke({
        filePath: testFile,
        viewRange: [0, 5] as [number, number]
      }, { context: testContext });

      expect(result).toContain('Invalid viewRange');
      expect(result).toContain('start must be >= 1');
    });

    it('should reject viewRange with end less than start', async () => {
      const result = await viewTool.invoke({
        filePath: testFile,
        viewRange: [10, 5] as [number, number]
      }, { context: testContext });

      expect(result).toContain('Invalid viewRange');
      expect(result).toContain('end (5) must be >= start (10)');
    });

    it('should accept valid viewRange', async () => {
      const result = await viewTool.invoke({
        filePath: testFile,
        viewRange: [2, 4] as [number, number]
      }, { context: testContext });

      expect(result).toContain('Line 2');
      expect(result).toContain('Line 3');
      expect(result).toContain('Line 4');
      expect(result).not.toContain('Line 1');
      expect(result).not.toContain('Line 5');
    });

    it('should accept viewRange with end as -1 for end of file', async () => {
      const result = await viewTool.invoke({
        filePath: testFile,
        viewRange: [8, -1] as [number, number]
      }, { context: testContext });

      expect(result).toContain('Line 8');
      expect(result).toContain('Line 9');
      expect(result).toContain('Line 10');
    });
  });
});
