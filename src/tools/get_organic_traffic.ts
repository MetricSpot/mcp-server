import { z } from "zod";
import { getAppClient } from "../lib/app-client.ts";
import { GetOrganicTrafficInput, McpOrganicTrafficResponse } from "../lib/schemas.ts";
import { requireBearer } from "../lib/auth.ts";
import type { ToolDefinition, ToolContext } from "./types.ts";

export const getOrganicTrafficTool: ToolDefinition<typeof GetOrganicTrafficInput> = {
  name: "get_organic_traffic",
  description:
    "If the user has linked GA4 + Google Search Console, return the 28-day organic traffic snapshot for an audit: " +
    "session count, daily trend, top landing pages, top queries, and indexing health. " +
    "Returns `connected: false` if Google is not linked. Cached 24h server-side. Requires an API key.",
  inputSchema: GetOrganicTrafficInput,
  requiresAuth: true,
  async handler(input: z.infer<typeof GetOrganicTrafficInput>, ctx: ToolContext) {
    const auth = requireBearer(ctx.authHeader);
    const app = getAppClient();
    const payload = await app.call<Record<string, unknown>>({
      method: "GET",
      path: `/api/audits/${encodeURIComponent(input.audit_id)}/google`,
      userApiToken: auth.apiToken,
    });

    const connected = Boolean(payload.connected ?? payload.linked ?? (payload.ga4 || payload.gsc));
    const ga4 = (payload.ga4 ?? {}) as Record<string, unknown>;
    const gsc = (payload.gsc ?? {}) as Record<string, unknown>;

    // The app returns ga4.daily_sessions as a bare number[] (oldest first;
    // reshapeGa4Daily drops the dates), top_pages as { path, sessions }, and
    // the indexed-page count nested under gsc.indexing.pages_count_28d.
    const trend = Array.isArray(ga4.daily_sessions) ? ga4.daily_sessions : [];
    const topPages = Array.isArray(ga4.top_pages) ? ga4.top_pages : [];
    const topQueries = Array.isArray(gsc.top_queries) ? gsc.top_queries : [];
    const indexing = (gsc.indexing ?? {}) as Record<string, unknown>;

    return McpOrganicTrafficResponse.parse({
      audit_id: input.audit_id,
      connected,
      sessions_28d: typeof ga4.sessions_28d === "number" ? ga4.sessions_28d : null,
      sessions_trend: trend.map((n) => Number(n) || 0),
      top_landing_pages: topPages
        .map((p) => ({
          path: String((p as { path?: unknown }).path ?? ""),
          sessions: Number((p as { sessions?: unknown }).sessions ?? 0),
        }))
        .filter((p) => p.path),
      top_queries: topQueries
        .map((q) => ({
          query: String((q as { query?: unknown }).query ?? ""),
          clicks: Number((q as { clicks?: unknown }).clicks ?? 0),
          impressions: Number((q as { impressions?: unknown }).impressions ?? 0),
        }))
        .filter((q) => q.query),
      indexed_pages: typeof indexing.pages_count_28d === "number" ? indexing.pages_count_28d : null,
    });
  },
};
