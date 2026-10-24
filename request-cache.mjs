const MINUTE = 60_000;
export const PUBLIC_QUERY_TTL_MS = Object.freeze({
  hotels: 5 * MINUTE,
  nearby: 5 * MINUTE,
  route: 30 * MINUTE,
  geocode: 24 * 60 * MINUTE
});

export function beijingDate(now = Date.now()) {
  return new Date(now + 8 * 60 * MINUTE).toISOString().slice(0, 10);
}

// This allowlist deliberately excludes model input, images, audio and user plans.
// Each key contains every variable used by its public upstream query.
export function publicQueryKey(kind, params, now = Date.now()) {
  if (!Object.hasOwn(PUBLIC_QUERY_TTL_MS, kind)) throw new TypeError('Unsupported public query type');
  const fields = {
    hotels: ['city', 'query', 'checkIn', 'checkOut'],
    nearby: ['city', 'lng', 'lat', 'keyword'],
    route: ['origin', 'destination'],
    geocode: ['city', 'address']
  }[kind];
  if (!fields || !params || fields.some(field => typeof params[field] !== 'string'))
    throw new TypeError('A complete public query context is required');
  return JSON.stringify([kind, ...fields.map(field => params[field]), ...(kind === 'nearby' ? [beijingDate(now)] : [])]);
}

/** In-memory cache for public query results only; pending work also counts toward capacity. */
export function createPublicQueryCache({maxEntries = 512, now = Date.now, assertAccess = () => {}} = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 512)
    throw new RangeError('Public query cache capacity must be between 1 and 512');
  const entries = new Map();
  const touch = (key, entry) => {entries.delete(key); entries.set(key, entry);};
  const prune = time => {
    for (const [key, entry] of entries)
      if (entry.state === 'ready' && entry.expiresAt <= time) entries.delete(key);
  };

  return {
    get size() {prune(now()); return entries.size;},
    async read(kind, params, load) {
      // Explicit service shutdown/access checks apply to hits and pending joins too.
      assertAccess();
      const time = now();
      const key = publicQueryKey(kind, params, time);
      if (typeof load !== 'function') throw new TypeError('A public query loader is required');
      prune(time);
      const existing = entries.get(key);
      if (existing) {
        touch(key, existing);
        return structuredClone(existing.state === 'ready' ? existing.value : await existing.promise);
      }

      if (entries.size >= maxEntries) {
        // Evict the least recently used completed result, never an in-flight request.
        const oldestReady = [...entries].find(([, entry]) => entry.state === 'ready');
        if (oldestReady) entries.delete(oldestReady[0]);
        else throw Object.assign(new Error('实时查询较多，请稍后重试。'), {status:503});
      }

      const entry = {state:'pending', promise:null};
      entries.set(key, entry);
      // Install the shared entry before invoking a loader, including synchronous quota checks.
      entry.promise = Promise.resolve().then(load).then(value => {
        const snapshot = structuredClone(value);
        entry.state = 'ready';
        entry.value = snapshot;
        entry.expiresAt = now() + PUBLIC_QUERY_TTL_MS[kind];
        touch(key, entry);
        return snapshot;
      }, error => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      try {
        return structuredClone(await entry.promise);
      } catch (error) {
        // Clone/serialization errors also fail closed instead of leaving a pending entry.
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      }
    }
  };
}
