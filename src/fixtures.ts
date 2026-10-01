import type { AnalysisInput, Point } from "./types.js";

export const rectangleVertices: Point[] = [
  { x: -2, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }, { x: -2, y: 3 }
];

export const trapezoidVertices: Point[] = [
  { x: -3, y: 0 }, { x: 3, y: 0 }, { x: 2, y: 2 }, { x: -2, y: 2 }
];

export const symmetricVVertices: Point[] = [
  { x: -2, y: 0 }, { x: 0, y: -2 }, { x: 2, y: 0 }, { x: 1.5, y: 1 }, { x: -1.5, y: 1 }
];

export const waterlineTouchVertices: Point[] = [
  { x: -2, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 3 }, { x: -2, y: 2 }
];

export function baseAnalysis(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    geometryId: 1,
    length: 10,
    mass: 120000,
    centerOfGravity: { x: 0, y: 1.2 },
    fluidDensity: 1000,
    minAngleDeg: -30,
    maxAngleDeg: 30,
    angleStepDeg: 5,
    ...overrides
  };
}
