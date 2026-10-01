import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AppDatabase, ConflictError, NotFoundError } from "./db.js";
import { findFloatCondition, GeometryError, ValidationError } from "./geometry.js";

type Route = { method: string; pattern: RegExp; handle: (req: IncomingMessage, res: ServerResponse, match: RegExpMatchArray, body: unknown) => void };

export function createApp(db: AppDatabase): Server {
  const routes: Route[] = [
    {
      method: "POST",
      pattern: /^\/api\/geometries$/,
      handle: (_req, res, _match, body) => sendJson(res, 201, db.createGeometry((body as Record<string, unknown>)?.name, (body as Record<string, unknown>)?.vertices))
    },
    {
      method: "GET",
      pattern: /^\/api\/geometries$/,
      handle: (_req, res, _match) => sendJson(res, 200, db.listGeometries(...parsePagination(queryFromUrl(_req))))
    },
    {
      method: "GET",
      pattern: /^\/api\/geometries\/(\d+)$/,
      handle: (_req, res, match) => sendJson(res, 200, db.requireGeometry(Number(match[1])))
    },
    {
      method: "POST",
      pattern: /^\/api\/reports$/,
      handle: (_req, res, _match, body) => sendJson(res, 201, db.createReport(body))
    },
    {
      method: "GET",
      pattern: /^\/api\/reports$/,
      handle: (req, res) => {
        const query = queryFromUrl(req);
        const geometryId = query.get("geometryId");
        if (geometryId !== null && (!/^\d+$/.test(geometryId))) throw new ValidationError("geometryId must be an integer", "INVALID_GEOMETRY_ID");
        sendJson(res, 200, db.listReports(...parsePagination(query), geometryId === null ? undefined : Number(geometryId)));
      }
    },
    {
      method: "GET",
      pattern: /^\/api\/reports\/(\d+)$/,
      handle: (_req, res, match) => sendJson(res, 200, db.requireReport(Number(match[1])))
    },
    {
      method: "GET",
      pattern: /^\/api\/reports\/(\d+)\/samples\/(-?[\d.]+)\/underwater$/,
      handle: (_req, res, match) => {
        const report = db.requireReport(Number(match[1]));
        const angleDeg = Number(match[2]);
        const sample = report.samples.find((item) => Math.abs(item.angleDeg - angleDeg) < 1e-9);
        if (!sample) throw new NotFoundError("sample angle not found in frozen report", "SAMPLE_NOT_FOUND");
        sendJson(res, 200, underwaterPolygon(report, angleDeg));
      }
    }
  ];

  return createServer((req, res) => {
    readJson(req).then((body) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      for (const route of routes) {
        if (req.method !== route.method) continue;
        const match = url.pathname.match(route.pattern);
        if (match) {
          route.handle(req, res, match, body);
          return;
        }
      }
      sendJson(res, 404, { error: { code: "ROUTE_NOT_FOUND", message: "route not found" } });
    }).catch((error: unknown) => sendError(res, error));
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.method !== "POST") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError("request body must be valid JSON", "INVALID_JSON");
  }
}

function queryFromUrl(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? "/", "http://127.0.0.1").searchParams;
}

function parsePagination(query: URLSearchParams): [number, number] {
  const limit = Number(query.get("limit") ?? "50");
  const offset = Number(query.get("offset") ?? "0");
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ValidationError("limit must be 1-200", "INVALID_LIMIT");
  if (!Number.isInteger(offset) || offset < 0) throw new ValidationError("offset must be a non-negative integer", "INVALID_OFFSET");
  return [limit, offset];
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof ValidationError || error instanceof GeometryError || error instanceof NotFoundError || error instanceof ConflictError) {
    sendJson(res, error.status, { error: { code: error.errorCode, message: error.message } });
  } else {
    sendJson(res, 500, { error: { code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : "internal error" } });
  }
}

function underwaterPolygon(report: ReturnType<AppDatabase["requireReport"]>, angleDeg: number) {
  const result = findFloatCondition({
    verticesBody: report.frozenVertices,
    angleDeg,
    mass: report.parameters.mass,
    fluidDensity: report.parameters.fluidDensity,
    length: report.parameters.length,
    centerOfGravityBody: report.parameters.centerOfGravity
  });
  return {
    coordinateSystem: "world coordinates: +x starboard, +y upward; positive heel rotates body clockwise from x toward -y",
    waterlineY: result.draft,
    vertices: result.submerged,
    area: result.area
  };
}
