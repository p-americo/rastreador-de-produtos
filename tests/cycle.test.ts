import { describe, expect, it } from 'vitest';
import type { Watch } from '../src/config.ts';
import { type FetchOutcome, type PageFetcher, chunk, isBrokenLayout, runCycle } from '../src/cycle.ts';
import type { Alert, Listing } from '../src/listing.ts';
import type { Notifier } from '../src/notifiers/index.ts';
import type { Source } from '../src/sources/index.ts';
import { Store } from '../src/store.ts';
import { makeListing, makeWatch } from './helpers.ts';

const fakeSource: Source = {
  id: 'olx',
  buildUrl: (w, p) => `fake://${w.id}/${p}`,
  extract: async () => ({ listings: [], emptyResult: true }),
  detectBlock: async () => 'ok',
  waitForResults: async () => {},
};

class FakeFetcher implements PageFetcher {
  calls: string[] = [];
  constructor(public pages: Record<string, FetchOutcome> = {}) {}
  async fetch(_s: Source, url: string): Promise<FetchOutcome> {
    this.calls.push(url);
    return this.pages[url] ?? { kind: 'ok', listings: [], emptyResult: true };
  }
}

class FakeNotifier implements Notifier {
  sent: Alert[][] = [];
  failNext = false;
  async send(alerts: Alert[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('discord fora');
    }
    this.sent.push(alerts);
  }
  async notify(): Promise<void> {}
}

const ok = (...listings: Listing[]): FetchOutcome => ({ kind: 'ok', listings, emptyResult: false });
const A = makeListing({ id: 'A', title: 'Nintendo Switch V1', priceCents: 100_000 });
const B = makeListing({ id: 'B', title: 'Case Nintendo Switch', priceCents: 5_000 });
const C = makeListing({ id: 'C', title: 'Nintendo Switch OLED', priceCents: 110_000 });

function setup(watch: Watch = makeWatch()) {
  const fetcher = new FakeFetcher();
  const notifier = new FakeNotifier();
  const store = new Store(':memory:');
  const run = (w: Watch = watch) =>
    runCycle(w, { fetcher, getSource: () => fakeSource, store, notifier, initialPages: 3 });
  return { fetcher, notifier, store, run };
}

