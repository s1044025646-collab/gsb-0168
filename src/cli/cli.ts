import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Repo, openDatabase } from "../db/repo.ts";
import * as fixtures from "../geometry/fixtures.ts";
import { createCondition, importGeometry, runScan, underwaterView, uprightDraft } from "../analysis/service.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = join(HERE, "..", "..", ".project");
const DB_PATH = join(PROJECT_DIR, "hydrostatics.db");

function open(): Repo {
  if (!existsSync(PROJECT_DIR)) mkdirSync(PROJECT_DIR, { recursive: true });
  return new Repo(openDatabase(DB_PATH));
}

function parseJsonArg(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return JSON.parse(readFileSync(value, "utf-8"));
  }
}

function fmt(n: number, d = 5): string {
  return Number.isFinite(n) ? n.toFixed(d) : String(n);
}

const HELP = `
prismatic-hull CLI (ideal closed convex prismatic section; no trim)

usage:
  node --experimental-sqlite src/cli/cli.ts <command> [args]

commands:
  init-fluid --name fresh-water --density 1000 [--g 9.81]
  hull --name "demo box"
  import --hull <id> --vertices '<json array>' | --file section.json
  fixture --hull <id> --kind rectangle|trapezoid|vee [--beam 4] [--depth 2] [--bottom 3] [--top 5]
  condition --hull <id> [--geometry <version>] --length 10 --mass 20000 --cgx 0 --cgz 0.8
  draft --condition <id> --fluid <id>
  scan --condition <id> --fluid <id> [--start -45 --end 45 --step 5] [--key <idempotencyKey>]
  underwater --condition <id> --fluid <id> --heel 15
  compare --condition <id> --fluid <id> --new-cgx 0.3 --new-cgz 0.9 [--start -30 --end 30] [--step 5]
  export --report <id> --out curve.csv
  list <hulls|geometries|conditions|fluids|reports> [--hull <id>] [--limit 50] [--offset 0]
  conventions
  help
`;

interface Args {
  _: string[];
  [key: string]: string | boolean | string[];
}

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
      else { out[a.slice(2)] = next; i++; }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function numArg(a: Args, key: string, fallback?: number): number {
  const v = a[key];
  if (v === undefined || v === true) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing --${key}`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${key} must be numeric, got ${v}`);
  return n;
}

