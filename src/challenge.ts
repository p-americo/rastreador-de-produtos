import type { BlockStatus } from './sources/index.ts';

/**
 * Espera o usuário resolver a verificação na janela do navegador.
 * Só OBSERVA a página (não recarrega, não clica). Nunca tenta resolver sozinho.
 */
export async function waitForChallenge(o: {
  check: () => Promise<BlockStatus>;
  onRemind: () => Promise<void>;
  intervalMs?: number;
  remindEveryMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
}): Promise<'resolved' | 'aborted'> {
  const intervalMs = o.intervalMs ?? 10_000;
  const remindEveryMs = o.remindEveryMs ?? 30 * 60_000;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = o.now ?? Date.now;
  let lastRemind = now();
  for (;;) {
    if (o.signal?.aborted) return 'aborted';
    await sleep(intervalMs);
    if (o.signal?.aborted) return 'aborted';
    let status: BlockStatus;
    try {
      status = await o.check();
    } catch {
      status = 'challenge'; // página navegando enquanto o usuário resolve
    }
    if (status === 'ok') return 'resolved';
    if (now() - lastRemind >= remindEveryMs) {
      lastRemind = now();
      await o.onRemind().catch(() => {});
    }
  }
}
