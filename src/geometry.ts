import type { Point, Sample } from "./types.js";

export const EPS = 1e-10;
export const FULL_IMMERSION_WARNING_RATIO = 0.995;

export function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validatePoint(point: unknown, label: string): Point {
  if (!point || typeof point !== "object") throw new ValidationError(`${label} must be an object`, "INVALID_POINT");
  const candidate = point as Record<string, unknown>;
  if (!finiteNumber(candidate.x) || !finiteNumber(candidate.y)) {
    throw new ValidationError(`${label}.x and ${label}.y must be finite numbers`, "INVALID_POINT");
  }
  return { x: candidate.x, y: candidate.y };
}

export class ValidationError extends Error {
  code = "VALIDATION_ERROR";
  status = 400;
  constructor(message: string, readonly errorCode = "VALIDATION_ERROR") {
    super(message);
  }
}

export class GeometryError extends Error {
  code = "GEOMETRY_ERROR";
  status = 422;
  constructor(message: string, readonly errorCode: "SELF_INTERSECTING" | "NON_CONVEX" | "ZERO_AREA" | "INVALID_GEOMETRY") {
    super(message);
  }
}

export function validateConvexPolygon(input: unknown): Point[] {
  if (!Array.isArray(input) || input.length < 3) {
    throw new GeometryError("section requires at least three vertices", "INVALID_GEOMETRY");
  }
  const points = input.map((point, index) => validatePoint(point, `vertices[${index}]`));
  const n = points.length;

  for (let i = 0; i < n; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % n]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) <= EPS) {
      throw new GeometryError("section contains duplicate adjacent vertices", "INVALID_GEOMETRY");
    }
  }

  if (segmentsIntersect(points)) {
    throw new GeometryError("self-intersecting sections are not supported", "SELF_INTERSECTING");
  }

  let positive = 0;
  let negative = 0;
  for (let i = 0; i < n; i += 1) {
    const cross = crossProduct(points[(i + n - 1) % n]!, points[i]!, points[(i + 1) % n]!);
    if (cross > EPS) positive += 1;
    if (cross < -EPS) negative += 1;
    if (positive > 0 && negative > 0) {
      throw new GeometryError("non-convex sections are not supported", "NON_CONVEX");
    }
  }

  const area = polygonArea(points);
  if (!(Math.abs(area) > EPS)) throw new GeometryError("zero-area sections are not supported", "ZERO_AREA");
  return points;
}

function segmentsIntersect(points: Point[]): boolean {
  const n = points.length;
  const segments = points.map((a, i) => [a, points[(i + 1) % n]!] as const);
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const adjacent = i === 0 && j === n - 1;
      if (j === i + 1 || adjacent) {
        continue;
      }
      if (segmentIntersects(segments[i]![0]!, segments[i]![1]!, segments[j]![0]!, segments[j]![1]!)) return true;
    }
  }
  return false;
}

function segmentIntersects(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = crossProduct(a, b, c);
  const o2 = crossProduct(a, b, d);
  const o3 = crossProduct(c, d, a);
  const o4 = crossProduct(c, d, b);
  if (o1 * o2 < -EPS && o3 * o4 < -EPS) return true;
  return onSegment(a, b, c, o1) || onSegment(a, b, d, o2) || onSegment(c, d, a, o3) || onSegment(c, d, b, o4);
}

function onSegment(a: Point, b: Point, point: Point, orientation: number): boolean {
  if (Math.abs(orientation) > EPS) return false;
  return Math.min(a.x, b.x) - EPS <= point.x && point.x <= Math.max(a.x, b.x) + EPS &&
    Math.min(a.y, b.y) - EPS <= point.y && point.y <= Math.max(a.y, b.y) + EPS;
}

function crossProduct(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}


export function polygonArea(points: Point[]): number {
  let twiceArea = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return twiceArea / 2;
}

export function rotatePoint(point: Point, angleRad: number): Point {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return { x: point.x * cos + point.y * sin, y: -point.x * sin + point.y * cos };
}

export function inverseRotatePoint(point: Point, angleRad: number): Point {
  return rotatePoint(point, -angleRad);
}

export function clipBelowWaterline(points: Point[], waterlineY: number): Point[] {
  const inside = (point: Point) => point.y <= waterlineY + EPS;
  const output: Point[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i]!;
    const previous = points[(i + points.length - 1) % points.length]!;
    const currentInside = inside(current);
    const previousInside = inside(previous);
    if (currentInside) {
      if (!previousInside) output.push(intersection(previous, current, waterlineY));
      output.push(current);
    } else if (previousInside) {
      output.push(intersection(previous, current, waterlineY));
    }
  }
  return output.length >= 3 ? output : [];
}

