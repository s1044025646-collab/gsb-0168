# Prismatic Hydrostatics Backend

Local Windows-friendly analysis backend for an idealized prismatic hull. It provides only an HTTP API, CLI, fictional cross-section fixtures, and automated tests. It has no web UI, navigation control, sensor integration, or real-ship connection.

## Model and Sign Convention

- The cross-section is one closed, simple, strictly convex polygon, constant along the ship length.
- Body coordinates use `+x` to starboard and `+y` upward; length is along the prismatic axis.
- Positive heel angle is clockwise when viewed along the ship axis, so starboard moves downward.
- The center of gravity is stored in body coordinates and rotated with the hull for every angle.
- Each rotated polygon is clipped by a horizontal world waterline. Submerged area, first area moments, and area centroid come from the clipped polygon.
- Draft is the world-`y` waterline position found by bisection until `rho * L * A = m`.
- Signed `GZ = x_B(world) - x_G(world)`. Positive GZ means buoyancy acts to the low/starboard side of gravity and creates a restoring moment for the stated positive heel convention.
- Discrete equilibrium results are sampled zero crossings or brackets. They do not prove that all instability angles have been found.
- Results apply only to this sealed ideal model; they make no claim about flooding, reserve stability, seaworthiness, or navigation safety.

Invalid sections are rejected with explicit error codes for self-intersection, non-convex geometry, zero area, or malformed vertices. A mass above full immersion displacement is rejected per angle (`draft` and `GZ` are `NaN`, and the report includes `MASS_EXCEEDS_FULL_DISPLACEMENT`). Samples at or above 99.5% of full displacement set `nearFullImmersion`, and reports include `NEAR_FULL_IMMERSION`; near-deck results must not be extrapolated.

## Requirements

- Node.js 24 or newer (tested with Node 25; uses built-in `node:sqlite`).
- npm, used only to install TypeScript build tooling. Runtime code has no third-party package dependency.

## Install and Test

```powershell
npm install
npm test
npm run demo
```

All SQLite files, demo folders, exported curves, and temporary state are written under the project's `.data` directory. Tests use operating-system temporary directories for database files.

## Start and Stop the API

```powershell
npm start
npm run stop
```

The server binds only `127.0.0.1` and asks the operating system for an ephemeral port. Startup prints JSON containing `port`, `pid`, database path, and port-file path. The stop command reads `.data/server.port` and signals only the PID recorded by this project.

## API

All errors use `{ "error": { "code", "message" } }`. Pagination uses `limit` (1-200, default 50) and `offset` (default 0), returning `items`, `limit`, `offset`, and `hasMore`.

- `POST /api/geometries` — create a geometry version: `{ "name": "rect", "vertices": [{"x":-2,"y":0}, ...] }`.
- `GET /api/geometries?limit=50&offset=0` — page through geometry versions.
- `GET /api/geometries/:id` — fetch one geometry version.
- `POST /api/reports` — create a frozen analysis report.
- `GET /api/reports?geometryId=1&limit=50&offset=0` — page reports.
- `GET /api/reports/:id` — fetch the frozen report.
- `GET /api/reports/:id/samples/:angle/underwater` — recompute the clipped underwater polygon from the report's frozen vertices and parameters.

The report stores original vertices, geometry version/name, length, mass, body-coordinate CG, fluid density, angle range/step, upright result, samples, residuals, equilibrium points, limits, and timestamp. Repeating a request with the same `idempotencyKey` returns the original report.

## CLI

Commands print before/after state as JSON.

```powershell
node dist/cli.js import-fixture rectangle-fixture
node dist/cli.js upright examples/rectangle-analysis.json
node dist/cli.js scan examples/rectangle-analysis.json
node dist/cli.js underwater 1 0
node dist/cli.js compare-cg examples/rectangle-analysis.json 0.2 0
node dist/cli.js export-curve 1 .data/example-curve.json
```

The CLI database defaults to `.data/hydro-cli.sqlite`; the API server defaults to `.data/hydro.sqlite`. Set `HYDRO_DB_PATH` to point either command at another project-local database.

## Persistence and Migrations

Migrations use idempotent `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` statements and can be run repeatedly. Restarting a process opens the same SQLite database without mutating frozen report vertices. Tests inject a fixed clock where needed; no random value is required for correctness.

## Included Verification

Automated tests cover rectangular analytic upright flotation, small-angle rectangular metacentric cross-checking, trapezoidal and symmetric V fixtures, shifted CG inputs, vertices exactly on a waterline, area moments, left/right symmetry, density/mass proportional scaling, clipping boundaries, numerical convergence, invalid geometry failures, parameter validation, idempotency, transaction rollback, API pagination, and persistence across reopen.
