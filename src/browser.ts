import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserContext, type Page, chromium } from 'playwright';
import type { FetchOutcome, PageFetcher } from './cycle.ts';
import type { Source } from './sources/index.ts';

/** Um Chromium com perfil persistente e uma aba por chave (fonte). Relança se fechar. */
export class BrowserManager {
  private ctx: BrowserContext | undefined;
  private readonly pages = new Map<string, Page>();

  constructor(private readonly o: { profileDir: string; headless: boolean }) {}

  private async context(): Promise<BrowserContext> {
    if (!this.ctx) {
      mkdirSync(this.o.profileDir, { recursive: true });
      const ctx = await chromium.launchPersistentContext(this.o.profileDir, {
        headless: this.o.headless,
        locale: 'pt-BR',
        viewport: { width: 1280, height: 900 },
      });
      ctx.on('close', () => {
        this.ctx = undefined;
        this.pages.clear();
      });
      this.ctx = ctx;
    }
    return this.ctx;
  }

  async page(key: string): Promise<Page> {
    const existing = this.pages.get(key);
    if (existing && !existing.isClosed()) return existing;
    const page = await (await this.context()).newPage();
    this.pages.set(key, page);
    return page;
  }

  async bringToFront(key: string): Promise<void> {
    await this.pages.get(key)?.bringToFront();
  }

  /** Salva HTML + screenshot da aba para diagnóstico (layout quebrado). */
  async snapshot(key: string, dir: string, name: string): Promise<string> {
    const page = this.pages.get(key);
    if (!page || page.isClosed()) throw new Error(`nenhuma aba aberta para "${key}"`);
    mkdirSync(dir, { recursive: true });
    const base = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}`);
    writeFileSync(`${base}.html`, await page.content());
    await page.screenshot({ path: `${base}.png`, fullPage: true });
    return base;
  }

  async close(): Promise<void> {
    await this.ctx?.close();
  }
}

export class BrowserFetcher implements PageFetcher {
  constructor(
    private readonly browser: BrowserManager,
    private readonly timeoutMs = 30_000,
  ) {}

  async fetch(source: Source, url: string): Promise<FetchOutcome> {
    try {
      const page = await this.browser.page(source.id);
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
      const status = res?.status() ?? null;
      const block = await source.detectBlock(page, status);
      if (block === 'challenge') return { kind: 'challenge' };
      if (block === 'blocked') return { kind: 'blocked', status };
      await source.waitForResults(page);
      const { listings, emptyResult } = await source.extract(page);
      return { kind: 'ok', listings, emptyResult };
    } catch (e) {
      return { kind: 'error', error: e instanceof Error ? e : new Error(String(e)) };
    }
  }
}