function intersection(a: Point, b: Point, waterlineY: number): Point {
  if (Math.abs(b.y - a.y) <= EPS) return { x: a.x, y: waterlineY };
  const ratio = (waterlineY - a.y) / (b.y - a.y);
  return { x: a.x + ratio * (b.x - a.x), y: waterlineY };
}

export function areaCentroid(points: Point[]): { area: number; centroid: Point } {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  const signedArea = twiceArea / 2;
  if (Math.abs(signedArea) <= EPS) return { area: 0, centroid: { x: 0, y: 0 } };
  return { area: Math.abs(signedArea), centroid: { x: cx / (6 * signedArea), y: cy / (6 * signedArea) } };
}

export function bounds(points: Point[]): { minX: number; maxX: number; minY: number; maxY: number } {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y))
  };
}

export type FloatResult = {
  draft: number;
  submerged: Point[];
  area: number;
  centroidWorld: Point;
  centroidBody: Point;
  targetArea: number;
  fullArea: number;
  nearFullImmersion: boolean;
  capacityExceeded: boolean;
};

export function findFloatCondition(params: {
  verticesBody: Point[];
  angleDeg: number;
  mass: number;
  fluidDensity: number;
  length: number;
  centerOfGravityBody: Point;
}): FloatResult {
  const angleRad = params.angleDeg * Math.PI / 180;
  const rotated = params.verticesBody.map((p) => rotatePoint(p, angleRad));
  const box = bounds(rotated);
  const fullArea = Math.abs(polygonArea(rotated));
  const targetArea = params.mass / (params.fluidDensity * params.length);
  const capacityExceeded = targetArea > fullArea * (1 + 1e-9);
  const nearFullImmersion = targetArea >= fullArea * FULL_IMMERSION_WARNING_RATIO;
  if (capacityExceeded) {
    return {
      draft: Number.NaN,
      submerged: [],
      area: fullArea,
      centroidWorld: { x: 0, y: 0 },
      centroidBody: { x: 0, y: 0 },
      targetArea,
      fullArea,
      nearFullImmersion,
      capacityExceeded
    };
  }

  const areaAt = (draft: number) => areaCentroid(clipBelowWaterline(rotated, draft)).area;
  let low = box.minY;
  let high = box.maxY;
  if (areaAt(low) > targetArea + 1e-8) low -= 1;
  for (let i = 0; i < 70; i += 1) {
    const middle = (low + high) / 2;
    if (areaAt(middle) < targetArea) low = middle;
    else high = middle;
  }
  const draft = (low + high) / 2;
  const submerged = clipBelowWaterline(rotated, draft);
  const { area, centroid: centroidWorld } = areaCentroid(submerged);
  return {
    draft,
    submerged,
    area,
    centroidWorld,
    centroidBody: inverseRotatePoint(centroidWorld, angleRad),
    targetArea,
    fullArea,
    nearFullImmersion,
    capacityExceeded: false
  };
}

export function analyzeAngle(args: {
  verticesBody: Point[];
  angleDeg: number;
  mass: number;
  fluidDensity: number;
  length: number;
  centerOfGravityBody: Point;
}): Sample {
  const angleRad = args.angleDeg * Math.PI / 180;
  const flotation = findFloatCondition(args);
  const displacedMass = flotation.area * args.length * args.fluidDensity;
  const gWorld = rotatePoint(args.centerOfGravityBody, angleRad);
  const relativeBody = {
    x: flotation.centroidBody.x - args.centerOfGravityBody.x,
    y: flotation.centroidBody.y - args.centerOfGravityBody.y
  };
  const relativeWorld = rotatePoint(relativeBody, angleRad);
  const limited = flotation.capacityExceeded || flotation.nearFullImmersion;
  return {
    angleDeg: args.angleDeg,
    draft: flotation.draft,
    submergedArea: flotation.area,
    displacedMass,
    displacementResidual: displacedMass - args.mass,
    centroidBody: flotation.centroidBody,
    centerOfBuoyancyWorld: flotation.centroidWorld,
    centerOfGravityWorld: gWorld,
    gz: flotation.capacityExceeded ? Number.NaN : relativeWorld.x,
    nearFullImmersion: flotation.nearFullImmersion,
    limited
  };
}
