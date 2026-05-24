export const CURRENT_SCHEMA_VERSION = 1;
export const MIN_SUPPORTED_VERSION = 1;

export const ddl: string[] = [
  `CREATE TABLE IF NOT EXISTS farms (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    region TEXT NOT NULL,
    name TEXT NOT NULL,
    area_ha REAL,
    created_by TEXT,
    created_at TEXT,
    updated_at TEXT,
    _meta TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS plots (
    id TEXT PRIMARY KEY,
    farm_id TEXT NOT NULL REFERENCES farms(id),
    tenant_id TEXT NOT NULL,
    region TEXT NOT NULL,
    name TEXT,
    area_ha REAL,
    crop_type TEXT,
    created_at TEXT,
    updated_at TEXT,
    _meta TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS crops (
    id TEXT PRIMARY KEY,
    plot_id TEXT NOT NULL REFERENCES plots(id),
    tenant_id TEXT NOT NULL,
    region TEXT NOT NULL,
    variety TEXT,
    sowing_date TEXT,
    harvest_date TEXT,
    created_at TEXT,
    updated_at TEXT,
    _meta TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS action_events (
    id TEXT PRIMARY KEY,
    farm_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    region TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT,
    created_at TEXT,
    seq INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS inspections (
    id TEXT PRIMARY KEY,
    farm_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    region TEXT NOT NULL,
    inspector_id TEXT,
    status TEXT,
    notes TEXT,
    created_at TEXT,
    updated_at TEXT,
    _meta TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS gdc_submissions (
    id TEXT PRIMARY KEY,
    farm_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    region TEXT NOT NULL,
    status TEXT NOT NULL,
    payload TEXT,
    created_at TEXT,
    updated_at TEXT,
    _meta TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    amount REAL,
    currency TEXT,
    status TEXT,
    paid_at TEXT,
    created_at TEXT,
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS farm_members (
    id TEXT PRIMARY KEY,
    farm_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    parent_type TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    uploaded_by TEXT,
    content_type TEXT,
    size_bytes INTEGER,
    storage_path TEXT,
    created_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS _oplog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seq INTEGER NOT NULL UNIQUE,
    collection TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    bucket TEXT NOT NULL
  )`,
];

export const migrations: Record<string, string[]> = {
  // Future: "1_to_2": ["ALTER TABLE farms ADD COLUMN ..."]
};

// Gap above which a client must upgrade before syncing.
const FORCED_UPGRADE_THRESHOLD = 2;

export type SchemaPolicy = "soft" | "forced" | "blocked";

export interface SchemaResponse {
  version: number;
  ddl: string[];
  migrations: Record<string, string[]>;
  policy: SchemaPolicy;
  minSupportedVersion: number;
}

export interface SchemaContext {
  rolloutPercent?: number;
  minSupportedVersion?: number;
  killSwitch?: boolean;
  /** Stable string used for deterministic rollout bucketing (e.g. clientId or request id). */
  clientKey?: string;
}

// Build-time assertion: migration keys must form a contiguous path 1_to_2, 2_to_3, …
function assertContiguousMigrations(): void {
  const keys = Object.keys(migrations).sort((a, b) => a.localeCompare(b));
  for (let i = 0; i < keys.length; i++) {
    const expected = `${MIN_SUPPORTED_VERSION + i}_to_${MIN_SUPPORTED_VERSION + i + 1}`;
    if (keys[i] !== expected) {
      throw new Error(
        `Migration path gap: expected key "${expected}", found "${keys[i] ?? "none"}"`,
      );
    }
  }
}
assertContiguousMigrations();

/** Deterministic rollout bucket: hash clientKey into [0,100). */
export function resolveTargetVersion(ctx: SchemaContext): number {
  const { killSwitch, rolloutPercent = 100, clientKey = "" } = ctx;
  // SPEC-030 #3 — never drop below MIN_SUPPORTED_VERSION (clamp).
  const previousVersion = Math.max(MIN_SUPPORTED_VERSION, CURRENT_SCHEMA_VERSION - 1);
  if (killSwitch) return previousVersion;

  if (rolloutPercent >= 100) return CURRENT_SCHEMA_VERSION;
  if (rolloutPercent <= 0) return previousVersion;

  // Simple djb2-style hash -> percentage
  let hash = 5381;
  for (let i = 0; i < clientKey.length; i++) {
    hash = ((hash << 5) + hash + (clientKey.codePointAt(i) ?? 0)) >>> 0;
  }
  const bucket = hash % 100;
  return bucket < rolloutPercent ? CURRENT_SCHEMA_VERSION : CURRENT_SCHEMA_VERSION - 1;
}

export function getSchemaResponse(clientVersion?: number, ctx: SchemaContext = {}): SchemaResponse {
  const effectiveMin = ctx.minSupportedVersion ?? MIN_SUPPORTED_VERSION;
  const targetVersion = resolveTargetVersion(ctx);

  if (clientVersion != null && clientVersion > CURRENT_SCHEMA_VERSION) {
    throw new RangeError(`Client version ${clientVersion} is newer than server version ${CURRENT_SCHEMA_VERSION}`);
  }

  let policy: SchemaPolicy = "soft";
  if (clientVersion != null && clientVersion < effectiveMin) {
    policy = "blocked";
  } else if (
    clientVersion != null &&
    targetVersion - clientVersion > FORCED_UPGRADE_THRESHOLD
  ) {
    policy = "forced";
  }

  const neededMigrations: Record<string, string[]> = {};
  if (clientVersion != null && clientVersion < targetVersion && policy !== "blocked") {
    for (let v = clientVersion; v < targetVersion; v++) {
      const key = `${v}_to_${v + 1}`;
      if (migrations[key]) {
        neededMigrations[key] = migrations[key];
      }
    }
  }

  return {
    version: targetVersion,
    ddl,
    migrations: neededMigrations,
    policy,
    minSupportedVersion: effectiveMin,
  };
}
