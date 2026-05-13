import { z } from "zod";
import { getAppClient, getReportBase } from "../lib/app-client.ts";
import { buildAuditResponse, GetAuditInput } from "../lib/schemas.ts";
import { requireBearer } from "../lib/auth.ts";
import type { ToolDefinition, ToolContext } from "./types.ts";

export const getAuditTool: ToolDefinition<typeof GetAuditInput> = {
  name: "get_audit",
  description:
    "Fetch a previously-run audit by id. Returns module scores (0-100), total score, all findings with severity, recommendation text, " +
    "and links to the HTML report. Use this to poll a queued `run_audit` until `status: complete`. Requires an API key.",
  inputSchema: GetAuditInput,
  requiresAuth: true,
  async handler(input: z.infer<typeof GetAuditInput>, ctx: ToolContext) {
    const auth = requireBearer(ctx.authHeader);
    const app = getAppClient();
    const payload = await app.call<{ audit: Record<string, unknown>; findings: Array<Record<string, unknown>> }>({
      method: "GET",
      path: `/api/audits/${encodeURIComponent(input.audit_id)}`,
      userApiToken: auth.apiToken,
    });
    return buildAuditResponse(payload, { reportBase: getReportBase() });
  },
};
