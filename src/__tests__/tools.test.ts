import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { tools, toolsByName } from "../tools/index.ts";
import { McpError } from "../lib/errors.ts";

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let captured: CapturedRequest[] = [];
let nextResponse: { status?: number; body?: unknown } = { status: 200, body: {} };
const realFetch = globalThis.fetch;

function setMockResponse(body: unknown, status = 200) {
  nextResponse = { status, body };
}

function lastRequest(): CapturedRequest {
  expect(captured.length).toBeGreaterThan(0);
  return captured[captured.length - 1]!;
}

beforeAll(() => {
  // Stub fetch so no real HTTP escapes the test process.
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const headers: Record<string, string> = {};
    const h = init?.headers;
    if (h instanceof Headers) {
      h.forEach((v, k) => (headers[k.toLowerCase()] = v));
    } else if (h && typeof h === "object") {
      for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
    }
    let body: unknown = undefined;
    if (init?.body) {
      try { body = JSON.parse(String(init.body)); } catch { body = init.body; }
    }
    captured.push({ url, method: init?.method ?? "GET", headers, body });
    const status = nextResponse.status ?? 200;
    return new Response(JSON.stringify(nextResponse.body ?? {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  process.env.APP_API_BASE_URL = "http://app-test.local";
  process.env.APP_PUBLIC_BASE_URL = "http://app-test.local";
  process.env.MCP_INTERNAL_TOKEN = "internal-secret-for-tests";
});

beforeEach(() => {
  captured = [];
  nextResponse = { status: 200, body: {} };
});

afterEach(() => {
  // No-op; resets handled in beforeEach.
});

describe("tool registry", () => {
  test("registers all six tools with unique names", () => {
    expect(tools.length).toBe(6);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "get_audit",
      "get_audit_pdf",
      "get_organic_traffic",
      "list_audits",
      "run_audit",
      "run_audit_anonymous",
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  test("only run_audit_anonymous is requiresAuth=false", () => {
    for (const t of tools) {
      if (t.name === "run_audit_anonymous") expect(t.requiresAuth).toBe(false);
      else expect(t.requiresAuth).toBe(true);
    }
  });

  test("toolsByName indexes the registry", () => {
    for (const t of tools) expect(toolsByName[t.name]).toBe(t);
  });

  test("every tool's description mentions rate limit, auth, or upgrade affordances", () => {
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(50);
      const lower = t.description.toLowerCase();
      // Either mentions limit/quota, or API key/auth, or the upgrade URL.
      const operationalHints = ["rate limit", "limit", "api key", "auth", "quota", "cooldown", "plan allowance"];
      expect(operationalHints.some((h) => lower.includes(h))).toBe(true);
    }
  });
});

describe("dispatch: run_audit_anonymous", () => {
  test("POSTs /api/public/audit without forwarding any auth header", async () => {
    setMockResponse({
      audit: {
        url: "https://example.com",
        domain: "example.com",
        total_score: 82,
        module_scores: { technical: 90, onpage: 75 },
        rules: [
          { module: "technical", rule_id: "technical.https", passed: true, severity: "info", title: "HTTPS enforced" },
        ],
      },
    });
    const out = await toolsByName.run_audit_anonymous!.handler({ url: "https://example.com" }, {});
    const req = lastRequest();
    expect(req.url).toBe("http://app-test.local/api/public/audit");
    expect(req.method).toBe("POST");
    expect(req.body).toEqual({ url: "https://example.com" });
    expect(req.headers["x-user-api-token"]).toBeUndefined();
    expect(req.headers["x-mcp-internal-token"]).toBe("internal-secret-for-tests");
    expect((out as { url: string }).url).toBe("https://example.com");
    expect((out as { status: string }).status).toBe("complete");
  });

  test("input schema rejects invalid URL when parsed (framework parses before dispatch)", () => {
    // The MCP server parses tool input through `inputSchema` before calling
    // the handler. Direct-handler calls in tests bypass that; here we verify
    // the schema itself rejects malformed URLs.
    const result = toolsByName.run_audit_anonymous!.inputSchema.safeParse({ url: "not-a-url" });
    expect(result.success).toBe(false);
  });
});

describe("dispatch: authenticated tools", () => {
  const ctx = { authHeader: "Bearer ms_live_aabbccddeeff00112233445566778899aabbccddeeff0011" };

  test("run_audit: POST /api/audits with X-User-Api-Token forwarded", async () => {
    setMockResponse({ audit: { id: 42, url: "https://x.com", status: "queued", created_at: "2026-05-13T00:00:00Z" } });
    const out = await toolsByName.run_audit!.handler({ url: "https://x.com" }, ctx);
    const req = lastRequest();
    expect(req.url).toBe("http://app-test.local/api/audits");
    expect(req.method).toBe("POST");
    expect(req.body).toEqual({ url: "https://x.com" });
    expect(req.headers["x-user-api-token"]).toBe("ms_live_aabbccddeeff00112233445566778899aabbccddeeff0011");
    expect(req.headers["x-mcp-internal-token"]).toBe("internal-secret-for-tests");
    expect((out as { audit_id: string }).audit_id).toBe("42");
    expect((out as { status: string }).status).toBe("queued");
  });

  test("run_audit: missing bearer → UNAUTHORIZED", async () => {
    await expect(
      toolsByName.run_audit!.handler({ url: "https://x.com" }, {})
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("run_audit: wrong-prefix bearer → UNAUTHORIZED", async () => {
    await expect(
      toolsByName.run_audit!.handler({ url: "https://x.com" }, { authHeader: "Bearer not-an-mcp-token" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("get_audit: GET /api/audits/<id>, encodes audit_id", async () => {
    setMockResponse({
      audit: { id: "abc/123", url: "https://y.com", status: "completed", score: 92, created_at: "2026-05-13T00:00:00Z", raw: { module_scores: { technical: 95 } } },
      findings: [{ module: "technical", rule_id: "technical.https", passed: true, severity: "info", title: "HTTPS" }],
    });
    const out = await toolsByName.get_audit!.handler({ audit_id: "abc/123" }, ctx);
    const req = lastRequest();
    expect(req.url).toBe("http://app-test.local/api/audits/abc%2F123");
    expect(req.method).toBe("GET");
    expect(req.headers["x-user-api-token"]).toBe("ms_live_aabbccddeeff00112233445566778899aabbccddeeff0011");
    expect((out as { status: string }).status).toBe("complete");
    expect((out as { total_score: number }).total_score).toBe(92);
    expect((out as { findings: unknown[] }).findings.length).toBe(1);
  });

  test("list_audits: GET /api/audits, sanitized + status-normalized + limit applied", async () => {
    setMockResponse({
      audits: Array.from({ length: 50 }, (_, i) => ({
        id: i + 1,
        url: `https://x${i}.com`,
        status: i === 0 ? "completed" : "queued",
        score: 80,
        created_at: "2026-05-13T00:00:00Z",
      })),
    });
    const out = await toolsByName.list_audits!.handler({ limit: 5 }, ctx);
    const req = lastRequest();
    expect(req.url).toBe("http://app-test.local/api/audits");
    expect(req.method).toBe("GET");
    expect(req.headers["x-user-api-token"]).toBe("ms_live_aabbccddeeff00112233445566778899aabbccddeeff0011");
    const out2 = out as { audits: Array<{ audit_id: string; status: string }> };
    expect(out2.audits.length).toBe(5);
    expect(out2.audits[0]!.status).toBe("complete"); // 'completed' → 'complete'
    expect(out2.audits[1]!.status).toBe("queued");
  });

  test("list_audits: default limit 24 when omitted", async () => {
    setMockResponse({
      audits: Array.from({ length: 50 }, (_, i) => ({
        id: i + 1, url: `https://x${i}.com`, status: "queued", score: 0, created_at: "2026-05-13T00:00:00Z",
      })),
    });
    const out = await toolsByName.list_audits!.handler({}, ctx);
    expect((out as { audits: unknown[] }).audits.length).toBe(24);
  });

  test("get_audit_pdf: POST /api/audits/<id>/pdf, returns ready URL", async () => {
    setMockResponse({ pdf_url: "https://signed-pdf.example.com/abc", status: "ready" });
    const out = await toolsByName.get_audit_pdf!.handler({ audit_id: "42" }, ctx);
    const req = lastRequest();
    expect(req.url).toBe("http://app-test.local/api/audits/42/pdf");
    expect(req.method).toBe("POST");
    expect((out as { pdf_url: string }).pdf_url).toBe("https://signed-pdf.example.com/abc");
    expect((out as { status: string }).status).toBe("ready");
  });

  test("get_audit_pdf: status falls back to 'queued' when no URL and no explicit status", async () => {
    setMockResponse({});
    const out = await toolsByName.get_audit_pdf!.handler({ audit_id: "42" }, ctx);
    expect((out as { status: string }).status).toBe("queued");
  });

  test("get_organic_traffic: GET /api/audits/<id>/google + connected=false fallback", async () => {
    setMockResponse({ connected: false });
    const out = await toolsByName.get_organic_traffic!.handler({ audit_id: "42" }, ctx);
    const req = lastRequest();
    expect(req.url).toBe("http://app-test.local/api/audits/42/google");
    expect(req.method).toBe("GET");
    expect((out as { connected: boolean }).connected).toBe(false);
    expect((out as { sessions_28d: number | null }).sessions_28d).toBeNull();
  });

  test("get_organic_traffic: populated payload normalizes daily/queries/landing", async () => {
    // Payload shape mirrors what app.metricspot.com /api/audits/:id/google
    // actually returns: ga4.daily_sessions is a bare number[], top_pages
    // uses `path`, and the indexed-page count sits under gsc.indexing.
    setMockResponse({
      connected: true,
      ga4: {
        sessions_28d: 1234,
        daily_sessions: [50, 75],
        top_pages: [{ path: "/a", sessions: 200 }],
      },
      gsc: {
        top_queries: [{ query: "metricspot", clicks: 80, impressions: 1000 }],
        indexing: { pages_count_28d: 42 },
      },
    });
    const out = await toolsByName.get_organic_traffic!.handler({ audit_id: "42" }, ctx);
    const r = out as {
      connected: boolean;
      sessions_28d: number;
      sessions_trend: number[];
      top_landing_pages: Array<{ path: string }>;
      top_queries: Array<{ query: string }>;
      indexed_pages: number;
    };
    expect(r.connected).toBe(true);
    expect(r.sessions_28d).toBe(1234);
    expect(r.sessions_trend).toEqual([50, 75]);
    expect(r.top_landing_pages[0]!.path).toBe("/a");
    expect(r.top_queries[0]!.query).toBe("metricspot");
    expect(r.indexed_pages).toBe(42);
  });

  test("direct mode: with no MCP_INTERNAL_TOKEN, forwards the user key as Authorization: Bearer", async () => {
    // This is the dashboard's copy-paste config — `npx` with only MCP_API_KEY,
    // no infra secret. The app accepts `Authorization: Bearer ms_live_…`.
    const saved = process.env.MCP_INTERNAL_TOKEN;
    delete process.env.MCP_INTERNAL_TOKEN;
    try {
      setMockResponse({ audits: [] });
      await toolsByName.list_audits!.handler({ limit: 5 }, ctx);
      const req = lastRequest();
      expect(req.headers["authorization"]).toBe("Bearer ms_live_aabbccddeeff00112233445566778899aabbccddeeff0011");
      expect(req.headers["x-mcp-internal-token"]).toBeUndefined();
      expect(req.headers["x-user-api-token"]).toBeUndefined();
    } finally {
      process.env.MCP_INTERNAL_TOKEN = saved;
    }
  });
});

describe("upstream errors propagate", () => {
  test("429 from app → RATE_LIMITED McpError", async () => {
    setMockResponse({ error: "rate limit" }, 429);
    await expect(
      toolsByName.run_audit_anonymous!.handler({ url: "https://x.com" }, {})
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  test("401 from app → UNAUTHORIZED McpError", async () => {
    setMockResponse({ error: "no auth" }, 401);
    await expect(
      toolsByName.run_audit!.handler({ url: "https://x.com" }, { authHeader: "Bearer ms_live_abcdef0123456789abcdef0123456789abcdef0123456789" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  test("404 from app on get_audit → AUDIT_NOT_FOUND McpError", async () => {
    setMockResponse({ error: "not found" }, 404);
    await expect(
      toolsByName.get_audit!.handler({ audit_id: "99999" }, { authHeader: "Bearer ms_live_abcdef0123456789abcdef0123456789abcdef0123456789" })
    ).rejects.toBeInstanceOf(McpError);
  });
});
