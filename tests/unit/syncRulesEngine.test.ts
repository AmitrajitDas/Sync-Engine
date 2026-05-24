import { describe, it, expect } from "vitest";
import { validateWrite } from "../../src/sync/syncRulesEngine.js";
import { ValidationError } from "../../src/gateway/plugins/errorHandler.js";
import type { SyncUser } from "../../src/gateway/types.js";
import type { WriteRequest } from "../../src/sync/syncTypes.js";

const USER: SyncUser = {
  sub: "u1",
  tenantId: "t1",
  tenantSlug: "t1",
  region: "north",
  roles: ["field_agent"],
};

const BASE_WRITE: WriteRequest = {
  collection: "farms",
  docId: "farm-1",
  operation: "PATCH",
  payload: { name: "Farm A", tenant_id: "t1", created_at: "2024-01-01" },
  clientTimestamp: new Date().toISOString(),
  baseSeq: 0,
  clientSeq: 1,
  idempotencyKey: "key-1",
};

describe("validateWrite", () => {
  it("strips protected fields from payload", () => {
    const result = validateWrite(BASE_WRITE, USER);
    expect(result.payload).not.toHaveProperty("tenant_id");
    expect(result.payload).not.toHaveProperty("created_at");
    expect(result.payload).toHaveProperty("name");
  });

  it("throws ValidationError for unknown collection", () => {
    expect(() => validateWrite({ ...BASE_WRITE, collection: "unknown" }, USER)).toThrow(
      ValidationError,
    );
  });

  it("throws ValidationError when role not allowed", () => {
    const adminOnly: WriteRequest = { ...BASE_WRITE, collection: "invoices" };
    expect(() => validateWrite(adminOnly, USER)).toThrow(ValidationError);
  });

  it("throws ValidationError for disallowed operation", () => {
    const removeWrite: WriteRequest = { ...BASE_WRITE, collection: "farms", operation: "REMOVE" };
    expect(() => validateWrite(removeWrite, USER)).toThrow(ValidationError);
  });

  it("allows operation when user has correct role", () => {
    const admin = { ...USER, roles: ["tenant_admin"] };
    const result = validateWrite({ ...BASE_WRITE, collection: "invoices", operation: "PUT" }, admin);
    expect(result.collection).toBe("invoices");
  });

  it("fails ownership check for non-admin", () => {
    const otherOwner: WriteRequest = {
      ...BASE_WRITE,
      payload: { created_by: "other-user" },
    };
    expect(() => validateWrite(otherOwner, USER)).toThrow("Ownership check");
  });

  // SPEC-031 — clients cannot emit MOVE / CLEAR.
  it("rejects MOVE from client", () => {
    expect(() =>
      validateWrite({ ...BASE_WRITE, operation: "MOVE" as never }, USER),
    ).toThrow("client cannot emit");
  });

  it("rejects CLEAR from client", () => {
    expect(() =>
      validateWrite({ ...BASE_WRITE, operation: "CLEAR" as never }, USER),
    ).toThrow("client cannot emit");
  });
});
