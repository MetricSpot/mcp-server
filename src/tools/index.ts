import { runAuditAnonymousTool } from "./run_audit_anonymous.ts";
import { runAuditTool } from "./run_audit.ts";
import { getAuditTool } from "./get_audit.ts";
import { listAuditsTool } from "./list_audits.ts";
import { getAuditPdfTool } from "./get_audit_pdf.ts";
import { getOrganicTrafficTool } from "./get_organic_traffic.ts";
import type { AnyToolDefinition } from "./types.ts";

export const tools: AnyToolDefinition[] = [
  runAuditAnonymousTool,
  runAuditTool,
  getAuditTool,
  listAuditsTool,
  getAuditPdfTool,
  getOrganicTrafficTool,
];

export const toolsByName: Record<string, AnyToolDefinition> = Object.fromEntries(
  tools.map((t) => [t.name, t]),
);
