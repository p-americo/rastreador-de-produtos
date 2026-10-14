import { mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, parseConfig, watchConfig } from '../src/config.ts';

const HEAD = `settings:
  intervalSeconds: 30
defaults:
  ignorePrefixes: [console, nintendo]
  pickupCities: ["Goiânia/GO"]
  exclude: [defeito, troco]
`;

const WATCH = `  - id: switch
    name: Nintendo Switch
    source: olx
    maxPrice: 1200.5
    startsWith: ["switch|swich"]
`;

/** YAML com um produto; `extra` são linhas adicionais do produto (indentadas com 4 espaços). */
const cfg = (extra = '    query: nintendo switch\n', head = HEAD) => `${head}watches:\n${WATCH}${extra}`;

describe('parseConfig', () => {
  it('aplica valores padrão de settings', () => {
    const c = parseConfig(cfg());
    expect(c.settings).toEqual({
      intervalSeconds: 30,
      jitterSeconds: 10,
      headless: false,
      notifier: 'discord',
      initialPages: 3,
      retentionDays: 30,
    });
  });

  it('resolve o produto: centavos, padrões e mescla de defaults', () => {
    const [w] = parseConfig(cfg('    query: nintendo switch\n    exclude: [lite]\n')).watches;
    expect(w).toEqual({
      id: 'switch',
      name: 'Nintendo Switch',
      source: 'olx',
      query: 'nintendo switch',
      region: 'brasil',
      searchUrl: undefined,
      maxPriceCents: 120_050,
      minPriceCents: 0,
      startsWith: ['switch|swich'],
      include: [],
      exclude: ['defeito', 'troco', 'lite'],
      ignorePrefixes: ['console', 'nintendo'],
      pickupCities: [{ city: 'goiania', state: 'go' }],
      enabled: true,
      webhookEnv: undefined,
    });
  });

  it('pickupCities do produto substitui o padrão; [] exige entrega em todo lugar', () => {
    const [w] = parseConfig(cfg('    query: x\n    pickupCities: []\n')).watches;
    expect(w.pickupCities).toEqual([]);
  });

  it('exige exatamente um entre query e searchUrl', () => {
    expect(() => parseConfig(cfg(''))).toThrow(/exatamente um/);
    expect(() =>
      parseConfig(cfg('    query: x\n    searchUrl: https://www.olx.com.br/games?q=x\n')),
    ).toThrow(/exatamente um/);
  });

  it('exige startsWith', () => {
    const semStartsWith = cfg().replace('    startsWith: ["switch|swich"]\n', '');
    expect(() => parseConfig(semStartsWith)).toThrow(/startsWith/);
  });

  it('rejeita chave desconhecida (erro de digitação) com mensagem clara', () => {
    expect(() => parseConfig(cfg('    query: x\n    maxprice: 10\n'))).toThrow(/maxprice/);
  });

  it('rejeita cidade fora do formato Cidade/UF', () => {
    expect(() => parseConfig(cfg('    query: x\n    pickupCities: ["Goiania"]\n'))).toThrow(/Cidade\/UF/);
  });

  it('rejeita minPrice maior que maxPrice', () => {
    expect(() => parseConfig(cfg('    query: x\n    minPrice: 2000\n'))).toThrow(/minPrice/);
  });

  it('rejeita ids repetidos', () => {
    const dup = `${HEAD}watches:\n${WATCH}    query: a\n${WATCH}    query: b\n`;
    expect(() => parseConfig(dup)).toThrow(/repetidos/);
  });

  it('rejeita fonte desconhecida quando a lista de fontes é informada', () => {
    expect(() => parseConfig(cfg().replace('source: olx', 'source: ebay'), ['olx'])).toThrow(
      /fonte desconhecida "ebay"/,
    );
  });

  it('YAML quebrado vira ConfigError', () => {
    expect(() => parseConfig('watches: [')).toThrow(ConfigError);
    expect(() => parseConfig('watches: [')).toThrow(/YAML inválido/);
  });
});

describe('watchConfig', () => {
  let stop: (() => void) | undefined;
  afterEach(() => stop?.());

  it('recarrega quando o arquivo muda e reporta erro quando fica inválido', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    const file = join(dir, 'watches.yaml');
    writeFileSync(file, cfg());
    const onChange = vi.fn();
    const onError = vi.fn();
    stop = watchConfig(file, onChange, onError);

    writeFileSync(file, cfg().replace('1200.5', '999'));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 3000 });
    expect(onChange.mock.lastCall![0].watches[0].maxPriceCents).toBe(99_900);

    writeFileSync(file, 'watches: [');
    await vi.waitFor(() => expect(onError).toHaveBeenCalled(), { timeout: 3000 });
  });

  it('continua funcionando quando o editor salva por renomeação', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
    const file = join(dir, 'watches.yaml');
    writeFileSync(file, cfg());
    const onChange = vi.fn();
    stop = watchConfig(file, onChange, vi.fn());

    const tmp = join(dir, 'watches.yaml.tmp');
    writeFileSync(tmp, cfg().replace('1200.5', '777'));
    renameSync(tmp, file);
    await vi.waitFor(
      () => expect(onChange.mock.lastCall?.[0].watches[0].maxPriceCents).toBe(77_700),
      { timeout: 3000 },
    );
  });
});
