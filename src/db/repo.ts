import { DatabaseSync } from "node:sqlite";
import { applyMigrations } from "./schema.ts";
import type { Point } from "../geometry/types.ts";

export interface HullRow {
  id: number;
  name: string;
  created_at: string;
}

export interface GeometryRow {
  id: number;
  hull_id: number;
  version: number;
  vertices: Point[];
  area: number;
  created_at: string;
}

export interface ConditionRow {
  id: number;
  hull_id: number;
  geometry_id: number;
  length_m: number;
  mass_kg: number;
  cg_x: number;
  cg_z: number;
  created_at: string;
}

export interface FluidRow {
  id: number;
  name: string;
  density: number;
  g: number;
  created_at: string;
}

export interface Clock {
  now(): Date;
}

export interface Rng {
  uuid(): string;
}

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  applyMigrations(db);
  return db;
}

export class Repo {
  readonly db!: DatabaseSync;
  private clock: Clock;

  constructor(
    db: DatabaseSync,
    clock: Clock = { now: () => new Date() },
  ) {
    this.db = db;
    this.clock = clock;
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  createHull(name: string): HullRow {
    const ts = this.clock.now().toISOString();
    const info = this.db.prepare("INSERT INTO hulls(name, created_at) VALUES(?, ?)").run(name, ts);
    return { id: Number(info.lastInsertRowid), name, created_at: ts };
  }

  getHull(id: number): HullRow | undefined {
    return this.db.prepare("SELECT * FROM hulls WHERE id=?").get(id) as HullRow | undefined;
  }

  listHulls(limit: number, offset: number): { rows: HullRow[]; total: number } {
    const rows = this.db.prepare("SELECT * FROM hulls ORDER BY id LIMIT ? OFFSET ?").all(limit, offset) as unknown as HullRow[];
    const total = (this.db.prepare("SELECT COUNT(*) c FROM hulls").get() as { c: number }).c;
    return { rows, total };
  }

  addGeometry(hullId: number, vertices: Point[], area: number): GeometryRow {
    const ts = this.clock.now().toISOString();
    return this.transaction(() => {
      const verRow = this.db.prepare("SELECT COALESCE(MAX(version), 0) v FROM geometries WHERE hull_id=?").get(hullId) as { v: number };
      const version = verRow.v + 1;
      const info = this.db.prepare(
        "INSERT INTO geometries(hull_id, version, vertices_json, area, created_at) VALUES(?,?,?,?,?)",
      ).run(hullId, version, JSON.stringify(vertices), area, ts);
      return {
        id: Number(info.lastInsertRowid), hull_id: hullId, version,
        vertices, area, created_at: ts,
      };
    });
  }

 getLatestGeometry(hullId: number): GeometryRow | undefined {
    const row = this.db.prepare(
      "SELECT * FROM geometries WHERE hull_id=? ORDER BY version DESC LIMIT 1",
    ).get(hullId) as Record<string, unknown> | undefined;
    return row ? this.hydrateGeometry(row) : undefined;
  }

  getGeometry(id: number): GeometryRow | undefined {
    const row = this.db.prepare("SELECT * FROM geometries WHERE id=?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.hydrateGeometry(row) : undefined;
  }

  listGeometries(hullId: number, limit: number, offset: number): { rows: GeometryRow[]; total: number } {
    const raw = this.db.prepare(
      "SELECT * FROM geometries WHERE hull_id=? ORDER BY version DESC LIMIT ? OFFSET ?",
    ).all(hullId, limit, offset) as Record<string, unknown>[];
    const total = (this.db.prepare("SELECT COUNT(*) c FROM geometries WHERE hull_id=?").get(hullId) as { c: number }).c;
    return { rows: raw.map((r) => this.hydrateGeometry(r)), total };
  }

  private hydrateGeometry(row: Record<string, unknown>): GeometryRow {
    return {
      id: Number(row.id),
      hull_id: Number(row.hull_id),
      version: Number(row.version),
      vertices: JSON.parse(String(row.vertices_json)) as Point[],
      area: Number(row.area),
      created_at: String(row.created_at),
    };
  }

  createCondition(input: {
    hullId: number; geometryId: number; length: number; mass: number; cg: Point;
  }): ConditionRow {
    const ts = this.clock.now().toISOString();
    const info = this.db.prepare(
      "INSERT INTO loading_conditions(hull_id, geometry_id, length_m, mass_kg, cg_x, cg_z, created_at) " +
      "VALUES(?,?,?,?,?,?,?)",
    ).run(input.hullId, input.geometryId, input.length, input.mass, input.cg.x, input.cg.z, ts);
    return {
      id: Number(info.lastInsertRowid), hull_id: input.hullId, geometry_id: input.geometryId,
      length_m: input.length, mass_kg: input.mass, cg_x: input.cg.x, cg_z: input.cg.z, created_at: ts,
    };
  }

  getCondition(id: number): ConditionRow | undefined {
    return this.db.prepare("SELECT * FROM loading_conditions WHERE id=?").get(id) as ConditionRow | undefined;
  }

  listConditions(hullId: number, limit: number, offset: number): { rows: ConditionRow[]; total: number } {
    const rows = this.db.prepare(
      "SELECT * FROM loading_conditions WHERE hull_id=? ORDER BY id DESC LIMIT ? OFFSET ?",
    ).all(hullId, limit, offset) as unknown as ConditionRow[];
    const total = (this.db.prepare("SELECT COUNT(*) c FROM loading_conditions WHERE hull_id=?").get(hullId) as { c: number }).c;
    return { rows, total };
  }

  upsertFluid(name: string, density: number, g: number): FluidRow {
    const ts = this.clock.now().toISOString();
    this.db.prepare(
      "INSERT INTO fluids(name, density, g, created_at) VALUES(?,?,?,?) " +
      "ON CONFLICT(name) DO UPDATE SET density=excluded.density, g=excluded.g",
    ).run(name, density, g, ts);
    return this.getFluidByName(name)!;
  }

  getFluid(id: number): FluidRow | undefined {
    return this.db.prepare("SELECT * FROM fluids WHERE id=?").get(id) as FluidRow | undefined;
  }

  getFluidByName(name: string): FluidRow | undefined {
    return this.db.prepare("SELECT * FROM fluids WHERE name=?").get(name) as FluidRow | undefined;
  }

  listFluids(limit: number, offset: number): { rows: FluidRow[]; total: number } {
    const rows = this.db.prepare("SELECT * FROM fluids ORDER BY id LIMIT ? OFFSET ?").all(limit, offset) as unknown as FluidRow[];
    const total = (this.db.prepare("SELECT COUNT(*) c FROM fluids").get() as { c: number }).c;
    return { rows, total };
  }

  createScanRequestIfAbsent(input: {
    idempotencyKey: string; conditionId: number; fluidId: number;
    start: number; end: number; step: number;
  }): { requestId: number; created: boolean } {
    const ts = this.clock.now().toISOString();
    try {
      const info = this.db.prepare(
        "INSERT INTO scan_requests(idempotency_key, condition_id, fluid_id, start_deg, end_deg, step_deg, created_at) " +
        "VALUES(?,?,?,?,?,?,?)",
      ).run(input.idempotencyKey, input.conditionId, input.fluidId, input.start, input.end, input.step, ts);
      return { requestId: Number(info.lastInsertRowid), created: true };
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint failed: scan_requests.idempotency_key")) {
        const row = this.db.prepare("SELECT id FROM scan_requests WHERE idempotency_key=?").get(input.idempotencyKey) as { id: number };
        return { requestId: row.id, created: false };
      }
      throw err;
    }
  }

  saveReport(input: {
    requestId: number; conditionId: number; fluidId: number;
    snapshot: unknown; points: unknown; equilibria: unknown;
    maxResidual: number; nearFull: unknown; fullSubmerged: unknown;
  }): number {
    const ts = this.clock.now().toISOString();
    const info = this.db.prepare(
      "INSERT INTO reports(request_id, condition_id, fluid_id, snapshot_json, points_json, " +
      "equilibria_json, max_abs_residual_kg, near_full_json, full_submerged_json, created_at) " +
      "VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      input.requestId, input.conditionId, input.fluidId,
      JSON.stringify(input.snapshot), JSON.stringify(input.points), JSON.stringify(input.equilibria),
      input.maxResidual, JSON.stringify(input.nearFull), JSON.stringify(input.fullSubmerged), ts,
    );
    return Number(info.lastInsertRowid);
  }

  getReportByRequest(requestId: number) {
    const row = this.db.prepare("SELECT * FROM reports WHERE request_id=?").get(requestId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.hydrateReport(row) : undefined;
  }

  getReport(id: number) {
    const row = this.db.prepare("SELECT * FROM reports WHERE id=?").get(id) as Record<string, unknown> | undefined;
    return row ? this.hydrateReport(row) : undefined;
  }

  listReports(conditionId: number | undefined, limit: number, offset: number) {
    const totalRow = conditionId === undefined
      ? this.db.prepare("SELECT COUNT(*) c FROM reports").get() as { c: number }
      : this.db.prepare("SELECT COUNT(*) c FROM reports WHERE condition_id=?").get(conditionId) as { c: number };
    const rows = conditionId === undefined
      ? this.db.prepare("SELECT * FROM reports ORDER BY id DESC LIMIT ? OFFSET ?").all(limit, offset) as Record<string, unknown>[]
      : this.db.prepare("SELECT * FROM reports WHERE condition_id=? ORDER BY id DESC LIMIT ? OFFSET ?").all(conditionId, limit, offset) as Record<string, unknown>[];
    return { rows: rows.map((r) => this.hydrateReport(r)), total: totalRow.c };
  }

  private hydrateReport(row: Record<string, unknown>) {
    return {
      id: Number(row.id),
      request_id: Number(row.request_id),
      condition_id: Number(row.condition_id),
      fluid_id: Number(row.fluid_id),
      snapshot: JSON.parse(String(row.snapshot_json)),
      points: JSON.parse(String(row.points_json)),
      equilibria: JSON.parse(String(row.equilibria_json)),
      max_abs_residual_kg: Number(row.max_abs_residual_kg),
      near_full: JSON.parse(String(row.near_full_json)),
      full_submerged: JSON.parse(String(row.full_submerged_json)),
      created_at: String(row.created_at),
    };
  }

  close(): void {
    this.db.close();
  }
}
