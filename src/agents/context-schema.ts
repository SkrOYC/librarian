import { z } from 'zod';

/**
 * Context Schema for Agent Runtime
 *
 * Defines context object that is passed to the agent during invocation.
 * This provides static runtime context that tools can access via ToolRuntime.
 */
export const contextSchema = z.object({
  /** The absolute path to sandbox directory where all file operations should be confined */
  workingDir: z.string().describe("The absolute path to sandbox directory"),
  /** Optional environment identifier (e.g., 'development', 'production') */
  environment: z.string().optional().describe("Optional environment identifier"),
  /** The technology group name (e.g., 'default', 'langchain') */
  group: z.string().describe("The technology group name"),
  /** The technology/repo name (e.g., 'react', 'openai') */
  technology: z.string().describe("The technology/repo name"),
});

/**
 * Type inference from contextSchema
 * Use this type for context objects throughout the application
 */
export type Context = z.infer<typeof contextSchema>;

/**
 * Creates a context object with the given parameters.
 *
 * @param workingDir - The absolute path to sandbox directory
 * @param group - The technology group name
 * @param technology - The technology/repo name
 * @param environment - Optional environment identifier
 * @returns A validated context object
 */
export function createContext(
  workingDir: string,
  group: string,
  technology: string,
  environment?: string
): Context {
  return contextSchema.parse({
    workingDir,
    group,
    technology,
    environment,
  });
}
