import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { StoredListing } from './decide.ts';
import type { Listing } from './listing.ts';

type Key = Pick<Listing, 'source' | 'id'>;

interface Row {
  last_price_cents: number | null;
  notified_price_cents: number | null;
  last_matched: number;
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS listings (
        source TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        watch_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        last_price_cents INTEGER,
        last_matched INTEGER NOT NULL DEFAULT 0,
        notified_price_cents INTEGER,
        notified_at TEXT,
        PRIMARY KEY (source, listing_id, watch_id)
      )`);
  }

  get(watchId: string, l: Key): StoredListing | undefined {
    const row = this.db
      .prepare(
        `SELECT last_price_cents, notified_price_cents, last_matched
         FROM listings WHERE source = ? AND listing_id = ? AND watch_id = ?`,
      )
      .get(l.source, l.id, watchId) as Row | undefined;
    if (!row) return undefined;
    return {
      lastPriceCents: row.last_price_cents,
      notifiedPriceCents: row.notified_price_cents,
      lastMatched: row.last_matched === 1,
    };
  }

  hasAny(watchId: string): boolean {
    return this.db.prepare('SELECT 1 FROM listings WHERE watch_id = ? LIMIT 1').get(watchId) !== undefined;
  }

  recordSeen(watchId: string, l: Listing, matched: boolean, now: Date): void {
    const ts = now.toISOString();
    this.db
      .prepare(
        `INSERT INTO listings
           (source, listing_id, watch_id, title, url, first_seen, last_seen, last_price_cents, last_matched)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (source, listing_id, watch_id) DO UPDATE SET
           title = excluded.title,
           url = excluded.url,
           last_seen = excluded.last_seen,
           last_price_cents = excluded.last_price_cents,
           last_matched = excluded.last_matched`,
      )
      .run(l.source, l.id, watchId, l.title, l.url, ts, ts, l.priceCents, matched ? 1 : 0);
  }

  markNotified(watchId: string, l: Listing, now: Date): void {
    this.db
      .prepare(
        `UPDATE listings SET notified_price_cents = ?, notified_at = ?
         WHERE source = ? AND listing_id = ? AND watch_id = ?`,
      )
      .run(l.priceCents, now.toISOString(), l.source, l.id, watchId);
  }

  purgeOlderThan(cutoff: Date): number {
    const r = this.db.prepare('DELETE FROM listings WHERE last_seen < ?').run(cutoff.toISOString());
    return Number(r.changes);
  }

  close(): void {
    this.db.close();
  }
}
