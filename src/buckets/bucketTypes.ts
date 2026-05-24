import { COLLECTIONS } from "../sync/syncRegistry.js";

export type BucketTag = string;

function deriveGroups(): { BY_REGION: string[]; BY_USER: string[] } {
  const byRegion: string[] = [];
  const byUser: string[] = [];
  for (const [name, c] of Object.entries(COLLECTIONS)) {
    if (c.bucket.group === "by_region") byRegion.push(name);
    else byUser.push(name);
  }
  return { BY_REGION: byRegion, BY_USER: byUser };
}

export const BUCKET_GROUPS = deriveGroups();
