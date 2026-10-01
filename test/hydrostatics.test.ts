import { test } from "node:test";
import assert from "node:assert/strict";
import { validateConvexPolygon, GeometryError } from "../src/geometry/polygon.ts";
import { rectangle } from "../src/geometry/fixtures.ts";
import { scanAngles, solveEquilibrium } from "../src/analysis/hydrostatics.ts";
import type { MassParams } from "../src/geometry/types.ts";

const params: MassParams = {
  length: 10, mass: 32000, cg: { x: 0, z: 0.8 },
  density: 1000, gravitationalAcceleration: 9.81,
};

test("upright rectangular draft matches analytic result m/(rho L b)", () => {
  const section = validateConvexPolygon(rectangle(4, 2));
  const r = solveEquilibrium(section, 0, params);
  const analytic = params.mass / (params.density * params.length * 4);
  assert.ok(Math.abs(r.draft - analytic) < 1e-8, `draft ${r.draft} vs ${analytic}`);
  assert.ok(Math.abs(r.displacementResidualKg) < 1e-4);
});

test("small-angle GZ cross-check against metacentric formula GZ = GM sin(phi)", () => {
  // Rectangular waterplane: BM = I_T/V = (L B^3/12)/(L B d) = B^2/(12d)
  const B = 4;
  const d = params.mass / (params.density * params.length * B);
  const KB = d / 2;
  const KG = params.cg.z;
  const BM = (B * B) / (12 * d);
  const GM = KB + BM - KG;
  const section = validateConvexPolygon(rectangle(B, 4));
  for (const deg of [0.5, 1, 2]) {
    const phi = deg * Math.PI / 180;
    const r = solveEquilibrium(section, phi, params);
    const expected = -GM * Math.sin(phi);
    assert.ok(Math.abs(r.gz - expected) < 2e-4,
      `phi=${deg}: GZ ${r.gz} vs meta ${expected}`);
  }
});

test("doubling density and mass together leaves draft and GZ unchanged", () => {
  const section = validateConvexPolygon(rectangle(4, 3));
  const phi = 10 * Math.PI / 180;
  const a = solveEquilibrium(section, phi, params);
  const b = solveEquilibrium(section, phi, { ...params, density: 2000, mass: 64000 });
  assert.ok(Math.abs(a.draft - b.draft) < 1e-9);
  assert.ok(Math.abs(a.gz - b.gz) < 1e-9);
});

test("symmetric section with centered CG: GZ is odd in heel angle", () => {
  const section = validateConvexPolygon(rectangle(4, 3));
  const scan = scanAngles(section, params, { startDeg: -20, endDeg: 20, stepDeg: 10 });
  const at = (deg: number) => scan.points.find((p) => Math.abs(p.heelDeg - deg) < 1e-9)!.gz;
  assert.ok(Math.abs(at(0)) < 1e-10);
  for (const deg of [10, 20]) {
    assert.ok(Math.abs(at(deg) + at(-deg)) < 1e-9, `odd GZ failed at ${deg}`);
  }
});

test("lateral CG offset shifts the equilibrium heel toward the heavy side", () => {
  const section = validateConvexPolygon(rectangle(4, 3));
  const p: MassParams = { ...params, cg: { x: 0.2, z: 0.8 } };
  const upright = solveEquilibrium(section, 0, p);
  assert.ok(Math.abs(upright.gz + 0.2) < 1e-9, "GZ(0) = xB - xG = -0.2");
  // Starboard-heavy CG => equilibrium is starboard-down => negative heel (positive heel = starboard up).
  const scan = scanAngles(section, p, { startDeg: -30, endDeg: 30, stepDeg: 2 });
  const eq = scan.equilibria.find((e) => Math.abs(e.estimatedHeelDeg) > 1e-9);
  assert.ok(eq, "expected a non-zero equilibrium angle");
  assert.ok(eq!.estimatedHeelDeg < 0, `expected negative equilibrium heel, got ${eq!.estimatedHeelDeg}`);
});

test("numerical convergence tightens with more bisection iterations", () => {
  const section = validateConvexPolygon(rectangle(4, 2));
  const coarse = solveEquilibrium(section, 0, params, { maxIterations: 10, toleranceKg: 0 });
  const fine = solveEquilibrium(section, 0, params, { maxIterations: 70, toleranceKg: 0 });
  assert.ok(Math.abs(fine.displacementResidualKg) < Math.abs(coarse.displacementResidualKg) + 1e-12);
  assert.ok(Math.abs(fine.displacementResidualKg) < 1e-7);
});

test("mass beyond full submersion is rejected, near-full reported", () => {
  const section = validateConvexPolygon(rectangle(4, 2));
  const heavy: MassParams = { ...params, mass: 100 * 1000 * params.length };
  assert.throws(
    () => solveEquilibrium(section, 0, heavy),
    (e: Error) => e instanceof GeometryError && e.code === "MASS_EXCEEDS_FULL_SUBMERGENCE",
  );
  const almost: MassParams = { ...params, mass: 0.997 * params.density * params.length * 8 };
  const r = solveEquilibrium(section, 0, almost);
  assert.ok(r.nearFullSubmerged);
  assert.ok(!r.fullSubmerged);
});

test("equilibrium zero crossings are bracketed, not claimed exhaustive", () => {
  const section = validateConvexPolygon(rectangle(4, 3));
  const p: MassParams = { ...params, cg: { x: 0.15, z: 3.5 } };
  const scan = scanAngles(section, p, { startDeg: -60, endDeg: 60, stepDeg: 5 });
  assert.ok(scan.equilibria.length >= 1);
  for (const e of scan.equilibria) {
    assert.ok(Math.sign(e.gzLeft) !== Math.sign(e.gzRight));
    assert.ok(e.estimatedHeelDeg >= e.betweenDeg[0] && e.estimatedHeelDeg <= e.betweenDeg[1]);
  }
});
