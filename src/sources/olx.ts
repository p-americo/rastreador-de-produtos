import type { Page } from 'playwright';
import type { Watch } from '../config.ts';
import type { Listing } from '../listing.ts';
import type { BlockStatus, ExtractResult, Source } from './index.ts';

/** Dados crus de um card, lidos no navegador. */
export interface RawCard {
  title: string;
  href: string;
  priceText: string | null;
  badges: string[];
  primaryBadge: string | null;
  location: string | null;
  date: string | null;
  image: string | null;
}

const BASE = 'https://www.olx.com.br/games';
/** Selos que indicam botão "Comprar" com Garantia da OLX (spec §2). "Parcele sem juros" NÃO conta. */
const DELIVERY_BADGES = ['entrega fácil', 'frete grátis'];
const EMPTY_TEXT = 'Nenhum anúncio foi encontrado';

export function buildUrl(watch: Watch, page: number): string {
  let url: URL;
  if (watch.searchUrl) {
    url = new URL(watch.searchUrl);
  } else {
    url = new URL(watch.region === 'brasil' ? BASE : `${BASE}/${regionPath(watch.region)}`);
    url.searchParams.set('q', watch.query ?? '');
  }
  url.searchParams.set('sf', '1'); // mais recentes
  url.searchParams.set('opst', '2'); // só anúncios com entrega/compra imediata (regra fixa)
  if (page > 1) url.searchParams.set('o', String(page));
  else url.searchParams.delete('o');
  return url.toString();
}

function regionPath(region: string): string {
  const [uf, sub] = region.split('/');
  return sub ? `estado-${uf}/${sub}` : `estado-${uf}`;
}

export function parsePrice(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/R\$\s*([\d.]+)(?:,(\d{1,2}))?/);
  if (!m) return null;
  const reais = Number(m[1].replace(/\./g, ''));
  const cents = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  return reais * 100 + cents;
}

export function parseCard(c: RawCard): Listing | null {
  let u: URL;
  try {
    u = new URL(c.href);
  } catch {
    return null;
  }
  const id = u.pathname.match(/-(\d+)\/?$/)?.[1];
  const title = c.title.replace(/\s+/g, ' ').trim();
  if (!id || !title) return null;

  const deliveryLabel = c.badges
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .find((b) => DELIVERY_BADGES.includes(b.toLowerCase()));
  const sub = u.hostname.split('.')[0];
  const location = c.location?.replace(/\s+/g, ' ').trim() || undefined;

  return {
    source: 'olx',
    id,
    title,
    priceCents: parsePrice(c.priceText),
    url: `${u.origin}${u.pathname}`,
    image: c.image ?? undefined,
    location,
    city: location?.split(',')[0].trim() || undefined,
    state: /^[a-z]{2}$/.test(sub) ? sub.toUpperCase() : undefined,
    postedAt: c.date?.trim() || undefined,
    boosted: /destaque|impulsionado/i.test(c.primaryBadge ?? ''),
    buyable: deliveryLabel !== undefined,
    delivery: deliveryLabel !== undefined,
    deliveryLabel,
  };
}

async function extract(page: Page): Promise<ExtractResult> {
  const raw: RawCard[] = await page.$$eval('section.olx-adcard', (cards) =>
    cards.map((c) => {
      const text = (sel: string) => c.querySelector(sel)?.textContent?.trim() || null;
      const link = c.querySelector<HTMLAnchorElement>('a[data-testid="adcard-link"], a.olx-adcard__link');
      return {
        title: text('h2') ?? link?.getAttribute('title') ?? '',
        href: link?.href ?? '',
        priceText: text('.olx-adcard__price'),
        badges: [...c.querySelectorAll('.olx-adcard__badges .olx-core-badge')].map((b) => b.textContent ?? ''),
        primaryBadge: text('.olx-adcard__primary-badge'),
        location: text('.olx-adcard__location'),
        date: text('.olx-adcard__date'),
        image: c.querySelector('img')?.getAttribute('src') ?? null,
      };
    }),
  );
  const listings = raw.map(parseCard).filter((l): l is Listing => l !== null);
  const emptyResult = raw.length === 0 && (await page.getByText(EMPTY_TEXT).count()) > 0;
  return { listings, emptyResult };
}

async function detectBlock(page: Page, status: number | null): Promise<BlockStatus> {
  const title = await page.title().catch(() => '');
  const body = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
  if (/you have been blocked|voc[eê] foi bloquead/i.test(body)) return 'blocked';
  if (/just a moment|um momento|attention required/i.test(title)) return 'challenge';
  const widgets = await page
    .locator('#challenge-form, iframe[src*="challenges.cloudflare.com"], iframe[src*="challenge-platform"]')
    .count();
  if (widgets > 0) return 'challenge';
  if (status === 403 || status === 429) return 'blocked';
  return 'ok';
}

async function waitForResults(page: Page): Promise<void> {
  await page
    .locator('section.olx-adcard')
    .or(page.getByText(EMPTY_TEXT))
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
}

export const olx: Source = { id: 'olx', buildUrl, extract, detectBlock, waitForResults };
