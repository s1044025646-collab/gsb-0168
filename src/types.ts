export type Point = { x: number; y: number };

export type Geometry = {
  id: number;
  name: string;
  vertices: Point[];
  createdAt: string;
};

export type CenterOfGravity = Point;

export type AnalysisInput = {
  geometryId: number;
  length: number;
  mass: number;
  centerOfGravity: CenterOfGravity;
  fluidDensity: number;
  minAngleDeg: number;
  maxAngleDeg: number;
  angleStepDeg: number;
  idempotencyKey?: string;
};

export type Sample = {
  angleDeg: number;
  draft: number;
  submergedArea: number;
  displacedMass: number;
  displacementResidual: number;
  centroidBody: Point;
  centerOfBuoyancyWorld: Point;
  centerOfGravityWorld: Point;
  gz: number;
  nearFullImmersion: boolean;
  limited: boolean;
};

export type EquilibriumPoint = {
  angleDeg: number;
  gz: number;
  residual: number;
  kind: "sample" | "sign-change-bracket";
  bracket?: [number, number];
};

export type Report = {
  id: number;
  idempotencyKey: string | null;
  geometryId: number;
  geometryVersionAtScan: number;
  geometryName: string;
  frozenVertices: Point[];
  parameters: Omit<AnalysisInput, "geometryId" | "idempotencyKey">;
  upright: Sample;
  samples: Sample[];
  equilibriumPoints: EquilibriumPoint[];
  limits: string[];
  createdAt: string;
};

export type Page<T> = {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
};
