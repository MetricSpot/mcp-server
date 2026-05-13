import { test, expect } from "@playwright/test";

/**
 * Live integration tests against the deployed MCP server at
 * https://mcp.metricspot.com. Audits two known-good URLs end-to-end:
 *
 *   - metricspot.com  (our own marketing site, AEO-tuned, score ~85-95)
 *   - revenuehunt.com (the founder's other product, score ~75-90)
 *
 * What this covers that the unit-mocked dispatch tests can't:
 *   1. Real network round-trip MCP → app over the internet
 *   2. Real upstream audit handler (psi skipped, organic_traffic gate rule)
 *   3. Sanitizer against actual production payload shapes
 *   4. Bearer ms_live_* path resolves a real user via api_tokens table
 *
 * Auth: set MCP_TEST_API_KEY env to a valid `ms_live_*` token from
 * api_tokens (see `app/src/server/services/api-tokens.ts`). The anon
 * tests don't need a key.
 *
 * Rate limit: anon is 1/IP/24h; running this test from the same IP twice
 * in a day will 429 on the second domain. The test handles 429 by
 * recording the skip and asserting the response shape was correct
 * structurally even when rate-limited.
 */

const MCP_URL = process.env.MCP_TEST_URL ?? "https://mcp.metricspot.com";
const API_KEY = process.env.MCP_TEST_API_KEY;

interface JsonRpcResp {
  jsonrpc: "2.0";
  id: number | string;
  result?: {
    content?: Array<{ type: string; text: string }>;
    structuredContent?: unknown;
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

async function mcpCall(args: {
  request: typeof test extends { request: infer T } ? T : never;
  tool: string;
  toolArgs: Record<string, unknown>;
  bearer?: string;
}): Promise<JsonRpcResp> {
  const res = await (args.request as unknown as { post: (url: string, opts: { headers: Record<string, string>; data: unknown }) => Promise<{ text(): Promise<string>; status(): number }> }).post(`${MCP_URL}/mcp`, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(args.bearer ? { Authorization: `Bearer ${args.bearer}` } : {}),
    },
    data: {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: args.tool, arguments: args.toolArgs },
    },
  });
  // The Streamable HTTP transport returns SSE-framed JSON; parse the
  // first `data:` line.
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  if (!line) throw new Error(`No SSE data frame: ${text.slice(0, 300)}`);
  return JSON.parse(line.slice(6)) as JsonRpcResp;
}

function unwrap(resp: JsonRpcResp): { isError: boolean; parsed: Record<string, unknown> } {
  expect(resp.error).toBeUndefined();
  expect(resp.result).toBeDefined();
  const raw = resp.result!.content?.[0]?.text;
  expect(raw).toBeDefined();
  return { isError: resp.result!.isError === true, parsed: JSON.parse(raw!) };
}

