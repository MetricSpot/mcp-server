import { z } from "zod";
import { getAppClient } from "../lib/app-client.ts";
import { ListAuditsInput, McpAuditListResponse } from "../lib/schemas.ts";
import { requireBearer } from "../lib/auth.ts";
import type { ToolDefinition, ToolContext } from "./types.ts";

export const listAuditsTool: ToolDefinition<typeof ListAuditsInput> = {
  name: "list_audits",
  description:
    "List the user's audits (most recent first, deduplicated by URL). Returns `audit_id`, `url`, `status`, `total_score`, `created_at`. " +
    "Default limit 24, max 100. Use the returned `audit_id` with `get_audit` for full findings. Requires an API key.",
  inputSchema: ListAuditsInput,
  requiresAuth: true,
  async handler(input: z.infer<typeof ListAuditsInput>, ctx: ToolContext) {
    const auth = requireBearer(ctx.authHeader);
    const limit = input.limit ?? 24;
    const app = getAppClient();
    const payload = await app.call<{ audits: Array<Record<string, unknown>> }>({
      method: "GET",
      path: "/api/audits",
      userApiToken: auth.apiToken,
    });

    const audits = (payload.audits ?? []).slice(0, limit).map((a) => {
      const dbStatus = String(a.status ?? "queued");
      const status =
        dbStatus === "completed" ? "complete"
        : dbStatus === "failed" ? "failed"
        : dbStatus === "running" ? "running"
        : "queued";
      return {
        audit_id: String(a.id ?? ""),
        url: String(a.url ?? ""),
        status: status as "queued" | "running" | "complete" | "failed",
        total_score: typeof a.score === "number" ? a.score : null,
        created_at: String(a.created_at ?? ""),
      };
    });

    return McpAuditListResponse.parse({ audits });
  },
};
