/**
 * Loads by key through `load`, keeping the `capacity` most recently used
 * results, so a key loaded again needs no second load. Every caller of a key
 * whose load is still in flight shares that load. A failed load is not kept.
 */
export const createLoader = <T>(
  load: (key: string) => Promise<T>,
  capacity: number,
): ((key: string) => Promise<T>) => {
  // A Map keeps insertion order, so its first key is the least recently used.
  const kept = new Map<string, { readonly value: T }>()
  const inFlight = new Map<string, Promise<T>>()
  const loadAndKeep = async (key: string): Promise<T> => {
    try {
      const value = await load(key)
      kept.set(key, { value })
      const oldest = kept.keys().next()
      if (kept.size > capacity && oldest.done !== true) kept.delete(oldest.value)
      return value
    } finally {
      inFlight.delete(key)
    }
  }
  return async (key) => {
    const hit = kept.get(key)
    if (hit !== undefined) {
      kept.delete(key)
      kept.set(key, hit)
      return hit.value
    }
    const pending = inFlight.get(key)
    if (pending !== undefined) return pending
    const loading = loadAndKeep(key)
    inFlight.set(key, loading)
    return loading
  }
}
