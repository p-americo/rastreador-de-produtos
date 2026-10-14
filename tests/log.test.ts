import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/log.ts';

describe('createLogger', () => {
  it('escreve no terminal e no arquivo do dia, com horário local', () => {
    const dir = mkdtempSync(join(tmpdir(), 'log-'));
    const when = new Date(2026, 9, 14, 9, 5, 7);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLogger(dir, () => when);
    log('olá');
    log('mundo');
    expect(spy).toHaveBeenCalledWith('2026-10-14 09:05:07 olá');
    expect(readFileSync(join(dir, '2026-10-14.log'), 'utf8')).toBe(
      '2026-10-14 09:05:07 olá\n2026-10-14 09:05:07 mundo\n',
    );
    spy.mockRestore();
  });
});
