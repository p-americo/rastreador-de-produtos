import { describe, expect, it } from 'vitest';
import { formatCheckLine } from '../src/cli/format.ts';
import { makeListing } from './helpers.ts';

describe('formatCheckLine', () => {
  it('aprovado: ícone, preço alinhado e título', () => {
    // preço alinhado à direita em 12 colunas
    expect(formatCheckLine(makeListing({ title: 'Nintendo Switch V1', priceCents: 85_000 }), { ok: true })).toBe(
      `✅ ${' '.repeat(3)}R$ 850,00  Nintendo Switch V1`,
    );
  });

  it('recusado: mostra o motivo; sem preço vira traço', () => {
    expect(
      formatCheckLine(makeListing({ title: 'Case Nintendo Switch', priceCents: null }), {
        ok: false,
        reason: 'startsWith',
      }),
    ).toBe(`❌ ${' '.repeat(11)}—  Case Nintendo Switch  [startsWith]`);
  });
});
