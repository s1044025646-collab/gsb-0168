export const SCHEMA_VERSION = 1;

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hulls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS geometries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hull_id INTEGER NOT NULL REFERENCES hulls(id),
    version INTEGER NOT NULL,
    vertices_json TEXT NOT NULL,
    area REAL NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(hull_id, version)
  );

  CREATE TABLE IF NOT EXISTS loading_conditions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hull_id INTEGER NOT NULL REFERENCES hulls(id),
    geometry_id INTEGER NOT NULL REFERENCES geometries(id),
    length_m REAL NOT NULL,
    mass_kg REAL NOT NULL,
    cg_x REAL NOT NULL,
    cg_z REAL NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fluids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    density REAL NOT NULL,
    g REAL NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scan_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idempotency_key TEXT NOT NULL UNIQUE,
    condition_id INTEGER NOT NULL REFERENCES loading_conditions(id),
    fluid_id INTEGER NOT NULL REFERENCES fluids(id),
    start_deg REAL NOT NULL,
    end_deg REAL NOT NULL,
    step_deg REAL NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL UNIQUE REFERENCES scan_requests(id),
    condition_id INTEGER NOT NULL,
    fluid_id INTEGER NOT NULL,
    -- Frozen snapshot: original vertices and parameters captured at scan time.
    snapshot_json TEXT NOT NULL,
    points_json TEXT NOT NULL,
    equilibria_json TEXT NOT NULL,
    max_abs_residual_kg REAL NOT NULL,
    near_full_json TEXT NOT NULL,
    full_submerged_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_geometries_hull ON geometries(hull_id);
  CREATE INDEX IF NOT EXISTS idx_conditions_hull ON loading_conditions(hull_id);
  CREATE INDEX IF NOT EXISTS idx_reports_condition ON reports(condition_id);
  `,
];

export function applyMigrations(db: import("node:sqlite").DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);
  const row = db.prepare("SELECT value FROM schema_meta WHERE key='version'").get() as
    | { value: string }
    | undefined;
  const current = row ? Number(row.value) : 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]!);
      db.prepare("INSERT INTO schema_meta(key, value) VALUES('version', ?) " +
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(v + 1));
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
