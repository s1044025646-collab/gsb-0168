import type { Point } from "./types.ts";

export const EPS = 1e-10;

export function cross2(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function segmentsIntersect(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d1 = cross2(p3, p4, p1);
  const d2 = cross2(p3, p4, p2);
  const d3 = cross2(p1, p2, p3);
  const d4 = cross2(p1, p2, p4);
  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
      ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) {
    return true;
  }
  return false;
}

function onSegment(a: Point, b: Point, p: Point): boolean {
  if (Math.abs(cross2(a, b, p)) > 1e-7) return false;
  return Math.min(a.x, b.x) - 1e-7 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-7 &&
         Math.min(a.z, b.z) - 1e-7 <= p.z && p.z <= Math.max(a.z, b.z) + 1e-7;
}

export class GeometryError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GeometryError";
    this.code = code;
  }
}

export interface ValidationOptions {
  minArea?: number;
}

/**
 * Validates that vertices define a simple, strictly convex polygon of
 * non-zero area. Collinear consecutive points are tolerated (the polygon
 * stays convex) but fully degenerate input is rejected. Self-intersection
 * and reflex vertices throw GeometryError with a stable code.
 */
export function validateConvexPolygon(input: Point[], opts: ValidationOptions = {}): Point[] {
  if (!Array.isArray(input) || input.length < 3) {
    throw new GeometryError("SECTION_NOT_ENOUGH_VERTICES",
      "a closed section needs at least 3 vertices");
  }
  const pts: Point[] = input.map((p) => {
    if (typeof p?.x !== "number" || typeof p?.z !== "number" || !Number.isFinite(p.x) || !Number.isFinite(p.z)) {
      throw new GeometryError("SECTION_INVALID_VERTEX", "every vertex needs finite numeric x and z");
    }
    return { x: p.x, z: p.z };
  });

  for (let i = 0; i < pts.length - 1; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const pi = pts[i]!;
      const pj = pts[j]!;
      if (Math.abs(pi.x - pj.x) < EPS && Math.abs(pi.z - pj.z) < EPS) {
        throw new GeometryError("SECTION_DUPLICATE_VERTEX", `duplicate vertex at index ${j}`);
      }
    }
  }

  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const c = pts[j]!;
      const d = pts[(j + 1) % n]!;
      if (segmentsIntersect(a, b, c, d)) {
        throw new GeometryError("SECTION_SELF_INTERSECT", "section edges cross; polygon must be simple");
      }
    }
  }

  let orientation = 0;
  for (let i = 0; i < n; i++) {
    const cr = cross2(pts[i]!, pts[(i + 1) % n]!, pts[(i + 2) % n]!);
    if (Math.abs(cr) <= 1e-9) continue;
    const s = cr > 0 ? 1 : -1;
    if (orientation === 0) orientation = s;
    else if (s !== orientation) {
      throw new GeometryError("SECTION_NON_CONVEX", "reflex turn detected; section must be convex");
    }
  }
  if (orientation === 0) {
    throw new GeometryError("SECTION_DEGENERATE", "all vertices are collinear");
  }

  const area = polygonArea(pts);
  const minArea = opts.minArea ?? 1e-9;
  if (!(area >= minArea)) {
    throw new GeometryError("SECTION_ZERO_AREA", "section has zero or negative area");
  }

  return orientation < 0 ? pts.slice().reverse() : pts;
}

/** Positive shoelace area; callers pass CCW polygons. */
export function polygonArea(poly: Point[]): number {
  let twice = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    twice += a.x * b.z - b.x * a.z;
  }
  return twice / 2;
}

/**
 * Signed area, centroid and first moments of a polygon via Green's theorem.
 * Works for any simple polygon (clipped output included).
 */
export function areaAndCentroid(poly: Point[]): { area: number; centroid: Point } {
  let twiceArea = 0;
  let mx = 0;
  let mz = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const cross = a.x * b.z - b.x * a.z;
    twiceArea += cross;
    mx += (a.x + b.x) * cross;
    mz += (a.z + b.z) * cross;
  }
  const area = twiceArea / 2;
  if (Math.abs(area) < EPS) return { area: 0, centroid: { x: NaN, z: NaN } };
  return { area, centroid: { x: mx / (3 * twiceArea), z: mz / (3 * twiceArea) } };
}

export function pointInConvex(poly: Point[], p: Point): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const cr = cross2(poly[i]!, poly[(i + 1) % poly.length]!, p);
    if (Math.abs(cr) <= 1e-9) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function ensureCgInside(poly: Point[], cg: Point): void {
  if (!pointInConvex(poly, cg)) {
    throw new GeometryError("CG_OUTSIDE_SECTION",
      "center of gravity lies outside the section polygon");
  }
}
