import { beforeEach, describe, expect, it } from 'vitest';
import { Scheduler } from '../src/scheduler.ts';

let t: number;
const now = () => t;
const make = (random = () => 0.5) => new Scheduler({ intervalMs: 30_000, jitterMs: 10_000, now, random });

beforeEach(() => {
  t = 1_000_000;
});

describe('Scheduler', () => {
  it('produtos novos vencem imediatamente, na ordem de cadastro', () => {
    const s = make();
    s.setWatches([{ id: 'a', source: 'olx' }, { id: 'b', source: 'olx' }]);
    expect(s.next()).toEqual({ watchId: 'a', at: t });
    s.done('a');
    expect(s.next()).toEqual({ watchId: 'b', at: t });
  });

  it('variação fica entre 25s e 40s (30s ± jitter)', () => {
    expect(make(() => 0).delay()).toBe(25_000);
    expect(make(() => 1).delay()).toBe(40_000);
    expect(make(() => 0.5).delay()).toBe(32_500);
  });

  it('done agenda o próximo ciclo a partir de agora', () => {
    const s = make(() => 0);
    s.setWatches([{ id: 'a', source: 'olx' }]);
    s.done('a');
    expect(s.next()).toEqual({ watchId: 'a', at: t + 25_000 });
  });

  it('recarga de config remove e adiciona produtos', () => {
    const s = make();
    s.setWatches([{ id: 'a', source: 'olx' }]);
    s.done('a');
    s.setWatches([{ id: 'b', source: 'olx' }]);
    expect(s.next()).toEqual({ watchId: 'b', at: t });
    s.done('b');
    expect(s.next()?.watchId).toBe('b');
  });

  it('fonte pausada é pulada; as outras continuam', () => {
    const s = make();
    s.setWatches([{ id: 'a', source: 'olx' }, { id: 'b', source: 'ml' }]);
    s.pause('olx');
    expect(s.isPaused('olx')).toBe(true);
    expect(s.next()?.watchId).toBe('b');
    s.resume('olx');
    expect(s.next()?.watchId).toBe('a');
  });

  it('recuo progressivo: 1, 2, 4, 8, 15, 15 min', () => {
    const s = make();
    s.setWatches([{ id: 'a', source: 'olx' }]);
    const waits = Array.from({ length: 6 }, () => s.reportBlocked('olx').waitMs / 60_000);
    expect(waits).toEqual([1, 2, 4, 8, 15, 15]);
    expect(s.next()).toEqual({ watchId: 'a', at: t + 15 * 60_000 });
  });

  it('reportOk zera o recuo e informa de quantas falhas recuperou', () => {
    const s = make();
    s.setWatches([{ id: 'a', source: 'olx' }]);
    s.reportBlocked('olx');
    s.reportBlocked('olx');
    s.reportBlocked('olx');
    expect(s.reportOk('olx')).toEqual({ recoveredFrom: 3 });
    expect(s.next()).toEqual({ watchId: 'a', at: t });
    expect(s.reportBlocked('olx').waitMs).toBe(60_000);
  });

  it('setTiming muda o intervalo dos próximos ciclos', () => {
    const s = make(() => 0);
    s.setTiming({ intervalMs: 60_000, jitterMs: 0 });
    expect(s.delay()).toBe(60_000);
  });
});
