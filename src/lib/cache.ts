const CACHE_PREFIX = 'eda_cache:';
const memoryCache = new Map<string, { t: number; d: unknown }>();

export function cacheRead<T>(key: string, maxAgeMs: number): T | null {
  const now = Date.now();
  const mem = memoryCache.get(key);
  if (mem && now - mem.t <= maxAgeMs) return mem.d as T;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const obj = JSON.parse(raw) as { t: number; d: T };
    if (!obj || typeof obj.t !== 'number') return null;
    if (now - obj.t > maxAgeMs) return null;
    memoryCache.set(key, obj);
    return obj.d;
  } catch {
    return null;
  }
}

export function cacheWrite<T>(key: string, data: T): void {
  const obj = { t: Date.now(), d: data };
  memoryCache.set(key, obj);
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(obj));
  } catch {}
}

export function cacheClear(prefix?: string) {
  // clear memory
  if (!prefix) {
    memoryCache.clear();
  } else {
    Array.from(memoryCache.keys()).forEach((k) => { if (k.startsWith(prefix)) memoryCache.delete(k); });
  }
  // clear localStorage
  try {
    if (!prefix) {
      Object.keys(localStorage).forEach((k) => { if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k); });
    } else {
      Object.keys(localStorage).forEach((k) => { if (k.startsWith(CACHE_PREFIX + prefix)) localStorage.removeItem(k); });
    }
  } catch {}
}


