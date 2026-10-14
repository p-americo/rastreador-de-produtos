import type { Watch } from '../config.ts';
import type { Alert } from '../listing.ts';
import type { Notifier } from './index.ts';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface DiscordEmbed {
  title: string;
  url: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  thumbnail?: { url: string };
  footer: { text: string };
}

const GREEN = 0x2ecc71;
const ORANGE = 0xe67e22;

/** "R$ 1.100,00" com espaço comum (o Intl usa espaço não separável). */
export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(cents / 100)
    .replace(/\s/g, ' ');
}

function headline(a: Alert): string {
  if (a.kind === 'new') return '🆕 NOVO';
  const price = a.listing.priceCents;
  if (a.previousPriceCents !== undefined && price !== null && price < a.previousPriceCents) {
    const label = a.kind === 'price_drop_again' ? 'BAIXOU DE NOVO' : 'PREÇO BAIXOU';
    return `📉 ${label} de ${formatBRL(a.previousPriceCents)}`;
  }
  return '✅ AGORA DENTRO DO LIMITE';
}

export function buildEmbed(a: Alert): DiscordEmbed {
  const l = a.listing;
  const tags = [headline(a)];
  if (l.boosted) tags.push('⭐ Destaque');

  const fields: DiscordEmbed['fields'] = [
    { name: 'Preço', value: l.priceCents === null ? '—' : formatBRL(l.priceCents), inline: true },
  ];
  const place = l.city && l.state ? `${l.city}/${l.state}` : l.location;
  if (place) fields.push({ name: 'Local', value: place, inline: true });
  if (l.deliveryLabel) fields.push({ name: 'Entrega', value: `🚚 ${l.deliveryLabel}`, inline: true });
  if (l.postedAt) fields.push({ name: 'Publicado', value: l.postedAt, inline: true });

  return {
    title: l.title.slice(0, 256),
    url: l.url,
    description: tags.join(' · '),
    color: a.kind === 'new' ? GREEN : ORANGE,
    fields,
    thumbnail: l.image ? { url: l.image } : undefined,
    footer: { text: a.watch.name },
  };
}

export class DiscordNotifier implements Notifier {
  constructor(
    private readonly opts: {
      defaultUrl: string;
      env?: Record<string, string | undefined>;
      fetchFn?: FetchFn;
      sleep?: (ms: number) => Promise<void>;
      maxAttempts?: number;
      timeoutMs?: number;
    },
  ) {}

  private webhookFor(watch: Watch): string {
    if (!watch.webhookEnv) return this.opts.defaultUrl;
    const url = (this.opts.env ?? process.env)[watch.webhookEnv];
    if (!url) throw new Error(`Variável ${watch.webhookEnv} (webhookEnv do produto "${watch.id}") não definida no .env`);
    return url;
  }

  async send(alerts: Alert[]): Promise<void> {
    if (alerts.length === 0) return;
    if (alerts.length > 10) throw new Error('o Discord aceita no máximo 10 alertas por mensagem');
    await this.post(this.webhookFor(alerts[0].watch), { embeds: alerts.map(buildEmbed) });
  }

  async notify(text: string): Promise<void> {
    await this.post(this.opts.defaultUrl, { content: text.slice(0, 2000) });
  }

  private async post(url: string, body: unknown): Promise<void> {
    const fetchFn = this.opts.fetchFn ?? fetch;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const maxAttempts = this.opts.maxAttempts ?? 4;
    for (let attempt = 1; ; attempt++) {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000),
      });
      if (res.ok) return;
      if (res.status === 429 && attempt < maxAttempts) {
        const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
        // teto de 30 s: um retry_after enorme não pode prender o ciclo
        await sleep(Math.ceil(Math.min(data.retry_after ?? 1, 30) * 1000));
        continue;
      }
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`Discord respondeu ${res.status}${detail ? `: ${detail}` : ''}`);
    }
  }
}
