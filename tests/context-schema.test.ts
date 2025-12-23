/**
 * Context Schema Tests
 * Tests for the agent's context schema definition and validation
 */

import { describe, it, expect } from 'bun:test';
import { contextSchema, Context, createContext } from '../src/agents/context-schema.js';

describe('Context Schema', () => {
  describe('Schema Validation', () => {
    it('should accept valid context with all required fields', () => {
      const validContext = {
        workingDir: '/path/to/repo',
        group: 'default',
        technology: 'react',
      };

      const result = contextSchema.safeParse(validContext);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.workingDir).toBe('/path/to/repo');
        expect(result.data.group).toBe('default');
        expect(result.data.technology).toBe('react');
      }
    });

    it('should accept valid context with optional environment field', () => {
      const contextWithOptional = {
        workingDir: '/path/to/repo',
        environment: 'development',
        group: 'default',
        technology: 'react',
      };

      const result = contextSchema.safeParse(contextWithOptional);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.environment).toBe('development');
      }
    });

    it('should reject context missing required workingDir', () => {
      const missingWorkingDir = {
        group: 'default',
        technology: 'react',
      };

      const result = contextSchema.safeParse(missingWorkingDir);
      expect(result.success).toBe(false);
    });

    it('should reject context missing required group field', () => {
      const missingGroup = {
        workingDir: '/path/to/repo',
        technology: 'react',
      };

      const result = contextSchema.safeParse(missingGroup);
      expect(result.success).toBe(false);
    });

    it('should reject context missing required technology field', () => {
      const missingTechnology = {
        workingDir: '/path/to/repo',
        group: 'default',
      };

      const result = contextSchema.safeParse(missingTechnology);
      expect(result.success).toBe(false);
    });

    it('should reject context with wrong type for workingDir', () => {
      const wrongType = {
        workingDir: 123, // Should be string
        group: 'default',
        technology: 'react',
      };

      const result = contextSchema.safeParse(wrongType);
      expect(result.success).toBe(false);
    });

    it('should reject context with wrong type for group', () => {
      const wrongType = {
        workingDir: '/path/to/repo',
        group: 123, // Should be string
        technology: 'react',
      };

      const result = contextSchema.safeParse(wrongType);
      expect(result.success).toBe(false);
    });

    it('should accept empty string for environment (optional field)', () => {
      const contextWithEmptyEnv = {
        workingDir: '/path/to/repo',
        environment: '',
        group: 'default',
        technology: 'react',
      };

      const result = contextSchema.safeParse(contextWithEmptyEnv);
      expect(result.success).toBe(true);
    });

    it('should properly extract field values', () => {
      const context = {
        workingDir: '/absolute/path/to/sandbox',
        environment: 'production',
        group: 'langchain',
        technology: 'openai',
      };

      const result = contextSchema.safeParse(context);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.workingDir).toBe('/absolute/path/to/sandbox');
        expect(result.data.environment).toBe('production');
        expect(result.data.group).toBe('langchain');
        expect(result.data.technology).toBe('openai');
      }
    });
  });

  describe('Type Safety', () => {
    it('should have proper TypeScript type inference', () => {
      // This test verifies that the schema provides proper type inference
      type Context = z.infer<typeof contextSchema>;

      const context: Context = {
        workingDir: '/path/to/repo',
        group: 'default',
        technology: 'react',
      };

      // If this compiles, type inference is correct
      expect(context.workingDir).toBeDefined();
      expect(context.group).toBeDefined();
      expect(context.technology).toBeDefined();
    });

    it('should mark environment as optional in inferred type', () => {
      type Context = z.infer<typeof contextSchema>;

      const contextWithoutEnv: Context = {
        workingDir: '/path/to/repo',
        group: 'default',
        technology: 'react',
      };

      expect(contextWithoutEnv.environment).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should accept absolute paths for workingDir', () => {
      const context = {
        workingDir: '/absolute/path',
        group: 'default',
        technology: 'react',
      };

      const result = contextSchema.safeParse(context);
      expect(result.success).toBe(true);
    });

    it('should accept relative paths for workingDir', () => {
      const context = {
        workingDir: './relative/path',
        group: 'default',
        technology: 'react',
      };

      const result = contextSchema.safeParse(context);
      expect(result.success).toBe(true);
    });

    it('should accept special characters in technology and group names', () => {
      const context = {
        workingDir: '/path/to/repo',
        group: 'group-with-dash',
        technology: 'tech_with_underscore',
      };

      const result = contextSchema.safeParse(context);
      expect(result.success).toBe(true);
    });
  });

  describe('createContext Helper', () => {
    it('should create valid context with required fields', () => {
      const context = createContext('/path/to/repo', 'default', 'react');

      expect(context.workingDir).toBe('/path/to/repo');
      expect(context.group).toBe('default');
      expect(context.technology).toBe('react');
      expect(context.environment).toBeUndefined();
    });

    it('should create valid context with optional environment', () => {
      const context = createContext('/path/to/repo', 'default', 'react', 'production');

      expect(context.workingDir).toBe('/path/to/repo');
      expect(context.group).toBe('default');
      expect(context.technology).toBe('react');
      expect(context.environment).toBe('production');
    });
  });
});
