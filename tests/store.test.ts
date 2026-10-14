import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.ts';
import { makeListing } from './helpers.ts';

const T0 = new Date('2026-10-14T10:00:00Z');

describe('Store', () => {
  it('começa vazio', () => {
    const s = new Store(':memory:');
    expect(s.hasAny('switch')).toBe(false);
    expect(s.get('switch', makeListing())).toBeUndefined();
  });

  it('registra visto e devolve o histórico por produto', () => {
    const s = new Store(':memory:');
    const l = makeListing({ id: '1', priceCents: 100_000 });
    s.recordSeen('switch', l, true, T0);
    expect(s.hasAny('switch')).toBe(true);
    expect(s.hasAny('ps-vita')).toBe(false);
    expect(s.get('switch', l)).toEqual({ lastPriceCents: 100_000, notifiedPriceCents: null, lastMatched: true });
    expect(s.get('ps-vita', l)).toBeUndefined();
  });

  it('atualiza preço e filtro ao ver de novo', () => {
    const s = new Store(':memory:');
    s.recordSeen('switch', makeListing({ id: '1', priceCents: 100_000 }), false, T0);
    s.recordSeen('switch', makeListing({ id: '1', priceCents: 80_000 }), true, T0);
    expect(s.get('switch', makeListing({ id: '1' }))).toEqual({
      lastPriceCents: 80_000,
      notifiedPriceCents: null,
      lastMatched: true,
    });
  });

  it('marca como notificado com o preço atual', () => {
    const s = new Store(':memory:');
    const l = makeListing({ id: '1', priceCents: 90_000 });
    s.recordSeen('switch', l, true, T0);
    s.markNotified('switch', l, T0);
    expect(s.get('switch', l)?.notifiedPriceCents).toBe(90_000);
  });

  it('aceita anúncio sem preço', () => {
    const s = new Store(':memory:');
    const l = makeListing({ id: '1', priceCents: null });
    s.recordSeen('switch', l, false, T0);
    expect(s.get('switch', l)?.lastPriceCents).toBeNull();
  });

  it('remove registros não vistos desde a data de corte', () => {
    const s = new Store(':memory:');
    s.recordSeen('switch', makeListing({ id: 'old' }), false, new Date('2026-09-01T00:00:00Z'));
    s.recordSeen('switch', makeListing({ id: 'new' }), false, T0);
    expect(s.purgeOlderThan(new Date('2026-09-14T00:00:00Z'))).toBe(1);
    expect(s.get('switch', makeListing({ id: 'old' }))).toBeUndefined();
    expect(s.get('switch', makeListing({ id: 'new' }))).toBeDefined();
  });

  it('persiste em arquivo entre aberturas', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'store-')), 'sub', 'tracker.db');
    const a = new Store(path);
    a.recordSeen('switch', makeListing({ id: '1' }), true, T0);
    a.close();
    const b = new Store(path);
    expect(b.hasAny('switch')).toBe(true);
    b.close();
  });
});
