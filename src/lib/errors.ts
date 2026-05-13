export type McpErrorCode =
  | "RATE_LIMITED"
  | "INVALID_URL"
  | "AUDIT_NOT_FOUND"
  | "QUOTA_EXCEEDED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "UPSTREAM_FAILED"
  | "INTERNAL_ERROR";

export class McpError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    message: string,
    public readonly retryable: boolean = false,
    public readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = "McpError";
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      upstream_status: this.upstreamStatus,
    };
  }
}

export function fromUpstreamStatus(status: number, body: string): McpError {
  if (status === 401) return new McpError("UNAUTHORIZED", "Missing or invalid API token. Issue a key at https://app.metricspot.com/settings/api-keys.", false, status);
  if (status === 403) return new McpError("FORBIDDEN", "Token lacks the required scope.", false, status);
  if (status === 404) return new McpError("AUDIT_NOT_FOUND", "Audit not found.", false, status);
  if (status === 429) return new McpError("RATE_LIMITED", body || "Rate limit reached.", true, status);
  if (status === 402) return new McpError("QUOTA_EXCEEDED", body || "Plan allowance exhausted. Upgrade at https://app.metricspot.com/billing.", false, status);
  if (status === 400) return new McpError("INVALID_URL", body || "Invalid input.", false, status);
  return new McpError("UPSTREAM_FAILED", `Upstream returned ${status}: ${body.slice(0, 200)}`, status >= 500, status);
}
