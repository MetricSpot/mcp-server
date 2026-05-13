import { McpError } from "./errors.ts";

const BEARER_RE = /^Bearer\s+(ms_live_[A-Za-z0-9_-]{16,})$/;

export interface AgentAuth {
  apiToken: string;
}

export function parseBearer(headerValue: string | undefined | null): AgentAuth | null {
  if (!headerValue) return null;
  const match = BEARER_RE.exec(headerValue.trim());
  if (!match) return null;
  return { apiToken: match[1]! };
}

export function requireBearer(headerValue: string | undefined | null): AgentAuth {
  const auth = parseBearer(headerValue);
  if (!auth) {
    throw new McpError(
      "UNAUTHORIZED",
      "Missing or malformed Authorization header. Expected: Authorization: Bearer ms_live_xxx",
    );
  }
  return auth;
}
