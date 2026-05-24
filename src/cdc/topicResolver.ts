export function resolveCollectionFromTopic(topic: string, prefix: string): string {
  if (!topic.startsWith(prefix)) {
    throw new Error(`Topic "${topic}" does not match expected prefix "${prefix}"`);
  }
  const collection = topic.slice(prefix.length);
  if (!collection) {
    throw new Error(`Topic "${topic}" has empty collection name after prefix "${prefix}"`);
  }
  return collection;
}
