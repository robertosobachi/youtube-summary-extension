// Pure helpers over the stored data. The service worker does the reading and writing.
import type { Summary } from './messages';

export type Summaries = Record<string, Summary>;

/** Videos you marked Not interested from the drawer: id -> "title [channel]". */
export type Rejected = Record<string, string>;

/**
 * Drops the oldest 10% of summaries by `at` (at least one) to get back under the storage
 * quota. `keep` is the summary being saved, which never goes.
 */
export function evictOldest(summaries: Summaries, keep: string): Summaries {
  const others = Object.entries(summaries)
    .filter(([id]) => id !== keep)
    .sort(([, a], [, b]) => a.at - b.at);
  const drop = new Set(
    others.slice(0, Math.max(1, Math.ceil(others.length / 10))).map(([id]) => id),
  );
  return Object.fromEntries(Object.entries(summaries).filter(([id]) => !drop.has(id)));
}
