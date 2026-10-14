import { loadConfig } from '../config.ts';
import { createNotifier } from '../notifiers/index.ts';
import { sources } from '../sources/index.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // sem .env: createNotifier explica o que falta
}

const config = loadConfig(process.env.WATCHES_FILE ?? 'watches.yaml', Object.keys(sources));
const notifier = createNotifier(config.settings);
const watch = config.watches[0];

await notifier.notify('🔔 Teste do rastreador: se isto chegou no seu celular, o webhook está funcionando.');
await notifier.send([
  {
    kind: 'new',
    watch,
    listing: {
      source: 'olx',
      id: 'exemplo',
      title: `${watch.name} (EXEMPLO — não é um anúncio real)`,
      priceCents: watch.maxPriceCents,
      url: 'https://www.olx.com.br',
      location: 'Goiânia, Setor Bueno',
      city: 'Goiânia',
      state: 'GO',
      postedAt: 'agora',
      boosted: false,
      buyable: true,
      delivery: true,
      deliveryLabel: 'Entrega Fácil',
    },
  },
]);
console.log('Mensagens de teste enviadas. Confira o Discord.');
