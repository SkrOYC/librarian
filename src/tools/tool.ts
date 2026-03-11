import type { z } from "zod";
import type { ToolConfig } from "../agents/tool-runtime.js";

export interface SimpleTool<
  TInput,
  TOutput = string,
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
> {
  name: string;
  description: string;
  schema: TSchema;
  invoke(input: TInput, config?: ToolConfig): Promise<TOutput>;
}

export function createTool<
  TSchema extends z.ZodTypeAny,
  TOutput = string,
>(
  handler: (input: z.infer<TSchema>, config?: ToolConfig) => Promise<TOutput>,
  config: {
    name: string;
    description: string;
    schema: TSchema;
  },
): SimpleTool<z.infer<TSchema>, TOutput, TSchema> {
  return {
    ...config,
    async invoke(input, runtimeConfig) {
      const parsedInput = config.schema.parse(input);
      return handler(parsedInput, runtimeConfig);
    },
  };
}
