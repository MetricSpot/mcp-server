import { fromUpstreamStatus, McpError } from "./errors.ts";

export interface AppClientConfig {
  baseUrl: string;
  internalToken?: string;
  userAgent: string;
}

export interface AppCallOptions {
  method?: "GET" | "POST" | "DELETE" | "PATCH";
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  userApiToken?: string;
  timeoutMs?: number;
}

export class AppClient {
  constructor(private readonly config: AppClientConfig) {}

  async call<T = unknown>(opts: AppCallOptions): Promise<T> {
    const url = new URL(opts.path, this.config.baseUrl);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      "Accept": "application/json",
      "User-Agent": this.config.userAgent,
    };
    // Two auth modes the app accepts. Gateway mode — hosted mcp.metricspot.com,
    // which has the service-to-service token configured: X-MCP-Internal-Token
    // plus X-User-Api-Token. Direct mode — a local stdio install that only
    // carries the user's MCP_API_KEY and no infra secret: Authorization Bearer.
    // Direct mode is what the dashboard's copy-paste config relies on.
    if (this.config.internalToken) {
      headers["X-MCP-Internal-Token"] = this.config.internalToken;
      if (opts.userApiToken) headers["X-User-Api-Token"] = opts.userApiToken;
    } else if (opts.userApiToken) {
      headers["Authorization"] = `Bearer ${opts.userApiToken}`;
    }

    let bodyStr: string | undefined;
    if (opts.body !== undefined) {
      bodyStr = JSON.stringify(opts.body);
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method ?? "GET",
        headers,
        body: bodyStr,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = (err as Error).name === "AbortError" ? "Upstream timeout" : (err as Error).message;
      throw new McpError("UPSTREAM_FAILED", `App request failed: ${msg}`, true);
    }
    clearTimeout(timer);

    const text = await res.text();
    if (!res.ok) throw fromUpstreamStatus(res.status, text);

    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new McpError("UPSTREAM_FAILED", "App returned non-JSON response");
    }
  }
}

export function getAppClient(): AppClient {
  const baseUrl = process.env.APP_API_BASE_URL ?? "https://app.metricspot.com";
  return new AppClient({
    baseUrl,
    internalToken: process.env.MCP_INTERNAL_TOKEN,
    userAgent: `metricspot-mcp/${process.env.MCP_VERSION ?? "0.1.0"}`,
  });
}

export function getReportBase(): string {
  return (
    process.env.APP_PUBLIC_BASE_URL ??
    process.env.APP_API_BASE_URL ??
    "https://app.metricspot.com"
  );
}
