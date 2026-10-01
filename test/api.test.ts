import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { createApp } from "../src/api/server.ts";
import { Repo, openDatabase } from "../src/db/repo.ts";

const dbPath = join(tmpdir(), `phh-api-${process.pid}.db`);
let server: Server;
let base: string;

before(async () => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(dbPath + suffix); } catch { /* ignore */ }
  }
  const repo = new Repo(openDatabase(dbPath));
  server = createApp({ repo });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1/${""}`;
  if (addr && typeof addr === "object") base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function jsonRequest(path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(base + path, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const body = (await res.json()) as any;
  return { status: res.status, body };
}

test("health and conventions", async () => {
  const h = await jsonRequest("/health");
  assert.equal(h.status, 200);
  const c = await jsonRequest("/conventions");
  assert.match(c.body.gzSign, /GZ/);
});

test("full workflow with validation errors, pagination and idempotency", async () => {
  const bad = await jsonRequest("/hulls", { method: "POST", body: {} });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "INVALID_STRING");

  const hull = await jsonRequest("/hulls", { method: "POST", body: { name: "api barge" } });
  assert.equal(hull.status, 201);
  const hullId = hull.body.id;

  const bowtie = await jsonRequest(`/hulls/${hullId}/geometries`, {
    method: "POST",
    body: { vertices: [{ x: 0, z: 0 }, { x: 2, z: 2 }, { x: 0, z: 2 }, { x: 2, z: 0 }] },
  });
  assert.equal(bowtie.status, 400);
  assert.equal(bowtie.body.error.code, "SECTION_SELF_INTERSECT");

  const geom = await jsonRequest(`/hulls/${hullId}/geometries`, {
    method: "POST",
    body: { vertices: [{ x: -2, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }, { x: -2, z: 2 }] },
  });
  assert.equal(geom.status, 201);

  const fluid = await jsonRequest("/fluids", { method: "POST", body: { name: "fresh", density: 1000 } });
  assert.equal(fluid.status, 200);

  const cond = await jsonRequest(`/hulls/${hullId}/conditions`, {
    method: "POST",
    body: { length: 10, mass: 32000, cg: { x: 0, z: 0.8 } },
  });
  assert.equal(cond.status, 201);

  const draft = await jsonRequest(`/conditions/${cond.body.id}/draft?fluidId=${fluid.body.id}`);
  assert.equal(draft.status, 200);
  assert.ok(Math.abs(draft.body.draft - 0.8) < 1e-6);

  const heavy = await jsonRequest(`/hulls/${hullId}/conditions`, {
    method: "POST",
    body: { length: 10, mass: 1e9, cg: { x: 0, z: 0.8 } },
  });
  const heavyDraft = await jsonRequest(`/conditions/${heavy.body.id}/draft?fluidId=${fluid.body.id}`);
  assert.equal(heavyDraft.status, 422);
  assert.equal(heavyDraft.body.error.code, "MASS_EXCEEDS_FULL_SUBMERGENCE");

  const scanBody = {
    fluidId: fluid.body.id, startDeg: -10, endDeg: 10, stepDeg: 5, idempotencyKey: "api-key-1",
  };
  const s1 = await jsonRequest(`/conditions/${cond.body.id}/scans`, { method: "POST", body: scanBody });
  const s2 = await jsonRequest(`/conditions/${cond.body.id}/scans`, { method: "POST", body: scanBody });
  assert.equal(s1.status, 201);
  assert.equal(s2.status, 200);
  assert.equal(s1.body.reportId, s2.body.reportId);
  assert.equal(s2.body.reused, true);

  const reports = await jsonRequest("/reports?limit=1&offset=0");
  assert.equal(reports.status, 200);
  assert.ok(reports.body.page.total >= 1);
  assert.equal(reports.body.page.limit, 1);
  assert.equal(reports.body.data.length, 1);

  const uw = await jsonRequest(`/conditions/${cond.body.id}/underwater?fluidId=${fluid.body.id}&heelDeg=0`);
  assert.equal(uw.status, 200);
  assert.ok(Array.isArray(uw.body.polygon));

  const notFound = await jsonRequest("/hulls/99999/geometries");
  assert.equal(notFound.status, 200); // list on missing hull is empty set
  const badId = await jsonRequest("/conditions/abc/draft?fluidId=1");
  assert.equal(badId.status, 400);
  assert.equal(badId.body.error.code, "INVALID_ID");
});
