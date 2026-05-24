import { describe, it, expect } from "vitest";
import {
  normalizeDebeziumEnvelope,
  type DebeziumEnvelope,
} from "../../src/cdc/postgresChangeNormalizer.js";

const META = { sourceTopic: "business.cdc.public.farms" };

const ROW = {
  id: "farm-1",
  tenant_id: "t1",
  region: "north",
  name: "Farm A",
};

describe("normalizeDebeziumEnvelope", () => {
  it("maps 'c' op to PUT", () => {
    const envelope: DebeziumEnvelope = { op: "c", before: null, after: ROW };
    const event = normalizeDebeziumEnvelope(envelope, "farms", META);
    expect(event.operation).toBe("PUT");
    expect(event.docId).toBe("farm-1");
    expect(event.bucket).toBe("tenant:t1:region:north");
    expect(event.tenantId).toBe("t1");
  });

  it("maps 'r' op to PUT", () => {
    const envelope: DebeziumEnvelope = { op: "r", before: null, after: ROW };
    const event = normalizeDebeziumEnvelope(envelope, "farms", META);
    expect(event.operation).toBe("PUT");
  });

  it("maps 'u' op to PATCH and computes delta", () => {
    const before = { ...ROW, name: "Old Name" };
    const after = { ...ROW, name: "New Name" };
    const envelope: DebeziumEnvelope = { op: "u", before, after };
    const event = normalizeDebeziumEnvelope(envelope, "farms", META);
    expect(event.operation).toBe("PATCH");
    expect(event.delta).toEqual({ name: "New Name" });
  });

  it("maps 'd' op to REMOVE using before.id", () => {
    const envelope: DebeziumEnvelope = { op: "d", before: ROW, after: null };
    const event = normalizeDebeziumEnvelope(envelope, "farms", META);
    expect(event.operation).toBe("REMOVE");
    expect(event.docId).toBe("farm-1");
    expect(event.delta).toBeNull();
  });

  it("throws on missing id", () => {
    const { id: _id, ...noId } = ROW;
    const envelope: DebeziumEnvelope = { op: "c", before: null, after: noId };
    expect(() => normalizeDebeziumEnvelope(envelope, "farms", META)).toThrow('Missing "id"');
  });

  it("throws on missing tenant_id", () => {
    const { tenant_id: _t, ...noTenant } = ROW;
    const envelope: DebeziumEnvelope = { op: "c", before: null, after: noTenant };
    expect(() => normalizeDebeziumEnvelope(envelope, "farms", META)).toThrow('"tenant_id"');
  });

  it("includes cdcLsn from source when present", () => {
    const envelope: DebeziumEnvelope = { op: "c", before: null, after: ROW, source: { lsn: 12345 } };
    const event = normalizeDebeziumEnvelope(envelope, "farms", META);
    expect(event.cdcLsn).toBe("12345");
  });

  // SPEC-024 — collection-aware bucket derivation.
  it("by_user collection tags user bucket from user_id", () => {
    const invoiceRow = { id: "inv-1", tenant_id: "t1", user_id: "u9", amount: 10 };
    const event = normalizeDebeziumEnvelope(
      { op: "c", before: null, after: invoiceRow },
      "invoices",
      { sourceTopic: "business.cdc.public.invoices" },
    );
    expect(event.bucket).toBe("tenant:t1:user:u9");
  });

  it("attachments tags user bucket from uploaded_by", () => {
    const attRow = { id: "a-1", tenant_id: "t1", uploaded_by: "u3", storage_path: "/x" };
    const event = normalizeDebeziumEnvelope(
      { op: "c", before: null, after: attRow },
      "attachments",
      { sourceTopic: "business.cdc.public.attachments" },
    );
    expect(event.bucket).toBe("tenant:t1:user:u3");
  });

  it("throws when by_user collection missing user-id field", () => {
    const invoiceRow = { id: "inv-1", tenant_id: "t1", amount: 10 };
    expect(() =>
      normalizeDebeziumEnvelope({ op: "c", before: null, after: invoiceRow }, "invoices", {
        sourceTopic: "business.cdc.public.invoices",
      }),
    ).toThrow('"user_id"');
  });

  it("throws on unknown collection", () => {
    expect(() =>
      normalizeDebeziumEnvelope({ op: "c", before: null, after: ROW }, "nope", {
        sourceTopic: "x",
      }),
    ).toThrow("No bucket strategy");
  });

  // SPEC-025 — client write echo.
  it("tags origin client when client_id + client_seq present", () => {
    const row = { ...ROW, client_id: "device-7", client_seq: 42 };
    const event = normalizeDebeziumEnvelope({ op: "c", before: null, after: row }, "farms", META);
    expect(event.origin).toBe("client");
    expect(event.clientId).toBe("device-7");
    expect(event.clientSeq).toBe(42);
  });

  it("defaults origin server when client fields absent", () => {
    const event = normalizeDebeziumEnvelope({ op: "c", before: null, after: ROW }, "farms", META);
    expect(event.origin).toBe("server");
  });

  // SPEC-028 — deep-equal delta diff.
  it("does not flag unchanged nested object in delta", () => {
    const before = { ...ROW, _meta: { tags: ["a", "b"] }, name: "Old" };
    const after = { ...ROW, _meta: { tags: ["a", "b"] }, name: "New" };
    const event = normalizeDebeziumEnvelope({ op: "u", before, after }, "farms", META);
    expect(event.delta).toEqual({ name: "New" });
    expect(event.delta).not.toHaveProperty("_meta");
  });

  // SPEC-026 — idempotency id.
  it("derives cdcEventId from topic + offset", () => {
    const event = normalizeDebeziumEnvelope({ op: "c", before: null, after: ROW }, "farms", {
      sourceTopic: "business.cdc.public.farms",
      offset: "100",
    });
    expect(event.cdcEventId).toBe("business.cdc.public.farms:100");
  });
});
