import type { OplogService } from "../oplog/oplogService.js";
import type { WriteRequest } from "../sync/syncTypes.js";
import { COLLECTIONS } from "../sync/syncRegistry.js";
import type { ConflictResult, ConflictStrategy } from "./conflictTypes.js";
import { LastWriteWinsStrategy } from "./strategies/lastWriteWins.js";
import { ServerWinsStrategy } from "./strategies/serverWins.js";

function deriveLwwCollections(): Set<string> {
  return new Set(
    Object.entries(COLLECTIONS)
      .filter(([, c]) => c.conflict === "lastWriteWins")
      .map(([k]) => k),
  );
}

export const LWW_COLLECTIONS: Set<string> = deriveLwwCollections();

const lww = new LastWriteWinsStrategy();
const serverWins = new ServerWinsStrategy();

function selectStrategy(collection: string): ConflictStrategy {
  return LWW_COLLECTIONS.has(collection) ? lww : serverWins;
}

export class ConflictResolver {
  constructor(private readonly oplogService: OplogService) {}

  async resolve(write: WriteRequest): Promise<ConflictResult> {
    // SPEC-029 — bounded single-row lookup instead of full history scan.
    const serverLatest = await this.oplogService.getLatestForDocument(
      write.collection,
      write.docId,
    );

    const strategy = selectStrategy(write.collection);
    return strategy.resolve({ write, serverLatest });
  }
}
