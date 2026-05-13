import type { z } from "zod";

export interface ToolContext {
  authHeader?: string | null;
}

export interface ToolDefinition<S extends z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: S;
  requiresAuth: boolean;
  handler: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolDefinition = ToolDefinition<any>;
