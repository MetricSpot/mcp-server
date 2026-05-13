# @metricspot/mcp-server

Model Context Protocol server for MetricSpot. Exposes 6 SEO + AI-readability audit tools to AI agents (Claude, ChatGPT, Gemini, Perplexity, Cursor, Zed, OpenClaw, custom bots).

- Hosted Streamable HTTP endpoint: `https://mcp.metricspot.com/mcp`
- Local stdio binary: `npx @metricspot/mcp-server`
- Agent guide: <https://metricspot.com/AGENTS.md>

## Tools

| Tool | Auth | Description |
| --- | --- | --- |
| `run_audit_anonymous` | none | One-shot audit, 1/IP/24h, no Core Web Vitals |
| `run_audit` | Bearer key | Full audit with PSI, returns `audit_id` |
| `get_audit` | Bearer key | Fetch audit + findings by id |
| `list_audits` | Bearer key | List the user's recent audits (max 100) |
| `get_audit_pdf` | Bearer key | Signed URL for the branded PDF report |
| `get_organic_traffic` | Bearer key | 28-day GA4 + GSC snapshot (if Google linked) |

## Local install (stdio)

Claude Code (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "metricspot": {
      "command": "npx",
      "args": ["-y", "@metricspot/mcp-server"],
      "env": {
        "MCP_API_KEY": "ms_live_xxx"
      }
    }
  }
}
```

Cursor (`~/.cursor/mcp.json`) and Zed use the same shape.

Omit `MCP_API_KEY` to only use `run_audit_anonymous`.

## Hosted (Streamable HTTP)

```
POST https://mcp.metricspot.com/mcp
Authorization: Bearer ms_live_xxx
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

## Env vars

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port |
| `APP_API_BASE_URL` | `https://app.metricspot.com` (prod) / `http://localhost:3000` (dev) | MetricSpot app API base |
| `APP_PUBLIC_BASE_URL` | falls back to `APP_API_BASE_URL` | Used to build `report_url` |
| `MCP_INTERNAL_TOKEN` | — | Service-to-service secret forwarded as `X-MCP-Internal-Token` |
| `MCP_API_KEY` | — | (stdio only) User API key, sent as `Authorization: Bearer` to the HTTP layer |

## Develop

```bash
bun install
bun run typecheck
bun test
bun run dev          # Streamable HTTP on :3000
bun run dev:stdio    # stdio loop (send JSON-RPC on stdin)
```

## Deploy

Multi-stage Dockerfile produces a Bun runtime image. Independent Dokku app on the same Hetzner droplet as `app/` and `web/`.

## License

MIT
