#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp-server.ts";

async function main() {
  const apiKey = process.env.MCP_API_KEY ?? process.env.METRICSPOT_API_KEY;
  const authHeader = apiKey ? `Bearer ${apiKey}` : undefined;

  const server = createMcpServer({
    getAuthHeader: () => authHeader,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Stay alive; transport closes on stdin EOF.
  process.on("SIGINT", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
}

main().catch((err) => {
  process.stderr.write(`[mcp] fatal: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
