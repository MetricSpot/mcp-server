import { describe, expect, test } from "bun:test";
import {
  buildAuditResponse,
  buildAnonymousAuditResponse,
  Finding,
  McpAuditResponse,
  docsUrlForRule,
} from "../lib/schemas.ts";

describe("McpAuditResponse sanitization", () => {
  test("strict parsing rejects unknown top-level fields", () => {
    const raw = {
      audit_id: "1",
      url: "https://example.com",
      status: "complete" as const,
      total_score: 80,
      module_scores: { technical: 90 },
      findings: [],
      created_at: new Date().toISOString(),
      stripe_customer_id: "cus_abc",
    };
    expect(() => McpAuditResponse.parse(raw)).toThrow();
  });

  test("buildAuditResponse drops internal fields from upstream payload", () => {
    const raw = {
      audit: {
        id: 42,
        user_id: 7,
        url: "https://example.com",
        status: "completed",
        score: 88,
        raw: {
          module_scores: { technical: 95, performance: 80 },
          internal_traces: ["secret"],
        },
        created_at: "2026-05-13T00:00:00Z",
        ip_address: "1.2.3.4",
        stripe_customer_id: "cus_abc",
        notes: "internal admin note",
        gsc_refresh_token: "1//abc-refresh-token",
      },
      findings: [
        {
          module: "technical",
          rule_id: "technical.https_enforced",
          passed: true,
          severity: "minor",
          title: "HTTPS enforced",
          recommendation: null,
          data: { internal_debug: "shouldnt leak" },
          ip_address: "1.2.3.4",
        },
      ],
    };

    const result = buildAuditResponse(raw, { reportBase: "https://app.metricspot.com" });

    const json = JSON.stringify(result);
    expect(json).not.toContain("stripe_customer_id");
    expect(json).not.toContain("cus_abc");
    expect(json).not.toContain("ip_address");
    expect(json).not.toContain("1.2.3.4");
    expect(json).not.toContain("internal admin note");
    expect(json).not.toContain("gsc_refresh_token");
    expect(json).not.toContain("1//abc-refresh-token");
    expect(json).not.toContain("internal_traces");
    expect(json).not.toContain("internal_debug");
    expect(json).not.toContain("user_id");

    expect(result.audit_id).toBe("42");
    expect(result.url).toBe("https://example.com");
    expect(result.status).toBe("complete");
    expect(result.total_score).toBe(88);
    expect(result.module_scores.technical).toBe(95);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.docs_url).toBe("https://metricspot.com/docs/technical-https_enforced/");
    expect(result.report_url).toBe("https://app.metricspot.com/audits/42");
  });

  test("Finding schema rejects internal fields via strict()", () => {
    expect(() =>
      Finding.parse({
        module: "technical",
        rule_id: "technical.https",
        passed: true,
        severity: "info",
        title: "HTTPS",
        docs_url: "https://metricspot.com/docs/technical-https/",
        ip_address: "1.2.3.4",
      }),
    ).toThrow();
  });

  test("buildAnonymousAuditResponse drops internal fields", () => {
    const raw = {
      audit: {
        url: "https://example.com",
        domain: "example.com",
        total_score: 70,
        module_scores: { technical: 80, performance: 60 },
        rules: [
          {
            module: "technical",
            rule_id: "technical.https_enforced",
            passed: true,
            severity: "minor" as const,
            title: "HTTPS enforced",
            recommendation: null,
          },
        ],
      },
      ip_address: "9.9.9.9",
      internal_id: 12345,
    };

    const result = buildAnonymousAuditResponse(raw);
    const json = JSON.stringify(result);

    expect(json).not.toContain("ip_address");
    expect(json).not.toContain("9.9.9.9");
    expect(json).not.toContain("internal_id");
    expect(result.audit_id).toBe("anonymous");
    expect(result.findings[0]!.docs_url).toContain("metricspot.com/docs/");
  });

  test("docsUrlForRule replaces dots with dashes", () => {
    expect(docsUrlForRule("ai_readability.llms_txt_present")).toBe(
      "https://metricspot.com/docs/ai_readability-llms_txt_present/",
    );
  });

  test("rejects invalid severity enum", () => {
    expect(() =>
      McpAuditResponse.parse({
        audit_id: "1",
        url: "https://example.com",
        status: "complete",
        total_score: 50,
        module_scores: {},
        findings: [
          {
            module: "technical",
            rule_id: "x",
            passed: false,
            severity: "BOGUS",
            title: "x",
            docs_url: "https://metricspot.com/docs/x/",
          },
        ],
        created_at: "2026-05-13T00:00:00Z",
      }),
    ).toThrow();
  });
});
