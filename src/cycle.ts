import type { Watch } from './config.ts';
import { decide } from './decide.ts';
import type { Alert, Listing } from './listing.ts';
import { match } from './matcher.ts';
import type { Notifier } from './notifiers/index.ts';
import type { Source } from './sources/index.ts';
import type { Store } from './store.ts';

export type FetchOutcome =
  | { kind: 'ok'; listings: Listing[]; emptyResult: boolean }
  | { kind: 'challenge' }
  | { kind: 'blocked'; status: number | null }
  | { kind: 'error'; error: Error };

export interface PageFetcher {
  fetch(source: Source, url: string): Promise<FetchOutcome>;
}

export interface CycleDeps {
  fetcher: PageFetcher;
  getSource: (id: string) => Source;
  store: Store;
  notifier: Notifier;
  initialPages: number;
  now?: () => Date;
}

export interface CycleResult {
  outcome: FetchOutcome['kind'];
  pagesRead: number;
  read: number;
  matched: number;
  /** Alertas entregues ao notificador. */
  alerts: number;
  notifyErrors: string[];
  brokenLayout: boolean;
  error?: string;
  ms: number;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Página carregou, mas não deu para ler anúncios: provável mudança de layout (spec §7). */
export function isBrokenLayout(listings: Listing[], emptyResult: boolean): boolean {
  if (listings.length === 0) return !emptyResult;
  return listings.filter((l) => l.priceCents === null).length > listings.length / 2;
}

export async function runCycle(watch: Watch, deps: CycleDeps): Promise<CycleResult> {
  const started = Date.now();
  const source = deps.getSource(watch.source);
  const totalPages = deps.store.hasAny(watch.id) ? 1 : deps.initialPages;
  const byId = new Map<string, Listing>();
  let pagesRead = 0;
  let brokenLayout = false;

  for (let p = 1; p <= totalPages; p++) {
    const out = await deps.fetcher.fetch(source, source.buildUrl(watch, p));
    if (out.kind !== 'ok') {
      if (p === 1) {
        return {
          outcome: out.kind,
          pagesRead: 0,
          read: 0,
          matched: 0,
          alerts: 0,
          notifyErrors: [],
          brokenLayout: false,
          error: out.kind === 'error' ? out.error.message : undefined,
          ms: Date.now() - started,
        };
      }
      break; // página extra da leitura inicial falhou: segue com o que já leu
    }
    pagesRead++;
    if (p === 1) brokenLayout = isBrokenLayout(out.listings, out.emptyResult);
    for (const l of out.listings) if (!byId.has(l.id)) byId.set(l.id, l);
    if (out.listings.length === 0) break;
  }

  const now = (deps.now ?? (() => new Date()))();
  const alerts: Alert[] = [];
  let matched = 0;
  for (const l of byId.values()) {
    const result = match(l, watch);
    if (result.ok) matched++;
    const d = decide(result.ok, l.priceCents, deps.store.get(watch.id, l));
    deps.store.recordSeen(watch.id, l, result.ok, now);
    if (d) alerts.push({ kind: d.alert, watch, listing: l, previousPriceCents: d.previousPriceCents });
  }

  const notifyErrors: string[] = [];
  let delivered = 0;
  for (const group of chunk(alerts, 10)) {
    try {
      await deps.notifier.send(group);
      for (const a of group) deps.store.markNotified(watch.id, a.listing, now);
      delivered += group.length;
    } catch (e) {
      notifyErrors.push((e as Error).message);
    }
  }

  return {
    outcome: 'ok',
    pagesRead,
    read: byId.size,
    matched,
    alerts: delivered,
    notifyErrors,
    brokenLayout,
    ms: Date.now() - started,
  };
}
