import { test } from "node:test";
import assert from "node:assert/strict";
import { areaAndCentroid, polygonArea, validateConvexPolygon, GeometryError, ensureCgInside } from "../src/geometry/polygon.ts";
import { clipBelowWaterline, rotatePoint, rotatePolygon } from "../src/geometry/transform.ts";
import { rectangle, symmetricV, trapezoid } from "../src/geometry/fixtures.ts";

test("rectangle area and centroid via moments", () => {
  const r = validateConvexPolygon(rectangle(4, 2));
  assert.ok(polygonArea(r) > 0, "normalized to CCW");
  const { area, centroid } = areaAndCentroid(r);
  assert.ok(Math.abs(area - 8) < 1e-12);
  assert.ok(Math.abs(centroid.x) < 1e-12);
  assert.ok(Math.abs(centroid.z - 1) < 1e-12);
});

test("clipping half of a rectangle gives half area with shifted centroid", () => {
  const r = validateConvexPolygon(rectangle(4, 2));
  const half = clipBelowWaterline(r, 1);
  const { area, centroid } = areaAndCentroid(half);
  assert.ok(Math.abs(area - 4) < 1e-10);
  assert.ok(Math.abs(centroid.z - 0.5) < 1e-10);
  assert.ok(Math.abs(centroid.x) < 1e-10);
});

test("waterline exactly through a vertex keeps that vertex", () => {
  const r = validateConvexPolygon(rectangle(4, 2));
  const poly = clipBelowWaterline(r, 2);
  assert.equal(poly.length, 4);
  assert.ok(poly.some((p) => Math.abs(p.z - 2) < 1e-9));
  const none = clipBelowWaterline(r, -1);
  assert.equal(none.length, 0);
});

test("left-right symmetry: centroid x is zero for symmetric sections", () => {
  for (const poly of [rectangle(3, 5), trapezoid(2, 4, 3), symmetricV(6, 2)]) {
    const ccw = validateConvexPolygon(poly);
    const c1 = areaAndCentroid(clipBelowWaterline(ccw, 1.5)).centroid;
    const flipped = ccw.map((p) => ({ x: -p.x, z: p.z }));
    const c2 = areaAndCentroid(clipBelowWaterline(flipped, 1.5)).centroid;
    assert.ok(Math.abs(c1.x + c2.x) < 1e-9);
    assert.ok(Math.abs(c1.x) < 1e-9);
  }
});

test("rotation: CG moves with hull, never fixed in world frame", () => {
  const cg = { x: 0, z: 1 };
  const moved = rotatePoint(cg, Math.PI / 2);
  assert.ok(Math.abs(moved.x - -1) < 1e-12);
  assert.ok(Math.abs(moved.z) < 1e-12);
  const verts = rotatePolygon([{ x: 1, z: 0 }], Math.PI);
  assert.ok(Math.abs(verts[0]!.x + 1) < 1e-12);
});

test("rejects self-intersecting bowtie", () => {
  assert.throws(
    () => validateConvexPolygon([{ x: 0, z: 0 }, { x: 2, z: 2 }, { x: 0, z: 2 }, { x: 2, z: 0 }]),
    (e: Error) => e instanceof GeometryError && e.code === "SECTION_SELF_INTERSECT",
  );
});

test("rejects non-convex, collinear (zero area) and duplicate vertex input", () => {
  assert.throws(
    () => validateConvexPolygon([{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 1, z: 1 }, { x: 2, z: 2 }, { x: 0, z: 2 }]),
    (e: Error) => e instanceof GeometryError && e.code === "SECTION_NON_CONVEX",
  );
  assert.throws(
    () => validateConvexPolygon([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }]),
    (e: Error) => e instanceof GeometryError && e.code === "SECTION_DEGENERATE",
  );
  assert.throws(
    () => validateConvexPolygon([{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 1, z: 1 }]),
    (e: Error) => e instanceof GeometryError && e.code === "SECTION_DUPLICATE_VERTEX",
  );
});

test("CG must lie inside section", () => {
  const r = validateConvexPolygon(rectangle(2, 2));
  assert.doesNotThrow(() => ensureCgInside(r, { x: 0, z: 1 }));
  assert.throws(() => ensureCgInside(r, { x: 5, z: 5 }), (e: unknown) => (e as GeometryError).code === "CG_OUTSIDE_SECTION");
});
