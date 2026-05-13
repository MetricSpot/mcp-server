import { z } from "zod";
import { getAppClient, getReportBase } from "../lib/app-client.ts";
import { buildAuditResponse, McpAuditResponse, RunAuditInput } from "../lib/schemas.ts";
import { requireBearer } from "../lib/auth.ts";
import type { ToolDefinition, ToolContext } from "./types.ts";

export const runAuditTool: ToolDefinition<typeof RunAuditInput> = {
  name: "run_audit",
  description:
    "Queue a full SEO + AI-readability audit (includes Core Web Vitals from Google PSI and organic traffic if Google is linked). " +
    "Returns the audit envelope immediately with `status: queued` and an `audit_id`. " +
    "Poll `get_audit` with the returned `audit_id` until `status` becomes `complete` (typical 10-30s). " +
    "Counts against the user's plan allowance. Requires an API key as a Bearer token. " +
    "Quota and per-domain cooldowns mirror the dashboard.",
  inputSchema: RunAuditInput,
  requiresAuth: true,
  async handler(input: z.infer<typeof RunAuditInput>, ctx: ToolContext) {
    const auth = requireBearer(ctx.authHeader);
    const app = getAppClient();
    const payload = await app.call<{ audit: Record<string, unknown> }>({
      method: "POST",
      path: "/api/audits",
      body: { url: input.url },
      userApiToken: auth.apiToken,
    });
    return buildAuditResponse({ audit: payload.audit, findings: [] }, { reportBase: getReportBase() }) satisfies McpAuditResponse;
  },
};
