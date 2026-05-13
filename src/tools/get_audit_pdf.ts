import { z } from "zod";
import { getAppClient } from "../lib/app-client.ts";
import { GetAuditPdfInput, McpPdfResponse } from "../lib/schemas.ts";
import { requireBearer } from "../lib/auth.ts";
import type { ToolDefinition, ToolContext } from "./types.ts";

export const getAuditPdfTool: ToolDefinition<typeof GetAuditPdfInput> = {
  name: "get_audit_pdf",
  description:
    "Return a signed download URL for the branded PDF report for a given audit id. " +
    "If no PDF has been rendered yet, queues a render and returns `status: queued` — poll the same tool again, or fetch the URL directly once ready. " +
    "Requires an API key.",
  inputSchema: GetAuditPdfInput,
  requiresAuth: true,
  async handler(input: z.infer<typeof GetAuditPdfInput>, ctx: ToolContext) {
    const auth = requireBearer(ctx.authHeader);
    const app = getAppClient();
    const payload = await app.call<{ pdf_url?: string; url?: string; status?: string }>({
      method: "POST",
      path: `/api/audits/${encodeURIComponent(input.audit_id)}/pdf`,
      userApiToken: auth.apiToken,
    });

    const pdfUrl = payload.pdf_url ?? payload.url ?? "";
    const rawStatus = String(payload.status ?? (pdfUrl ? "ready" : "queued"));
    const status: "ready" | "queued" =
      rawStatus === "ready" || rawStatus === "completed" || rawStatus === "complete" ? "ready" : "queued";

    return McpPdfResponse.parse({
      audit_id: input.audit_id,
      pdf_url: pdfUrl,
      status,
    });
  },
};
