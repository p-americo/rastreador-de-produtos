import type { Settings } from '../config.ts';
import type { Alert } from '../listing.ts';
import { DiscordNotifier } from './discord.ts';

export interface Notifier {
  /** Até 10 alertas do mesmo produto; lança erro se o envio não for confirmado. */
  send(alerts: Alert[]): Promise<void>;
  /** Aviso operacional em texto (iniciado, bloqueio, config inválida...). */
  notify(text: string): Promise<void>;
}

export function createNotifier(
  settings: Settings,
  env: Record<string, string | undefined> = process.env,
): Notifier {
  switch (settings.notifier) {
    case 'discord': {
      const url = env.DISCORD_WEBHOOK_URL;
      if (!url) throw new Error('DISCORD_WEBHOOK_URL não definida. Copie .env.example para .env e cole a URL do webhook.');
      return new DiscordNotifier({ defaultUrl: url, env });
    }
  }
}
