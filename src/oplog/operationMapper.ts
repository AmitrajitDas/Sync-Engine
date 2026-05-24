import type { OplogOperation } from "./oplogSchema.js";

export type LegacyOp = "insert" | "update" | "delete";

export function legacyToTaxonomy(op: LegacyOp | string): OplogOperation {
  switch (op) {
    case "insert":
      return "PUT";
    case "update":
      return "PATCH";
    case "delete":
      return "REMOVE";
    case "PUT":
    case "PATCH":
    case "REMOVE":
    case "MOVE":
    case "CLEAR":
      return op;
    default:
      return "PUT";
  }
}

export function taxonomyToLegacy(op: OplogOperation): LegacyOp | null {
  switch (op) {
    case "PUT":
      return "insert";
    case "PATCH":
      return "update";
    case "REMOVE":
      return "delete";
    default:
      return null;
  }
}