describe('runCycle', () => {
  it('1º ciclo lê as páginas iniciais e notifica os que passam', async () => {
    const { fetcher, notifier, store, run } = setup();
    fetcher.pages = { 'fake://switch/1': ok(A, B), 'fake://switch/2': ok(C), 'fake://switch/3': ok() };
    const r = await run();
    expect(fetcher.calls).toEqual(['fake://switch/1', 'fake://switch/2', 'fake://switch/3']);
    expect(r).toMatchObject({ outcome: 'ok', pagesRead: 3, read: 3, matched: 2, alerts: 2, brokenLayout: false });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].map((a) => [a.kind, a.listing.id])).toEqual([['new', 'A'], ['new', 'C']]);
    expect(store.get('switch', A)?.notifiedPriceCents).toBe(100_000);
    expect(store.get('switch', B)).toEqual({ lastPriceCents: 5_000, notifiedPriceCents: null, lastMatched: false });
  });

  it('2º ciclo lê só a página 1 e não repete alerta', async () => {
    const { fetcher, notifier, run } = setup();
    fetcher.pages = { 'fake://switch/1': ok(A) };
    await run();
    fetcher.calls = [];
    const r = await run();
    expect(fetcher.calls).toEqual(['fake://switch/1']);
    expect(r.alerts).toBe(0);
    expect(notifier.sent).toHaveLength(1);
  });

  it('nova queda de preço gera BAIXOU DE NOVO', async () => {
    const { fetcher, notifier, run } = setup();
    fetcher.pages = { 'fake://switch/1': ok(A) };
    await run();
    fetcher.pages = { 'fake://switch/1': ok({ ...A, priceCents: 90_000 }) };
    await run();
    expect(notifier.sent[1][0]).toMatchObject({ kind: 'price_drop_again', previousPriceCents: 100_000 });
  });

  it('aumentar o teto notifica anúncio que antes estava acima', async () => {
    const { fetcher, notifier, run } = setup();
    const caro = makeListing({ id: 'D', title: 'Nintendo Switch OLED', priceCents: 130_000 });
    fetcher.pages = { 'fake://switch/1': ok(caro) };
    await run();
    expect(notifier.sent).toHaveLength(0);
    await run(makeWatch({ maxPriceCents: 150_000 }));
    expect(notifier.sent[0][0]).toMatchObject({ kind: 'price_drop', previousPriceCents: 130_000 });
  });

  it('falha no Discord: não marca e reenvia como NOVO no ciclo seguinte', async () => {
    const { fetcher, notifier, store, run } = setup();
    fetcher.pages = { 'fake://switch/1': ok(A) };
    notifier.failNext = true;
    const r1 = await run();
    expect(r1.alerts).toBe(0);
    expect(r1.notifyErrors).toEqual(['discord fora']);
    expect(store.get('switch', A)?.notifiedPriceCents).toBeNull();
    await run();
    expect(notifier.sent[0][0]).toMatchObject({ kind: 'new' });
    expect(store.get('switch', A)?.notifiedPriceCents).toBe(100_000);
  });

  it('desafio na página 1: nada é gravado nem enviado', async () => {
    const { fetcher, notifier, store, run } = setup();
    fetcher.pages = { 'fake://switch/1': { kind: 'challenge' } };
    const r = await run();
    expect(r.outcome).toBe('challenge');
    expect(store.hasAny('switch')).toBe(false);
    expect(notifier.sent).toHaveLength(0);
  });

  it('erro na página 1 devolve a mensagem', async () => {
    const { fetcher, run } = setup();
    fetcher.pages = { 'fake://switch/1': { kind: 'error', error: new Error('net::ERR_TIMED_OUT') } };
    expect(await run()).toMatchObject({ outcome: 'error', error: 'net::ERR_TIMED_OUT' });
  });

  it('falha numa página extra da leitura inicial: processa o que já leu', async () => {
    const { fetcher, notifier, run } = setup();
    fetcher.pages = { 'fake://switch/1': ok(A), 'fake://switch/2': { kind: 'blocked', status: 403 } };
    const r = await run();
    expect(r).toMatchObject({ outcome: 'ok', pagesRead: 1, alerts: 1 });
    expect(notifier.sent[0][0].listing.id).toBe('A');
  });

  it('o mesmo anúncio repetido gera um único alerta', async () => {
    const { fetcher, notifier, run } = setup();
    fetcher.pages = { 'fake://switch/1': ok(A, A), 'fake://switch/2': ok(A), 'fake://switch/3': ok() };
    const r = await run();
    expect(r.read).toBe(1);
    expect(notifier.sent.flat()).toHaveLength(1);
  });

  it('mais de 10 alertas vão em mensagens de até 10', async () => {
    const { fetcher, notifier, run } = setup();
    const many = Array.from({ length: 12 }, (_, i) =>
      makeListing({ id: `L${i}`, title: 'Nintendo Switch V1', priceCents: 100_000 }),
    );
    fetcher.pages = { 'fake://switch/1': ok(...many) };
    const r = await run();
    expect(notifier.sent.map((m) => m.length)).toEqual([10, 2]);
    expect(r.alerts).toBe(12);
  });

  it('marca layout quebrado quando a página não traz anúncios válidos', async () => {
    const { fetcher, run } = setup();
    fetcher.pages = { 'fake://switch/1': { kind: 'ok', listings: [], emptyResult: false } };
    expect((await run()).brokenLayout).toBe(true);
  });
});

describe('isBrokenLayout', () => {
  it('busca vazia declarada não é quebra', () => {
    expect(isBrokenLayout([], true)).toBe(false);
    expect(isBrokenLayout([], false)).toBe(true);
  });

  it('mais da metade sem preço é quebra', () => {
    const sem = makeListing({ priceCents: null });
    const com = makeListing();
    expect(isBrokenLayout([sem, sem, com], false)).toBe(true);
    expect(isBrokenLayout([sem, com], false)).toBe(false);
  });
});

describe('chunk', () => {
  it('divide em blocos', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
  });
});
