import { z } from "zod";
import { getAppClient } from "../lib/app-client.ts";
import { buildAnonymousAuditResponse, RunAuditAnonymousInput } from "../lib/schemas.ts";
import type { ToolDefinition, ToolContext } from "./types.ts";

export const runAuditAnonymousTool: ToolDefinition<typeof RunAuditAnonymousInput> = {
  name: "run_audit_anonymous",
  description:
    "Run a one-shot SEO + AI-readability audit on any public URL. Returns scores across 11 modules and ~90 checks, plus actionable findings with rule docs. " +
    "Limited to 1 audit per IP per 24 hours — for higher volume, get an API key at https://app.metricspot.com/settings/api-keys and use `run_audit`. " +
    "Synchronous: blocks until the audit completes. Does NOT include Core Web Vitals (use `run_audit` for full PSI scoring). " +
    "No auth required.",
  inputSchema: RunAuditAnonymousInput,
  requiresAuth: false,
  async handler(input: z.infer<typeof RunAuditAnonymousInput>, _ctx: ToolContext) {
    const app = getAppClient();
    const payload = await app.call({
      method: "POST",
      path: "/api/public/audit",
      body: { url: input.url },
      timeoutMs: 120_000,
    });
    return buildAnonymousAuditResponse(payload as Parameters<typeof buildAnonymousAuditResponse>[0]);
  },
};
