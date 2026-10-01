/**
 * Repeatable end-to-end demo, fully offline. Uses an isolated database under
 * .project/demo.db so repeated runs start from a clean state.
 */
import { rmSync } from "node:fs";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo, openDatabase } from "../src/db/repo.ts";
import { rectangle, symmetricV } from "../src/geometry/fixtures.ts";
import { createCondition, importGeometry, runScan, uprightDraft } from "../src/analysis/service.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, "..", ".project", "demo.db");
for (const suffix of ["", "-wal", "-shm"]) {
  try { rmSync(dbPath + suffix); } catch { /* not present */ }
}

let tick = 0;
const clock = { now: () => new Date(Date.UTC(2026, 8, 30, 0, 0, tick++)) };
const db = openDatabase(dbPath);
const repo = new Repo(db, clock);

function hr(t: string): void {
  console.log(`\n=== ${t} ===`);
}

hr("1. hull + 4m x 2m rectangular section, L=10m, rho=1000");
const hull = repo.createHull("demo barge");
const geom = importGeometry(repo, hull.id, rectangle(4, 2));
console.log(`hull=${hull.id} geometry version=${geom.version} area=${geom.area} m^2`);
const fluid = repo.upsertFluid("fresh-water", 1000, 9.81);

hr("2. mass=32000 kg -> analytic draft 32000/(1000*10*4)=0.8 m");
const condition = createCondition(repo, {
  hullId: hull.id, length: 10, mass: 32000, cg: { x: 0, z: 0.8 },
});
const d = uprightDraft(repo, condition.id, fluid.id);
console.log(`numerical draft=${d.draft.toFixed(8)} m, residual=${Math.abs(d.displacementResidualKg).toExponential(2)} kg`);

hr("3. GZ scan -15..15 deg, step 5 (centered CG: GZ odd in heel, restoring sign)");
const scan = runScan(repo, {
  conditionId: condition.id, fluidId: fluid.id,
  startDeg: -15, endDeg: 15, stepDeg: 5, idempotencyKey: "demo-scan-1",
});
for (const p of scan.scan.points) {
  console.log(`phi=${p.heelDeg.toFixed(0).padStart(4)} draft=${p.draft.toFixed(5)} GZ=${p.gz.toExponential(3)}`);
}

hr("4. idempotent resubmit returns the same report, vertices unchanged");
const again = runScan(repo, {
  conditionId: condition.id, fluidId: fluid.id,
  startDeg: -15, endDeg: 15, stepDeg: 5, idempotencyKey: "demo-scan-1",
});
console.log(`reused=${again.reused} reportId same=${again.reportId === scan.reportId}`);
console.log(`vertices still CCW original: ${JSON.stringify(repo.getGeometry(geom.id)!.vertices[0])} ...`);

hr("5. later V-section geometry version does not alter the frozen report");
const geom2 = importGeometry(repo, hull.id, symmetricV(4, 2));
console.log(`new geometry version=${geom2.version}; report snapshot version=${(scan.snapshot as { geometryVersion: number }).geometryVersion}`);

hr("6. failure path: mass exceeding full submersion is rejected");
const tooHeavy = createCondition(repo, {
  hullId: hull.id, length: 10, mass: 1000000, cg: { x: 0, z: 0.5 },
});
try {
  uprightDraft(repo, tooHeavy.id, fluid.id);
  console.log("ERROR: should have thrown");
} catch (err) {
  console.log(`rejected: ${(err as Error).message}`);
}

hr("7. failure path: self-intersecting section is rejected");
try {
  importGeometry(repo, hull.id, [
    { x: 0, z: 0 }, { x: 2, z: 2 }, { x: 0, z: 2 }, { x: 2, z: 0 },
  ]);
} catch (err) {
  console.log(`rejected: ${(err as Error).message}`);
}

repo.close();
console.log(`\ndemo db left at ${dbPath} (restart test reads it back)`);
