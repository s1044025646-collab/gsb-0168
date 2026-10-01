import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AnalysisInput, Geometry, Page, Point, Report, Sample, EquilibriumPoint } from "./types.js";
import { analyzeAngle, ValidationError, validateConvexPolygon } from "./geometry.js";

export type Clock = () => Date;

export class AppDatabase {
  readonly db: DatabaseSync;

  constructor(path: string, private readonly clock: Clock = () => new Date()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS geometries(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        vertices_json TEXT NOT NULL CHECK(json_valid(vertices_json)),
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reports(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotency_key TEXT UNIQUE,
        geometry_id INTEGER NOT NULL REFERENCES geometries(id),
        geometry_version INTEGER NOT NULL,
        payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reports_geometry ON reports(geometry_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);
    `);
  }

  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  createGeometry(name: unknown, vertices: unknown): Geometry {
    if (typeof name !== "string" || name.trim().length === 0 || name.length > 120) {
      throw new ValidationError("name must be 1-120 characters", "INVALID_NAME");
    }
    const validVertices = validateConvexPolygon(vertices);
    return this.transaction(() => {
      const createdAt = this.clock().toISOString();
      const result = this.db.prepare("INSERT INTO geometries(name, vertices_json, created_at) VALUES (?, ?, ?)")
        .run(name.trim(), JSON.stringify(validVertices), createdAt);
      return this.getGeometry(Number(result.lastInsertRowid))!;
    });
  }

  getGeometry(id: number): Geometry | null {
    const row = this.db.prepare("SELECT id, name, vertices_json, created_at FROM geometries WHERE id = ?").get(id) as
      { id: number; name: string; vertices_json: string; created_at: string } | undefined;
    return row ? hydrateGeometry(row) : null;
  }

  requireGeometry(id: number): Geometry {
    const geometry = this.getGeometry(id);
    if (!geometry) throw new NotFoundError(`geometry ${id} not found`, "GEOMETRY_NOT_FOUND");
    return geometry;
  }

  listGeometries(limit: number, offset: number): Page<Geometry> {
    const rows = this.db.prepare("SELECT id, name, vertices_json, created_at FROM geometries ORDER BY id DESC LIMIT ? OFFSET ?")
      .all(limit + 1, offset) as Array<Record<string, unknown>>;
    return paginate(rows.map((row) => hydrateGeometry(row as never)), limit, offset);
  }

  createReport(input: unknown): Report {
    const analysis = validateAnalysisInput(input);
    return this.transaction(() => {
      if (analysis.idempotencyKey) {
        const existing = this.db.prepare("SELECT payload_json FROM reports WHERE idempotency_key = ?").get(analysis.idempotencyKey) as
          { payload_json: string } | undefined;
        if (existing) return JSON.parse(existing.payload_json) as Report;
      }
      const geometry = this.requireGeometry(analysis.geometryId);
      const report = buildReport(geometry, analysis, this.clock().toISOString());
      const insertResult = this.db.prepare(`
        INSERT INTO reports(idempotency_key, geometry_id, geometry_version, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(report.idempotencyKey, report.geometryId, report.geometryVersionAtScan, JSON.stringify(report), report.createdAt);
      report.id = Number(insertResult.lastInsertRowid);
      this.db.prepare("UPDATE reports SET payload_json = ? WHERE id = ?").run(JSON.stringify(report), report.id);
      return report;
    });
  }

  getReport(id: number): Report | null {
    const row = this.db.prepare("SELECT payload_json FROM reports WHERE id = ?").get(id) as { payload_json: string } | undefined;
    return row ? JSON.parse(row.payload_json) as Report : null;
  }

  requireReport(id: number): Report {
    const report = this.getReport(id);
    if (!report) throw new NotFoundError(`report ${id} not found`, "REPORT_NOT_FOUND");
    return report;
  }

  listReports(limit: number, offset: number, geometryId?: number): Page<Report> {
    const rows = geometryId === undefined
      ? this.db.prepare("SELECT payload_json FROM reports ORDER BY id DESC LIMIT ? OFFSET ?").all(limit + 1, offset)
      : this.db.prepare("SELECT payload_json FROM reports WHERE geometry_id = ? ORDER BY id DESC LIMIT ? OFFSET ?").all(geometryId, limit + 1, offset);
    return paginate((rows as Array<{ payload_json: string }>).map((row) => JSON.parse(row.payload_json) as Report), limit, offset);
  }
}

export class NotFoundError extends Error {
  code = "NOT_FOUND";
  status = 404;
  constructor(message: string, readonly errorCode: string) {
    super(message);
  }
}

export class ConflictError extends Error {
  code = "CONFLICT";
  status = 409;
  constructor(message: string, readonly errorCode = "CONFLICT") {
    super(message);
  }
}

function hydrateGeometry(row: { id: number; name: string; vertices_json: string; created_at: string }): Geometry {
  return { id: Number(row.id), name: row.name, vertices: JSON.parse(row.vertices_json) as Point[], createdAt: row.created_at };
}

function paginate<T>(itemsPlusOne: T[], limit: number, offset: number): Page<T> {
  const hasMore = itemsPlusOne.length > limit;
  return { items: hasMore ? itemsPlusOne.slice(0, -1) : itemsPlusOne, limit, offset, hasMore };
}

function numberField(object: Record<string, unknown>, field: string, positive = false, integer = false): number {
  const value = object[field];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new ValidationError(`${field} must be a finite number`, `INVALID_${field.toUpperCase()}`);
  if (integer && !Number.isInteger(value)) throw new ValidationError(`${field} must be an integer`, `INVALID_${field.toUpperCase()}`);
  if (positive && value <= 0) throw new ValidationError(`${field} must be positive`, `INVALID_${field.toUpperCase()}`);
  return value;
}

function validateAnalysisInput(input: unknown): AnalysisInput {
  if (!input || typeof input !== "object") throw new ValidationError("request body must be an object", "INVALID_BODY");
  const value = input as Record<string, unknown>;
  const geometryId = numberField(value, "geometryId", true, true);
  const length = numberField(value, "length", true);
  const mass = numberField(value, "mass", true);
  const fluidDensity = numberField(value, "fluidDensity", true);
  const minAngleDeg = numberField(value, "minAngleDeg");
  const maxAngleDeg = numberField(value, "maxAngleDeg");
  const angleStepDeg = numberField(value, "angleStepDeg", true);
  if (minAngleDeg < -90 || maxAngleDeg > 90 || minAngleDeg >= maxAngleDeg) {
    throw new ValidationError("angles must satisfy -90 <= min < max <= 90", "INVALID_ANGLE_RANGE");
  }
  if (angleStepDeg > maxAngleDeg - minAngleDeg) throw new ValidationError("angleStepDeg is too large", "INVALID_ANGLE_STEP");
  if (value.idempotencyKey !== undefined && (typeof value.idempotencyKey !== "string" || value.idempotencyKey.length < 8 || value.idempotencyKey.length > 120)) {
    throw new ValidationError("idempotencyKey must contain 8-120 characters", "INVALID_IDEMPOTENCY_KEY");
  }
  return {
    geometryId,
    length,
    mass,
    fluidDensity,
    minAngleDeg,
    maxAngleDeg,
    angleStepDeg,
    centerOfGravity: {
      x: numberField((value.centerOfGravity ?? {}) as Record<string, unknown>, "x"),
      y: numberField((value.centerOfGravity ?? {}) as Record<string, unknown>, "y")
    },
    ...(typeof value.idempotencyKey === "string" ? { idempotencyKey: value.idempotencyKey } : {})
  };
}

function buildReport(geometry: Geometry, input: AnalysisInput, createdAt: string): Omit<Report, "id"> & { id: number } {
  const count = Math.round((input.maxAngleDeg - input.minAngleDeg) / input.angleStepDeg);
  const angles = Array.from({ length: count + 1 }, (_, index) => input.minAngleDeg + index * input.angleStepDeg);
  const samples = angles.map((angleDeg) => analyzeAngle({
    verticesBody: geometry.vertices,
    angleDeg,
    mass: input.mass,
    fluidDensity: input.fluidDensity,
    length: input.length,
    centerOfGravityBody: input.centerOfGravity
  }));
  const upright = analyzeAngle({
    verticesBody: geometry.vertices,
    angleDeg: 0,
    mass: input.mass,
    fluidDensity: input.fluidDensity,
    length: input.length,
    centerOfGravityBody: input.centerOfGravity
  });
  const limits: string[] = [];
  if (samples.some((sample) => Number.isNaN(sample.draft))) limits.push("MASS_EXCEEDS_FULL_DISPLACEMENT");
  if (samples.some((sample) => sample.nearFullImmersion)) limits.push("NEAR_FULL_IMMERSION");
  const equilibriumPoints = findEquilibriumPoints(samples);
  return {
    id: 0,
    idempotencyKey: input.idempotencyKey ?? null,
    geometryId: geometry.id,
    geometryVersionAtScan: geometry.id,
    geometryName: geometry.name,
    frozenVertices: geometry.vertices,
    parameters: {
      length: input.length,
      mass: input.mass,
      centerOfGravity: input.centerOfGravity,
      fluidDensity: input.fluidDensity,
      minAngleDeg: input.minAngleDeg,
      maxAngleDeg: input.maxAngleDeg,
      angleStepDeg: input.angleStepDeg
    },
    upright,
    samples,
    equilibriumPoints,
    limits,
    createdAt
  };
}

function findEquilibriumPoints(samples: Sample[]): EquilibriumPoint[] {
  const points: EquilibriumPoint[] = [];
  const tolerance = Math.max(1e-7, ...samples.map((s) => Math.abs(s.displacementResidual))) * 0 + 1e-7;
  for (const sample of samples) {
    if (!Number.isNaN(sample.gz) && Math.abs(sample.gz) <= 1e-6 && Math.abs(sample.displacementResidual) <= tolerance) {
      points.push({ angleDeg: sample.angleDeg, gz: sample.gz, residual: sample.displacementResidual, kind: "sample" });
    }
  }
  for (let i = 1; i < samples.length; i += 1) {
    const before = samples[i - 1]!;
    const after = samples[i]!;
    if (!Number.isNaN(before.gz) && !Number.isNaN(after.gz) && before.gz * after.gz < 0) {
      points.push({
        angleDeg: (before.angleDeg + after.angleDeg) / 2,
        gz: NaN,
        residual: Math.max(Math.abs(before.displacementResidual), Math.abs(after.displacementResidual)),
        kind: "sign-change-bracket",
        bracket: [before.angleDeg, after.angleDeg]
      });
    }
  }
  return points;
}
