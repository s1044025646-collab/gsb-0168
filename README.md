# Prismatic Hull Hydrostatics (local-only analysis backend)

TypeScript + Node.js + SQLite backend for **static flotation and righting-arm
(GZ curve) analysis** of an idealised hull: a single closed convex polygon
cross-section constant along the whole hull length (prismatic hull, no trim).

Scope is deliberately restricted. There is **no web UI, no navigation/control,
and no connection to any real vessel system**. Results describe the ideal
closed-section model only; they must not be used to infer real flooding or
seaworthiness.

## Model and sign conventions

- Body frame fixed to the hull: `x` positive to starboard, `z` positive up,
  metres. Water occupies `z <= waterlineZ`.
- Heel `phi` (degrees) positive = counter-clockwise = **starboard up / port
  submerged**. Vertices and the center of gravity are rotated together with
  the hull via `R(phi)`; the CG is never left fixed in world coordinates.
- At each heel the waterline is solved by bisection so displaced mass
  `rho * L * A_sub` equals the vessel mass. The displacement residual in kg is
  reported for every sample.
- Righting arm `GZ = xB_world - xG_world`. With the sign convention above a
  stable hull at positive heel shows `GZ < 0`; the restoring moment about the
  longitudinal axis is `M = -rho * g * V * GZ`.
- Equilibrium points reported by a scan are only GZ sign changes bracketed
  between discrete samples (with a linear interpolation estimate). Discrete
  sampling **cannot prove that all equilibrium/instability angles exist**.
- Geometry, CG and fluid parameters are snapshotted (frozen) into each report.
  Re-running a scan with the same idempotency key returns the stored report
  unchanged and never overwrites original vertices.

Rejected inputs: self-intersecting or non-convex sections, zero-area
sections, CG outside the section, and mass exceeding the fully-submerged
displacement (HTTP `422 MASS_EXCEEDS_FULL_SUBMERGENCE`). Angles where the
section is at least 99.5% submerged are flagged `NEAR_FULL`; full submersion
is flagged `FULL`.

## Requirements

- Node.js >= 24 (uses the built-in `node:sqlite`; developed on Node 25)
- npm (only dev dependencies: `typescript`, `@types/node`)

## Install

```powershell
npm install
```

## Type-check and test

```powershell
npm run typecheck
npm test
```

Tests cover: area/first-moment integration, left-right symmetry, rectangle
upright analytic draft, small-angle metacentric (`GM`) cross-check,
density/mass equal scaling, clip boundary vertices, numerical convergence,
eccentric CG equilibria, geometry/frozen-report integrity, idempotent
rescans, transaction rollback, persistence after reopening the database, and
the HTTP API including failure paths.

## Repeatable end-to-end demo

```powershell
npm run demo
```

Runs an offline script against an isolated `.project/demo.db`, printing
analytic-vs-numeric draft, a GZ scan, idempotent rescan, geometry versioning,
and the over-mass / self-intersection failure paths.

## API server (localhost only, automatic ephemeral port)

```powershell
npm start
# -> hydrostatics API listening on http://127.0.0.1:<auto-port>
```

The server binds only to `127.0.0.1` on an OS-assigned port (set `PORT` to
override) and writes `.project/server.port` / `.project/server.pid`. The
SQLite database lives at `.project/hydrostatics.db`; all data stay inside the
project directory.

Stop only this project's server:

```powershell
npm run stop
```

### Endpoints

- `GET /health`, `GET /conventions`
- `GET/POST /hulls` (list supports `?limit=&offset=`)
- `GET/POST /hulls/:id/geometries` (post body: `{vertices:[{x,z},...]}`)
- `GET/POST /hulls/:id/conditions` (`{length,mass,cg:{x,z},geometryId?}`)
- `GET/POST /fluids` (`{name,density,g?}`)
- `GET /conditions/:id/draft?fluidId=`
- `GET /conditions/:id/underwater?fluidId=&heelDeg=`
- `POST /conditions/:id/scans` (`{fluidId,startDeg,endDeg,stepDeg,idempotencyKey}`)
- `GET /reports[?conditionId=&limit=&offset=]`, `GET /reports/:id`

Errors return `{error:{code,message}}` with codes such as `INVALID_NUMBER`,
`INVALID_ID`, `SECTION_SELF_INTERSECT`, `SECTION_NON_CONVEX`,
`SECTION_ZERO_AREA`, `CG_OUTSIDE_SECTION`, `MASS_EXCEEDS_FULL_SUBMERGENCE`,
`HULL_NOT_FOUND`, `ROUTE_NOT_FOUND`.

### Example

```powershell
$port = Get-Content .project/server.port
$b = "http://127.0.0.1:$port"
$hull = Invoke-RestMethod "$b/hulls" -Method Post -ContentType application/json `
  -Body '{"name":"barge"}'
Invoke-RestMethod "$b/hulls/$($hull.id)/geometries" -Method Post -ContentType application/json `
  -Body '{"vertices":[{"x":-2,"z":0},{"x":2,"z":0},{"x":2,"z":2},{"x":-2,"z":2}]}'
Invoke-RestMethod "$b/fluids" -Method Post -ContentType application/json `
  -Body '{"name":"fresh","density":1000}'
```

## CLI

```powershell
node --experimental-sqlite src/cli/cli.ts help
```

Main commands: `init-fluid`, `hull`, `import` (JSON inline or file),
`fixture` (`rectangle|trapezoid|vee`), `condition`, `draft`, `scan`,
`underwater`, `compare` (move the fictitious CG and diff the GZ curves),
`export --report <id> --out curve.csv`, and `list`. CLI output shows
before/after counts and residuals for the key mutating operations. Example:

```powershell
node --experimental-sqlite src/cli/cli.ts init-fluid --name fresh-water --density 1000
node --experimental-sqlite src/cli/cli.ts hull --name box
node --experimental-sqlite src/cli/cli.ts fixture --hull 1 --kind rectangle --beam 4 --depth 2
node --experimental-sqlite src/cli/cli.ts condition --hull 1 --length 10 --mass 32000 --cgz 0.8
node --experimental-sqlite src/cli/cli.ts draft --condition 1 --fluid 1
node --experimental-sqlite src/cli/cli.ts scan --condition 1 --fluid 1 --key demo-1
node --experimental-sqlite src/cli/cli.ts compare --condition 1 --fluid 1 --new-cgx 0.2
node --experimental-sqlite src/cli/cli.ts export --report 1 --out gz.csv
```

## Layout

- `src/geometry` — polygon validation, moments, rotation, waterline clipping, fixtures
- `src/analysis` — equilibrium solve, GZ scan, service/idempotency/freeze
- `src/db` — repeatable migrations and repository
- `src/api`, `src/cli` — HTTP API and command line
- `test` — automated tests; `scripts/demo.ts` — repeatable demo; `scripts/stop.ps1` — stop
