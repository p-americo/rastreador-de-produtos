import type { Watch } from '../src/config.ts';
import type { Listing } from '../src/listing.ts';

export const DEFAULT_PREFIXES = [
  'console', 'nintendo', 'nitendo', 'sony', 'playstation', 'video game',
  'videogame', 'vendo', 'vende se', 'novo', 'nova',
];

export const DEFAULT_EXCLUDE = [
  'defeito', 'defeituoso', 'quebrado', 'quebrada', 'nao liga', 'nao funciona',
  'pecas', 'sucata', 'troco', 'so troca', 'somente troca', 'apenas troca',
  'procuro', 'compro', 'aluguel', 'caixa vazia', 'so a caixa', 'somente a caixa',
];

/** Produto "Switch (demais modelos)" da spec, já resolvido. */
export function makeWatch(over: Partial<Watch> = {}): Watch {
  return {
    id: 'switch',
    name: 'Nintendo Switch',
    source: 'olx',
    query: 'nintendo switch',
    region: 'brasil',
    maxPriceCents: 120_000,
    minPriceCents: 40_000,
    startsWith: ['switch|swich'],
    include: [],
    exclude: [...DEFAULT_EXCLUDE, 'lite'],
    ignorePrefixes: DEFAULT_PREFIXES,
    pickupCities: [{ city: 'goiania', state: 'go' }],
    enabled: true,
    ...over,
  };
}

export function makeListing(over: Partial<Listing> = {}): Listing {
  return {
    source: 'olx',
    id: '1000',
    title: 'Nintendo Switch V2 desbloqueado',
    priceCents: 100_000,
    url: 'https://go.olx.com.br/x/nintendo-switch-1000',
    location: 'Goiânia, Setor Bueno',
    city: 'Goiânia',
    state: 'GO',
    postedAt: 'Hoje, 10:00',
    boosted: false,
    buyable: true,
    delivery: true,
    deliveryLabel: 'Entrega Fácil',
    ...over,
  };
}
