import { z } from "zod";

export const RunAuditAnonymousInput = z.object({
  url: z.string().url().max(2000),
});
export type RunAuditAnonymousInput = z.infer<typeof RunAuditAnonymousInput>;

export const RunAuditInput = z.object({
  url: z.string().url().max(2000),
});
export type RunAuditInput = z.infer<typeof RunAuditInput>;

export const GetAuditInput = z.object({
  audit_id: z.string().min(1),
});
export type GetAuditInput = z.infer<typeof GetAuditInput>;

export const ListAuditsInput = z.object({
  limit: z.number().int().min(1).max(100).default(24).optional(),
});
export type ListAuditsInput = z.infer<typeof ListAuditsInput>;

export const GetAuditPdfInput = z.object({
  audit_id: z.string().min(1),
});
export type GetAuditPdfInput = z.infer<typeof GetAuditPdfInput>;

export const GetOrganicTrafficInput = z.object({
  audit_id: z.string().min(1),
});
export type GetOrganicTrafficInput = z.infer<typeof GetOrganicTrafficInput>;

export const Severity = z.enum(["info", "minor", "major", "critical"]);

export const Finding = z
  .object({
    module: z.string(),
    rule_id: z.string(),
    passed: z.boolean(),
    severity: Severity,
    title: z.string(),
    recommendation: z.string().optional(),
    docs_url: z.string(),
  })
  .strict();
export type Finding = z.infer<typeof Finding>;

export const McpAuditResponse = z
  .object({
    audit_id: z.string(),
    url: z.string(),
    status: z.enum(["queued", "running", "complete", "failed"]),
    total_score: z.number().nullable(),
    module_scores: z.record(z.string(), z.number()),
    findings: z.array(Finding),
    report_url: z.string().optional(),
    pdf_url: z.string().optional(),
    created_at: z.string(),
  })
  .strict();
export type McpAuditResponse = z.infer<typeof McpAuditResponse>;

export const McpAuditListItem = z
  .object({
    audit_id: z.string(),
    url: z.string(),
    status: z.enum(["queued", "running", "complete", "failed"]),
    total_score: z.number().nullable(),
    created_at: z.string(),
  })
  .strict();
export type McpAuditListItem = z.infer<typeof McpAuditListItem>;

export const McpAuditListResponse = z
  .object({
    audits: z.array(McpAuditListItem),
  })
  .strict();
export type McpAuditListResponse = z.infer<typeof McpAuditListResponse>;

export const McpPdfResponse = z
  .object({
    audit_id: z.string(),
    pdf_url: z.string(),
    status: z.enum(["ready", "queued"]),
  })
  .strict();
export type McpPdfResponse = z.infer<typeof McpPdfResponse>;

export const OrganicLanding = z
  .object({
    path: z.string(),
    sessions: z.number(),
  })
  .strict();

export const OrganicQuery = z
  .object({
    query: z.string(),
    clicks: z.number(),
    impressions: z.number(),
  })
  .strict();

export const McpOrganicTrafficResponse = z
  .object({
    audit_id: z.string(),
    connected: z.boolean(),
    sessions_28d: z.number().nullable(),
    sessions_trend: z.array(z.number()).optional(),
    top_landing_pages: z.array(OrganicLanding).optional(),
    top_queries: z.array(OrganicQuery).optional(),
    indexed_pages: z.number().nullable().optional(),
  })
  .strict();
export type McpOrganicTrafficResponse = z.infer<typeof McpOrganicTrafficResponse>;

const DOCS_BASE = "https://metricspot.com/docs";

export function docsUrlForRule(ruleId: string): string {
  const slug = ruleId.replace(/\./g, "-");
  return `${DOCS_BASE}/${slug}/`;
}

interface RawAuditPayload {
  audit?: Record<string, unknown>;
  findings?: Array<Record<string, unknown>>;
}

export function buildAuditResponse(payload: RawAuditPayload, opts: { reportBase: string }): McpAuditResponse {
  const audit = payload.audit ?? {};
  const findings = payload.findings ?? [];

  const dbStatus = String(audit.status ?? "queued");
  const status =
    dbStatus === "completed" ? "complete"
    : dbStatus === "failed" ? "failed"
    : dbStatus === "running" ? "running"
    : "queued";

  const rawScores = (audit.raw as Record<string, unknown> | undefined)?.module_scores
    ?? (audit as { module_scores?: Record<string, unknown> }).module_scores
    ?? {};
  const moduleScores: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawScores)) {
    if (typeof v === "number") moduleScores[k] = v;
  }

  const auditId = String(audit.id ?? "");

  const mappedFindings: Finding[] = findings.map((f) => {
    const ruleId = String(f.rule_id ?? "");
    return {
      module: String(f.module ?? ""),
      rule_id: ruleId,
      passed: Boolean(f.passed),
      severity: (f.severity as Finding["severity"]) ?? "info",
      title: String(f.title ?? ""),
      recommendation: typeof f.recommendation === "string" ? f.recommendation : undefined,
      docs_url: docsUrlForRule(ruleId),
    };
  });

  const result = {
    audit_id: auditId,
    url: String(audit.url ?? ""),
    status,
    total_score: typeof audit.score === "number" ? audit.score : null,
    module_scores: moduleScores,
    findings: mappedFindings,
    report_url: auditId ? `${opts.reportBase}/audits/${auditId}` : undefined,
    created_at: String(audit.created_at ?? new Date().toISOString()),
  };

  return McpAuditResponse.parse(result);
}

interface RawAnonAuditPayload {
  audit?: {
    url?: string;
    domain?: string;
    total_score?: number | null;
    module_scores?: Record<string, number>;
    rules?: Array<{
      module: string;
      rule_id: string;
      passed: boolean;
      severity: Finding["severity"];
      title: string;
      recommendation?: string | null;
    }>;
  };
}

export function buildAnonymousAuditResponse(payload: RawAnonAuditPayload): McpAuditResponse {
  const audit = payload.audit ?? {};
  const findings: Finding[] = (audit.rules ?? []).map((r) => ({
    module: r.module,
    rule_id: r.rule_id,
    passed: r.passed,
    severity: r.severity,
    title: r.title,
    recommendation: r.recommendation ?? undefined,
    docs_url: docsUrlForRule(r.rule_id),
  }));

  return McpAuditResponse.parse({
    audit_id: "anonymous",
    url: String(audit.url ?? ""),
    status: "complete",
    total_score: typeof audit.total_score === "number" ? audit.total_score : null,
    module_scores: audit.module_scores ?? {},
    findings,
    created_at: new Date().toISOString(),
  });
}
