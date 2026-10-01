import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Repo, openDatabase } from "../src/db/repo.ts";
import { applyMigrations } from "../src/db/schema.ts";
import { rectangle } from "../src/geometry/fixtures.ts";
import { createCondition, importGeometry, runScan } from "../src/analysis/service.ts";
import { DatabaseSync } from "node:sqlite";

let dbPath: string;

beforeEach(() => {
  dbPath = join(tmpdir(), `phh-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
});

afterEach(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(dbPath + suffix); } catch { /* ignore */ }
  }
});

test("migrations are idempotent and repeatable", () => {
  const db = openDatabase(dbPath);
  applyMigrations(db);
  applyMigrations(db);
  const row = db.prepare("SELECT value FROM schema_meta WHERE key='version'").get() as { value: string };
  assert.equal(Number(row.value), 1);
  db.close();
});

test("report freezes vertices/CG/fluid; later geometry version does not change it", () => {
  const repo = new Repo(openDatabase(dbPath));
  const hull = repo.createHull("h");
  const g1 = importGeometry(repo, hull.id, rectangle(4, 2));
  const fluid = repo.upsertFluid("w", 1000, 9.81);
  const cond = createCondition(repo, { hullId: hull.id, length: 10, mass: 32000, cg: { x: 0, z: 0.8 } });
  const first = runScan(repo, {
    conditionId: cond.id, fluidId: fluid.id,
    startDeg: -10, endDeg: 10, stepDeg: 5, idempotencyKey: "k1",
  });
  importGeometry(repo, hull.id, rectangle(6, 3));
  const again = runScan(repo, {
    conditionId: cond.id, fluidId: fluid.id,
    startDeg: -10, endDeg: 10, stepDeg: 5, idempotencyKey: "k1",
  });
  assert.equal(again.reused, true);
  assert.equal(again.reportId, first.reportId);
  assert.deepEqual((again.snapshot as { vertices: unknown }).vertices, g1.vertices);
  assert.equal((again.snapshot as { geometryVersion: number }).geometryVersion, 1);
  repo.close();
});

test("duplicate idempotency key never creates a second request or report", () => {
  const repo = new Repo(openDatabase(dbPath));
  const hull = repo.createHull("h");
  importGeometry(repo, hull.id, rectangle(4, 2));
  const fluid = repo.upsertFluid("w", 1000, 9.81);
  const cond = createCondition(repo, { hullId: hull.id, length: 10, mass: 32000, cg: { x: 0, z: 0.8 } });
  const a = runScan(repo, { conditionId: cond.id, fluidId: fluid.id, startDeg: 0, endDeg: 5, stepDeg: 5, idempotencyKey: "same" });
  const b = runScan(repo, { conditionId: cond.id, fluidId: fluid.id, startDeg: 0, endDeg: 5, stepDeg: 5, idempotencyKey: "same" });
  assert.equal(a.requestId, b.requestId);
  const reports = repo.listReports(cond.id, 10, 0);
  assert.equal(reports.total, 1);
  repo.close();
});

test("transaction rolls back on failure", () => {
  const repo = new Repo(openDatabase(dbPath));
  repo.createHull("h");
  const before = (repo.listHulls(10, 0).total);
  assert.throws(() => repo.transaction(() => {
    repo.db.prepare("INSERT INTO hulls(name, created_at) VALUES('rolled back', '2020-01-01')").run();
    throw new Error("boom");
  }), /boom/);
  assert.equal(repo.listHulls(10, 0).total, before);
  repo.close();
});

test("persistence survives reopening the database", () => {
  {
    const repo = new Repo(openDatabase(dbPath));
    const hull = repo.createHull("persist me");
    importGeometry(repo, hull.id, rectangle(4, 2));
    const fluid = repo.upsertFluid("w", 1000, 9.81);
    const cond = createCondition(repo, { hullId: hull.id, length: 10, mass: 32000, cg: { x: 0, z: 0.8 } });
    runScan(repo, { conditionId: cond.id, fluidId: fluid.id, startDeg: -5, endDeg: 5, stepDeg: 5, idempotencyKey: "persist" });
    repo.close();
  }
  {
    const repo = new Repo(new DatabaseSync(dbPath));
    const hulls = repo.listHulls(10, 0);
    assert.equal(hulls.rows[0]!.name, "persist me");
    assert.equal(repo.listReports(undefined, 10, 0).total, 1);
    repo.close();
  }
});

test("injected clock controls timestamps deterministically", () => {
  let n = 0;
  const clock = { now: () => new Date(Date.UTC(2020, 0, 1 + n++)) };
  const repo = new Repo(openDatabase(dbPath), clock);
  const h1 = repo.createHull("a");
  const h2 = repo.createHull("b");
  assert.equal(h1.created_at, "2020-01-01T00:00:00.000Z");
  assert.equal(h2.created_at, "2020-01-02T00:00:00.000Z");
  repo.close();
});
