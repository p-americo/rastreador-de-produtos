import { setTimeout as sleep } from 'node:timers/promises';
import { BrowserFetcher, BrowserManager } from './browser.ts';
import { judgeChallenge } from './challenge-page.ts';
import { waitForChallenge } from './challenge.ts';
import { type Config, type Watch, loadConfig, watchConfig } from './config.ts';
import { type CycleResult, runCycle } from './cycle.ts';
import { type Logger, createLogger } from './log.ts';
import { createNotifier } from './notifiers/index.ts';
import { OpsAlerts } from './ops.ts';
import { Scheduler } from './scheduler.ts';
import { getSource, sources } from './sources/index.ts';
import { Store } from './store.ts';
import { TimeoutError, withTimeout } from './timeout.ts';

const CONFIG_PATH = process.env.WATCHES_FILE ?? 'watches.yaml';
const KNOWN_SOURCES = Object.keys(sources);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Teto de um ciclo inteiro: só o goto tinha limite; o resto podia travar para sempre. */
const CYCLE_TIMEOUT_MS = 3 * MINUTE;
const FATAL_NOTICE_TIMEOUT_MS = 10_000;

let fatalLog: Logger | undefined;

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // sem .env: usa só as variáveis de ambiente (ex.: Docker)
  }
  const log = createLogger('logs');
  fatalLog = log;
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

  // Falha fatal: deixa rastro no log, tenta avisar o Discord (com limite) e sai com código 1.
  let dying = false;
  const die = async (kind: string, e: unknown): Promise<never> => {
    if (!dying) {
      dying = true;
      const msg = e instanceof Error ? e.message : String(e);
      log(`${kind}: ${e instanceof Error ? (e.stack ?? msg) : msg}`);
      await withTimeout(notifier.notify(`🔴 Rastreador caiu: ${msg}`), FATAL_NOTICE_TIMEOUT_MS, 'aviso de queda').catch(
        (err) => log(`não consegui avisar a queda ao Discord: ${(err as Error).message}`),
      );
    }
    process.exit(1);
  };
  process.on('unhandledRejection', (e) => void die('rejeição não tratada', e));
  process.on('uncaughtException', (e) => void die('exceção não capturada', e));
  const store = new Store('data/tracker.db');
  // headless só vale na largada: o navegador é lançado com este valor
  const headless = config.settings.headless;
  const browser = new BrowserManager({ profileDir: 'data/browser-profile', headless });
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
      if (c.settings.headless !== headless) log('mudança em "headless" só vale após reiniciar');
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
    if (!running) {
      log(`${signal} de novo: saindo agora`);
      process.exit(1);
    }
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
      let tabLost = false;
      const result = await waitForChallenge({
        // peek() só olha a aba existente: nunca abre aba nem relança o Chromium (nem no desligamento)
        check: async () => {
          if (abort.signal.aborted) return 'challenge';
          const page = browser.peek(src);
          const verdict = await judgeChallenge(page && { url: page.url() }, () =>
            getSource(src).detectBlock(page as NonNullable<typeof page>, null),
          );
          if (verdict === 'tab-lost') tabLost = true;
          return verdict === 'waiting' ? 'challenge' : 'ok';
        },
        onRemind: () => safeNotify(`⏰ ${src.toUpperCase()} ainda está pedindo verificação na janela do navegador.`),
        signal: abort.signal,
      });
      sched.resume(src);
      if (result !== 'resolved') return;
      if (tabLost) {
        log(`[${src}] aba da verificação fechada; retomando e deixando o próximo ciclo conferir`);
        await safeNotify(
          `ℹ️ A aba de ${src.toUpperCase()} foi fechada durante a verificação. Retomei; se o pedido continuar, aviso de novo.`,
        );
      } else {
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
    for (const e of r.dbErrors) log(`[${watch.id}] alerta enviado, mas falhou ao gravar no banco (${e}); pode ser reenviado`);

    if (r.outcome !== 'error') {
      errorSince.delete(src);
      await ops.clear(`error:${src}`, `✅ Conexão com ${src} restabelecida.`);
    }

    switch (r.outcome) {
      case 'ok':
        sched.reportOk(src);
        await ops.clear(`blocked:${src}`, `✅ ${src} voltou a responder normalmente.`);
        if (r.brokenLayout) {
          // um snapshot por episódio: com o aviso ativo, não grava outro a cada ciclo
          if (!ops.isActive(`layout:${watch.id}`)) {
            await browser
              .snapshot(src, 'debug', watch.id)
              .catch((e) => log(`falha ao salvar snapshot: ${(e as Error).message}`));
          }
          await ops.raise(
            `layout:${watch.id}`,
            `🛠️ O adaptador ${src} pode estar quebrado (produto ${watch.id}): a página carregou, mas não consegui ler os anúncios. Snapshot salvo em debug/.`,
          );
        } else {
          await ops.clear(`layout:${watch.id}`, `✅ Leitura de anúncios de ${watch.id} normalizada.`);
        }
        break;
      case 'challenge':
        if (!headless) {
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

  /** Um ciclo com teto de tempo. Travou = tratado como erro da fonte e o navegador é reiniciado. */
  async function runWithWatchdog(watch: Watch): Promise<CycleResult> {
    const started = Date.now();
    try {
      return await withTimeout(
        runCycle(watch, { fetcher, getSource, store, notifier, initialPages: config.settings.initialPages }),
        CYCLE_TIMEOUT_MS,
        'ciclo',
      );
    } catch (e) {
      if (!(e instanceof TimeoutError)) throw e;
      log(`[${watch.id}] ${e.message}; reiniciando o navegador`);
      await withTimeout(browser.close(), 10_000, 'fechamento do navegador').catch((err) =>
        log(`falha ao fechar o navegador travado: ${(err as Error).message}`),
      );
      return {
        outcome: 'error',
        pagesRead: 0,
        read: 0,
        matched: 0,
        alerts: 0,
        notifyErrors: [],
        dbErrors: [],
        brokenLayout: false,
        error: e.message,
        ms: Date.now() - started,
      };
    }
  }

  let lastPurge = 0;
  while (running) {
    try {
      if (Date.now() - lastPurge > HOUR) {
        lastPurge = Date.now();
        try {
          const removed = store.purgeOlderThan(new Date(Date.now() - config.settings.retentionDays * 24 * HOUR));
          if (removed > 0) log(`limpeza: ${removed} anúncios antigos removidos do histórico`);
        } catch (e) {
          log(`falha na limpeza do histórico (tento de novo em 1h): ${(e as Error).message}`);
        }
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
        const r = await runWithWatchdog(watch);
        sched.done(watch.id);
        await ops.clear(`crash:${watch.id}`, `✅ O produto ${watch.id} voltou a funcionar normalmente.`);
        await handle(watch, r);
      } catch (e) {
        sched.done(watch.id);
        const msg = e instanceof Error ? e.message : String(e);
        log(`[${watch.id}] erro inesperado: ${(e as Error).stack ?? msg}`);
        await ops.raise(`crash:${watch.id}`, `⚠️ Erro inesperado no produto ${watch.id}: ${msg}`);
      }
      await ops.clear('loop', '✅ O laço principal voltou ao normal.');
    } catch (e) {
      // nada fora do ciclo pode derrubar o laço; espera um pouco para não girar em falso
      log(`erro no laço principal: ${(e as Error).stack ?? String(e)}`);
      await ops.raise('loop', `⚠️ Erro no laço principal: ${(e as Error).message}`);
      await sleep(5000).catch(() => {});
    }
  }

  // desligamento com limites: nada aqui pode prender o processo
  await withTimeout(safeNotify('🔴 Rastreador parado'), FATAL_NOTICE_TIMEOUT_MS, 'aviso de parada').catch(() => {});
  stopWatching();
  await withTimeout(browser.close(), FATAL_NOTICE_TIMEOUT_MS, 'fechamento do navegador').catch(() => {});
  store.close();
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  if (fatalLog) fatalLog(msg);
  else console.error(msg);
  process.exit(1);
});
