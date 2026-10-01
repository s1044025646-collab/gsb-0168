import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { Repo, openDatabase } from "../db/repo.ts";
import { ValidationError } from "../validation.ts";
import { GeometryError } from "../geometry/polygon.ts";
import {
  ConflictError, NotFoundError, createCondition, importGeometry,
  runScan, underwaterView, uprightDraft,
} from "../analysis/service.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_DIR = join(HERE, "..", "..", ".project");
const DEFAULT_DB = join(PROJECT_DIR, "hydrostatics.db");

interface AppContext {
  repo: Repo;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(json);
}

function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, details } };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError("INVALID_JSON", "request body is not valid JSON");
  }
}

function matchPath(pathname: string, pattern: string): Record<string, string> | undefined {
  const a = pathname.split("/").filter(Boolean);
  const b = pattern.split("/").filter(Boolean);
  if (a.length !== b.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (b[i]!.startsWith(":")) params[b[i]!.slice(1)] = a[i]!;
    else if (a[i] !== b[i]) return undefined;
  }
  return params;
}

function pageFrom(url: URL) {
  return {
    limit: Number(url.searchParams.get("limit") ?? 50),
    offset: Number(url.searchParams.get("offset") ?? 0),
  };
}

function paged(rows: unknown[], total: number, limit: number, offset: number) {
  return {
    data: rows,
    page: { limit, offset, total, hasMore: offset + rows.length < total },
  };
}

export function createApp(ctx: AppContext) {
  const { repo } = ctx;
  return createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      mapError(res, err);
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    const method = req.method ?? "GET";

    if (pathname === "/health" && method === "GET") {
      send(res, 200, { status: "ok", model: "ideal-prismatic-closed-section" });
      return;
    }

    if (pathname === "/conventions" && method === "GET") {
      send(res, 200, conventions());
      return;
    }

    if (pathname === "/hulls" && method === "GET") {
      const { limit, offset } = pageFrom(url);
      const p = { limit: clampLimit(limit), offset: clampOffset(offset) };
      const { rows, total } = repo.listHulls(p.limit, p.offset);
      send(res, 200, paged(rows, total, p.limit, p.offset));
      return;
    }
    if (pathname === "/hulls" && method === "POST") {
      const body = (await readJson(req)) as { name?: unknown };
      if (typeof body.name !== "string" || body.name.trim() === "") {
        throw new ValidationError("INVALID_STRING", "name required", "name");
      }
      send(res, 201, repo.createHull(body.name.trim()));
      return;
    }

    let m: Record<string, string> | undefined;

    if ((m = matchPath(pathname, "/hulls/:id/geometries")) && method === "GET") {
      const hullId = idParam(m!.id);
      const p = { limit: clampLimit(pageFrom(url).limit), offset: clampOffset(pageFrom(url).offset) };
      const { rows, total } = repo.listGeometries(hullId, p.limit, p.offset);
      send(res, 200, paged(rows, total, p.limit, p.offset));
      return;
    }
    if ((m = matchPath(pathname, "/hulls/:id/geometries")) && method === "POST") {
      const hullId = idParam(m!.id);
      const body = (await readJson(req)) as { vertices?: unknown };
      send(res, 201, importGeometry(repo, hullId, body.vertices));
      return;
    }

    if ((m = matchPath(pathname, "/hulls/:id/conditions")) && method === "GET") {
      const hullId = idParam(m!.id);
      const p = { limit: clampLimit(pageFrom(url).limit), offset: clampOffset(pageFrom(url).offset) };
      const { rows, total } = repo.listConditions(hullId, p.limit, p.offset);
      send(res, 200, paged(rows, total, p.limit, p.offset));
      return;
    }
    if ((m = matchPath(pathname, "/hulls/:id/conditions")) && method === "POST") {
      const hullId = idParam(m!.id);
      const body = (await readJson(req)) as Record<string, unknown>;
      send(res, 201, createCondition(repo, {
        hullId,
        geometryId: body.geometryId as number | undefined,
        length: body.length as number,
        mass: body.mass as number,
        cg: body.cg as { x: number; z: number },
      }));
      return;
    }

    if (pathname === "/fluids" && method === "GET") {
      const p = { limit: clampLimit(pageFrom(url).limit), offset: clampOffset(pageFrom(url).offset) };
      const { rows, total } = repo.listFluids(p.limit, p.offset);
      send(res, 200, paged(rows, total, p.limit, p.offset));
      return;
    }
    if (pathname === "/fluids" && method === "POST") {
      const body = (await readJson(req)) as { name?: unknown; density?: unknown; g?: unknown };
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) throw new ValidationError("INVALID_STRING", "name required", "name");
      const density = Number(body.density);
      const g = body.g === undefined ? 9.81 : Number(body.g);
      if (!Number.isFinite(density) || density <= 0) {
        throw new ValidationError("INVALID_RANGE", "density must be > 0", "density");
      }
      if (!Number.isFinite(g) || g <= 0) throw new ValidationError("INVALID_RANGE", "g must be > 0", "g");
      send(res, 200, repo.upsertFluid(name, density, g));
      return;
    }

    if ((m = matchPath(pathname, "/conditions/:id/draft")) && method === "GET") {
      const conditionId = idParam(m!.id);
      const fluidId = idParam(url.searchParams.get("fluidId") ?? "");
      send(res, 200, uprightDraft(repo, conditionId, fluidId));
      return;
    }
    if ((m = matchPath(pathname, "/conditions/:id/underwater")) && method === "GET") {
      const conditionId = idParam(m!.id);
      const fluidId = idParam(url.searchParams.get("fluidId") ?? "");
      const heel = Number(url.searchParams.get("heelDeg") ?? 0);
      send(res, 200, underwaterView(repo, conditionId, fluidId, heel));
      return;
    }
    if ((m = matchPath(pathname, "/conditions/:id/scans")) && method === "POST") {
      const conditionId = idParam(m!.id);
      const body = (await readJson(req)) as Record<string, unknown>;
      const result = runScan(repo, {
        conditionId,
        fluidId: Number(body.fluidId),
        startDeg: body.startDeg === undefined ? -45 : Number(body.startDeg),
        endDeg: body.endDeg === undefined ? 45 : Number(body.endDeg),
        stepDeg: body.stepDeg === undefined ? 5 : Number(body.stepDeg),
        idempotencyKey: body.idempotencyKey ?? randomUUID(),
      });
      send(res, result.reused ? 200 : 201, result);
      return;
    }

    if (pathname === "/reports" && method === "GET") {
      const p = { limit: clampLimit(pageFrom(url).limit), offset: clampOffset(pageFrom(url).offset) };
      const cond = url.searchParams.get("conditionId");
      const conditionId = cond === null ? undefined : idParam(cond);
      const { rows, total } = repo.listReports(conditionId, p.limit, p.offset);
      send(res, 200, paged(rows, total, p.limit, p.offset));
      return;
    }
    if ((m = matchPath(pathname, "/reports/:id")) && method === "GET") {
      const report = repo.getReport(idParam(m!.id));
      if (!report) throw new NotFoundError("REPORT_NOT_FOUND", "report not found");
      send(res, 200, report);
      return;
    }

    send(res, 404, errorBody("ROUTE_NOT_FOUND", `${method} ${pathname} has no handler`));
  }
}

