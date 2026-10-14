import { existsSync, readFileSync } from 'node:fs';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { olx } from '../src/sources/olx.ts';

const file = new URL('./fixtures/olx-real-switch-lite.html', import.meta.url);

describe.skipIf(!existsSync(file))('fixture real da OLX (busca switch lite, opst=2)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  it('o adaptador ainda lê a página real', async () => {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
    await page.setContent(readFileSync(file, 'utf8'));
    const { listings, emptyResult } = await olx.extract(page);
    expect(emptyResult).toBe(false);
    expect(listings.length).toBeGreaterThanOrEqual(40);
    for (const l of listings) {
      expect(l.id).toMatch(/^\d+$/);
      expect(l.url).toMatch(/^https:\/\/[a-z]{2}\.olx\.com\.br\//);
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.state).toMatch(/^[A-Z]{2}$/);
      expect(l.buyable).toBe(true); // a busca usa opst=2
    }
    const priced = listings.filter((l) => l.priceCents !== null).length;
    expect(priced / listings.length).toBeGreaterThanOrEqual(0.9);
    expect(await olx.detectBlock(page, 200)).toBe('ok');
  });
});
