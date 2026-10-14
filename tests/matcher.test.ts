import { describe, expect, it } from 'vitest';
import { match, matchText } from '../src/matcher.ts';
import { DEFAULT_EXCLUDE, makeListing, makeWatch } from './helpers.ts';

const lite = makeWatch({
  id: 'switch-lite',
  startsWith: ['switch lite|swich lite|switchlite'],
  exclude: DEFAULT_EXCLUDE,
});

describe('matchText', () => {
  it('aceita console com prefixos ignorados', () => {
    expect(matchText('Console Nintendo Switch Oled Desbloqueado', makeWatch())).toEqual({ ok: true });
  });

  it('recusa acessório que vem antes do produto', () => {
    expect(matchText('Case Nintendo switch LITE', lite)).toEqual({ ok: false, reason: 'startsWith' });
  });

  it('aceita acessório que vem depois do produto (brinde)', () => {
    expect(matchText('Nintendo Switch Lite Turquesa(bloqueado) com Case e Capas', lite)).toEqual({ ok: true });
    expect(matchText('?Nintendo Switch Lite Coral Case + Película + Carregador', lite)).toEqual({ ok: true });
  });

  it('aceita erro de digitação via alternativa', () => {
    expect(matchText('Nitendo swich lite desbloqueado semi-novo', lite)).toEqual({ ok: true });
  });

  it('startsWith que começa com palavra de prefixo ignorado ainda casa', () => {
    const w = makeWatch({ startsWith: ['nintendo switch'] });
    expect(matchText('Nintendo Switch V1', w)).toEqual({ ok: true });
    expect(matchText('Console Nintendo Switch V1', w)).toEqual({ ok: true });
  });

  it('exclude soma padrão e produto, como palavra inteira', () => {
    expect(matchText('Nintendo Switch Lite', makeWatch())).toEqual({ ok: false, reason: 'exclude:"lite"' });
    expect(matchText('Nintendo Switch com defeito na tela', makeWatch())).toEqual({
      ok: false,
      reason: 'exclude:"defeito"',
    });
  });

  it('"Avaliamos troca" passa; "troco" é recusado', () => {
    expect(matchText('Switch Lite 32gb (Excelente). Avaliamos Troca, loja física', lite)).toEqual({ ok: true });
    expect(matchText('Switch Lite troco por PS4', lite)).toEqual({ ok: false, reason: 'exclude:"troco"' });
  });

  it('include exige todos os termos', () => {
    const w = makeWatch({ include: ['oled', 'desbloqueado|destravado'] });
    expect(matchText('Nintendo Switch OLED destravado', w)).toEqual({ ok: true });
    expect(matchText('Nintendo Switch OLED', w)).toEqual({ ok: false, reason: 'include:"desbloqueado|destravado"' });
  });
});

describe('match', () => {
  it('limites de preço são inclusivos', () => {
    const w = makeWatch();
    expect(match(makeListing({ priceCents: 40_000 }), w)).toEqual({ ok: true });
    expect(match(makeListing({ priceCents: 120_000 }), w)).toEqual({ ok: true });
    expect(match(makeListing({ priceCents: 39_999 }), w)).toEqual({ ok: false, reason: 'price<min' });
    expect(match(makeListing({ priceCents: 120_001 }), w)).toEqual({ ok: false, reason: 'price>max' });
  });

  it('anúncio sem preço é recusado', () => {
    expect(match(makeListing({ priceCents: null }), makeWatch())).toEqual({ ok: false, reason: 'no-price' });
  });

  it('"Switch Lite R$ 950" é recusado no produto demais modelos', () => {
    const l = makeListing({ title: 'Nintendo Switch Lite', priceCents: 95_000 });
    expect(match(l, makeWatch())).toEqual({ ok: false, reason: 'exclude:"lite"' });
  });

  it('não comprável é sempre recusado, mesmo em cidade de retirada', () => {
    const l = makeListing({ buyable: false, delivery: false, deliveryLabel: undefined });
    expect(match(l, makeWatch())).toEqual({ ok: false, reason: 'not-buyable' });
  });

  it('em cidade de retirada aceita sem entrega', () => {
    const l = makeListing({ delivery: false, deliveryLabel: undefined });
    expect(match(l, makeWatch())).toEqual({ ok: true });
  });

  it('fora da cidade de retirada exige entrega', () => {
    const l = makeListing({ delivery: false, city: 'São Paulo', state: 'SP' });
    expect(match(l, makeWatch())).toEqual({ ok: false, reason: 'no-delivery' });
  });

  it('"Aparecida de Goiânia" não conta como Goiânia', () => {
    const l = makeListing({ delivery: false, city: 'Aparecida de Goiânia', state: 'GO' });
    expect(match(l, makeWatch())).toEqual({ ok: false, reason: 'no-delivery' });
  });

  it('anúncio sem cidade conta como fora', () => {
    const l = makeListing({ delivery: false, city: undefined, state: undefined });
    expect(match(l, makeWatch())).toEqual({ ok: false, reason: 'no-delivery' });
  });

  it('pickupCities vazio exige entrega em todo lugar', () => {
    const l = makeListing({ delivery: false });
    expect(match(l, makeWatch({ pickupCities: [] }))).toEqual({ ok: false, reason: 'no-delivery' });
  });

  it('anúncio impulsionado não é descartado', () => {
    expect(match(makeListing({ boosted: true }), makeWatch())).toEqual({ ok: true });
  });
});
