import { describe, it, expect } from "vitest";
import {
  getSchemaResponse,
  resolveTargetVersion,
  CURRENT_SCHEMA_VERSION,
  MIN_SUPPORTED_VERSION,
} from "../../src/sync/clientSchema.js";

describe("resolveTargetVersion", () => {
  it("returns current version when rollout is 100%", () => {
    expect(resolveTargetVersion({ rolloutPercent: 100 })).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("returns previous version (clamped to min) when kill switch enabled", () => {
    // SPEC-030 #3 — never drop below MIN_SUPPORTED_VERSION.
    expect(resolveTargetVersion({ killSwitch: true })).toBe(
      Math.max(MIN_SUPPORTED_VERSION, CURRENT_SCHEMA_VERSION - 1),
    );
  });

  it("kill switch clamps to MIN when CURRENT === MIN", () => {
    // With CURRENT_SCHEMA_VERSION === MIN_SUPPORTED_VERSION, clamp keeps version >= MIN.
    const v = resolveTargetVersion({ killSwitch: true });
    expect(v).toBeGreaterThanOrEqual(MIN_SUPPORTED_VERSION);
  });

  it("is deterministic for same clientKey", () => {
    const a = resolveTargetVersion({ rolloutPercent: 50, clientKey: "abc123" });
    const b = resolveTargetVersion({ rolloutPercent: 50, clientKey: "abc123" });
    expect(a).toBe(b);
  });
});

describe("getSchemaResponse", () => {
  it("returns soft policy for up-to-date client", () => {
    const resp = getSchemaResponse(CURRENT_SCHEMA_VERSION);
    expect(resp.policy).toBe("soft");
    expect(resp.version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("returns blocked policy for version below minimum", () => {
    const resp = getSchemaResponse(0, { minSupportedVersion: 1 });
    expect(resp.policy).toBe("blocked");
  });

  it("throws RangeError when client version exceeds server", () => {
    expect(() => getSchemaResponse(CURRENT_SCHEMA_VERSION + 10)).toThrow(RangeError);
  });

  it("includes minSupportedVersion in response", () => {
    const resp = getSchemaResponse(undefined, { minSupportedVersion: 1 });
    expect(resp.minSupportedVersion).toBe(1);
  });

  it("returns empty migrations when no gap", () => {
    const resp = getSchemaResponse(CURRENT_SCHEMA_VERSION);
    expect(Object.keys(resp.migrations)).toHaveLength(0);
  });
});

describe("migration contiguity assertion", () => {
  it("module loads without throwing (no gaps in current migrations)", () => {
    // If there were a gap, the module-level assertion would throw on import.
    expect(MIN_SUPPORTED_VERSION).toBeGreaterThanOrEqual(1);
  });
});
