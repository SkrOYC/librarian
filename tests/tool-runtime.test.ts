/**
 * ToolRuntime Type Tests
 * Tests for type definitions and their usage in tools
 */

import { describe, it, expect } from 'bun:test';
import type { ToolRuntime, ToolConfig } from '../src/agents/tool-runtime.js';

describe('ToolRuntime Types', () => {
  describe('Type Definitions', () => {
    it('should define ToolRuntime interface with context field', () => {
      const runtime: ToolRuntime = {
        context: {
          workingDir: '/path/to/repo',
          group: 'default',
          technology: 'react',
        }
      };

      expect(runtime.context).toBeDefined();
      expect(runtime.context?.workingDir).toBe('/path/to/repo');
    });

    it('should allow ToolRuntime without context (optional)', () => {
      const runtime: ToolRuntime = {};
      expect(runtime.context).toBeUndefined();
    });

    it('should allow ToolRuntime with additional properties', () => {
      const runtime: ToolRuntime = {
        context: {
          workingDir: '/path',
          group: 'default',
          technology: 'react',
          environment: 'dev'
        },
        customProperty: 'some value'
      };

      expect(runtime.context?.environment).toBe('dev');
      expect(runtime.customProperty).toBe('some value');
    });

    it('should define ToolConfig as ToolRuntime or undefined', () => {
      const config1: ToolConfig = {
        context: {
          workingDir: '/path',
          group: 'default',
          technology: 'react',
        }
      };

      const config2: ToolConfig = undefined;

      expect(config1?.context).toBeDefined();
      expect(config2).toBeUndefined();
    });
  });

  describe('Context Access Patterns', () => {
    it('should support optional chaining for context access', () => {
      const runtime: ToolRuntime = {
        context: {
          workingDir: '/sandbox',
          group: 'langchain',
          technology: 'openai',
        }
      };

      // This is the pattern used in tools: config?.context?.workingDir
      const workingDir = runtime.context?.workingDir;
      expect(workingDir).toBe('/sandbox');
    });

    it('should provide safe fallback when context is undefined', () => {
      const runtime: ToolRuntime = {};

      // Simulate tool fallback pattern: config?.context?.workingDir || process.cwd()
      const workingDir = runtime.context?.workingDir || process.cwd();

      expect(workingDir).toBe(process.cwd());
    });

    it('should provide safe fallback when context is undefined but default exists', () => {
      const runtime: ToolRuntime = {};
      const fallback = '/default/path';

      const workingDir = runtime.context?.workingDir || fallback;

      expect(workingDir).toBe(fallback);
    });
  });

  describe('Type Safety with Context', () => {
    it('should enforce context type fields', () => {
      const runtime: ToolRuntime = {
        context: {
          workingDir: '/path',
          group: 'group',
          technology: 'tech',
        }
      };

      expect(runtime.context?.workingDir).toBeDefined();
    });

    it('should allow optional environment field', () => {
      const runtime: ToolRuntime = {
        context: {
          workingDir: '/path',
          group: 'group',
          technology: 'tech',
          environment: 'production',
        }
      };

      expect(runtime.context?.environment).toBe('production');
    });
  });
});
