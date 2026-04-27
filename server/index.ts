import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { hydrateEnvFromFile, getServerConfig } from "./config/env";
import { redactErrorForLog } from "./security/redaction";
import { getHealthResponse } from "./routes/healthRoute";
import { getAiStatusResponse } from "./routes/aiStatusRoute";
import { handleAiProbe } from "./routes/aiProbeRoute";
import { handleResumeIntelligence } from "./routes/resumeIntelligenceRoute";
import { handleResumeParse } from "./routes/resumeParseRoute";

/**
 * Agentic Job Ops AI API server.
 *
 * Stays intentionally tiny — three endpoints, raw Node http, no
 * framework. The provider abstraction in server/ai/ is where the
 * real complexity lives.
 *
 * Hard logging rules:
 * - Request bodies are NEVER logged in full.
 * - Response bodies are NEVER logged in full.
 * - API keys and bearer tokens are NEVER logged.
 * - Errors are passed through `redactErrorForLog` before being
 *   written to stdout/stderr.
 */

// Body limit needs to fit a Base64-encoded resume PDF / DOCX
// (≈4/3 the raw size). 8 MB request → ~6 MB raw file, well above
// the 5 MB extract limit enforced inside resumeParser.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

// Hydrate .env early so getServerConfig() always sees the file values.
hydrateEnvFromFile();

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("REQUEST_BODY_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf-8");
      if (text.length === 0) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });
    req.on("error", (error: Error) => reject(error));
  });
}

function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  corsOrigin: string
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Vary", "Origin");
  res.end(JSON.stringify(body));
}

function applyPreflight(res: ServerResponse, corsOrigin: string): void {
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Vary", "Origin");
}

function logRequest(line: string, fields: Record<string, unknown> = {}): void {
  // Single-line JSON log so a future log shipper (Azure Monitor,
  // etc.) can ingest cleanly. Never includes request/response
  // bodies — only structural fields.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ msg: line, ...fields }));
}

export function createApiServer(config = getServerConfig()) {
  const corsOrigin = config.webOrigin;

  return createServer(async (req, res) => {
    const startedAt = Date.now();
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    // CORS preflight.
    if (method === "OPTIONS") {
      applyPreflight(res, corsOrigin);
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      if (method === "GET" && path === "/api/health") {
        const { status, body } = getHealthResponse();
        writeJson(res, status, body, corsOrigin);
        logRequest("http.request", {
          method,
          path,
          status,
          durationMs: Date.now() - startedAt
        });
        return;
      }

      if (method === "GET" && path === "/api/ai/status") {
        const { status, body } = getAiStatusResponse();
        writeJson(res, status, body, corsOrigin);
        logRequest("http.request", {
          method,
          path,
          status,
          durationMs: Date.now() - startedAt
        });
        return;
      }

      if (method === "GET" && path === "/api/ai/probe") {
        const force = url.searchParams.get("force") === "1";
        const result = await handleAiProbe({ force });
        writeJson(res, result.status, result.body, corsOrigin);
        logRequest("ai.probe", {
          ok: result.body.ok,
          provider: result.body.provider,
          model: result.body.model,
          latencyMs: result.body.latencyMs,
          cached: result.body.cached,
          errorCategory: result.body.errorCategory ?? "ok"
        });
        logRequest("http.request", {
          method,
          path,
          status: result.status,
          durationMs: Date.now() - startedAt
        });
        return;
      }

      if (method === "POST" && path === "/api/resume/parse") {
        let parsed: unknown;
        try {
          parsed = await readJsonBody(req);
        } catch (error) {
          const message =
            error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE"
              ? "Request body exceeds the configured limit."
              : "Invalid JSON in request body.";
          writeJson(res, 400, { error: message }, corsOrigin);
          logRequest("http.request", {
            method,
            path,
            status: 400,
            durationMs: Date.now() - startedAt,
            kind: "body_parse_failed"
          });
          return;
        }
        const result = await handleResumeParse(parsed);
        writeJson(res, result.status, result.body, corsOrigin);
        for (const entry of result.logs) {
          logRequest(entry.message, entry.fields);
        }
        logRequest("http.request", {
          method,
          path,
          status: result.status,
          durationMs: Date.now() - startedAt
        });
        return;
      }

      if (method === "POST" && path === "/api/resume-intelligence") {
        let parsed: unknown;
        try {
          parsed = await readJsonBody(req);
        } catch (error) {
          const message =
            error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE"
              ? "Request body exceeds the configured limit."
              : "Invalid JSON in request body.";
          writeJson(res, 400, { error: message }, corsOrigin);
          logRequest("http.request", {
            method,
            path,
            status: 400,
            durationMs: Date.now() - startedAt,
            kind: "body_parse_failed"
          });
          return;
        }

        const result = await handleResumeIntelligence(parsed);
        writeJson(res, result.status, result.body, corsOrigin);
        for (const entry of result.logs) {
          logRequest(entry.message, entry.fields);
        }
        logRequest("http.request", {
          method,
          path,
          status: result.status,
          durationMs: Date.now() - startedAt
        });
        return;
      }

      writeJson(res, 404, { error: "Not found" }, corsOrigin);
      logRequest("http.request", {
        method,
        path,
        status: 404,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      const redacted = redactErrorForLog(error);
      writeJson(res, 500, { error: "Internal server error" }, corsOrigin);
      logRequest("http.request_failed", {
        method,
        path,
        durationMs: Date.now() - startedAt,
        errorName: redacted.name,
        errorMessage: redacted.message
      });
    }
  });
}

// Auto-start when invoked directly (e.g. `tsx server/index.ts`).
// Skipped when the module is imported by tests.
const isDirectInvocation = process.argv[1]?.endsWith("server/index.ts") ||
  process.argv[1]?.endsWith("server/index.js") ||
  process.argv[1]?.endsWith("server\\index.ts") ||
  process.argv[1]?.endsWith("server\\index.js");

if (isDirectInvocation) {
  const config = getServerConfig();
  const server = createApiServer(config);
  server.listen(config.apiPort, () => {
    logRequest("server.started", {
      port: config.apiPort,
      provider: config.aiProvider,
      webOrigin: config.webOrigin
    });
  });
  process.on("SIGTERM", () => {
    server.close(() => process.exit(0));
  });
  process.on("SIGINT", () => {
    server.close(() => process.exit(0));
  });
}
