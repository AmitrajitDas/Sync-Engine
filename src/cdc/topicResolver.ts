/*
 * Debezium topic -> collection name mapper.
 *
 * Example: prefix "business.cdc.public." and topic
 * "business.cdc.public.farms" resolves to collection "farms".
 */
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

export function filterTopicsByPrefix(topics: string[], prefix: string): string[] {
  return topics.filter((topic) => topic.startsWith(prefix)).sort();
}
