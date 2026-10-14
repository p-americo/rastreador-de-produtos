import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ emitter: undefined as undefined | (EventEmitter & { close: () => void }) }));

vi.mock('node:fs', async (orig) => {
  const actual = await orig<typeof import('node:fs')>();
  return {
    ...actual,
    watch: () => {
      fake.emitter = Object.assign(new EventEmitter(), { close: () => {} });
      return fake.emitter;
    },
  };
});

const { watchConfig } = await import('../src/config.ts');

describe('watchConfig', () => {
  it('erro do FSWatcher (ex.: EPERM no Windows) vai para onError em vez de derrubar o processo', () => {
    const onError = vi.fn();
    const stop = watchConfig('watches.yaml', () => {}, onError);
    expect(() => fake.emitter?.emit('error', new Error('EPERM: operation not permitted'))).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('EPERM') }));
    stop();
  });
});
