import { describe, it, expect } from "vitest";
import { resolveCollectionFromTopic } from "../../src/cdc/topicResolver.js";

describe("resolveCollectionFromTopic", () => {
  it("strips prefix and returns collection name", () => {
    expect(resolveCollectionFromTopic("business.cdc.public.farms", "business.cdc.public.")).toBe("farms");
  });

  it("throws on topic not matching prefix", () => {
    expect(() => resolveCollectionFromTopic("other.topic.farms", "business.cdc.public.")).toThrow(
      'Topic "other.topic.farms" does not match expected prefix',
    );
  });

  it("throws on empty collection after prefix", () => {
    expect(() => resolveCollectionFromTopic("business.cdc.public.", "business.cdc.public.")).toThrow(
      "empty collection name",
    );
  });
});
