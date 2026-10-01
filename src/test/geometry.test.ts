import assert from "node:assert/strict";
import test from "node:test";
import { areaCentroid, clipBelowWaterline, findFloatCondition, rotatePoint, validateConvexPolygon } from "../geometry.js";
import { rectangleVertices, symmetricVVertices, trapezoidVertices, waterlineTouchVertices } from "../fixtures.js";

test("rectangle upright area moments match analytic immersion", () => {
  const result = findFloatCondition({ verticesBody: rectangleVertices, angleDeg: 0, mass: 120000, fluidDensity: 1000, length: 10, centerOfGravityBody: { x: 0, y: 1 } });
  assert.ok(Math.abs(result.draft - 3) < 1e-8);
  assert.ok(Math.abs(result.area - 12) < 1e-8);
  assert.ok(Math.abs(result.centroidWorld.x) < 1e-10);
  assert.ok(Math.abs(result.centroidWorld.y - 1.5) < 1e-8);
});

test("small-angle rectangular metacentric GZ is close to BM minus BG", () => {
  const kg = 1.2;
  const result = findFloatCondition({ verticesBody: rectangleVertices, angleDeg: 1, mass: 80000, fluidDensity: 1000, length: 10, centerOfGravityBody: { x: 0, y: kg } });
  const draft = 2;
  const beam = 4;
  const bm = beam * beam / (12 * draft);
  const bg = draft / 2 - kg;
  const angle = Math.PI / 180;
  const expected = (bm + bg) * angle;
  const angleRad = angle;
  const g = rotatePoint({ x: 0, y: kg }, angleRad);
  const gz = result.centroidWorld.x - g.x;
  assert.ok(Math.abs(gz - expected) < 2e-5, `gz=${gz}, expected=${expected}`);
});

test("left-right symmetry gives zero upright centroid x offset", () => {
  for (const vertices of [rectangleVertices, trapezoidVertices, symmetricVVertices, waterlineTouchVertices]) {
    const result = findFloatCondition({ verticesBody: vertices, angleDeg: 0, mass: 10000, fluidDensity: 1000, length: 10, centerOfGravityBody: { x: 0, y: 0 } });
    assert.ok(Math.abs(result.centroidWorld.x) < 1e-9);
  }
});

test("density and mass scaled together preserve draft and centroid", () => {
  const a = findFloatCondition({ verticesBody: rectangleVertices, angleDeg: 5, mass: 1000, fluidDensity: 1000, length: 10, centerOfGravityBody: { x: 0, y: 1 } });
  const b = findFloatCondition({ verticesBody: rectangleVertices, angleDeg: 5, mass: 2000, fluidDensity: 2000, length: 10, centerOfGravityBody: { x: 0, y: 1 } });
  assert.ok(Math.abs(a.draft - b.draft) < 1e-10);
  assert.deepEqual(a.centroidBody, b.centroidBody);
});

test("waterline exactly through vertices clips a closed polygon", () => {
  const clipped = clipBelowWaterline(rectangleVertices, 0);
  const { area } = areaCentroid(clipped);
  assert.equal(clipped.length, 4);
  assert.ok(Math.abs(area) < 1e-10);
  const touched = clipBelowWaterline(waterlineTouchVertices, 1);
  assert.ok(touched.length >= 3);
});

test("rejects invalid polygons and excessive mass", () => {
  assert.throws(() => validateConvexPolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]), /zero-area/);
  assert.throws(() => validateConvexPolygon([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 0, y: 2 }]), /non-convex/);
  const overloaded = findFloatCondition({ verticesBody: rectangleVertices, angleDeg: 0, mass: 1000000, fluidDensity: 1000, length: 10, centerOfGravityBody: { x: 0, y: 1 } });
  assert.equal(overloaded.capacityExceeded, true);
  assert.ok(Number.isNaN(overloaded.draft));
});

test("convergence improves with repeated bisection range", () => {
  const result = findFloatCondition({ verticesBody: rectangleVertices, angleDeg: 10, mass: 120000, fluidDensity: 1000, length: 10, centerOfGravityBody: { x: 0, y: 1 } });
  assert.ok(Math.abs(result.area * 10000 - 120000) < 1e-4);
});