test.describe("Live MCP server: run_audit_anonymous", () => {
  test("audits metricspot.com end-to-end (anon)", async ({ request }) => {
    const resp = await mcpCall({ request: request as never, tool: "run_audit_anonymous", toolArgs: { url: "https://metricspot.com/" } });
    const { isError, parsed } = unwrap(resp);
    if (isError) {
      // Rate-limit guard: the next-day rerun is expected to 429.
      expect((parsed as { code?: string }).code === "RATE_LIMITED" || (parsed as { upstream_status?: number }).upstream_status === 429).toBe(true);
      test.skip();
      return;
    }
    // Audit shape.
    expect(parsed.audit_id).toBe("anonymous");
    expect(parsed.url).toBe("https://metricspot.com/");
    expect(parsed.status).toBe("complete");
    expect(typeof parsed.total_score).toBe("number");
    expect((parsed.total_score as number) >= 0 && (parsed.total_score as number) <= 100).toBe(true);
    // 11 modules, every score 0-100.
    const ms = parsed.module_scores as Record<string, number>;
    expect(Object.keys(ms).sort()).toEqual([
      "accessibility", "ai_readability", "modern_seo", "onpage",
      "organic_traffic", "performance", "privacy", "readability",
      "social", "tech_stack", "technical",
    ]);
    for (const [k, v] of Object.entries(ms)) {
      expect(typeof v).toBe("number");
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    // organic_traffic gate rule is the marker we know exists for anon.
    const findings = parsed.findings as Array<{ rule_id: string; severity: string; passed: boolean; docs_url: string; module: string }>;
    expect(findings.length).toBeGreaterThan(20);
    const gate = findings.find((f) => f.rule_id === "organic_traffic.connected");
    expect(gate).toBeDefined();
    expect(gate!.passed).toBe(true);
    // Every finding carries a docs_url back to metricspot.com/docs/.
    for (const f of findings) {
      expect(f.docs_url).toMatch(/^https:\/\/metricspot\.com\/docs\//);
      expect(["info", "minor", "major", "critical"]).toContain(f.severity);
    }
    // Sanitizer: no internal fields leak.
    for (const banned of ["stripe_customer_id", "ip_address", "internal_traces", "gsc_refresh_token"]) {
      expect(parsed).not.toHaveProperty(banned);
    }
  });

  test("audits revenuehunt.com end-to-end (anon)", async ({ request }) => {
    const resp = await mcpCall({ request: request as never, tool: "run_audit_anonymous", toolArgs: { url: "https://revenuehunt.com/" } });
    const { isError, parsed } = unwrap(resp);
    if (isError) {
      expect((parsed as { code?: string }).code === "RATE_LIMITED" || (parsed as { upstream_status?: number }).upstream_status === 429).toBe(true);
      test.skip();
      return;
    }
    expect(parsed.audit_id).toBe("anonymous");
    expect(parsed.url).toBe("https://revenuehunt.com/");
    expect(parsed.status).toBe("complete");
    expect(typeof parsed.total_score).toBe("number");
    // Spot-check: revenuehunt.com is a Shopify storefront, the tech_stack
    // module should detect Shopify with a passing finding.
    const findings = parsed.findings as Array<{ rule_id: string; passed: boolean; data?: Record<string, unknown> }>;
    const shopifyDetected = findings.find((f) => f.rule_id === "tech_stack.ecommerce_platform" && f.passed);
    if (shopifyDetected) {
      // The data payload (if present) names the platform.
      const data = (shopifyDetected.data ?? {}) as Record<string, unknown>;
      const platform = String(data.platform ?? "").toLowerCase();
      if (platform) expect(platform).toContain("shopify");
    }
  });

  test("rejects malformed URL at the input schema", async ({ request }) => {
    const resp = await mcpCall({ request: request as never, tool: "run_audit_anonymous", toolArgs: { url: "not-a-url" } });
    // SDK rejects pre-dispatch with an error code on the JSON-RPC envelope,
    // OR the result envelope flags isError. Either is acceptable.
    if (resp.error) {
      expect(typeof resp.error.message).toBe("string");
    } else {
      expect(resp.result!.isError).toBe(true);
    }
  });
});

test.describe("Live MCP server: authenticated", () => {
  test.skip(!API_KEY, "set MCP_TEST_API_KEY env to run authenticated tests");

  test("list_audits returns the caller's audit history", async ({ request }) => {
    const resp = await mcpCall({
      request: request as never,
      tool: "list_audits",
      toolArgs: { limit: 5 },
      bearer: API_KEY,
    });
    const { isError, parsed } = unwrap(resp);
    expect(isError).toBe(false);
    const audits = parsed.audits as Array<{ audit_id: string; url: string; status: string; total_score: number | null; created_at: string }>;
    expect(Array.isArray(audits)).toBe(true);
    // At least one audit exists (this account has been used)
    if (audits.length > 0) {
      const a = audits[0]!;
      expect(typeof a.audit_id).toBe("string");
      expect(a.url).toMatch(/^https?:\/\//);
      expect(["queued", "running", "complete", "failed"]).toContain(a.status);
    }
  });

  test("missing bearer → UNAUTHORIZED on an authenticated tool", async ({ request }) => {
    const resp = await mcpCall({
      request: request as never,
      tool: "list_audits",
      toolArgs: { limit: 1 },
      // no bearer
    });
    expect(resp.result?.isError).toBe(true);
    const parsed = JSON.parse(resp.result!.content![0]!.text) as { code: string };
    expect(parsed.code).toBe("UNAUTHORIZED");
  });

  test("wrong-prefix bearer → UNAUTHORIZED", async ({ request }) => {
    const resp = await mcpCall({
      request: request as never,
      tool: "list_audits",
      toolArgs: { limit: 1 },
      bearer: "not-an-ms-live-token",
    });
    expect(resp.result?.isError).toBe(true);
    const parsed = JSON.parse(resp.result!.content![0]!.text) as { code: string };
    expect(parsed.code).toBe("UNAUTHORIZED");
  });
});

test.describe("Live MCP server: discovery surface", () => {
  test("GET /health returns 200 with the server identity", async ({ request }) => {
    const res = await request.get(`${MCP_URL}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.name).toBe("metricspot-mcp");
    expect(typeof body.version).toBe("string");
  });

  test("tools/list returns exactly the 6 expected tools with rich descriptions", async ({ request }) => {
    const res = await request.post(`${MCP_URL}/mcp`, {
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    });
    const text = await res.text();
    const line = text.split("\n").find((l) => l.startsWith("data: "));
    expect(line).toBeDefined();
    const json = JSON.parse(line!.slice(6));
    const tools = json.result.tools as Array<{ name: string; description: string; inputSchema: { properties?: Record<string, unknown> } }>;
    expect(tools.length).toBe(6);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_audit", "get_audit_pdf", "get_organic_traffic",
      "list_audits", "run_audit", "run_audit_anonymous",
    ]);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(50);
      expect(t.inputSchema).toBeDefined();
    }
  });
});
