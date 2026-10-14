import { readFileSync } from 'node:fs';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { olx } from '../src/sources/olx.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.route('**/*', (route) => route.abort()); // nenhum acesso à rede
});

afterAll(async () => {
  await browser.close();
});

describe('olx.extract', () => {
  it('lê os 4 cards da fixture', async () => {
    await page.setContent(fixture('olx-search.html'));
    const { listings, emptyResult } = await olx.extract(page);
    expect(emptyResult).toBe(false);
    expect(listings).toEqual([
      {
        source: 'olx',
        id: '1543000244',
        title: 'Switch Lite Em ótimo estado bloqueado com caixa + película',
        priceCents: 110_000,
        url: 'https://sp.olx.com.br/grande-campinas/games/consoles-de-video-game/switch-lite-em-otimo-estado-bloqueado-com-caixa-pelicula-1543000244',
        image: 'https://img.olx.com.br/thumbs700x500/95/956689335817784.webp',
        location: 'Americana, Jardim Boer I',
        city: 'Americana',
        state: 'SP',
        postedAt: 'Hoje, 10:23',
        boosted: true,
        buyable: true,
        delivery: true,
        deliveryLabel: 'Frete grátis',
      },
      {
        source: 'olx',
        id: '1544200001',
        title: 'Nintendo Switch Lite Turquesa',
        priceCents: 85_000,
        url: 'https://go.olx.com.br/grande-goiania-e-anapolis/games/consoles-de-video-game/nintendo-switch-lite-turquesa-1544200001',
        image: 'https://img.olx.com.br/thumbs700x500/11/111111111111111.webp',
        location: 'Goiânia, Setor Bueno',
        city: 'Goiânia',
        state: 'GO',
        postedAt: 'Hoje, 11:27',
        boosted: false,
        buyable: true,
        delivery: true,
        deliveryLabel: 'Entrega Fácil',
      },
      {
        source: 'olx',
        id: '1544146354',
        title: 'Nintendo switch lite desbloqueado',
        priceCents: 150_000,
        url: 'https://ba.olx.com.br/grande-salvador/games/consoles-de-video-game/nintendo-switch-lite-desbloqueado-1544146354',
        image: 'https://img.olx.com.br/thumbs700x500/22/222222222222222.webp',
        location: 'Salvador, Dom Avelar',
        city: 'Salvador',
        state: 'BA',
        postedAt: 'Hoje, 12:07',
        boosted: false,
        buyable: false,
        delivery: false,
        deliveryLabel: undefined,
      },
      {
        source: 'olx',
        id: '1544100002',
        title: 'Nintendo Switch Lite',
        priceCents: null,
        url: 'https://sc.olx.com.br/norte-de-santa-catarina/games/consoles-de-video-game/nintendo-switch-lite-1544100002',
        image: undefined,
        location: 'Joinville, Vila Nova',
        city: 'Joinville',
        state: 'SC',
        postedAt: 'Ontem, 19:55',
        boosted: false,
        buyable: false,
        delivery: false,
        deliveryLabel: undefined,
      },
    ]);
  });

  it('reconhece busca sem resultados', async () => {
    await page.setContent(fixture('olx-empty.html'));
    expect(await olx.extract(page)).toEqual({ listings: [], emptyResult: true });
  });

  it('página sem cards e sem aviso de vazio não é "vazia"', async () => {
    await page.setContent('<html><body><main>layout novo</main></body></html>');
    expect(await olx.extract(page)).toEqual({ listings: [], emptyResult: false });
  });
});

describe('olx.detectBlock', () => {
  it('página normal com 200 é ok', async () => {
    await page.setContent(fixture('olx-search.html'));
    expect(await olx.detectBlock(page, 200)).toBe('ok');
  });

  it('desafio "Just a moment" é challenge', async () => {
    await page.setContent(fixture('cloudflare-challenge.html'));
    expect(await olx.detectBlock(page, 403)).toBe('challenge');
  });

  it('"you have been blocked" é blocked', async () => {
    await page.setContent(fixture('cloudflare-blocked.html'));
    expect(await olx.detectBlock(page, 403)).toBe('blocked');
  });

  it('403/429 sem página de desafio é blocked', async () => {
    await page.setContent(fixture('olx-empty.html'));
    expect(await olx.detectBlock(page, 403)).toBe('blocked');
    expect(await olx.detectBlock(page, 429)).toBe('blocked');
  });
});

describe('olx.waitForResults', () => {
  it('retorna logo quando há cards ou aviso de vazio', async () => {
    for (const name of ['olx-search.html', 'olx-empty.html']) {
      await page.setContent(fixture(name));
      const t = Date.now();
      await olx.waitForResults(page);
      expect(Date.now() - t).toBeLessThan(2000);
    }
  });
});
