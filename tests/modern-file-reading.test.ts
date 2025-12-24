/**
 * Modern File Reading Tool Tests
 * Converted to Bun Test framework
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { fileReadTool } from '../src/tools/file-reading.tool.js';

describe('Modern File Reading Tool', () => {
  beforeEach(() => {
    // Clean up any existing test files
    const testFiles = ['test_modern_file_read.txt', 'test_binary.bin'];
    testFiles.forEach(file => {
      const filePath = path.join(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  });

  afterEach(() => {
    // Clean up test files after each test
    const testFiles = ['test_modern_file_read.txt', 'test_binary.bin'];
    testFiles.forEach(file => {
      const filePath = path.join(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    });
  });

  it('should read file content with structured parameters', async () => {
    // Create a temporary file for testing
    const testFile = path.join(process.cwd(), 'test_modern_file_read.txt');
    const testContent = 'This is test content for modernized file reading tool.';
    fs.writeFileSync(testFile, testContent);
    
    // Test modern tool with structured parameters
    const result = await fileReadTool.invoke({({, testContext)
      filePath: testFile
    });
    
    expect(result).toContain(testContent);
    expect(result).toContain('Content of file');
  });

  it('should handle non-existent files', async () => {
    const result = await fileReadTool.invoke({({, testContext)
      filePath: 'non_existent_file.txt'
    });
    expect(result).toContain('Error reading file');
  });

  it('should handle invalid file paths', async () => {
    const result = await fileReadTool.invoke({({, testContext)
      filePath: '../invalid_dir/file.txt'
    });
    expect(result).toContain('contains invalid path characters');
  });

  it('should handle binary files', async () => {
    // Create a temporary binary file
    const testFile = path.join(process.cwd(), 'test_binary.bin');
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03]); // Binary data with null byte
    fs.writeFileSync(testFile, binaryContent);
    
    const result = await fileReadTool.invoke({({, testContext)
      filePath: testFile
    });
    
    expect(result).toContain('not a text file');
    expect(result).toContain('binary');
  });

  it('should handle large files efficiently', async () => {
    const testFile = path.join(process.cwd(), 'test_large.txt');
    const largeContent = 'A'.repeat(50000); // 50KB file
    fs.writeFileSync(testFile, largeContent);
    
    const startTime = Date.now();
    const result = await fileReadTool.invoke({({, testContext)
      filePath: testFile
    });
    const endTime = Date.now();
    
    expect(result).toContain('Content of file');
    expect(result).toContain(largeContent.substring(0, 100)); // Should contain part of the content
    expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
  });

  it('should handle files with special characters', async () => {
    const testFile = path.join(process.cwd(), 'test-special-émojis-🚀.txt');
    const specialContent = 'Content with special chars: émojis 🚀 unicode 中文';
    fs.writeFileSync(testFile, specialContent);
    
    const result = await fileReadTool.invoke({({, testContext)
      filePath: testFile
    });
    
    expect(result).toContain(specialContent);
    expect(result).toContain('Content of file');
  });

  it('should handle empty files', async () => {
    const testFile = path.join(process.cwd(), 'test_empty.txt');
    fs.writeFileSync(testFile, '');
    
    const result = await fileReadTool.invoke({({, testContext)
      filePath: testFile
    });
    
    expect(result).toContain('Content of file');
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
      
      const result = await fileReadTool.invoke({({, testContext)
        filePath: filePath
      });
      
      expect(result).toContain(testFile.content);
      expect(result).toContain('Content of file');
      
      // Clean up
      fs.unlinkSync(filePath);
    }
  });

  it('should handle permission errors gracefully', async () => {
    const result = await fileReadTool.invoke({({, testContext)
      filePath: '/root/protected.txt'
    });
    
    expect(result).toContain('Error reading file');
    expect(result).toContain('working directory sandbox');
  });

  it('should handle concurrent file reading', async () => {
    const testFile1 = path.join(process.cwd(), 'test_concurrent1.txt');
    const testFile2 = path.join(process.cwd(), 'test_concurrent2.txt');
    fs.writeFileSync(testFile1, 'Concurrent content 1');
    fs.writeFileSync(testFile2, 'Concurrent content 2');
    
    // Read files concurrently
    const [result1, result2] = await Promise.all([
      fileReadTool.invoke({({, testContext) filePath: testFile1 }),
      fileReadTool.invoke({({, testContext) filePath: testFile2 })
    ]);
    
    expect(result1).toContain('Concurrent content 1');
    expect(result2).toContain('Concurrent content 2');
    expect(result1).toContain('Content of file');
    expect(result2).toContain('Content of file');
    
    // Clean up
    fs.unlinkSync(testFile1);
    fs.unlinkSync(testFile2);
  });

  it('should handle path resolution', async () => {
    const testFile = path.join(process.cwd(), 'test_path.txt');
    const relativeFile = './test_path.txt';
    fs.writeFileSync(testFile, 'Path resolution test');
    
    const result1 = await fileReadTool.invoke({({, testContext)
      filePath: testFile
    });
    
    const result2 = await fileReadTool.invoke({({, testContext)
      filePath: relativeFile
    });
    
    expect(result1).toContain('Path resolution test');
    expect(result2).toContain('Path resolution test');
    expect(result1).toContain('Content of file');
    expect(result2).toContain('Content of file');
  });
});