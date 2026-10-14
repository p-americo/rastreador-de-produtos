import { describe, expect, it } from 'vitest';
import { type RawCard, buildUrl, parseCard, parsePrice } from '../src/sources/olx.ts';
import { makeWatch } from './helpers.ts';

describe('buildUrl', () => {
  it('Brasil todo, página 1, sempre com opst=2 e mais recentes', () => {
    expect(buildUrl(makeWatch({ query: 'switch lite', region: 'brasil' }), 1)).toBe(
      'https://www.olx.com.br/games?q=switch+lite&sf=1&opst=2',
    );
  });

  it('estado e paginação', () => {
    expect(buildUrl(makeWatch({ query: 'switch lite', region: 'go' }), 2)).toBe(
      'https://www.olx.com.br/games/estado-go?q=switch+lite&sf=1&opst=2&o=2',
    );
  });

  it('estado/região', () => {
    expect(buildUrl(makeWatch({ query: 'switch', region: 'go/grande-goiania-e-anapolis' }), 1)).toBe(
      'https://www.olx.com.br/games/estado-go/grande-goiania-e-anapolis?q=switch&sf=1&opst=2',
    );
  });

  it('codifica acentos na busca', () => {
    expect(buildUrl(makeWatch({ query: 'ps vita edição', region: 'brasil' }), 1)).toBe(
      'https://www.olx.com.br/games?q=ps+vita+edi%C3%A7%C3%A3o&sf=1&opst=2',
    );
  });

  it('searchUrl recebe opst=2, ordenação e paginação por cima', () => {
    const w = makeWatch({
      query: undefined,
      searchUrl: 'https://www.olx.com.br/games/consoles-de-video-game/estado-go?q=switch&opst=1&o=5&sp=2',
    });
    const p1 = new URL(buildUrl(w, 1));
    expect(p1.pathname).toBe('/games/consoles-de-video-game/estado-go');
    expect(p1.searchParams.get('q')).toBe('switch');
    expect(p1.searchParams.get('opst')).toBe('2');
    expect(p1.searchParams.get('sf')).toBe('1');
    expect(p1.searchParams.get('sp')).toBe('2');
    expect(p1.searchParams.has('o')).toBe(false);
    expect(new URL(buildUrl(w, 3)).searchParams.get('o')).toBe('3');
  });
});

describe('parsePrice', () => {
  it('lê reais e centavos', () => {
    expect(parsePrice('R$ 1.100')).toBe(110_000);
    expect(parsePrice('R$ 850')).toBe(85_000);
    expect(parsePrice('R$ 1.299,90')).toBe(129_990);
    expect(parsePrice('R$ 99,5')).toBe(9_950);
    expect(parsePrice('R$ 1.400')).toBe(140_000);
  });

  it('sem preço legível vira null', () => {
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice('Grátis')).toBeNull();
  });
});

const raw = (over: Partial<RawCard> = {}): RawCard => ({
  title: 'Nintendo Switch Lite',
  href: 'https://go.olx.com.br/grande-goiania-e-anapolis/games/consoles-de-video-game/nintendo-switch-lite-123?lis=x',
  priceText: 'R$ 850',
  badges: ['Entrega Fácil', 'Parcele sem juros'],
  primaryBadge: null,
  location: 'Goiânia, Setor Bueno',
  date: 'Hoje, 11:27',
  image: 'https://img.olx.com.br/a.webp',
  ...over,
});

describe('parseCard', () => {
  it('converte o card em Listing', () => {
    expect(parseCard(raw())).toEqual({
      source: 'olx',
      id: '123',
      title: 'Nintendo Switch Lite',
      priceCents: 85_000,
      url: 'https://go.olx.com.br/grande-goiania-e-anapolis/games/consoles-de-video-game/nintendo-switch-lite-123',
      image: 'https://img.olx.com.br/a.webp',
      location: 'Goiânia, Setor Bueno',
      city: 'Goiânia',
      state: 'GO',
      postedAt: 'Hoje, 11:27',
      boosted: false,
      buyable: true,
      delivery: true,
      deliveryLabel: 'Entrega Fácil',
    });
  });

  it('"Parcele sem juros" sozinho não é comprável', () => {
    const l = parseCard(raw({ badges: ['Parcele sem juros'] }))!;
    expect(l.buyable).toBe(false);
    expect(l.delivery).toBe(false);
    expect(l.deliveryLabel).toBeUndefined();
  });

  it('reconhece selo com caixa e espaços diferentes', () => {
    expect(parseCard(raw({ badges: ['  FRETE GRÁTIS '] }))!.deliveryLabel).toBe('FRETE GRÁTIS');
  });

  it('destaque/impulsionado viram boosted', () => {
    expect(parseCard(raw({ primaryBadge: 'Destaque' }))!.boosted).toBe(true);
    expect(parseCard(raw({ primaryBadge: 'Impulsionado' }))!.boosted).toBe(true);
  });

  it('colapsa espaços do título', () => {
    expect(parseCard(raw({ title: ' Nintendo switch  lite ' }))!.title).toBe('Nintendo switch lite');
  });

  it('host www não vira UF', () => {
    expect(parseCard(raw({ href: 'https://www.olx.com.br/item/switch-lite-55' }))!.state).toBeUndefined();
  });

  it('card sem id, sem link válido ou sem título é descartado', () => {
    expect(parseCard(raw({ href: 'https://go.olx.com.br/games/sem-id' }))).toBeNull();
    expect(parseCard(raw({ href: '' }))).toBeNull();
    expect(parseCard(raw({ title: '  ' }))).toBeNull();
  });
});
