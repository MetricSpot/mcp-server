import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;
const DIST_CLI = join(REPO_ROOT, "dist", "cli.js");
const DIST_SERVER = join(REPO_ROOT, "dist", "server.js");

describe("build artifact", () => {
  test("dist/cli.js and dist/server.js exist after `bun run build`", () => {
    // CI: callers must run `bun run build` before this test. Local: same.
    // We don't shell out to build here because tests should be fast and
    // hermetic — the build is part of the npm publish flow.
    expect(existsSync(DIST_CLI)).toBe(true);
    expect(existsSync(DIST_SERVER)).toBe(true);
    // Sanity: not empty.
    expect(statSync(DIST_CLI).size).toBeGreaterThan(1000);
    expect(statSync(DIST_SERVER).size).toBeGreaterThan(1000);
  });

  test("dist/cli.js executes via node and responds to MCP initialize over stdio", async () => {
    if (!existsSync(DIST_CLI)) {
      console.warn("[build.test] skipping: dist/cli.js missing — run `bun run build` first");
      return;
    }
    const proc = spawn("node", [DIST_CLI], {
      env: { ...process.env, APP_API_BASE_URL: "http://localhost:1", NODE_ENV: "test" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdout: string[] = [];
    const stderr: string[] = [];
    proc.stdout.on("data", (d) => stdout.push(d.toString()));
    proc.stderr.on("data", (d) => stderr.push(d.toString()));

    // MCP initialize request (JSON-RPC 2.0 over stdio, line-delimited).
    const initReq = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "build-test", version: "0.0.1" },
      },
    });
    proc.stdin.write(initReq + "\n");

    // Wait up to 3s for a response line.
    const response = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        try { proc.kill(); } catch { /* noop */ }
        reject(new Error(`No response in 3s. stdout=${stdout.join("")} stderr=${stderr.join("")}`));
      }, 3000);
      const tryParse = () => {
        const buf = stdout.join("");
        const nl = buf.indexOf("\n");
        if (nl >= 0) {
          clearTimeout(timer);
          resolve(buf.slice(0, nl));
        }
      };
      proc.stdout.on("data", tryParse);
      // Also exit early if the process dies.
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (stdout.length === 0) reject(new Error(`Process exited code=${code} with no stdout. stderr=${stderr.join("")}`));
      });
    });

    proc.kill();

    expect(response.length).toBeGreaterThan(0);
    const parsed = JSON.parse(response);
    expect(parsed.jsonrpc).toBe("2.0");
    expect(parsed.id).toBe(1);
    // SDK responds with `result` for a successful initialize; assert shape.
    expect(parsed.result).toBeDefined();
    expect(parsed.result.protocolVersion).toBeDefined();
    expect(parsed.result.serverInfo).toBeDefined();
    expect(parsed.result.serverInfo.name).toContain("metricspot");
  }, 10_000);
});
