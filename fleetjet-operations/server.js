import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./worker/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ENV_PATH = path.join(__dirname, ".env");
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.ROVA_DATA_DIR
  ? path.resolve(process.env.ROVA_DATA_DIR)
  : path.join(__dirname, "work", "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || "127.0.0.1";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function loadEnvFile() {
  if (!fs.existsSync(ENV_PATH)) return;
  const content = fs.readFileSync(ENV_PATH, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function persistedRow() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) return null;
  const payload = fs.readFileSync(DB_PATH, "utf8");
  JSON.parse(payload);
  return {
    state_key: "primary",
    payload_json: payload,
    updated_at: fs.statSync(DB_PATH).mtime.toISOString()
  };
}

function persistPayload(payload, updatedAt) {
  const next = JSON.stringify(JSON.parse(payload), null, 2);
  const tempPath = path.join(DATA_DIR, ".db.json.tmp");
  fs.writeFileSync(tempPath, `${next}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, DB_PATH);
  return {
    state_key: "primary",
    payload_json: payload,
    updated_at: updatedAt
  };
}

class LocalD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new LocalD1Statement(this.database, this.sql, bindings);
  }

  async first() {
    if (!this.sql.startsWith("SELECT payload_json")) {
      throw new Error(`Unsupported local database query: ${this.sql}`);
    }
    return this.database.row ? { ...this.database.row } : null;
  }

  async run() {
    if (this.sql.startsWith("CREATE TABLE")) return { meta: { changes: 0 } };
    if (this.sql.includes("UPDATE delivery_tracker_state_v1")) {
      const [payload, updatedAt, stateKey, expectedUpdatedAt] = this.bindings;
      if (String(stateKey) !== "primary" || !this.database.row || String(this.database.row.updated_at) !== String(expectedUpdatedAt)) {
        return { meta: { changes: 0 } };
      }
      this.database.row = persistPayload(String(payload), String(updatedAt));
      return { meta: { changes: 1 } };
    }
    if (this.sql.includes("INSERT INTO delivery_tracker_state_v1")) {
      if (this.sql.includes("DO NOTHING") && this.database.row) return { meta: { changes: 0 } };
      const [stateKey, payload, updatedAt] = this.bindings;
      if (String(stateKey) !== "primary") return { meta: { changes: 0 } };
      this.database.row = persistPayload(String(payload), String(updatedAt));
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unsupported local database statement: ${this.sql}`);
  }
}

class LocalD1 {
  constructor() {
    this.row = persistedRow();
  }

  prepare(sql) {
    return new LocalD1Statement(this, sql);
  }
}

function assetResponse(request) {
  const url = new URL(request.url);
  const pathname = decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) return new Response("Bad request", { status: 400 });
  try {
    const body = fs.readFileSync(filePath);
    const extension = path.extname(filePath).toLowerCase();
    return new Response(body, {
      headers: { "content-type": MIME_TYPES[extension] || "application/octet-stream" }
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : null;
}

async function webRequest(request) {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);
  const body = ["GET", "HEAD"].includes(request.method || "GET") ? null : await requestBody(request);
  const init = {
    method: request.method,
    headers: request.headers
  };
  if (body) {
    init.body = body;
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function sendWebResponse(response, nodeResponse, method) {
  const headers = Object.fromEntries(response.headers.entries());
  nodeResponse.writeHead(response.status, headers);
  if (method === "HEAD" || response.body === null) {
    nodeResponse.end();
    return;
  }
  nodeResponse.end(Buffer.from(await response.arrayBuffer()));
}

loadEnvFile();
const database = new LocalD1();
const env = {
  ...process.env,
  DB: database,
  ASSETS: { fetch: assetResponse }
};

const server = http.createServer(async (request, response) => {
  try {
    const incoming = await webRequest(request);
    const outgoing = await worker.fetch(incoming, env);
    await sendWebResponse(outgoing, response, request.method || "GET");
  } catch (error) {
    response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message || "Server error" }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Rova running at http://${HOST}:${PORT}`);
});
