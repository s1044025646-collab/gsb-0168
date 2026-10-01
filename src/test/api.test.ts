import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDatabase } from "../db.js";
import { createApp } from "../api.js";
import { baseAnalysis, rectangleVertices } from "../fixtures.js";

test("end to end API validation, creation and pagination", async () => {
  const db = new AppDatabase(join(mkdtempSync(join(tmpdir(), "hydro-api-")), "api.sqlite"));
  const server = createApp(db);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const created = await request(port, "POST", "/api/geometries", { name: "rect", vertices: rectangleVertices });
    assert.equal(created.status, 201);
    const bad = await request(port, "POST", "/api/geometries", { name: "bad", vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }] });
    assert.equal(bad.status, 422);
    assert.equal(bad.body.error.code, "INVALID_GEOMETRY");
    const input = { ...baseAnalysis(), geometryId: created.body.id, idempotencyKey: "api-e2e-0000001" };
    const first = await request(port, "POST", "/api/reports", input);
    const second = await request(port, "POST", "/api/reports", input);
    assert.equal(first.body.id, second.body.id);
    const listed = await request(port, "GET", "/api/reports?limit=1&offset=0");
    assert.equal(listed.body.items.length, 1);
    assert.equal(listed.body.hasMore, false);
    const underwater = await request(port, "GET", `/api/reports/${first.body.id}/samples/0/underwater`);
    assert.equal(underwater.status, 200);
    assert.ok(underwater.body.vertices.length >= 3);
  } finally {
    server.close();
    db.close();
  }
});

function request(port: number, method: string, path: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return fetch(`http://127.0.0.1:${port}${path}`, init).then(async (response) => ({ status: response.status, body: await response.json() }));
}
