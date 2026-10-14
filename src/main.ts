import { setTimeout as sleep } from 'node:timers/promises';
import { BrowserFetcher, BrowserManager } from './browser.ts';
import { waitForChallenge } from './challenge.ts';
import { type Config, type Watch, loadConfig, watchConfig } from './config.ts';
import { type CycleResult, runCycle } from './cycle.ts';
import { createLogger } from './log.ts';
import { createNotifier } from './notifiers/index.ts';
import { OpsAlerts } from './ops.ts';
import { Scheduler } from './scheduler.ts';
import { getSource, sources } from './sources/index.ts';
import { Store } from './store.ts';

const CONFIG_PATH = process.env.WATCHES_FILE ?? 'watches.yaml';
const KNOWN_SOURCES = Object.keys(sources);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // sem .env: usa só as variáveis de ambiente (ex.: Docker)
  }
  const log = createLogger('logs');
  let config: Config = loadConfig(CONFIG_PATH, KNOWN_SOURCES);
  const notifier = createNotifier(config.settings);
  const safeNotify = async (text: string) => {
    try {
      await notifier.notify(text);
    } catch (e) {
      log(`falha ao enviar aviso ao Discord: ${(e as Error).message}`);
    }
  };
  const ops = new OpsAlerts((t) => notifier.notify(t), log);
  const store = new Store('data/tracker.db');
  const browser = new BrowserManager({ profileDir: 'data/browser-profile', headless: config.settings.headless });
  const fetcher = new BrowserFetcher(browser);
  const timing = (c: Config) => ({
    intervalMs: c.settings.intervalSeconds * 1000,
    jitterMs: c.settings.jitterSeconds * 1000,
  });
  const sched = new Scheduler(timing(config));
  const enabled = () => config.watches.filter((w) => w.enabled);
  sched.setWatches(enabled());

  const stopWatching = watchConfig(
    CONFIG_PATH,
    (c) => {
      if (c.settings.headless !== config.settings.headless) log('mudança em "headless" só vale após reiniciar');
      config = c;
      sched.setTiming(timing(c));
      sched.setWatches(enabled());
      log(`config recarregada: ${enabled().length} produtos ativos`);
    },
    (e) => {
      log(`watches.yaml inválido, mantendo a versão anterior: ${e.message}`);
      void safeNotify(`⚠️ watches.yaml inválido, mantendo a versão anterior.\n${e.message}`);
    },
    KNOWN_SOURCES,
  );

  const abort = new AbortController();
  let running = true;
  const stop = (signal: string) => {
    if (!running) return;
    running = false;
    abort.abort();
    log(`encerrando (${signal})...`);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  const errorSince = new Map<string, number>();

  function startChallengeWatch(src: string): void {
    if (sched.isPaused(src)) return;
    sched.pause(src);
    log(`[${src}] verificação de segurança detectada; fonte pausada até ser resolvida`);
    void (async () => {
      await browser.bringToFront(src).catch(() => {});
      await safeNotify(
        `⚠️ ${src.toUpperCase()} pediu verificação ("sou humano"). Resolva na janela do navegador do rastreador; depois eu continuo sozinho.`,
      );
      const page = await browser.page(src);
      const result = await waitForChallenge({
        check: () => getSource(src).detectBlock(page, null),
        onRemind: () => safeNotify(`⏰ ${src.toUpperCase()} ainda está pedindo verificação na janela do navegador.`),
        signal: abort.signal,
      });
      sched.resume(src);
      if (result === 'resolved') {
        log(`[${src}] verificação resolvida`);
        await safeNotify(`✅ Verificação resolvida. ${src.toUpperCase()} retomado.`);
      }
    })().catch((e) => {
      sched.resume(src);
      log(`[${src}] erro aguardando verificação: ${(e as Error).message}`);
    });
  }

  async function handle(watch: Watch, r: CycleResult): Promise<void> {
    const src = watch.source;
    log(
      `[${watch.id}] ${r.outcome} páginas=${r.pagesRead} lidos=${r.read} aprovados=${r.matched} alertas=${r.alerts} ${r.ms}ms` +
        (r.error ? ` erro=${r.error}` : ''),
    );
    for (const e of r.notifyErrors) log(`[${watch.id}] falha ao notificar (tento de novo no próximo ciclo): ${e}`);

    if (r.outcome !== 'error') {
      errorSince.delete(src);
      await ops.clear(`error:${src}`, `✅ Conexão com ${src} restabelecida.`);
    }

    switch (r.outcome) {
      case 'ok':
        sched.reportOk(src);
        await ops.clear(`blocked:${src}`, `✅ ${src} voltou a responder normalmente.`);
        if (r.brokenLayout) {
          await browser
            .snapshot(src, 'debug', watch.id)
            .catch((e) => log(`falha ao salvar snapshot: ${(e as Error).message}`));
          await ops.raise(
            `layout:${watch.id}`,
            `🛠️ O adaptador ${src} pode estar quebrado (produto ${watch.id}): a página carregou, mas não consegui ler os anúncios. Snapshot salvo em debug/.`,
          );
        } else {
          await ops.clear(`layout:${watch.id}`, `✅ Leitura de anúncios de ${watch.id} normalizada.`);
        }
        break;
      case 'challenge':
        if (!config.settings.headless) {
          startChallengeWatch(src);
          break;
        }
      // em modo headless ninguém resolve o desafio: trata como bloqueio
      // falls through
      case 'blocked': {
        const { failures, waitMs } = sched.reportBlocked(src);
        log(`[${src}] bloqueado (${failures}ª vez seguida); próxima tentativa em ${waitMs / MINUTE} min`);
        if (failures >= 3) {
          await ops.raise(
            `blocked:${src}`,
            `⛔ ${src} está bloqueando as consultas (${failures} falhas seguidas). Vou tentando com intervalos maiores (até 15 min).`,
          );
        }
        break;
      }
      case 'error': {
        const since = errorSince.get(src) ?? Date.now();
        errorSince.set(src, since);
        if (Date.now() - since > 5 * MINUTE) {
          await ops.raise(`error:${src}`, `📡 Não consigo acessar ${src} há mais de 5 minutos. Último erro: ${r.error}`);
        }
        break;
      }
    }
  }

  await safeNotify(`🟢 Rastreador iniciado (${enabled().length} produtos)`);
  log(`rastreador iniciado com ${enabled().length} produtos`);

  let lastPurge = 0;
  while (running) {
    if (Date.now() - lastPurge > HOUR) {
      lastPurge = Date.now();
      const removed = store.purgeOlderThan(new Date(Date.now() - config.settings.retentionDays * 24 * HOUR));
      if (removed > 0) log(`limpeza: ${removed} anúncios antigos removidos do histórico`);
    }

    const next = sched.next();
    const wait = next ? next.at - Date.now() : 1000;
    if (!next || wait > 0) {
      await sleep(Math.min(Math.max(wait, 0), 1000));
      continue;
    }

    const watch = config.watches.find((w) => w.id === next.watchId && w.enabled);
    if (!watch) {
      sched.setWatches(enabled());
      continue;
    }

    try {
      const r = await runCycle(watch, {
        fetcher,
        getSource,
        store,
        notifier,
        initialPages: config.settings.initialPages,
      });
      sched.done(watch.id);
      await handle(watch, r);
    } catch (e) {
      sched.done(watch.id);
      log(`[${watch.id}] erro inesperado: ${(e as Error).stack ?? String(e)}`);
    }
  }

  await safeNotify('🔴 Rastreador parado');
  stopWatching();
  await browser.close().catch(() => {});
  store.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
