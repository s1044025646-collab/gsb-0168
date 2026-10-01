import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDatabase } from "./db.js";
import { baseAnalysis, rectangleVertices } from "./fixtures.js";

const dir = mkdtempSync(join(process.cwd(), ".data", "demo-"));
const db = new AppDatabase(join(dir, "demo.sqlite"), () => new Date("2026-01-01T00:00:00.000Z"));
const geometry = db.createGeometry("demo-rectangle", rectangleVertices);
const input = { ...baseAnalysis(), geometryId: geometry.id, idempotencyKey: "demo-repeatable-001" };
const first = db.createReport(input);
const second = db.createReport(input);
writeFileSync(join(dir, "input.json"), JSON.stringify(input, null, 2));
console.log(JSON.stringify({
  dataDir: dir,
  geometryId: geometry.id,
  reportIds: [first.id, second.id],
  idempotent: first.id === second.id,
  uprightDraft: first.upright.draft,
  uprightResidual: first.upright.displacementResidual,
  equilibriumPoints: first.equilibriumPoints,
  limits: first.limits,
  note: "Discrete sign-change brackets are not a claim that all instability angles have been found."
}, null, 2));
db.close();