function conventions() {
  return {
    axes: "body frame: x starboard, z up, metres; prismatic along length, no trim",
    water: "water occupies z <= waterlineZ; draft measured from lowest rotated vertex",
    heelSign: "positive heel = counter-clockwise = starboard up / port submerged",
    rotation: "[x',z'] = R(phi)[x,z]; center of gravity rotates with the hull",
    gzSign: "GZ = xB_world - xG_world; stable at positive heel gives GZ<0, restoring moment = -rho*g*V*GZ",
    scope: "ideal closed convex prismatic section only; no flooding or real-vessel safety inference",
  };
}

function idParam(raw: string | undefined): number {
  if (raw === undefined) throw new ValidationError("INVALID_ID", "id is required");
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new ValidationError("INVALID_ID", "id must be a positive integer");
  return n;
}

function clampLimit(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.min(200, Math.max(1, Math.floor(n)));
}

function clampOffset(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function mapError(res: ServerResponse, err: unknown): void {
  if (err instanceof ValidationError) {
    send(res, 400, errorBody(err.code, err.message, err.field ? { field: err.field } : undefined));
  } else if (err instanceof GeometryError) {
    const status = err.code === "MASS_EXCEEDS_FULL_SUBMERGENCE" ? 422 : 400;
    send(res, status, errorBody(err.code, err.message));
  } else if (err instanceof NotFoundError) {
    send(res, 404, errorBody(err.code, err.message));
  } else if (err instanceof ConflictError) {
    send(res, 409, errorBody(err.code, err.message));
  } else {
    send(res, 500, errorBody("INTERNAL_ERROR", err instanceof Error ? err.message : "unknown error"));
  }
}

export function startServer(dbPath = DEFAULT_DB, preferredPort = 0): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
    const db = openDatabase(dbPath);
    const repo = new Repo(db);
    const server = createApp({ repo });
    server.listen(preferredPort, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      writeFileSync(join(PROJECT_DIR, "server.pid"), String(process.pid));
      writeFileSync(join(PROJECT_DIR, "server.port"), String(port));
      resolve({ server, port });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer(DEFAULT_DB, Number(process.env.PORT ?? 0)).then(({ port }) => {
    console.log(`hydrostatics API listening on http://127.0.0.1:${port} (db ${DEFAULT_DB})`);
  });
}
