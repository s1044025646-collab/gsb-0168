import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDatabase, ConflictError } from "../db.js";
import { baseAnalysis, rectangleVertices } from "../fixtures.js";

function tempDb(clock: () => Date = () => new Date("2026-01-01T00:00:00Z")) {
  const dir = mkdtempSync(join(tmpdir(), "hydro-"));
  return new AppDatabase(join(dir, "test.sqlite"), clock);
}

test("freezes geometry, CG and fluid parameters in report", () => {
  const db = tempDb();
  const geometry = db.createGeometry("rect", rectangleVertices);
  const input = { ...baseAnalysis(), geometryId: geometry.id, idempotencyKey: "freeze-test-0001" };
  const report = db.createReport(input);
  assert.deepEqual(report.frozenVertices, rectangleVertices);
  assert.deepEqual(report.parameters.centerOfGravity, input.centerOfGravity);
  assert.equal(report.parameters.fluidDensity, input.fluidDensity);
  db.close();
});

test("duplicate idempotency key returns same report", () => {
  const db = tempDb();
  const geometry = db.createGeometry("rect", rectangleVertices);
  const input = { ...baseAnalysis(), geometryId: geometry.id, idempotencyKey: "same-key-0000001" };
  assert.equal(db.createReport(input).id, db.createReport(input).id);
  db.close();
});

test("rolls back invalid transaction and preserves prior rows", () => {
  const db = tempDb();
  db.createGeometry("rect", rectangleVertices);
  assert.throws(() => db.transaction(() => {
    db.db.exec("INSERT INTO geometries(name, vertices_json, created_at) VALUES ('x', 'not-json', 't')");
  }));
  assert.equal(db.listGeometries(10, 0).items.length, 1);
  db.close();
});

test("persists after reopening and migrations are repeatable", () => {
  const dir = mkdtempSync(join(tmpdir(), "hydro-persist-"));
  const path = join(dir, "test.sqlite");
  const first = new AppDatabase(path);
  const geometry = first.createGeometry("rect", rectangleVertices);
  const report = first.createReport({ ...baseAnalysis(), geometryId: geometry.id });
  first.close();
  const second = new AppDatabase(path);
  second.migrate();
  assert.equal(second.requireGeometry(geometry.id).name, "rect");
  assert.equal(second.requireReport(report.id).id, report.id);
  second.close();
});

test("supports pagination", () => {
  const db = tempDb();
  for (let i = 0; i < 3; i += 1) db.createGeometry(`g${i}`, rectangleVertices);
  const page = db.listGeometries(2, 0);
  assert.equal(page.items.length, 2);
  assert.equal(page.hasMore, true);
  db.close();
});

void ConflictError;
