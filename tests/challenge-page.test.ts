import { describe, expect, it, vi } from 'vitest';
import { judgeChallenge } from '../src/challenge-page.ts';

describe('judgeChallenge', () => {
  it('aba fechada: perdeu a aba, sem consultar a fonte', async () => {
    const detect = vi.fn();
    expect(await judgeChallenge(undefined, detect)).toBe('tab-lost');
    expect(detect).not.toHaveBeenCalled();
  });

  it('aba em branco não conta como resolvida', async () => {
    const detect = vi.fn(async () => 'ok' as const);
    expect(await judgeChallenge({ url: 'about:blank' }, detect)).toBe('tab-lost');
    expect(await judgeChallenge({ url: '' }, detect)).toBe('tab-lost');
    expect(detect).not.toHaveBeenCalled();
  });

  it('página real: resolvida só quando a fonte diz ok', async () => {
    const tab = { url: 'https://www.olx.com.br/x' };
    expect(await judgeChallenge(tab, async () => 'ok')).toBe('resolved');
    expect(await judgeChallenge(tab, async () => 'challenge')).toBe('waiting');
    expect(await judgeChallenge(tab, async () => 'blocked')).toBe('waiting');
  });

  it('erro ao checar (página navegando) segue esperando', async () => {
    const detect = async () => {
      throw new Error('Execution context was destroyed');
    };
    expect(await judgeChallenge({ url: 'https://www.olx.com.br/x' }, detect)).toBe('waiting');
  });
});
