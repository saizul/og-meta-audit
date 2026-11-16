/**
 * Maps `items` through an async function with at most `limit` calls running at
 * once. Results keep the input order. A rejected call rejects the whole map,
 * so callers that must not fail should catch inside `fn`.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  }
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
