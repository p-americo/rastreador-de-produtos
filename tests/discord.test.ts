import { describe, expect, it, vi } from 'vitest';
import type { Alert } from '../src/listing.ts';
import { DiscordNotifier, buildEmbed, formatBRL } from '../src/notifiers/discord.ts';
import { createNotifier } from '../src/notifiers/index.ts';
import { makeListing, makeWatch } from './helpers.ts';

const alert = (over: Partial<Alert> = {}): Alert => ({
  kind: 'new',
  watch: makeWatch({ name: 'Nintendo Switch' }),
  listing: makeListing({ image: 'https://img.olx.com.br/x.webp' }),
  ...over,
});

const ok204 = () => vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));

describe('formatBRL', () => {
  it('formata em reais com espaço comum', () => {
    expect(formatBRL(100_000)).toBe('R$ 1.000,00');
    expect(formatBRL(85_050)).toBe('R$ 850,50');
  });
});

describe('buildEmbed', () => {
  it('monta o alerta NOVO completo', () => {
    expect(buildEmbed(alert())).toEqual({
      title: 'Nintendo Switch V2 desbloqueado',
      url: 'https://go.olx.com.br/x/nintendo-switch-1000',
      description: '🆕 NOVO',
      color: 0x2ecc71,
      fields: [
        { name: 'Preço', value: 'R$ 1.000,00', inline: true },
        { name: 'Local', value: 'Goiânia/GO', inline: true },
        { name: 'Entrega', value: '🚚 Entrega Fácil', inline: true },
        { name: 'Publicado', value: 'Hoje, 10:00', inline: true },
      ],
      thumbnail: { url: 'https://img.olx.com.br/x.webp' },
      footer: { text: 'Nintendo Switch' },
    });
  });

  it('PREÇO BAIXOU mostra o preço anterior', () => {
    const e = buildEmbed(
      alert({ kind: 'price_drop', previousPriceCents: 95_000, listing: makeListing({ priceCents: 85_000 }) }),
    );
    expect(e.description).toBe('📉 PREÇO BAIXOU de R$ 950,00');
    expect(e.color).toBe(0xe67e22);
  });

  it('BAIXOU DE NOVO mostra o preço notificado antes', () => {
    const e = buildEmbed(
      alert({ kind: 'price_drop_again', previousPriceCents: 90_000, listing: makeListing({ priceCents: 85_000 }) }),
    );
    expect(e.description).toBe('📉 BAIXOU DE NOVO de R$ 900,00');
  });

  it('teto aumentado (preço não caiu) mostra AGORA DENTRO DO LIMITE', () => {
    const l = makeListing({ priceCents: 85_000 });
    expect(buildEmbed(alert({ kind: 'price_drop', previousPriceCents: 85_000, listing: l })).description).toBe(
      '✅ AGORA DENTRO DO LIMITE',
    );
    expect(buildEmbed(alert({ kind: 'price_drop', listing: l })).description).toBe('✅ AGORA DENTRO DO LIMITE');
  });

  it('marca destaque e corta título longo', () => {
    const e = buildEmbed(alert({ listing: makeListing({ boosted: true, title: 'x'.repeat(300) }) }));
    expect(e.description).toBe('🆕 NOVO · ⭐ Destaque');
    expect(e.title).toHaveLength(256);
  });

  it('omite campos ausentes', () => {
    const l = makeListing({ city: undefined, state: undefined, location: undefined, deliveryLabel: undefined, postedAt: undefined });
    expect(buildEmbed(alert({ listing: l })).fields).toEqual([{ name: 'Preço', value: 'R$ 1.000,00', inline: true }]);
  });
});

