import type { Repo } from "../db/repo.ts";
import { ensureCgInside, polygonArea, validateConvexPolygon, GeometryError } from "../geometry/polygon.ts";
import type { Point } from "../geometry/types.ts";
import { num, str, ValidationError } from "../validation.ts";
import { solveEquilibrium, scanAngles } from "./hydrostatics.ts";
import type { HeelResult, ScanResult } from "./hydrostatics.ts";

export class NotFoundError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "NotFoundError";
    this.code = code;
  }
}

export class ConflictError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ConflictError";
    this.code = code;
  }
}

export function importGeometry(repo: Repo, hullId: number, vertices: unknown) {
  if (!repo.getHull(hullId)) throw new NotFoundError("HULL_NOT_FOUND", `hull ${hullId} not found`);
  if (!Array.isArray(vertices)) throw new ValidationError("INVALID_VERTICES", "vertices must be an array", "vertices");
  const pts = vertices.map((v, i) => ({
    x: num((v as Point)?.x, `vertices[${i}].x`),
    z: num((v as Point)?.z, `vertices[${i}].z`),
  }));
  const ccw = validateConvexPolygon(pts);
  return repo.addGeometry(hullId, ccw, polygonArea(ccw));
}

export interface ConditionInput {
  hullId: number;
  geometryId?: number;
  length: number;
  mass: number;
  cg: Point;
}

export function createCondition(repo: Repo, input: ConditionInput) {
  if (!repo.getHull(input.hullId)) throw new NotFoundError("HULL_NOT_FOUND", `hull ${input.hullId} not found`);
  const length = num(input.length, "length", { min: 0 });
  const mass = num(input.mass, "mass", { min: 0 });
  const cg = { x: num(input.cg?.x, "cg.x"), z: num(input.cg?.z, "cg.z") };
  const geom = input.geometryId !== undefined
    ? repo.getGeometry(input.geometryId)
    : repo.getLatestGeometry(input.hullId);
  if (!geom || geom.hull_id !== input.hullId) {
    throw new NotFoundError("GEOMETRY_NOT_FOUND", "geometry version not found for this hull");
  }
  ensureCgInside(geom.vertices, cg);
  return repo.createCondition({ hullId: input.hullId, geometryId: geom.id, length, mass, cg });
}

function loadMassParams(repo: Repo, conditionId: number, fluidId: number) {
  const condition = repo.getCondition(conditionId);
  if (!condition) throw new NotFoundError("CONDITION_NOT_FOUND", `condition ${conditionId} not found`);
  const fluid = repo.getFluid(fluidId);
  if (!fluid) throw new NotFoundError("FLUID_NOT_FOUND", `fluid ${fluidId} not found`);
  const geom = repo.getGeometry(condition.geometry_id);
  if (!geom) throw new NotFoundError("GEOMETRY_NOT_FOUND", "frozen geometry missing");
  return {
    condition, fluid, geom,
    params: {
      length: condition.length_m,
      mass: condition.mass_kg,
      cg: { x: condition.cg_x, z: condition.cg_z },
      density: fluid.density,
      gravitationalAcceleration: fluid.g,
    },
  };
}

export function uprightDraft(repo: Repo, conditionId: number, fluidId: number): HeelResult {
  const { geom, params } = loadMassParams(repo, conditionId, fluidId);
  return solveEquilibrium(geom.vertices, 0, params);
}

export function underwaterView(
  repo: Repo, conditionId: number, fluidId: number, heelDeg: number,
): { heelDeg: number; polygon: Point[]; waterlineZ: number; draft: number } {
  const { geom, params } = loadMassParams(repo, conditionId, fluidId);
  const res = solveEquilibrium(geom.vertices, num(heelDeg, "heelDeg") * Math.PI / 180, params);
  return { heelDeg: res.heelDeg, polygon: res.submergedPolygonWorld, waterlineZ: res.waterlineZ, draft: res.draft };
}

export interface ScanInput {
  conditionId: number;
  fluidId: number;
  startDeg: number;
  endDeg: number;
  stepDeg: number;
  idempotencyKey: unknown;
}

export interface ReportResponse {
  reportId: number;
  requestId: number;
  reused: boolean;
  scan: ScanResult;
  snapshot: unknown;
  createdAt: string;
}

/**
 * Runs a scan with idempotency support. Geometry vertices, CG and fluid are
 * snapshotted (frozen) into the report; rescanning with the same key returns
 * the identical stored report and never mutates original vertices.
 */
export function runScan(repo: Repo, input: ScanInput): ReportResponse {
  const start = num(input.startDeg, "startDeg", { min: -180, max: 180, strict: false });
  const end = num(input.endDeg, "endDeg", { min: -180, max: 180, strict: false });
  const step = num(input.stepDeg, "stepDeg", { min: 0 });
  if (!(end > start)) throw new ValidationError("SCAN_INVALID_RANGE", "endDeg must exceed startDeg");
  const key = str(input.idempotencyKey, "idempotencyKey", 200);

  const { conditionId, fluidId } = input;
  const { requestId, created } = repo.createScanRequestIfAbsent({
    idempotencyKey: key, conditionId, fluidId, start, end, step,
  });
  if (!created) {
    const existing = repo.getReportByRequest(requestId);
    if (existing) {
      return {
        reportId: existing.id, requestId, reused: true,
        scan: {
          points: existing.points as HeelResult[],
          equilibria: existing.equilibria as ScanResult["equilibria"],
          maxAbsResidualKg: existing.max_abs_residual_kg,
          nearFullAnglesDeg: existing.near_full as number[],
          fullSubmergedAnglesDeg: existing.full_submerged as number[],
        },
        snapshot: existing.snapshot,
        createdAt: existing.created_at,
      };
    }
  }

  const { geom, condition, fluid, params } = loadMassParams(repo, conditionId, fluidId);
  const scan = scanAngles(geom.vertices, params, { startDeg: start, endDeg: end, stepDeg: step });
  const snapshot = {
    geometryId: geom.id,
    geometryVersion: geom.version,
    vertices: structuredClone(geom.vertices),
    length: condition.length_m,
    mass: condition.mass_kg,
    cg: { x: condition.cg_x, z: condition.cg_z },
    fluid: { id: fluid.id, name: fluid.name, density: fluid.density, g: fluid.g },
    range: { startDeg: start, endDeg: end, stepDeg: step },
  };

  const reportId = repo.transaction(() =>
    repo.saveReport({
      requestId, conditionId, fluidId,
      snapshot, points: scan.points, equilibria: scan.equilibria,
      maxResidual: scan.maxAbsResidualKg,
      nearFull: scan.nearFullAnglesDeg,
      fullSubmerged: scan.fullSubmergedAnglesDeg,
    }));
  const report = repo.getReport(reportId)!;
  return {
    reportId, requestId, reused: false, scan, snapshot,
    createdAt: report.created_at,
  };
}

export { GeometryError };
