import type { Pool } from "pg";
/*
 * Postgres snapshot reader.
 *
 * Used by /sync/snapshot for initial bootstrap. It streams rows through a
 * database cursor so large tenants do not need to fit in process memory.
 */
import type { SnapshotReadParams, SnapshotReader } from "../gateway/routes/snapshot.js";
import { DependencyUnavailableError, ValidationError } from "../gateway/plugins/errorHandler.js";

interface TableSpec {
  table: string;
  tenantColumn: string;
  bucketColumn: "region" | "user_id" | "uploaded_by";
}

// Static allowlist: collection -> physical table mapping.
// No user input ever reaches a SQL identifier; only these names can be used.
const TABLE_MAP: Record<string, TableSpec> = {
  farms:          { table: "farms",          tenantColumn: "tenant_id", bucketColumn: "region" },
  plots:          { table: "plots",          tenantColumn: "tenant_id", bucketColumn: "region" },
  crops:          { table: "crops",          tenantColumn: "tenant_id", bucketColumn: "region" },
  action_events:  { table: "action_events",  tenantColumn: "tenant_id", bucketColumn: "region" },
  inspections:    { table: "inspections",    tenantColumn: "tenant_id", bucketColumn: "region" },
  gdc_submissions:{ table: "gdc_submissions",tenantColumn: "tenant_id", bucketColumn: "region" },
  invoices:       { table: "invoices",       tenantColumn: "tenant_id", bucketColumn: "user_id" },
  farm_members:   { table: "farm_members",   tenantColumn: "tenant_id", bucketColumn: "user_id" },
  attachments:    { table: "attachments",    tenantColumn: "tenant_id", bucketColumn: "uploaded_by" },
};

function parseBucket(bucket: string): { tenantId: string; region?: string; userId?: string } {
  const regionMatch = bucket.match(/^tenant:([^:]+):region:(.+)$/);
  if (regionMatch) return { tenantId: regionMatch[1], region: regionMatch[2] };

  const userMatch = bucket.match(/^tenant:([^:]+):user:(.+)$/);
  if (userMatch) return { tenantId: userMatch[1], userId: userMatch[2] };

  const wildcardMatch = bucket.match(/^tenant:([^:]+):\*$/);
  if (wildcardMatch) return { tenantId: wildcardMatch[1] };

  throw new ValidationError(`Cannot parse bucket for snapshot: ${bucket}`);
}

export class PostgresSnapshotReader implements SnapshotReader {
  constructor(private readonly pool: Pool) {}

  async *streamCollection(params: SnapshotReadParams): AsyncIterable<Record<string, unknown>> {
    const spec = TABLE_MAP[params.collection];
    if (!spec) {
      throw new ValidationError(`Unknown collection for snapshot: ${params.collection}`);
    }

    const { tenantId, region, userId } = parseBucket(params.bucket);

    const paramValues: unknown[] = [tenantId];
    let bucketClause = "";

    if (region !== undefined) {
      if (spec.bucketColumn !== "region") return;
      paramValues.push(region);
      bucketClause = `AND ${spec.bucketColumn} = $${paramValues.length}`;
    } else if (userId !== undefined) {
      if (spec.bucketColumn === "region") return;
      paramValues.push(userId);
      bucketClause = `AND ${spec.bucketColumn} = $${paramValues.length}`;
    }

    // Table name comes from allowlist, never from user input — safe to interpolate.
    const sql = `
      SELECT * FROM ${spec.table}
      WHERE ${spec.tenantColumn} = $1
      ${bucketClause}
      ORDER BY id
    `;

    let client;
    try {
      client = await this.pool.connect();
    } catch (err) {
      throw new DependencyUnavailableError(`Postgres unavailable: ${(err as Error).message}`);
    }

    try {
      await client.query("BEGIN");
      await client.query("DECLARE snapshot_cursor NO SCROLL CURSOR FOR " + sql, paramValues);

      while (true) {
        const result = await client.query("FETCH 100 FROM snapshot_cursor");
        if (result.rows.length === 0) break;
        for (const row of result.rows) {
          yield row as Record<string, unknown>;
        }
      }

      await client.query("CLOSE snapshot_cursor");
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw new DependencyUnavailableError(`Snapshot stream error: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
}
