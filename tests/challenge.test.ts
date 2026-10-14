import { describe, expect, it, vi } from 'vitest';
import { waitForChallenge } from '../src/challenge.ts';
import type { BlockStatus } from '../src/sources/index.ts';

describe('waitForChallenge', () => {
  it('termina quando a página volta ao normal, sem recarregar', async () => {
    const statuses: BlockStatus[] = ['challenge', 'challenge', 'ok'];
    const check = vi.fn(async () => statuses.shift()!);
    const sleeps: number[] = [];
    const r = await waitForChallenge({
      check,
      onRemind: vi.fn(async () => {}),
      intervalMs: 10_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => 0,
    });
    expect(r).toBe('resolved');
    expect(check).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([10_000, 10_000, 10_000]);
  });

  it('lembra a cada 30 minutos enquanto não resolve', async () => {
    let t = 0;
    let calls = 0;
    const onRemind = vi.fn(async () => {});
    await waitForChallenge({
      check: async () => (++calls >= 400 ? 'ok' : 'challenge'),
      onRemind,
      intervalMs: 10_000,
      remindEveryMs: 1_800_000,
      sleep: async (ms) => {
        t += ms;
      },
      now: () => t,
    });
    // 399 verificações sem sucesso (≈66 min) → lembretes aos 30 e aos 60 min
    expect(onRemind).toHaveBeenCalledTimes(2);
  });

  it('erro na verificação conta como "ainda em desafio"', async () => {
    const check = vi
      .fn<() => Promise<BlockStatus>>()
      .mockRejectedValueOnce(new Error('Execution context was destroyed'))
      .mockResolvedValueOnce('ok');
    const r = await waitForChallenge({ check, onRemind: async () => {}, sleep: async () => {}, now: () => 0 });
    expect(r).toBe('resolved');
  });

  it('para quando o sinal é abortado', async () => {
    const ac = new AbortController();
    ac.abort();
    const check = vi.fn(async (): Promise<BlockStatus> => 'challenge');
    const r = await waitForChallenge({ check, onRemind: async () => {}, sleep: async () => {}, signal: ac.signal });
    expect(r).toBe('aborted');
    expect(check).not.toHaveBeenCalled();
  });
});
