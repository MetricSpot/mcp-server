import { test, expect } from "@playwright/test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

class StdioMcpClient {
  private buffer = "";
  private resolvers = new Map<number | string, (msg: JsonRpcResponse) => void>();
  private nextId = 1;

  constructor(private child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      let nl: number;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (msg.id !== undefined) {
            const resolver = this.resolvers.get(msg.id);
            if (resolver) {
              this.resolvers.delete(msg.id);
              resolver(msg);
            }
          }
        } catch {
          // notification or non-JSON stderr leak — ignore
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(`[mcp stderr] ${chunk}`);
    });
  }

  async request(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolveFn, reject) => {
      const timer = setTimeout(() => {
        this.resolvers.delete(id);
        reject(new Error(`Timeout waiting for response to ${method}`));
      }, 30_000);
      this.resolvers.set(id, (msg) => {
        clearTimeout(timer);
        resolveFn(msg);
      });
      this.child.stdin.write(payload + "\n");
    });
  }

  close() {
    this.child.kill("SIGTERM");
  }
}

test("stdio: initialize, tools/list, tools/call run_audit_anonymous", async () => {
  const cliPath = resolve(__dirname, "../src/cli.ts");
  const child = spawn("bun", [cliPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      APP_API_BASE_URL: process.env.APP_API_BASE_URL ?? "http://localhost:3000",
      NODE_ENV: "test",
    },
  });

  const client = new StdioMcpClient(child);

  try {
    const init = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "e2e-test", version: "0.0.0" },
    });
    expect(init.error).toBeUndefined();
    expect(init.result).toBeDefined();

    const listed = await client.request("tools/list");
    expect(listed.error).toBeUndefined();
    const tools = (listed.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_audit",
      "get_audit_pdf",
      "get_organic_traffic",
      "list_audits",
      "run_audit",
      "run_audit_anonymous",
    ]);
  } finally {
    client.close();
  }
});
