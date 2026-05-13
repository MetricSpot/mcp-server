import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { tools, toolsByName } from "./tools/index.ts";
import { McpError } from "./lib/errors.ts";

const SERVER_NAME = "@metricspot/mcp-server";
const SERVER_VERSION = "0.1.0";

interface CreateServerOptions {
  getAuthHeader?: () => string | null | undefined;
}

function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  // Minimal converter for the small set of shapes we use: z.object with string/number/url fields.
  // Keeps the dep surface tiny — no need for the full zod-to-json-schema package.
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, field] of Object.entries(shape)) {
      properties[key] = fieldToJsonSchema(field);
      if (!field.isOptional()) required.push(key);
    }
    const out: Record<string, unknown> = {
      type: "object",
      properties,
      additionalProperties: false,
    };
    if (required.length > 0) out.required = required;
    return out;
  }
  return { type: "object" };
}

function fieldToJsonSchema(field: z.ZodTypeAny): Record<string, unknown> {
  let inner: z.ZodTypeAny = field;
  let isOptional = false;
  if (inner instanceof z.ZodOptional) {
    isOptional = true;
    inner = inner.unwrap();
  }
  if (inner instanceof z.ZodDefault) {
    inner = inner.removeDefault();
  }
  let out: Record<string, unknown>;
  if (inner instanceof z.ZodString) {
    out = { type: "string" };
    const checks = (inner as unknown as { _def: { checks?: Array<Record<string, unknown>> } })._def.checks ?? [];
    for (const c of checks) {
      if (c.kind === "url") out.format = "uri";
      if (c.kind === "max" && typeof c.value === "number") out.maxLength = c.value;
      if (c.kind === "min" && typeof c.value === "number") out.minLength = c.value;
    }
  } else if (inner instanceof z.ZodNumber) {
    out = { type: "number" };
    const checks = (inner as unknown as { _def: { checks?: Array<Record<string, unknown>> } })._def.checks ?? [];
    for (const c of checks) {
      if (c.kind === "int") out.type = "integer";
      if (c.kind === "max" && typeof c.value === "number") out.maximum = c.value;
      if (c.kind === "min" && typeof c.value === "number") out.minimum = c.value;
    }
  } else if (inner instanceof z.ZodBoolean) {
    out = { type: "boolean" };
  } else {
    out = {};
  }
  void isOptional;
  return out;
}

export function createMcpServer(opts: CreateServerOptions = {}): Server {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: zodToJsonSchema(t.inputSchema),
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = toolsByName[req.params.name];
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ code: "TOOL_NOT_FOUND", message: `Unknown tool: ${req.params.name}` }) }],
      };
    }

    let parsed: unknown;
    try {
      parsed = tool.inputSchema.parse(req.params.arguments ?? {});
    } catch (err) {
      const issues = err instanceof z.ZodError ? err.issues : [{ message: (err as Error).message }];
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ code: "INVALID_URL", message: "Invalid arguments", issues }) }],
      };
    }

    const authHeader = opts.getAuthHeader?.() ?? undefined;

    try {
      const result = await tool.handler(parsed, { authHeader });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as { [k: string]: unknown },
      };
    } catch (err) {
      if (err instanceof McpError) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(err.toJSON()) }],
        };
      }
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ code: "INTERNAL_ERROR", message: (err as Error).message }) }],
      };
    }
  });

  return server;
}
