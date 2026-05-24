import type { ConflictContext, ConflictResult, ConflictStrategy } from "../conflictTypes.js";

type FieldTimestamps = Record<string, string>;

interface MetaDoc {
  field_timestamps?: FieldTimestamps;
  updated_at?: string;
}

function getFieldTimestamp(doc: Record<string, unknown>, field: string): number {
  const meta = doc._meta as MetaDoc | undefined;
  if (meta?.field_timestamps?.[field]) {
    return new Date(meta.field_timestamps[field]).getTime();
  }
  if (meta?.updated_at) {
    return new Date(meta.updated_at).getTime();
  }
  return 0;
}

export class LastWriteWinsStrategy implements ConflictStrategy {
  resolve(ctx: ConflictContext): ConflictResult {
    const { write, serverLatest } = ctx;

    if (!serverLatest) {
      return { outcome: "client_wins", payload: write.payload };
    }

    let clientTs: number;
    try {
      clientTs = new Date(write.clientTimestamp).getTime();
      if (isNaN(clientTs)) throw new Error("invalid");
    } catch {
      const sd = (serverLatest.fullDoc ?? serverLatest.delta ?? {}) as Record<string, unknown>;
      return { outcome: "server_wins", payload: sd, serverVersion: sd };
    }

    // SPEC-031 — REMOVE tombstone semantics.
    if (serverLatest.operation === "REMOVE") {
      const serverTs = new Date(serverLatest.timestamp).getTime();
      if (write.operation === "REMOVE") {
        if (clientTs > serverTs) return { outcome: "client_wins", payload: {} };
        return { outcome: "server_wins", payload: {}, serverVersion: {} };
      }
      // client PUT/PATCH vs server REMOVE — client resurrects only if newer.
      if (clientTs > serverTs) return { outcome: "client_wins", payload: write.payload };
      return { outcome: "server_wins", payload: {}, serverVersion: {} };
    }

    const serverDoc = (serverLatest.fullDoc ?? serverLatest.delta ?? {}) as Record<string, unknown>;

    if (write.operation === "REMOVE") {
      const serverTs = new Date(serverLatest.timestamp).getTime();
      if (clientTs > serverTs) return { outcome: "client_wins", payload: {} };
      return { outcome: "server_wins", payload: serverDoc, serverVersion: serverDoc };
    }

    const merged: Record<string, unknown> = { ...serverDoc };

    for (const [field, value] of Object.entries(write.payload)) {
      const serverFieldTs = getFieldTimestamp(serverDoc, field);
      if (clientTs > serverFieldTs) {
        merged[field] = value;
      }
    }

    return {
      outcome: "merged",
      payload: merged,
      serverVersion: serverDoc,
    };
  }
}
