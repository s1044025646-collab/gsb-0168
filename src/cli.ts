#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AppDatabase } from "./db.js";
import { analyzeAngle, findFloatCondition, rotatePoint } from "./geometry.js";
import { baseAnalysis, rectangleVertices } from "./fixtures.js";
import type { Report } from "./types.js";

const dbPath = process.env.HYDRO_DB_PATH ?? join(process.cwd(), ".data", "hydro-cli.sqlite");
const db = new AppDatabase(dbPath);
const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "import-fixture": {
      const before = db.listGeometries(1, 0).items[0] ?? null;
      const geometry = db.createGeometry(args[0] ?? "fixture-rectangle", rectangleVertices);
      printState({ before: before?.id ?? null, after: geometry.id, action: "imported fixture geometry" }, geometry);
      break;
    }
    case "import": {
      const file = requireArg(args[0], "usage: cli import <file> [name]");
      const payload = JSON.parse(readFileSync(file, "utf8")) as { name?: string; vertices?: unknown };
      const geometry = db.createGeometry(args[1] ?? payload.name ?? "imported-section", payload.vertices);
      printState({ action: "imported geometry" }, geometry);
      break;
    }
    case "upright": {
      const input = readAnalysis(args[0]);
      const before = db.getGeometry(input.geometryId);
      const report = db.createReport({ ...input, minAngleDeg: 0, maxAngleDeg: 0.0001, angleStepDeg: 0.0001 });
      printState({ action: "upright equilibrium", geometryBefore: before?.name }, report.upright);
      break;
    }
    case "scan": {
      const input = readAnalysis(args[0]);
      const report = db.createReport(input);
      printState({
        action: "angle scan",
        reportId: report.id,
        equilibriumPoints: report.equilibriumPoints,
        limits: report.limits
      }, report.samples.map((sample) => ({
        angleDeg: sample.angleDeg,
        draft: round(sample.draft),
        gz: round(sample.gz),
        residual: round(sample.displacementResidual),
        limited: sample.limited
      })));
      break;
    }
    case "underwater": {
      const reportId = Number(args[0]);
      const angleDeg = Number(args[1]);
      const report = db.requireReport(reportId);
      const result = findFloatCondition({
        verticesBody: report.frozenVertices,
        angleDeg,
        mass: report.parameters.mass,
        fluidDensity: report.parameters.fluidDensity,
        length: report.parameters.length,
        centerOfGravityBody: report.parameters.centerOfGravity
      });
      printState({ action: "frozen underwater polygon", reportId, angleDeg, waterlineY: result.draft }, result.submerged);
      break;
    }
    case "compare-cg": {
      const input = readAnalysis(args[0]);
      const shiftedX = Number(args[1] ?? "0.2");
      const shiftedY = Number(args[2] ?? "0");
      const original = db.createReport({ ...input, idempotencyKey: `cg-a-${stableKey(input)}` });
      const shifted = db.createReport({
        ...input,
        idempotencyKey: `cg-b-${stableKey(input)}-${shiftedX}-${shiftedY}`,
        centerOfGravity: { x: input.centerOfGravity.x + shiftedX, y: input.centerOfGravity.y + shiftedY }
      });
      printState({ action: "compare center of gravity", shiftedBy: { x: shiftedX, y: shiftedY } }, {
        original: summarize(original),
        shifted: summarize(shifted)
      });
      break;
    }
    case "export-curve": {
      const report = db.requireReport(Number(args[0]));
      const output = args[1] ?? join(process.cwd(), ".data", `gz-curve-${report.id}.json`);
      const curve = report.samples.map((sample) => ({ angleDeg: sample.angleDeg, gz: sample.gz, draft: sample.draft }));
      writeFileSync(output, JSON.stringify({ convention: gzConvention(), curve }, null, 2));
      printState({ action: "exported curve", reportId: report.id, output }, curve.length);
      break;
    }
    default:
      console.log(["import-fixture [name]", "import <file> [name]", "upright <input.json>", "scan <input.json>", "underwater <reportId> <angle>", "compare-cg <input.json> [dx] [dy]", "export-curve <reportId> [output]"].join("\n"));
  }
} finally {
  db.close();
}

function requireArg(value: string | undefined, message: string): string {
  if (!value) throw new Error(message);
  return value;
}

function readAnalysis(file: string | undefined) {
  if (!file) throw new Error("usage: input JSON file is required");
  return JSON.parse(readFileSync(file, "utf8"));
}

function stableKey(input: object): string {
  return Buffer.from(JSON.stringify(input)).toString("base64url").slice(0, 72);
}

function summarize(report: Report) {
  return {
    reportId: report.id,
    uprightDraft: round(report.upright.draft),
    gz: report.samples.map((sample) => ({ angleDeg: sample.angleDeg, gz: round(sample.gz) }))
  };
}

function round(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(9)) : value;
}

function gzConvention(): string {
  return "body +x starboard, body +y upward; positive heel is clockwise; GZ>0 means buoyancy is on low/starboard side and creates restoring moment";
}

function printState(state: object, result: unknown): void {
  console.log(JSON.stringify({ state, result }, null, 2));
}

void analyzeAngle;
void rotatePoint;
void baseAnalysis;
