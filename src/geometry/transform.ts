import type { Point } from "./types.ts";
import { EPS } from "./polygon.ts";

/** Rotate a body-frame point into world frame by heel phi (radians). */
export function rotatePoint(p: Point, phi: number): Point {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return { x: p.x * c - p.z * s, z: p.x * s + p.z * c };
}

export function rotatePolygon(poly: Point[], phi: number): Point[] {
  return poly.map((p) => rotatePoint(p, phi));
}

/**
 * Sutherland-Hodgman clip keeping the half-plane z <= waterlineZ.
 * Input may be clockwise after rotation; the formula works regardless.
 * Vertices exactly on the waterline are preserved (boundary case).
 */
export function clipBelowWaterline(poly: Point[], waterlineZ: number): Point[] {
  if (poly.length === 0) return [];
  let out = poly;
  const inside = (p: Point) => p.z <= waterlineZ + EPS;
  const intersect = (a: Point, b: Point): Point => {
    const t = (waterlineZ - a.z) / (b.z - a.z);
    return { x: a.x + t * (b.x - a.x), z: waterlineZ };
  };

  const next: Point[] = [];
  let prev = out[out.length - 1]!;
  let prevInside = inside(prev);
  for (const cur of out) {
    const curInside = inside(cur);
    if (curInside) {
      if (!prevInside) next.push(intersect(prev, cur));
      next.push(cur);
    } else if (prevInside) {
      next.push(intersect(prev, cur));
    }
    prev = cur;
    prevInside = curInside;
  }
  out = next;
  return dedupe(out);
}

function dedupe(poly: Point[]): Point[] {
  const res: Point[] = [];
  for (const p of poly) {
    const last = res[res.length - 1];
    if (!last || Math.abs(last.x - p.x) > EPS || Math.abs(last.z - p.z) > EPS) {
      res.push(p);
    }
  }
  if (res.length >= 2) {
    const first = res[0]!;
    const last = res[res.length - 1]!;
    if (Math.abs(first.x - last.x) <= EPS && Math.abs(first.z - last.z) <= EPS) res.pop();
  }
  return res;
}

export function minZ(poly: Point[]): number {
  return poly.reduce((m, p) => Math.min(m, p.z), Infinity);
}

export function maxZ(poly: Point[]): number {
  return poly.reduce((m, p) => Math.max(m, p.z), -Infinity);
}
