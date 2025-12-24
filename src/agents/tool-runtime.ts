import type { Context } from "./context-schema.js";

/**
 * Tool Runtime Context
 *
 * Provides the static runtime context passed to the agent during invocation.
 * Tools can access this through the config parameter.
 */
export interface ToolRuntime {
	/** The context object containing working directory and metadata */
	context?: Context;

	/** Additional runtime properties if needed for future extensions */
	[key: string]: any;
}

/**
 * Type for the config parameter passed to tool functions
 * This aligns with LangChain's tool() function signature
 */
export type ToolConfig = ToolRuntime | undefined;
