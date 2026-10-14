import { BrowserFetcher, BrowserManager } from '../browser.ts';
import { waitForChallenge } from '../challenge.ts';
import { loadConfig } from '../config.ts';
import { match } from '../matcher.ts';
import { getSource, sources } from '../sources/index.ts';
import { formatCheckLine } from './format.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // opcional para este comando
}

const id = process.argv[2];
const config = loadConfig(process.env.WATCHES_FILE ?? 'watches.yaml', Object.keys(sources));
const watch = config.watches.find((w) => w.id === id);
if (!watch) {
  console.error(`Uso: npm run check -- <id>\nProdutos: ${config.watches.map((w) => w.id).join(', ')}`);
  process.exit(1);
}

const source = getSource(watch.source);
// perfil separado: o rastreador pode estar rodando com o perfil principal travado
const browser = new BrowserManager({ profileDir: 'data/browser-profile-cli', headless: config.settings.headless });
const fetcher = new BrowserFetcher(browser);

try {
  const url = source.buildUrl(watch, 1);
  console.log(`Buscando: ${url}\n`);
  let out = await fetcher.fetch(source, url);
  if (out.kind === 'challenge') {
    console.log('A página pediu verificação. Resolva na janela do navegador (até 3 min)...');
    const page = await browser.page(source.id);
    await browser.bringToFront(source.id);
    const r = await waitForChallenge({
      check: () => source.detectBlock(page, null),
      onRemind: async () => {},
      intervalMs: 3000,
      signal: AbortSignal.timeout(180_000),
    });
    if (r === 'resolved') out = await fetcher.fetch(source, url);
  }
  if (out.kind !== 'ok') {
    console.error(`Não foi possível ler a busca: ${out.kind}${out.kind === 'error' ? ` (${out.error.message})` : ''}`);
    process.exitCode = 2;
  } else {
    let approved = 0;
    for (const l of out.listings) {
      const m = match(l, watch);
      if (m.ok) approved++;
      console.log(formatCheckLine(l, m));
      if (m.ok) console.log(`                 ${l.url}`);
    }
    console.log(`\n${out.listings.length} anúncios lidos, ${approved} aprovados para "${watch.name}".`);
  }
} finally {
  await browser.close();
}
