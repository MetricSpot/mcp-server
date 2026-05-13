import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp-server.ts";

const PORT = Number(process.env.PORT ?? 3000);

async function handleMcp(req: Request): Promise<Response> {
  const authHeader = req.headers.get("authorization") ?? undefined;

  const server = createMcpServer({
    getAuthHeader: () => authHeader,
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  const bodyText = req.method === "POST" ? await req.text() : "";

  const url = new URL(req.url);
  return new Promise<Response>((resolve, reject) => {
    const nodeReq = buildIncomingMessage(req.method, url.pathname + url.search, req.headers, bodyText);
    const nodeRes = buildServerResponse(resolve, reject);

    let parsedBody: unknown = undefined;
    if (bodyText) {
      try {
        parsedBody = JSON.parse(bodyText);
      } catch {
        resolve(new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "content-type": "application/json" } }));
        return;
      }
    }

    transport.handleRequest(nodeReq, nodeRes, parsedBody).catch((err) => {
      reject(err);
    });
  });
}

interface CapturedResponse {
  status: number;
  headers: Record<string, string>;
  chunks: Array<Uint8Array | string>;
}

function buildIncomingMessage(method: string, url: string, headers: Headers, body: string) {
  const hdrObj: Record<string, string> = {};
  const rawHeaders: string[] = [];
  headers.forEach((v, k) => {
    hdrObj[k] = v;
    rawHeaders.push(k, v);
  });

  let bodyConsumed = false;
  return {
    method,
    url,
    headers: hdrObj,
    rawHeaders,
    httpVersion: "1.1",
    httpVersionMajor: 1,
    httpVersionMinor: 1,
    socket: { remoteAddress: "127.0.0.1" },
    on(event: string, cb: (data?: unknown) => void) {
      if (event === "data" && !bodyConsumed && body) {
        bodyConsumed = true;
        queueMicrotask(() => cb(Buffer.from(body)));
      }
      if (event === "end") {
        queueMicrotask(() => cb());
      }
      if (event === "error") {
        // no-op
      }
      return this;
    },
    once(this: { on: (e: string, c: (d?: unknown) => void) => unknown }, event: string, cb: (data?: unknown) => void) {
      return this.on(event, cb);
    },
    removeListener() { return this; },
  } as unknown as Parameters<StreamableHTTPServerTransport["handleRequest"]>[0];
}

function buildServerResponse(
  resolve: (r: Response) => void,
  _reject: (e: unknown) => void,
): Parameters<StreamableHTTPServerTransport["handleRequest"]>[1] {
  const captured: CapturedResponse = { status: 200, headers: {}, chunks: [] };
  let ended = false;

  const finish = () => {
    if (ended) return;
    ended = true;
    const body = captured.chunks.map((c) => (typeof c === "string" ? c : new TextDecoder().decode(c))).join("");
    resolve(new Response(body || null, { status: captured.status, headers: captured.headers }));
  };

  const res = {
    statusCode: 200,
    setHeader(name: string, value: string | number | string[]) {
      captured.headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
      return this;
    },
    getHeader(name: string) {
      return captured.headers[name.toLowerCase()];
    },
    removeHeader(name: string) {
      delete captured.headers[name.toLowerCase()];
    },
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status;
      if (headers) {
        for (const [k, v] of Object.entries(headers)) captured.headers[k.toLowerCase()] = String(v);
      }
      return this;
    },
    write(chunk: Uint8Array | string) {
      captured.chunks.push(chunk);
      return true;
    },
    end(chunk?: Uint8Array | string) {
      if (chunk !== undefined) captured.chunks.push(chunk);
      captured.status = (this as { statusCode: number }).statusCode || captured.status;
      finish();
      return this;
    },
    on() { return this; },
    once() { return this; },
    emit() { return true; },
  };

  return res as unknown as Parameters<StreamableHTTPServerTransport["handleRequest"]>[1];
}

const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  if (url.pathname === "/health") {
    return Response.json({ ok: true, name: "metricspot-mcp", version: "0.1.0" });
  }

  if (url.pathname === "/mcp") {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, mcp-session-id",
        },
      });
    }
    try {
      return await handleMcp(req);
    } catch (err) {
      return Response.json(
        { error: "Internal", message: (err as Error).message },
        { status: 500 },
      );
    }
  }

  return new Response("MetricSpot MCP server. POST /mcp for JSON-RPC.", { status: 404 });
};

const server = Bun.serve({
  port: PORT,
  fetch: handler,
});

console.log(`[mcp] listening on http://${server.hostname}:${server.port}`);

process.on("SIGINT", () => {
  console.log("[mcp] shutting down");
  server.stop();
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log("[mcp] shutting down");
  server.stop();
  process.exit(0);
});
