import { describe, expect, it, vi } from 'vitest';
import { OpsAlerts } from '../src/ops.ts';

describe('OpsAlerts', () => {
  it('não repete o mesmo aviso enquanto o estado não muda', async () => {
    const send = vi.fn(async (_t: string) => {});
    const ops = new OpsAlerts(send);
    await ops.raise('blocked:olx', '⛔ bloqueado');
    await ops.raise('blocked:olx', '⛔ bloqueado');
    expect(send).toHaveBeenCalledTimes(1);
    expect(ops.isActive('blocked:olx')).toBe(true);
  });

  it('envia a recuperação só se o aviso estava ativo', async () => {
    const send = vi.fn(async (_t: string) => {});
    const ops = new OpsAlerts(send);
    await ops.clear('blocked:olx', '✅ voltou');
    expect(send).not.toHaveBeenCalled();
    await ops.raise('blocked:olx', '⛔ bloqueado');
    await ops.clear('blocked:olx', '✅ voltou');
    expect(send.mock.calls.map((c) => c[0])).toEqual(['⛔ bloqueado', '✅ voltou']);
    expect(ops.isActive('blocked:olx')).toBe(false);
  });

  it('clear sem texto só desativa', async () => {
    const send = vi.fn(async (_t: string) => {});
    const ops = new OpsAlerts(send);
    await ops.raise('k', 'a');
    await ops.clear('k');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('se o envio falhar, o aviso não fica marcado e o próximo raise tenta de novo', async () => {
    const send = vi.fn(async (_t: string) => {}).mockRejectedValueOnce(new Error('discord fora'));
    const ops = new OpsAlerts(send, () => {});
    await ops.raise('k', 'a');
    expect(ops.isActive('k')).toBe(false);
    await ops.raise('k', 'a');
    expect(send).toHaveBeenCalledTimes(2);
    expect(ops.isActive('k')).toBe(true);
    await ops.raise('k', 'a');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('falha de envio é registrada no log e não lança', async () => {
    const log = vi.fn();
    const ops = new OpsAlerts(async () => {
      throw new Error('discord fora');
    }, log);
    await expect(ops.raise('k', 'a')).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('discord fora'));
  });
});
