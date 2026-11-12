import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { suggestMapping } from "../public/js/mapper.js";
import {
  localSuggestions,
  suggestWithOpenAI,
  validateColumnMetadata
} from "./provider.js";

const rootDir = resolve(fileURLToPath(new URL("../public", import.meta.url)));
const envPath = resolve(fileURLToPath(new URL("../.env", import.meta.url)));

async function loadEnv() {
  if (!existsSync(envPath)) return;
  const contents = await readFile(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const headers = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

const attempts = new Map();

function rateLimited(address) {
  const now = Date.now();
  const recent = (attempts.get(address) || []).filter((time) => now - time < 60_000);
  recent.push(now);
  attempts.set(address, recent);
  return recent.length > 30;
}

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    ...headers,
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

async function body(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32 * 1024) throw new Error("Request body exceeds 32 KB.");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function staticFile(pathname, response) {
  const decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const filePath = resolve(rootDir, `.${decoded}`);
  if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${sep}`)) {
    json(response, 403, { error: "Path is not allowed." });
    return;
  }
  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      ...headers,
      "Cache-Control": "no-cache",
      "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": file.length
    });
    response.end(file);
  } catch {
    json(response, 404, { error: "Not found." });
  }
}

export function createAppServer(options = {}) {
  const model = options.model || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const liveProvider = options.liveProvider || suggestWithOpenAI;

  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");

    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, {
        ok: true,
        provider: process.env.OPENAI_API_KEY || options.apiKey ? "openai-ready" : "local",
        privacy: "metadata-only-live-route"
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/suggest-mappings") {
      if (rateLimited(request.socket.remoteAddress || "local")) {
        json(response, 429, { error: "Too many mapping requests. Retry in one minute." });
        return;
      }
      try {
        const payload = await body(request);
        const validationError = validateColumnMetadata(payload.columns);
        if (validationError) {
          json(response, 400, { error: validationError });
          return;
        }
        const columns = payload.columns.map((column) => ({
          name: column.name.trim(),
          type: column.type
        }));
        const apiKey = process.env.OPENAI_API_KEY || options.apiKey;
        if (apiKey && payload.engine === "auto") {
          try {
            const suggestions = await liveProvider(columns, { apiKey, model });
            json(response, 200, { provider: "openai", model, suggestions });
            return;
          } catch (error) {
            console.error(`[fieldmap] Live mapping fallback: ${error.message}`);
          }
        }
        json(response, 200, {
          provider: "local",
          model: "deterministic-mapper",
          suggestions: localSuggestions(columns, suggestMapping)
        });
      } catch (error) {
        const status = error instanceof SyntaxError ? 400 : 500;
        json(response, status, { error: status === 400 ? "Request body must be valid JSON." : "Mapping request failed." });
      }
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await staticFile(url.pathname, response);
      return;
    }
    json(response, 405, { error: "Method not allowed." });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await loadEnv();
  const port = Number(process.env.PORT || 4180);
  createAppServer().listen(port, "127.0.0.1", () => {
    const provider = process.env.OPENAI_API_KEY ? "OpenAI metadata mapping + local fallback" : "local deterministic";
    console.log(`FieldMap running at http://127.0.0.1:${port} (${provider})`);
  });
}
