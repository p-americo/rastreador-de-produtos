import { writeFileSync } from 'node:fs';
import { BrowserManager } from '../browser.ts';
import { loadConfig } from '../config.ts';
import { getSource, sources } from '../sources/index.ts';

const id = process.argv[2];
const config = loadConfig(process.env.WATCHES_FILE ?? 'watches.yaml', Object.keys(sources));
const watch = config.watches.find((w) => w.id === id);
if (!watch) {
  console.error(`Uso: npm run capture-fixture -- <id>\nProdutos: ${config.watches.map((w) => w.id).join(', ')}`);
  process.exit(1);
}

const source = getSource(watch.source);
const browser = new BrowserManager({ profileDir: 'data/browser-profile-cli', headless: config.settings.headless });
try {
  const page = await browser.page(source.id);
  const res = await page.goto(source.buildUrl(watch, 1), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const block = await source.detectBlock(page, res?.status() ?? null);
  if (block !== 'ok') {
    console.error(`Página bloqueada (${block}). Rode "npm run check -- ${watch.id}", resolva a verificação e tente de novo.`);
    process.exitCode = 2;
  } else {
    await source.waitForResults(page);
    // remove scripts/estilos para a fixture ficar pequena e não executar nada nos testes
    await page.evaluate(() =>
      document.querySelectorAll('script, style, link, noscript, svg, iframe').forEach((e) => e.remove()),
    );
    const file = `tests/fixtures/${source.id}-real-${watch.id}.html`;
    writeFileSync(file, await page.content());
    console.log(`Salvo em ${file}`);
  }
} finally {
  await browser.close();
}
