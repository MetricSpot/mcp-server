# MetricSpot MCP server

Standalone Dokku app at `mcp.metricspot.com`. Thin TypeScript wrapper that exposes `app.metricspot.com`'s audit API as Model Context Protocol tools.

PRD: `../.project/planning/MCP_SERVER_PRD.md`. Read first.

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Bun |
| HTTP | `Bun.serve()` (Streamable HTTP for hosted, stdio for local) |
| SDK | `@modelcontextprotocol/sdk` |
| Validation | Zod (Zod schemas are the response-boundary sanitizer) |
| Tests | `bun:test` + Playwright |
| Deploy | Docker → Dokku, sibling of `../app/` |

## Folder layout

```
src/
├── server.ts             # Streamable HTTP entry (Bun.serve)
├── cli.ts                # stdio entry (the npm bin)
├── mcp-server.ts         # shared Server factory wiring tools + handlers
├── tools/                # one file per tool + index.ts registry
├── lib/
│   ├── app-client.ts     # fetch wrapper for app.metricspot.com (internal token + user token)
│   ├── auth.ts           # parse Authorization: Bearer ms_live_xxx
│   ├── errors.ts         # structured McpError codes
│   └── schemas.ts        # Zod schemas + sanitizing response builders
└── __tests__/            # unit tests
e2e/                       # Playwright e2e (spawns the stdio binary)
```

## Conventions

- Bun for everything (package manager, runtime, test runner)
- Tool name = `verb_noun`. Six tools v1; **no write tools**
- Every response built through a Zod `.strict()` schema — internal fields cannot leak even if the upstream handler returns them
- Tool `description` text is the agent's usage guide. Mention rate limits, auth requirements, and upgrade URLs inline
- No comments unless WHY is non-obvious
- Match `../app/` TypeScript style; keep deps minimal

## Quick reference

```bash
bun install
bun run typecheck
bun test
bun run dev          # Streamable HTTP on :3000
bun run dev:stdio    # stdio entry
```

Health: `curl localhost:3000/health`.

## Auth model

- `run_audit_anonymous` — no auth, app-side rate limit (1/IP/24h).
- Other 5 tools — `Authorization: Bearer ms_live_xxx` from agent, forwarded to app as `X-User-Api-Token`.
- Service-to-service — `MCP_INTERNAL_TOKEN` env, sent as `X-MCP-Internal-Token`.
- The `api_tokens` table + middleware live in `../app/` (wired separately).

## Env vars

See `README.md`.
