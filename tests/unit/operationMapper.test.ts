import { describe, it, expect } from "vitest";
import { legacyToTaxonomy, taxonomyToLegacy } from "../../src/oplog/operationMapper.js";

describe("operationMapper", () => {
  it("maps legacy → taxonomy", () => {
    expect(legacyToTaxonomy("insert")).toBe("PUT");
    expect(legacyToTaxonomy("update")).toBe("PATCH");
    expect(legacyToTaxonomy("delete")).toBe("REMOVE");
  });

  it("maps taxonomy → legacy", () => {
    expect(taxonomyToLegacy("PUT")).toBe("insert");
    expect(taxonomyToLegacy("PATCH")).toBe("update");
    expect(taxonomyToLegacy("REMOVE")).toBe("delete");
  });

  it("MOVE / CLEAR have no legacy equivalent", () => {
    expect(taxonomyToLegacy("MOVE")).toBeNull();
    expect(taxonomyToLegacy("CLEAR")).toBeNull();
  });

  it("round-trips taxonomy values", () => {
    for (const op of ["PUT", "PATCH", "REMOVE"] as const) {
      expect(legacyToTaxonomy(taxonomyToLegacy(op)!)).toBe(op);
    }
  });

  it("passes through taxonomy values defensively", () => {
    expect(legacyToTaxonomy("PUT")).toBe("PUT");
    expect(legacyToTaxonomy("MOVE")).toBe("MOVE");
  });

  it("defaults unknown legacy op to PUT", () => {
    expect(legacyToTaxonomy("garbage")).toBe("PUT");
  });
});
