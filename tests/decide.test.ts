import { describe, expect, it } from 'vitest';
import { decide, type StoredListing } from '../src/decide.ts';

const stored = (over: Partial<StoredListing> = {}): StoredListing => ({
  lastPriceCents: 100_000,
  notifiedPriceCents: null,
  lastMatched: false,
  ...over,
});

describe('decide (tabela da spec §6)', () => {
  it('inexistente + passa → NOVO', () => {
    expect(decide(true, 90_000, undefined)).toEqual({ alert: 'new' });
  });

  it('inexistente + não passa → silêncio', () => {
    expect(decide(false, 90_000, undefined)).toBeNull();
  });

  it('existe, nunca notificado, antes fora do filtro, agora passa → PREÇO BAIXOU com preço anterior', () => {
    expect(decide(true, 90_000, stored({ lastPriceCents: 130_000 }))).toEqual({
      alert: 'price_drop',
      previousPriceCents: 130_000,
    });
  });

  it('price_drop sem preço anterior conhecido não inventa valor', () => {
    expect(decide(true, 90_000, stored({ lastPriceCents: null }))).toEqual({ alert: 'price_drop' });
  });

  it('existe, notificado, preço menor que o notificado → BAIXOU DE NOVO', () => {
    expect(decide(true, 80_000, stored({ notifiedPriceCents: 90_000, lastMatched: true }))).toEqual({
      alert: 'price_drop_again',
      previousPriceCents: 90_000,
    });
  });

  it('existe, notificado, preço igual ou maior → nada', () => {
    expect(decide(true, 90_000, stored({ notifiedPriceCents: 90_000, lastMatched: true }))).toBeNull();
    expect(decide(true, 95_000, stored({ notifiedPriceCents: 90_000, lastMatched: true }))).toBeNull();
  });

  it('existe e não passa → nada', () => {
    expect(decide(false, 50_000, stored({ notifiedPriceCents: 90_000 }))).toBeNull();
  });

  it('passou antes mas o envio falhou (nunca notificado) → NOVO de novo', () => {
    expect(decide(true, 90_000, stored({ lastPriceCents: 90_000, lastMatched: true }))).toEqual({ alert: 'new' });
  });
});
