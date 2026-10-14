import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeoutError, withTimeout } from '../src/timeout.ts';

afterEach(() => vi.useRealTimers());

describe('withTimeout', () => {
  it('devolve o valor quando a promessa termina a tempo e não deixa timer pendente', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.resolve(42), 1000, 'tarefa')).resolves.toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('repassa a rejeição original e limpa o timer', async () => {
    vi.useFakeTimers();
    await expect(withTimeout(Promise.reject(new Error('falhou')), 1000, 'tarefa')).rejects.toThrow('falhou');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejeita com mensagem clara quando estoura o limite', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise<never>(() => {}), 2500, 'ciclo');
    const assertion = expect(p).rejects.toThrow('ciclo excedeu o limite de 2.5s');
    await vi.advanceTimersByTimeAsync(2500);
    await assertion;
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('não gera rejeição não tratada se a promessa original falhar depois do limite', async () => {
    vi.useFakeTimers();
    let fail!: (e: Error) => void;
    const slow = new Promise<never>((_, rej) => {
      fail = rej;
    });
    const p = withTimeout(slow, 100, 'x');
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    fail(new Error('tarde demais'));
    await vi.advanceTimersByTimeAsync(0);
  });
});
