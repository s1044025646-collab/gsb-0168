import type { Point } from "./types.ts";

/** Rectangle centred on x, with keel at z=0, beam b, depth d. */
export function rectangle(b: number, d: number): Point[] {
  return [
    { x: -b / 2, z: 0 },
    { x: b / 2, z: 0 },
    { x: b / 2, z: d },
    { x: -b / 2, z: d },
  ];
}

/** Symmetric trapezoid: bottom beam b0, deck beam b1, depth d. */
export function trapezoid(b0: number, b1: number, d: number): Point[] {
  return [
    { x: -b0 / 2, z: 0 },
    { x: b0 / 2, z: 0 },
    { x: b1 / 2, z: d },
    { x: -b1 / 2, z: d },
  ];
}

/** Symmetric V section: half-angle implied by beam b and depth d. */
export function symmetricV(b: number, d: number): Point[] {
  return [
    { x: 0, z: 0 },
    { x: b / 2, z: d },
    { x: -b / 2, z: d },
  ];
}

/** Rectangle shifted so the given vertex lands exactly at the upright
 * waterline for mass m at density rho and length L (test boundary case). */
export function rectangleWithVertexAtWaterline(
  b: number,
  d: number,
  length: number,
  mass: number,
  density: number,
): { vertices: Point[]; draft: number } {
  const draft = mass / (density * length * b);
  // Place a vertex at (b/2, draft): depth equals draft so deck corner is on waterline.
  const vertices = rectangle(b, draft);
  return { vertices, draft };
}