describe('DiscordNotifier', () => {
  it('envia embeds para o webhook padrão', async () => {
    const fetchFn = ok204();
    const a = alert();
    await new DiscordNotifier({ defaultUrl: 'https://discord.test/default', fetchFn }).send([a]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://discord.test/default');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ embeds: [buildEmbed(a)] });
  });

  it('usa o webhook do produto quando webhookEnv está definido', async () => {
    const fetchFn = ok204();
    const n = new DiscordNotifier({
      defaultUrl: 'https://discord.test/default',
      env: { DISCORD_WEBHOOK_SWITCH: 'https://discord.test/switch' },
      fetchFn,
    });
    await n.send([alert({ watch: makeWatch({ webhookEnv: 'DISCORD_WEBHOOK_SWITCH' }) })]);
    expect(fetchFn.mock.calls[0][0]).toBe('https://discord.test/switch');
  });

  it('falha clara quando a variável do webhook do produto não existe', async () => {
    const n = new DiscordNotifier({ defaultUrl: 'https://discord.test/default', env: {}, fetchFn: ok204() });
    await expect(n.send([alert({ watch: makeWatch({ webhookEnv: 'DISCORD_WEBHOOK_X' }) })])).rejects.toThrow(
      /DISCORD_WEBHOOK_X/,
    );
  });

  it('limita a espera de retry_after a 30 s', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 120 }), { status: 429 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const sleep = vi.fn(async (_ms: number) => {});
    await new DiscordNotifier({ defaultUrl: 'https://discord.test/d', fetchFn, sleep }).send([alert()]);
    expect(sleep).toHaveBeenCalledWith(30_000);
  });

  it('o fetch recebe um signal de timeout', async () => {
    const fetchFn = ok204();
    await new DiscordNotifier({ defaultUrl: 'https://discord.test/d', fetchFn }).notify('oi');
    expect(fetchFn.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('em 429 espera retry_after e reenvia', async () => {
    const fetchFn = vi
      .fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ retry_after: 1.5 }), { status: 429, headers: { 'content-type': 'application/json' } }),
      );
    const sleep = vi.fn(async (_ms: number) => {});
    await new DiscordNotifier({ defaultUrl: 'https://discord.test/d', fetchFn, sleep }).send([alert()]);
    expect(sleep).toHaveBeenCalledWith(1500);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('lança erro em falha definitiva', async () => {
    const fetchFn = vi.fn(async () => new Response('boom', { status: 500 }));
    await expect(new DiscordNotifier({ defaultUrl: 'https://discord.test/d', fetchFn }).send([alert()])).rejects.toThrow(
      /500/,
    );
  });

  it('desiste após o número máximo de 429', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ retry_after: 0 }), { status: 429 }));
    const n = new DiscordNotifier({ defaultUrl: 'https://discord.test/d', fetchFn, sleep: async () => {}, maxAttempts: 3 });
    await expect(n.send([alert()])).rejects.toThrow(/429/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('recusa mais de 10 alertas numa mensagem e ignora lista vazia', async () => {
    const fetchFn = ok204();
    const n = new DiscordNotifier({ defaultUrl: 'https://discord.test/d', fetchFn });
    await expect(n.send(Array.from({ length: 11 }, () => alert()))).rejects.toThrow(/10/);
    await n.send([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('notify envia texto simples ao webhook padrão', async () => {
    const fetchFn = ok204();
    await new DiscordNotifier({ defaultUrl: 'https://discord.test/d', fetchFn }).notify('🟢 iniciado');
    expect(JSON.parse(fetchFn.mock.calls[0][1].body as string)).toEqual({ content: '🟢 iniciado' });
  });
});

describe('createNotifier', () => {
  const settings = { intervalSeconds: 30, jitterSeconds: 10, headless: false, notifier: 'discord' as const, initialPages: 3, retentionDays: 30 };

  it('exige DISCORD_WEBHOOK_URL', () => {
    expect(() => createNotifier(settings, {})).toThrow(/DISCORD_WEBHOOK_URL/);
  });

  it('cria o notificador do Discord', () => {
    expect(createNotifier(settings, { DISCORD_WEBHOOK_URL: 'https://discord.test/d' })).toBeInstanceOf(DiscordNotifier);
  });
});
