/**
 * localStorage-backed display cache for the latest page of each session.
 *
 * Purpose: when the app cold-starts (home-screen PWA), a session the user
 * opens renders its cached latest page instantly while
 * `useSessionStore.fetchFromServer` refreshes from the backend. The backend
 * JSONL remains the source of truth — this cache is never authoritative and
 * is always overwritten by the next successful server fetch.
 */

import type { NormalizedMessage } from './useSessionStore';

const CACHE_KEY = 'cloudcli.sessionMessagesCache.v1';
/** Keep the most recent N opened sessions (LRU by write time). */
const MAX_CACHED_SESSIONS = 24;
/** Refuse to cache transcripts larger than ~1 MB. */
const MAX_ENTRY_CHARS = 1_000_000;

export interface CachedSessionPage {
  messages: NormalizedMessage[];
  total: number;
  hasMore: boolean;
  cachedAt: number;
}

type CacheShape = Record<string, CachedSessionPage>;

function readCache(): CacheShape {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CacheShape;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
}

function writeCache(cache: CacheShape): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Quota exceeded or storage unavailable — the cache is best-effort.
  }
}

function isUsableEntry(entry: CachedSessionPage | undefined): entry is CachedSessionPage {
  return Boolean(
    entry
    && Array.isArray(entry.messages)
    && typeof entry.total === 'number'
    && typeof entry.cachedAt === 'number',
  );
}

/**
 * Persist the latest server page for one session. Called after a successful
 * latest-page fetch; older history loaded via `fetchMore` is not persisted.
 */
export function saveSessionPageCache(
  sessionId: string,
  messages: NormalizedMessage[],
  total: number,
  hasMore: boolean,
): void {
  if (!sessionId || !Array.isArray(messages) || messages.length === 0) {
    return;
  }

  try {
    const serialized = JSON.stringify(messages);
    if (serialized.length > MAX_ENTRY_CHARS) {
      return;
    }

    const cache = readCache();
    // Drop any other entry that would push us past the LRU bound.
    const entries = Object.entries(cache)
      .filter(([key]) => key !== sessionId)
      .sort((a, b) => b[1].cachedAt - a[1].cachedAt)
      .slice(0, MAX_CACHED_SESSIONS - 1);

    const next: CacheShape = {
      [sessionId]: { messages, total, hasMore, cachedAt: Date.now() },
    };
    for (const [key, value] of entries) {
      next[key] = value;
    }
    writeCache(next);
  } catch {
    // Best-effort only.
  }
}

/** Remove one session from the cache (e.g. after the session was deleted). */
export function clearSessionPageCache(sessionId: string): void {
  const cache = readCache();
  if (!(sessionId in cache)) {
    return;
  }
  delete cache[sessionId];
  writeCache(cache);
}

export function loadSessionPageCache(sessionId: string): CachedSessionPage | null {
  if (!sessionId) {
    return null;
  }
  const entry = readCache()[sessionId];
  return isUsableEntry(entry) ? entry : null;
}