function intArg(a: Args, key: string): number {
  const n = numArg(a, key);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${key} must be a positive integer`);
  return n;
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "help";
  const args = parseArgs(process.argv.slice(3));
  const repo = open();
  try {
    switch (cmd) {
      case "help": console.log(HELP); break;
      case "conventions": printConventions(); break;
      case "init-fluid": {
        const name = String(args.name ?? "fresh-water");
        const density = numArg(args, "density", 1000);
        const g = numArg(args, "g", 9.81);
        const before = repo.listFluids(200, 0).total;
        const f = repo.upsertFluid(name, density, g);
        const after = repo.listFluids(200, 0).total;
        console.log(`fluids before=${before} after=${after}`);
        console.log(`fluid id=${f.id} name=${f.name} density=${f.density} g=${f.g}`);
        break;
      }
      case "hull": {
        const h = repo.createHull(String(args.name ?? "hull"));
        console.log(`created hull id=${h.id} name=${h.name}`);
        break;
      }
      case "import": {
        const hullId = intArg(args, "hull");
        let vertices: unknown;
        if (typeof args.vertices === "string") vertices = parseJsonArg(args.vertices);
        else if (typeof args.file === "string") vertices = parseJsonArg(args.file);
        else throw new Error("need --vertices '<json>' or --file path");
        const geom = importGeometry(repo, hullId, vertices);
        console.log(`hull ${hullId}: stored geometry version=${geom.version} id=${geom.id} area=${fmt(geom.area)} m^2, vertices=${geom.vertices.length} (input normalized to CCW; originals untouched)`);
        break;
      }
      case "fixture": {
        const hullId = intArg(args, "hull");
        const beam = numArg(args, "beam", 4);
        const depth = numArg(args, "depth", 2);
        let vertices: ReturnType<typeof fixtures.rectangle>;
        switch (String(args.kind ?? "rectangle")) {
          case "rectangle": vertices = fixtures.rectangle(beam, depth); break;
          case "trapezoid": vertices = fixtures.trapezoid(numArg(args, "bottom", 3), numArg(args, "top", 5), depth); break;
          case "vee": vertices = fixtures.symmetricV(beam, depth); break;
          default: throw new Error(`unknown fixture kind ${String(args.kind)}`);
        }
        const geom = importGeometry(repo, hullId, vertices);
        console.log(`fixture=${args.kind} -> hull ${hullId} version=${geom.version} area=${fmt(geom.area)}`);
        break;
      }
      case "condition": {
        const hullId = intArg(args, "hull");
        const before = repo.listConditions(hullId, 200, 0).total;
        const geom = repo.getLatestGeometry(hullId);
        const c = createCondition(repo, {
          hullId,
          geometryId: args.geometry ? (repo.listGeometries(hullId, 200, 0).rows.find((g) => g.version === Number(args.geometry))?.id) : geom?.id,
          length: numArg(args, "length"),
          mass: numArg(args, "mass"),
          cg: { x: numArg(args, "cgx", 0), z: numArg(args, "cgz", 1) },
        });
        const after = repo.listConditions(hullId, 200, 0).total;
        console.log(`conditions before=${before} after=${after}`);
        console.log(`condition id=${c.id} geometry=${c.geometry_id} L=${c.length_m} m=${c.mass_kg} cg=(${c.cg_x},${c.cg_z})`);
        break;
      }
      case "draft": {
        const conditionId = intArg(args, "condition");
        const fluidId = intArg(args, "fluid");
        const r = uprightDraft(repo, conditionId, fluidId);
        console.log(`upright draft=${fmt(r.draft)} m submergedArea=${fmt(r.submergedArea)} displaced=${fmt(r.displacedMass, 3)} kg residual=${fmt(r.displacementResidualKg, 9)} kg iterations=${r.iterations}`);
        if (r.nearFullSubmerged) console.log("LIMIT: section >=99.5% submerged at equilibrium");
        break;
      }
      case "scan": {
        const result = runScan(repo, {
          conditionId: intArg(args, "condition"),
          fluidId: intArg(args, "fluid"),
          startDeg: numArg(args, "start", -45),
          endDeg: numArg(args, "end", 45),
          stepDeg: numArg(args, "step", 5),
          idempotencyKey: String(args.key ?? `cli-${Date.now()}-${Math.random().toString(36).slice(2)}`),
        });
        console.log(`${result.reused ? "reused existing" : "created new"} report id=${result.reportId}`);
        printScan(result);
        break;
      }
      case "underwater": {
        const r = underwaterView(repo, intArg(args, "condition"), intArg(args, "fluid"), numArg(args, "heel", 0));
        console.log(`heel=${fmt(r.heelDeg, 2)} draft=${fmt(r.draft)} waterlineZ=${fmt(r.waterlineZ)} vertices=${r.polygon.length}`);
        for (const p of r.polygon) console.log(`  (${fmt(p.x)}, ${fmt(p.z)})`);
        break;
      }
      case "compare": {
        const baseConditionId = intArg(args, "condition");
        const fluidId = intArg(args, "fluid");
        const old = repo.getCondition(baseConditionId);
        if (!old) throw new Error("condition not found");
        const newCg = {
          x: numArg(args, "new-cgx", old.cg_x),
          z: numArg(args, "new-cgz", old.cg_z),
        };
        const variant = createCondition(repo, {
          hullId: old.hull_id,
          geometryId: old.geometry_id,
          length: old.length_m,
          mass: old.mass_kg,
          cg: newCg,
        });
        const opts = {
          startDeg: numArg(args, "start", -30),
          endDeg: numArg(args, "end", 30),
          stepDeg: numArg(args, "step", 5),
        };
        console.log(`baseline condition=${baseConditionId} cg=(${old.cg_x},${old.cg_z}) -> variant condition=${variant.id} cg=(${newCg.x},${newCg.z})`);
        const base = runScan(repo, {
          conditionId: baseConditionId, fluidId, ...opts,
          idempotencyKey: `cli-compare-base-${baseConditionId}-${fluidId}-${opts.startDeg}-${opts.endDeg}-${opts.stepDeg}`,
        });
        const moved = runScan(repo, {
          conditionId: variant.id, fluidId, ...opts,
          idempotencyKey: `cli-compare-var-${variant.id}-${fluidId}-${opts.startDeg}-${opts.endDeg}-${opts.stepDeg}`,
        });
        console.log("heel(deg)   GZ baseline(m)   GZ moved(m)   delta(m)");
        moved.scan.points.forEach((p, i) => {
          const b = base.scan.points[i]!;
          console.log(`${fmt(p.heelDeg, 2).padStart(9)} ${fmt(b.gz).padStart(15)} ${fmt(p.gz).padStart(13)} ${fmt(p.gz - b.gz).padStart(10)}`);
        });
        console.log(`baseline report=${base.reportId} moved report=${moved.reportId}; max residual moved=${fmt(moved.scan.maxAbsResidualKg, 9)} kg`);
        break;
      }
      case "export": {
        const report = repo.getReport(intArg(args, "report"));
        if (!report) throw new Error("report not found");
        const out = String(args.out ?? "gz-curve.csv");
        const lines = ["heel_deg,draft_m,submerged_area_m2,gz_m,residual_kg,near_full,full_submerged"];
        for (const p of report.points as Array<Record<string, number>>) {
          const heel = p.heelDeg!;
          lines.push([heel, p.draft!, p.submergedArea!, p.gz!, p.displacementResidualKg!,
            (report.near_full as number[]).includes(heel) ? 1 : 0,
            (report.full_submerged as number[]).includes(heel) ? 1 : 0].join(","));
        }
        const target = /[\\/]/.test(out) ? out : join(PROJECT_DIR, out);
        writeFileSync(target, lines.join("\n"));
        console.log(`exported ${lines.length - 1} rows to ${target}`);
        break;
      }
      case "list": {
        const what = String(args._[0] ?? "");
        const limit = Number(args.limit ?? 20);
        const offset = Number(args.offset ?? 0);
        if (what === "hulls") {
          const { rows, total } = repo.listHulls(limit, offset);
          for (const h of rows) console.log(`${h.id}\t${h.name}\t${h.created_at}`);
          console.log(`total=${total}`);
        } else if (what === "geometries") {
          const { rows, total } = repo.listGeometries(intArg(args, "hull"), limit, offset);
          for (const g of rows) console.log(`v${g.version}\tid=${g.id}\tarea=${fmt(g.area)}\tn=${g.vertices.length}`);
          console.log(`total=${total}`);
        } else if (what === "conditions") {
          const { rows, total } = repo.listConditions(intArg(args, "hull"), limit, offset);
          for (const c of rows) console.log(`${c.id}\tgeom=${c.geometry_id}\tL=${c.length_m}\tm=${c.mass_kg}\tcg=(${c.cg_x},${c.cg_z})`);
          console.log(`total=${total}`);
        } else if (what === "fluids") {
          const { rows, total } = repo.listFluids(limit, offset);
          for (const f of rows) console.log(`${f.id}\t${f.name}\trho=${f.density}\tg=${f.g}`);
          console.log(`total=${total}`);
        } else if (what === "reports") {
          const { rows, total } = repo.listReports(undefined, limit, offset);
          for (const r of rows) console.log(`${r.id}\tcond=${r.condition_id}\tresidualMax=${fmt(r.max_abs_residual_kg, 9)}\t${r.created_at}`);
          console.log(`total=${total}`);
        } else throw new Error(`list what? hulls|geometries|conditions|fluids|reports`);
        break;
      }
      default:
        console.error(`unknown command: ${cmd}`);
        console.log(HELP);
        process.exitCode = 2;
    }
  } finally {
    repo.close();
  }

}

function printScan(result: ReturnType<typeof runScan>): void {
  console.log("heel(deg)   draft(m)   GZ(m)    residual(kg)  flags");
  for (const p of result.scan.points) {
    const flags = [p.nearFullSubmerged ? "NEAR_FULL" : "", p.fullSubmerged ? "FULL" : ""].filter(Boolean).join(",");
    console.log(`${fmt(p.heelDeg, 2).padStart(9)} ${fmt(p.draft).padStart(10)} ${fmt(p.gz).padStart(9)} ${fmt(p.displacementResidualKg, 8).padStart(13)} ${flags}`);
  }
  console.log(`max |displacement residual| = ${fmt(result.scan.maxAbsResidualKg, 9)} kg`);
  if (result.scan.equilibria.length === 0) {
    console.log("no GZ sign changes between discrete samples (this does NOT prove no equilibria exist)");
  } else {
    for (const e of result.scan.equilibria) {
      console.log(`GZ zero bracketed between ${e.betweenDeg[0]} and ${e.betweenDeg[1]} deg, linear estimate ${fmt(e.estimatedHeelDeg, 3)} deg`);
    }
  }
  if (result.scan.nearFullAnglesDeg.length) {
    console.log(`LIMIT near-full submersion at: ${result.scan.nearFullAnglesDeg.join(", ")} deg`);
  }
}

function printConventions(): void {
  console.log(`x starboard, z up (body frame); positive heel = CCW = starboard up / port down`);
  console.log(`vertices rotate with hull; CG rotates with hull (never fixed in world frame)`);
  console.log(`GZ = xB_world - xG_world; stable positive heel -> GZ<0; restoring M = -rho g V GZ`);
  console.log(`ideal closed convex prismatic model only; no flooding / real-vessel safety claims`);
}

main().catch((err: unknown) => {
  console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
