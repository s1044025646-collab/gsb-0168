import type { MassParams, Point, PolygonResult } from "../geometry/types.ts";
import { areaAndCentroid } from "../geometry/polygon.ts";
import { clipBelowWaterline, maxZ, minZ, rotatePoint, rotatePolygon } from "../geometry/transform.ts";
import { GeometryError } from "../geometry/polygon.ts";

export interface SolveOptions {
  maxIterations?: number;
  toleranceKg?: number;
  /** Fraction of total section area considered "nearly fully submerged". */
  nearFullThreshold?: number;
}

export interface HeelResult {
  heelDeg: number;
  draft: number;
  waterlineZ: number;
  submergedArea: number;
  displacedMass: number;
  displacementResidualKg: number;
  centerOfBuoyancyWorld: Point;
  centerOfGravityWorld: Point;
  gz: number;
  restoringMomentPerLength: number;
  submergedPolygonWorld: Point[];
  iterations: number;
  fullSubmerged: boolean;
  nearFullSubmerged: boolean;
}

const TARGET_RESIDUAL = 1e-6;

/**
 * Find the waterline z_w at fixed heel so rho * L * A_sub(z_w) = mass.
 * A_sub is monotone non-decreasing in z_w. Bisection is used so clipping
 * noise cannot break convergence.
 */
export function solveEquilibrium(
  sectionCCW: Point[],
  phiRad: number,
  params: MassParams,
  opts: SolveOptions = {},
): HeelResult {
  const maxIter = opts.maxIterations ?? 80;
  const tol = opts.toleranceKg ?? 1e-6;
  const nearThreshold = opts.nearFullThreshold ?? 0.995;

  const rotated = rotatePolygon(sectionCCW, phiRad);
  const zLow = minZ(rotated);
  const zHigh = maxZ(rotated);
  const { area: totalArea } = areaAndCentroid(rotated);
  const cgWorld = rotatePoint(params.cg, phiRad);

  const submerged = (zw: number): PolygonResult => {
    const poly = clipBelowWaterline(rotated, zw);
    if (poly.length < 3) return { area: 0, centroid: { x: NaN, z: NaN }, polygon: poly };
    const { area, centroid } = areaAndCentroid(poly);
    return { area: Math.abs(area), centroid, polygon: poly };
  };

  const targetArea = params.mass / (params.density * params.length);
  const maxMass = params.density * params.length * totalArea;
  if (params.mass > maxMass * (1 + 1e-9)) {
    throw new GeometryError("MASS_EXCEEDS_FULL_SUBMERGENCE",
      `mass ${params.mass} kg exceeds maximum fully-submerged displacement ${maxMass.toFixed(3)} kg at heel ${(phiRad * 180 / Math.PI).toFixed(2)} deg`);
  }

  let lo = zLow;
  let hi = zHigh;
  let mid = lo;
  let sub: PolygonResult = { area: 0, centroid: { x: NaN, z: NaN }, polygon: [] };
  let iter = 0;
  for (; iter < maxIter; iter++) {
    mid = (lo + hi) / 2;
    sub = submerged(mid);
    const diff = sub.area - targetArea;
    if (Math.abs(diff * params.density * params.length) < tol || (hi - lo) < 1e-12) break;
    if (diff < 0) lo = mid;
    else hi = mid;
  }

  const waterlineZ = mid;
  const displacedMass = params.density * params.length * sub.area;
  const residual = displacedMass - params.mass;
  const draft = waterlineZ - zLow;
  const fraction = totalArea > 0 ? sub.area / totalArea : 1;
  const full = fraction >= 1 - 1e-7;
  const near = fraction >= nearThreshold;
  const gz = sub.area > 0 ? sub.centroid.x - cgWorld.x : NaN;
  const momentPerLength = -params.density * params.gravitationalAcceleration * sub.area * gz;

  return {
    heelDeg: phiRad * 180 / Math.PI,
    draft,
    waterlineZ,
    submergedArea: sub.area,
    displacedMass,
    displacementResidualKg: residual,
    centerOfBuoyancyWorld: sub.centroid,
    centerOfGravityWorld: cgWorld,
    gz,
    restoringMomentPerLength: momentPerLength,
    submergedPolygonWorld: sub.polygon,
    iterations: iter + 1,
    fullSubmerged: full,
    nearFullSubmerged: near,
  };
}

export interface ScanOptions extends SolveOptions {
  startDeg?: number;
  endDeg?: number;
  stepDeg?: number;
}

export interface EquilibriumPoint {
  /** Sample interval bracketing the sign change, degrees. */
  betweenDeg: [number, number];
  gzLeft: number;
  gzRight: number;
  /** Linear interpolation estimate of the zero crossing. */
  estimatedHeelDeg: number;
}

export interface ScanResult {
  points: HeelResult[];
  equilibria: EquilibriumPoint[];
  maxAbsResidualKg: number;
  nearFullAnglesDeg: number[];
  fullSubmergedAnglesDeg: number[];
}

/**
 * Discrete GZ scan. Reported equilibria are ONLY zero crossings found
 * between consecutive samples; they are not a proof that all equilibrium
 * or instability angles exist in the range.
 */
export function scanAngles(sectionCCW: Point[], params: MassParams, opts: ScanOptions = {}): ScanResult {
  const start = opts.startDeg ?? -45;
  const end = opts.endDeg ?? 45;
  const step = opts.stepDeg ?? 5;
  if (!(end > start) || !(step > 0)) {
    throw new GeometryError("SCAN_INVALID_RANGE", "require endDeg > startDeg and stepDeg > 0");
  }

  const points: HeelResult[] = [];
  const steps = Math.round((end - start) / step);
  for (let i = 0; i <= steps; i++) {
    const deg = start + i * step;
    const phi = deg * Math.PI / 180;
    points.push(solveEquilibrium(sectionCCW, phi, params, opts));
  }

  const equilibria: EquilibriumPoint[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (Number.isFinite(a.gz) && Number.isFinite(b.gz) && a.gz * b.gz < 0) {
      const t = a.gz / (a.gz - b.gz);
      equilibria.push({
        betweenDeg: [a.heelDeg, b.heelDeg],
        gzLeft: a.gz,
        gzRight: b.gz,
        estimatedHeelDeg: a.heelDeg + t * (b.heelDeg - a.heelDeg),
      });
    }
  }

  return {
    points,
    equilibria,
    maxAbsResidualKg: points.reduce((m, p) => Math.max(m, Math.abs(p.displacementResidualKg)), 0),
    nearFullAnglesDeg: points.filter((p) => p.nearFullSubmerged).map((p) => p.heelDeg),
    fullSubmergedAnglesDeg: points.filter((p) => p.fullSubmerged).map((p) => p.heelDeg),
  };
}

export { TARGET_RESIDUAL };
