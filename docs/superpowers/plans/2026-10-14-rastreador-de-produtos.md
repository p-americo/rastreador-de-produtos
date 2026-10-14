# Rastreador de Produtos — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serviço Node.js que consulta a OLX a cada ~30s com um navegador real, filtra anúncios compráveis de PS Vita / Switch / Switch Lite pelo título, preço e entrega, e avisa no Discord uma única vez por anúncio (ou quando o preço cai de novo).

**Architecture:** Componentes pequenos e independentes, ligados por `main.ts`. `config` (YAML + zod), `matcher` (regras de texto, preço e entrega), `decide` (função pura de alerta), `store` (SQLite), `notifiers/discord`, `sources/olx` (adaptador Playwright), `scheduler` (intervalo, recuo, pausa), `cycle` (um ciclo de um produto, testável com fakes). A fonte e o notificador são interfaces, então adicionar Mercado Livre ou Telegram é criar um arquivo.

**Tech Stack:** Node.js ≥ 22.13 (desenvolvimento em 24), TypeScript executado com `tsx`, Playwright 1.56.1 (Chromium), `node:sqlite`, `yaml`, `zod` 3, `vitest` 3.

**Spec:** `docs/superpowers/specs/2026-10-14-rastreador-de-produtos-design.md`

## Global Constraints

- Projeto ESM (`"type": "module"`); imports internos com extensão `.ts` (ex.: `import { normalize } from './text.ts'`).
- Node.js ≥ 22.13 (`engines`); sem dependências de runtime além de `playwright@1.56.1` (versão **exata**, igual à imagem Docker), `yaml` e `zod@3`. Sem `dotenv`: usar `process.loadEnvFile('.env')`.
- **Nenhum teste automatizado acessa a OLX ou o Discord reais.** Testes com Chromium usam `page.route('**/*', r => r.abort())` e `page.setContent(...)`.
- **Nunca tentar burlar anti-bot**: sem plugins "stealth", sem disfarce de TLS, sem resolver desafios automaticamente.
- **Compra imediata é fixa**: toda URL da OLX tem `opst=2`, e o matcher recusa `buyable: false`. Não existe opção para desligar.
- Mensagens para o usuário (Discord, terminal, erros de config) em **português (pt-BR)**; identificadores de código em inglês.
- Caminhos: banco `data/tracker.db`, perfil do navegador `data/browser-profile` (o rastreador) e `data/browser-profile-cli` (comandos `check`/`capture-fixture`), logs em `logs/AAAA-MM-DD.log`, snapshots em `debug/`. Segredos só no `.env`.
- Intervalo padrão 30s; variação: o próximo ciclo cai entre `interval − jitter/2` e `interval + jitter` (30s/10s → 25s a 40s).
- Commits terminam com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Refinamentos sobre a spec (decididos ao planejar)

Pequenos ajustes de interface que a spec não detalhava. Executores seguem o plano:

1. `Source.extract` retorna `{ listings, emptyResult }`: a OLX mostra "Nenhum anúncio foi encontrado" em buscas vazias, e isso não pode disparar o aviso de "layout quebrado".
2. `Source.waitForResults(page)`: espera os cards (ou a mensagem de vazio) aparecerem, porque a página é renderizada por JS.
3. `Notifier.notify(text)`: avisos operacionais (iniciado, bloqueio, config inválida) além de `send(alerts)`.
4. Coluna `last_matched` no banco. Se o envio ao Discord falhar, o anúncio volta no próximo ciclo como **NOVO**, e não como "agora dentro do limite".
5. `parseConfig(text, knownSources)` rejeita `source` desconhecida no carregamento.
6. Comandos `check` e `capture-fixture` usam um perfil de navegador separado (`data/browser-profile-cli`), para poderem rodar com o rastreador ligado (o perfil fica travado pelo processo que o abriu).
7. Busca na categoria geral **Games** (`/games`), verificada em 2026-10-14: `/games?q=ps+vita&sf=1&opst=2` (50 de 50 compráveis), `/games/estado-go?...`, `/games/estado-go/grande-goiania-e-anapolis?...`, paginação `&o=2`.

## Review Focus

1. **Editor salva `watches.yaml` por renomeação** (salvamento atômico, comum no VS Code/Notepad++): a recarga a quente precisa continuar funcionando. Teste em Task 2 (`watchConfig` observa a pasta, não o arquivo).
2. **Alternativa de `startsWith` que começa com palavra de `ignorePrefixes`** (ex.: `startsWith: ["nintendo switch"]` com `nintendo` nos prefixos): ainda precisa casar. Teste em Task 1 (`prefixStates` devolve todos os estados) e Task 3.
3. **O mesmo anúncio aparece duas vezes** (na mesma página ou em duas páginas da leitura inicial): uma notificação só. Teste em Task 10.
4. **Erro de digitação numa chave do YAML** (ex.: `maxprice`): a config deve ser rejeitada com mensagem clara, nunca ignorada em silêncio. Teste em Task 2.
5. **Discord fora do ar no primeiro envio**: o anúncio deve voltar no ciclo seguinte como 🆕 NOVO. Teste em Task 4 e Task 10.

---

## Estrutura de arquivos

```
package.json  tsconfig.json  vitest.config.ts  .env.example  watches.yaml
iniciar.bat  Dockerfile  .dockerignore  README.md
src/
  text.ts            normalização e casamento de termos (puro)
  config.ts          schema zod, mescla de defaults, loadConfig, watchConfig
  listing.ts         tipos Listing, Alert, AlertKind
  matcher.ts         matchText / match (regras da spec §5)
  decide.ts          decide() + StoredListing (tabela da spec §6)
  store.ts           Store (node:sqlite)
  notifiers/index.ts interface Notifier + createNotifier
  notifiers/discord.ts formatBRL, buildEmbed, DiscordNotifier
  sources/index.ts   interface Source + registro + getSource
  sources/olx.ts     buildUrl, parsePrice, parseCard, extract, detectBlock, waitForResults
  scheduler.ts       Scheduler (intervalo, recuo, pausa)
  ops.ts             OpsAlerts (avisos sem repetição)
  challenge.ts       waitForChallenge
  cycle.ts           runCycle, PageFetcher, FetchOutcome, chunk, isBrokenLayout
  log.ts             createLogger
  browser.ts         BrowserManager, BrowserFetcher
  main.ts            orquestração
  cli/format.ts      formatCheckLine
  cli/check.ts  cli/test-notify.ts  cli/capture-fixture.ts
tests/
  helpers.ts  text.test.ts  config.test.ts  matcher.test.ts  matcher-real-titles.test.ts
  decide.test.ts  store.test.ts  discord.test.ts  olx.test.ts  olx-browser.test.ts
  scheduler.test.ts  ops.test.ts  challenge.test.ts  cycle.test.ts  log.test.ts  format.test.ts
  olx-real-fixture.test.ts
  fixtures/titles.json (já existe)  olx-search.html  olx-empty.html
  fixtures/cloudflare-challenge.html  cloudflare-blocked.html  olx-real-switch-lite.html (Task 13)
```

---

### Task 1: Projeto base e utilitários de texto

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/text.ts`
- Test: `tests/text.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (`src/text.ts`):
  - `normalize(s: string): string`
  - `alternatives(term: string): string[]`
  - `containsTerm(normText: string, term: string): boolean`
  - `startsWithTerm(normText: string, term: string): boolean`
  - `prefixStates(normText: string, prefixes: string[]): string[]`

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "rastreador-de-produtos",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.13" },
  "scripts": {
    "start": "tsx src/main.ts",
    "check": "tsx src/cli/check.ts",
    "test-notify": "tsx src/cli/test-notify.ts",
    "capture-fixture": "tsx src/cli/capture-fixture.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Instalar dependências e o Chromium do Playwright**

```bash
npm install playwright@1.56.1 yaml@^2.8.1 zod@^3.25.76
npm install -D typescript@^5.9.3 tsx@^4.20.6 vitest@^3.2.4 @types/node@^24
npx playwright install chromium
```

Expected: instalação sem erros; `npx playwright install chromium` baixa o Chromium.

- [ ] **Step 3: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "vitest.config.ts"]
}
```

- [ ] **Step 4: Criar `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
```

- [ ] **Step 5: Escrever o teste que falha — `tests/text.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { alternatives, containsTerm, normalize, prefixStates, startsWithTerm } from '../src/text.ts';

describe('normalize', () => {
  it('remove acentos, pontuação e caixa', () => {
    expect(normalize('?Nintendo Switch-Lite!')).toBe('nintendo switch lite');
    expect(normalize('Peças  Película  NÃO liga')).toBe('pecas pelicula nao liga');
    expect(normalize('Nintendo Switch OLED | Dock')).toBe('nintendo switch oled dock');
  });

  it('texto só com símbolos vira vazio', () => {
    expect(normalize('  ?? -- ')).toBe('');
  });
});

describe('alternatives', () => {
  it('separa por | e normaliza, descartando vazios', () => {
    expect(alternatives('Swich Lite|switchlite| ')).toEqual(['swich lite', 'switchlite']);
  });
});

describe('containsTerm', () => {
  it('casa palavra inteira', () => {
    expect(containsTerm('switch lite com case', 'case')).toBe(true);
    expect(containsTerm('casei com o switch', 'case')).toBe(false);
  });

  it('casa frase inteira e alternativas', () => {
    expect(containsTerm('vendo so a caixa do switch', 'so a caixa')).toBe(true);
    expect(containsTerm('ps vita com jogos', 'vita|psvita')).toBe(true);
  });

  it('termo com acento casa texto normalizado', () => {
    expect(containsTerm(normalize('Retirada de peças'), 'Peças')).toBe(true);
  });
});

describe('startsWithTerm', () => {
  it('exige o início como palavra inteira', () => {
    expect(startsWithTerm('switch oled', 'switch')).toBe(true);
    expect(startsWithTerm('switch', 'switch')).toBe(true);
    expect(startsWithTerm('switchx oled', 'switch')).toBe(false);
    expect(startsWithTerm('case switch', 'switch')).toBe(false);
  });

  it('aceita qualquer alternativa', () => {
    expect(startsWithTerm('swich lite desbloqueado', 'switch lite|swich lite')).toBe(true);
  });
});

describe('prefixStates', () => {
  const P = ['console', 'nintendo', 'video game', 'video'];

  it('retorna o texto original e cada estado após remover prefixos', () => {
    expect(prefixStates('console nintendo switch oled', P)).toEqual([
      'console nintendo switch oled',
      'nintendo switch oled',
      'switch oled',
    ]);
  });

  it('prefere o prefixo mais longo', () => {
    expect(prefixStates('video game switch', P)).toEqual(['video game switch', 'switch']);
  });

  it('não remove prefixo grudado em outra palavra', () => {
    expect(prefixStates('nintendoswitch', P)).toEqual(['nintendoswitch']);
  });

  it('título só de prefixos termina vazio', () => {
    expect(prefixStates('console nintendo', P)).toEqual(['console nintendo', 'nintendo', '']);
  });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run tests/text.test.ts`
Expected: FAIL — `Failed to resolve import "../src/text.ts"`.

- [ ] **Step 7: Implementar `src/text.ts`**

```ts
/** Minúsculas, sem acentos, só [a-z0-9] separados por um espaço. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "a|b" → ["a", "b"], normalizados; alternativas vazias são descartadas. */
export function alternatives(term: string): string[] {
  return term.split('|').map(normalize).filter(Boolean);
}

/** O termo (ou uma alternativa) aparece como palavra/frase inteira no texto normalizado. */
export function containsTerm(normText: string, term: string): boolean {
  const padded = ` ${normText} `;
  return alternatives(term).some((a) => padded.includes(` ${a} `));
}

/** O texto normalizado começa com o termo (ou uma alternativa) como palavra/frase inteira. */
export function startsWithTerm(normText: string, term: string): boolean {
  return alternatives(term).some((a) => normText === a || normText.startsWith(`${a} `));
}

/**
 * Remove prefixos do início, um por vez, e devolve todos os estados intermediários
 * (incluindo o original). Assim "nintendo switch" ainda casa mesmo com "nintendo"
 * entre os prefixos ignorados.
 */
export function prefixStates(normText: string, prefixes: string[]): string[] {
  const sorted = prefixes
    .map(normalize)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const states = [normText];
  let t = normText;
  for (;;) {
    const p = sorted.find((x) => t === x || t.startsWith(`${x} `));
    if (!p) break;
    t = t.slice(p.length).trim();
    states.push(t);
  }
  return states;
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run tests/text.test.ts && npx tsc --noEmit`
Expected: PASS (todos os testes) e typecheck sem erros.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/text.ts tests/text.test.ts
git commit -m "feat: projeto base e normalização de texto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Configuração (`watches.yaml`) com recarga a quente

**Files:**
- Create: `src/config.ts`, `watches.yaml`, `.env.example`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: `normalize` (Task 1).
- Produces (`src/config.ts`):
  - `interface Settings { intervalSeconds: number; jitterSeconds: number; headless: boolean; notifier: 'discord'; initialPages: number; retentionDays: number }`
  - `interface PickupCity { city: string; state: string }` (ambos normalizados, ex.: `{ city: 'goiania', state: 'go' }`)
  - `interface Watch { id; name; source; query?; region; searchUrl?; maxPriceCents; minPriceCents; startsWith: string[]; include: string[]; exclude: string[]; ignorePrefixes: string[]; pickupCities: PickupCity[]; enabled: boolean; webhookEnv? }` (exclude e ignorePrefixes já somados com os defaults)
  - `interface Config { settings: Settings; watches: Watch[] }`
  - `class ConfigError extends Error`
  - `parseConfig(text: string, knownSources?: readonly string[]): Config`
  - `loadConfig(path: string, knownSources?: readonly string[]): Config`
  - `watchConfig(path: string, onChange: (c: Config) => void, onError: (e: Error) => void, knownSources?: readonly string[]): () => void` (retorna função para parar)

- [ ] **Step 1: Escrever o teste que falha — `tests/config.test.ts`**

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — `Failed to resolve import "../src/config.ts"`.

- [ ] **Step 3: Implementar `src/config.ts`**

```ts
import { readFileSync, watch as fsWatch } from 'node:fs';
import { basename, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { normalize } from './text.ts';

const termList = z.array(z.string().min(1)).default([]);
const cityList = z.array(
  z.string().regex(/^[^/]+\/[A-Za-z]{2}$/, 'use o formato "Cidade/UF", ex.: "Goiânia/GO"'),
);

const SettingsSchema = z
  .object({
    intervalSeconds: z.number().positive().default(30),
    jitterSeconds: z.number().min(0).default(10),
    headless: z.boolean().default(false),
    notifier: z.literal('discord').default('discord'),
    initialPages: z.number().int().min(1).max(10).default(3),
    retentionDays: z.number().int().positive().default(30),
  })
  .strict();

const DefaultsSchema = z
  .object({
    ignorePrefixes: termList,
    pickupCities: cityList.default([]),
    exclude: termList,
  })
  .strict();

const WatchSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, 'use só letras minúsculas, números e "-"'),
    name: z.string().min(1),
    source: z.string().min(1),
    query: z.string().min(1).optional(),
    region: z
      .string()
      .regex(/^(brasil|[a-z]{2}(\/[a-z0-9-]+)?)$/, 'use "brasil", "go" ou "go/grande-goiania-e-anapolis"')
      .default('brasil'),
    searchUrl: z.string().url().optional(),
    maxPrice: z.number().positive(),
    minPrice: z.number().min(0).default(0),
    startsWith: z.array(z.string().min(1)).min(1),
    include: termList,
    exclude: termList,
    ignorePrefixes: termList,
    pickupCities: cityList.optional(),
    enabled: z.boolean().default(true),
    webhookEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional(),
  })
  .strict()
  .refine((w) => (w.query === undefined) !== (w.searchUrl === undefined), {
    message: 'defina exatamente um entre "query" e "searchUrl"',
  })
  .refine((w) => w.minPrice <= w.maxPrice, { message: '"minPrice" não pode ser maior que "maxPrice"' });

const FileSchema = z
  .object({
    settings: SettingsSchema.default({}),
    defaults: DefaultsSchema.default({}),
    watches: z.array(WatchSchema).min(1),
  })
  .strict()
  .refine((f) => new Set(f.watches.map((w) => w.id)).size === f.watches.length, {
    message: 'ids de produto repetidos',
  });

export type Settings = z.infer<typeof SettingsSchema>;

export interface PickupCity {
  city: string;
  state: string;
}

export interface Watch {
  id: string;
  name: string;
  source: string;
  query?: string;
  region: string;
  searchUrl?: string;
  maxPriceCents: number;
  minPriceCents: number;
  startsWith: string[];
  include: string[];
  exclude: string[];
  ignorePrefixes: string[];
  pickupCities: PickupCity[];
  enabled: boolean;
  webhookEnv?: string;
}

export interface Config {
  settings: Settings;
  watches: Watch[];
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function parsePickupCity(s: string): PickupCity {
  const i = s.lastIndexOf('/');
  return { city: normalize(s.slice(0, i)), state: normalize(s.slice(i + 1)) };
}

export function parseConfig(text: string, knownSources?: readonly string[]): Config {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new ConfigError(`YAML inválido: ${(e as Error).message}`);
  }
  const r = FileSchema.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ');
    throw new ConfigError(msg);
  }
  const { settings, defaults, watches } = r.data;
  if (knownSources) {
    for (const w of watches) {
      if (!knownSources.includes(w.source)) {
        throw new ConfigError(
          `watches: fonte desconhecida "${w.source}" no produto "${w.id}" (disponíveis: ${knownSources.join(', ')})`,
        );
      }
    }
  }
  return {
    settings,
    watches: watches.map((w) => ({
      id: w.id,
      name: w.name,
      source: w.source,
      query: w.query,
      region: w.region,
      searchUrl: w.searchUrl,
      maxPriceCents: Math.round(w.maxPrice * 100),
      minPriceCents: Math.round(w.minPrice * 100),
      startsWith: w.startsWith,
      include: w.include,
      exclude: [...defaults.exclude, ...w.exclude],
      ignorePrefixes: [...defaults.ignorePrefixes, ...w.ignorePrefixes],
      pickupCities: (w.pickupCities ?? defaults.pickupCities).map(parsePickupCity),
      enabled: w.enabled,
      webhookEnv: w.webhookEnv,
    })),
  };
}

export function loadConfig(path: string, knownSources?: readonly string[]): Config {
  return parseConfig(readFileSync(path, 'utf8'), knownSources);
}

/**
 * Observa a PASTA do arquivo (não o arquivo): editores que salvam por renomeação
 * trocam o arquivo observado e um watch direto pararia de disparar.
 */
export function watchConfig(
  path: string,
  onChange: (c: Config) => void,
  onError: (e: Error) => void,
  knownSources?: readonly string[],
): () => void {
  const name = basename(path);
  let timer: NodeJS.Timeout | undefined;
  const watcher = fsWatch(dirname(path), (_event, filename) => {
    if (filename !== null && filename !== name) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        onChange(loadConfig(path, knownSources));
      } catch (e) {
        onError(e as Error);
      }
    }, 300);
  });
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Criar `watches.yaml` (exemplo da spec) e `.env.example`**

`watches.yaml`:

```yaml
settings:
  intervalSeconds: 30        # base entre consultas de cada produto
  jitterSeconds: 10          # variação aleatória: ciclo entre 25s e 40s
  headless: false            # janela visível no PC
  notifier: discord          # usa DISCORD_WEBHOOK_URL do .env
  initialPages: 3            # páginas lidas na primeira consulta de um produto
  retentionDays: 30

defaults:
  # palavras ignoradas no INÍCIO do título antes de checar startsWith
  ignorePrefixes: [console, nintendo, nitendo, sony, playstation, video game,
                   videogame, vendo, vende se, novo, nova]
  # cidades onde você aceita retirada em mãos; fora delas, exige entrega
  pickupCities: ["Goiânia/GO"]
  # só problemas reais; acessórios NÃO entram aqui (o filtro startsWith cuida deles)
  exclude: [defeito, defeituoso, quebrado, quebrada, nao liga, nao funciona,
            pecas, sucata, troco, so troca, somente troca, apenas troca,
            procuro, compro, aluguel, caixa vazia, so a caixa, somente a caixa]

watches:
  - id: switch-lite
    name: Nintendo Switch Lite
    source: olx
    query: switch lite
    region: brasil
    maxPrice: 900
    minPrice: 400
    startsWith: ["switch lite|swich lite|switchlite"]

  - id: switch
    name: Nintendo Switch (demais modelos)
    source: olx
    query: nintendo switch
    region: brasil
    maxPrice: 1200
    minPrice: 400
    startsWith: ["switch|swich"]
    exclude: [lite]

  - id: ps-vita
    name: PS Vita
    source: olx
    query: ps vita
    region: brasil
    maxPrice: 700
    minPrice: 300
    startsWith: ["ps vita|psvita|vita"]
```

`.env.example`:

```
# Webhook do canal do Discord que recebe os alertas
# (no Discord: Editar canal → Integrações → Webhooks → Novo webhook → Copiar URL)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/COLE_AQUI

# Opcional: um webhook por produto (em watches.yaml use webhookEnv: DISCORD_WEBHOOK_SWITCH)
# DISCORD_WEBHOOK_SWITCH=https://discord.com/api/webhooks/...
```

- [ ] **Step 6: Garantir que o exemplo é válido**

Run: `npx tsx -e "import('./src/config.ts').then(m => console.log(m.loadConfig('watches.yaml', ['olx']).watches.map(w => w.id)))"`
Expected: `[ 'switch-lite', 'switch', 'ps-vita' ]`

- [ ] **Step 7: Commit**

```bash
git add src/config.ts tests/config.test.ts watches.yaml .env.example
git commit -m "feat: config watches.yaml com validação e recarga a quente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Tipos de anúncio e matcher

**Files:**
- Create: `src/listing.ts`, `src/matcher.ts`, `tests/helpers.ts`
- Test: `tests/matcher.test.ts`, `tests/matcher-real-titles.test.ts`

**Interfaces:**
- Consumes: `Watch` (Task 2); `normalize`, `containsTerm`, `startsWithTerm`, `prefixStates` (Task 1).
- Produces:
  - `src/listing.ts`: `interface Listing { source; id; title; priceCents: number | null; url; image?; location?; city?; state?; postedAt?; boosted: boolean; buyable: boolean; delivery: boolean; deliveryLabel? }`, `type AlertKind = 'new' | 'price_drop' | 'price_drop_again'`, `interface Alert { kind: AlertKind; watch: Watch; listing: Listing; previousPriceCents?: number }`
  - `src/matcher.ts`: `type MatchResult = { ok: true } | { ok: false; reason: string }`, `matchText(title: string, watch: Pick<Watch, 'startsWith' | 'include' | 'exclude' | 'ignorePrefixes'>): MatchResult`, `match(listing: Listing, watch: Watch): MatchResult`
  - `tests/helpers.ts`: `DEFAULT_PREFIXES`, `DEFAULT_EXCLUDE`, `makeWatch(over?: Partial<Watch>): Watch`, `makeListing(over?: Partial<Listing>): Listing` (usados pelos testes das tasks seguintes)

- [ ] **Step 1: Criar `src/listing.ts`**

```ts
import type { Watch } from './config.ts';

/** Anúncio no formato comum a todas as fontes. */
export interface Listing {
  source: string; // "olx"
  id: string; // id do anúncio na fonte
  title: string;
  priceCents: number | null;
  url: string;
  image?: string;
  location?: string; // texto bruto: "Americana, Jardim Boer I"
  city?: string; // "Americana"
  state?: string; // "SP"
  postedAt?: string; // "Hoje, 10:23"
  boosted: boolean; // "Destaque" / "Impulsionado"
  buyable: boolean; // pode ser comprado agora, sem "Solicitar"
  delivery: boolean; // vendedor oferece entrega
  deliveryLabel?: string; // "Entrega Fácil" | "Frete grátis"
}

export type AlertKind = 'new' | 'price_drop' | 'price_drop_again';

export interface Alert {
  kind: AlertKind;
  watch: Watch;
  listing: Listing;
  previousPriceCents?: number;
}
```

- [ ] **Step 2: Criar `tests/helpers.ts`**

```ts
import type { Watch } from '../src/config.ts';
import type { Listing } from '../src/listing.ts';

export const DEFAULT_PREFIXES = [
  'console', 'nintendo', 'nitendo', 'sony', 'playstation', 'video game',
  'videogame', 'vendo', 'vende se', 'novo', 'nova',
];

export const DEFAULT_EXCLUDE = [
  'defeito', 'defeituoso', 'quebrado', 'quebrada', 'nao liga', 'nao funciona',
  'pecas', 'sucata', 'troco', 'so troca', 'somente troca', 'apenas troca',
  'procuro', 'compro', 'aluguel', 'caixa vazia', 'so a caixa', 'somente a caixa',
];

/** Produto "Switch (demais modelos)" da spec, já resolvido. */
export function makeWatch(over: Partial<Watch> = {}): Watch {
  return {
    id: 'switch',
    name: 'Nintendo Switch',
    source: 'olx',
    query: 'nintendo switch',
    region: 'brasil',
    maxPriceCents: 120_000,
    minPriceCents: 40_000,
    startsWith: ['switch|swich'],
    include: [],
    exclude: [...DEFAULT_EXCLUDE, 'lite'],
    ignorePrefixes: DEFAULT_PREFIXES,
    pickupCities: [{ city: 'goiania', state: 'go' }],
    enabled: true,
    ...over,
  };
}

export function makeListing(over: Partial<Listing> = {}): Listing {
  return {
    source: 'olx',
    id: '1000',
    title: 'Nintendo Switch V2 desbloqueado',
    priceCents: 100_000,
    url: 'https://go.olx.com.br/x/nintendo-switch-1000',
    location: 'Goiânia, Setor Bueno',
    city: 'Goiânia',
    state: 'GO',
    postedAt: 'Hoje, 10:00',
    boosted: false,
    buyable: true,
    delivery: true,
    deliveryLabel: 'Entrega Fácil',
    ...over,
  };
}
```

- [ ] **Step 3: Escrever o teste que falha — `tests/matcher.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { match, matchText } from '../src/matcher.ts';
import { DEFAULT_EXCLUDE, makeListing, makeWatch } from './helpers.ts';

const lite = makeWatch({
  id: 'switch-lite',
  startsWith: ['switch lite|swich lite|switchlite'],
  exclude: DEFAULT_EXCLUDE,
});

describe('matchText', () => {
  it('aceita console com prefixos ignorados', () => {
    expect(matchText('Console Nintendo Switch Oled Desbloqueado', makeWatch())).toEqual({ ok: true });
  });

  it('recusa acessório que vem antes do produto', () => {
    expect(matchText('Case Nintendo switch LITE', lite)).toEqual({ ok: false, reason: 'startsWith' });
  });

  it('aceita acessório que vem depois do produto (brinde)', () => {
    expect(matchText('Nintendo Switch Lite Turquesa(bloqueado) com Case e Capas', lite)).toEqual({ ok: true });
    expect(matchText('?Nintendo Switch Lite Coral Case + Película + Carregador', lite)).toEqual({ ok: true });
  });

  it('aceita erro de digitação via alternativa', () => {
    expect(matchText('Nitendo swich lite desbloqueado semi-novo', lite)).toEqual({ ok: true });
  });

  it('startsWith que começa com palavra de prefixo ignorado ainda casa', () => {
    const w = makeWatch({ startsWith: ['nintendo switch'] });
    expect(matchText('Nintendo Switch V1', w)).toEqual({ ok: true });
    expect(matchText('Console Nintendo Switch V1', w)).toEqual({ ok: true });
  });

  it('exclude soma padrão e produto, como palavra inteira', () => {
    expect(matchText('Nintendo Switch Lite', makeWatch())).toEqual({ ok: false, reason: 'exclude:"lite"' });
    expect(matchText('Nintendo Switch com defeito na tela', makeWatch())).toEqual({
      ok: false,
      reason: 'exclude:"defeito"',
    });
  });

  it('"Avaliamos troca" passa; "troco" é recusado', () => {
    expect(matchText('Switch Lite 32gb (Excelente). Avaliamos Troca, loja física', lite)).toEqual({ ok: true });
    expect(matchText('Switch Lite troco por PS4', lite)).toEqual({ ok: false, reason: 'exclude:"troco"' });
  });

  it('include exige todos os termos', () => {
    const w = makeWatch({ include: ['oled', 'desbloqueado|destravado'] });
    expect(matchText('Nintendo Switch OLED destravado', w)).toEqual({ ok: true });
    expect(matchText('Nintendo Switch OLED', w)).toEqual({ ok: false, reason: 'include:"desbloqueado|destravado"' });
  });
});

describe('match', () => {
  it('limites de preço são inclusivos', () => {
    const w = makeWatch();
    expect(match(makeListing({ priceCents: 40_000 }), w)).toEqual({ ok: true });
    expect(match(makeListing({ priceCents: 120_000 }), w)).toEqual({ ok: true });
    expect(match(makeListing({ priceCents: 39_999 }), w)).toEqual({ ok: false, reason: 'price<min' });
    expect(match(makeListing({ priceCents: 120_001 }), w)).toEqual({ ok: false, reason: 'price>max' });
  });

  it('anúncio sem preço é recusado', () => {
    expect(match(makeListing({ priceCents: null }), makeWatch())).toEqual({ ok: false, reason: 'no-price' });
  });

  it('"Switch Lite R$ 950" é recusado no produto demais modelos', () => {
    const l = makeListing({ title: 'Nintendo Switch Lite', priceCents: 95_000 });
    expect(match(l, makeWatch())).toEqual({ ok: false, reason: 'exclude:"lite"' });
  });

  it('não comprável é sempre recusado, mesmo em cidade de retirada', () => {
    const l = makeListing({ buyable: false, delivery: false, deliveryLabel: undefined });
    expect(match(l, makeWatch())).toEqual({ ok: false, reason: 'not-buyable' });
  });

  it('em cidade de retirada aceita sem entrega', () => {
    const l = makeListing({ delivery: false, deliveryLabel: undefined });
    expect(match(l, makeWatch())).toEqual({ ok: true });
  });

  it('fora da cidade de retirada exige entrega', () => {
    const l = makeListing({ delivery: false, city: 'São Paulo', state: 'SP' });
    expect(match(l, makeWatch())).toEqual({ ok: false, reason: 'no-delivery' });
  });

  it('"Aparecida de Goiânia" não conta como Goiânia', () => {
    const l = makeListing({ delivery: false, city: 'Aparecida de Goiânia', state: 'GO' });
    expect(match(l, makeWatch())).toEqual({ ok: false, reason: 'no-delivery' });
  });

  it('anúncio sem cidade conta como fora', () => {
    const l = makeListing({ delivery: false, city: undefined, state: undefined });
    expect(match(l, makeWatch())).toEqual({ ok: false, reason: 'no-delivery' });
  });

  it('pickupCities vazio exige entrega em todo lugar', () => {
    const l = makeListing({ delivery: false });
    expect(match(l, makeWatch({ pickupCities: [] }))).toEqual({ ok: false, reason: 'no-delivery' });
  });

  it('anúncio impulsionado não é descartado', () => {
    expect(match(makeListing({ boosted: true }), makeWatch())).toEqual({ ok: true });
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npx vitest run tests/matcher.test.ts`
Expected: FAIL — `Failed to resolve import "../src/matcher.ts"`.

- [ ] **Step 5: Implementar `src/matcher.ts`**

```ts
import type { Watch } from './config.ts';
import type { Listing } from './listing.ts';
import { containsTerm, normalize, prefixStates, startsWithTerm } from './text.ts';

export type MatchResult = { ok: true } | { ok: false; reason: string };

type TextRules = Pick<Watch, 'startsWith' | 'include' | 'exclude' | 'ignorePrefixes'>;

/** Regras 1–5 da spec §5: normalização, prefixos, startsWith, include, exclude. */
export function matchText(title: string, watch: TextRules): MatchResult {
  const t = normalize(title);
  const states = prefixStates(t, watch.ignorePrefixes);
  const starts = watch.startsWith.some((term) => states.some((s) => startsWithTerm(s, term)));
  if (!starts) return { ok: false, reason: 'startsWith' };
  const missing = watch.include.find((term) => !containsTerm(t, term));
  if (missing !== undefined) return { ok: false, reason: `include:"${missing}"` };
  const hit = watch.exclude.find((term) => containsTerm(t, term));
  if (hit !== undefined) return { ok: false, reason: `exclude:"${hit}"` };
  return { ok: true };
}

/** Todas as regras da spec §5: texto, preço, compra imediata (fixa) e entrega/retirada. */
export function match(listing: Listing, watch: Watch): MatchResult {
  const text = matchText(listing.title, watch);
  if (!text.ok) return text;
  if (listing.priceCents === null) return { ok: false, reason: 'no-price' };
  if (listing.priceCents < watch.minPriceCents) return { ok: false, reason: 'price<min' };
  if (listing.priceCents > watch.maxPriceCents) return { ok: false, reason: 'price>max' };
  if (!listing.buyable) return { ok: false, reason: 'not-buyable' };
  if (!listing.delivery && !inPickupCity(listing, watch)) return { ok: false, reason: 'no-delivery' };
  return { ok: true };
}

function inPickupCity(listing: Listing, watch: Watch): boolean {
  if (!listing.city || !listing.state) return false;
  const city = normalize(listing.city);
  const state = normalize(listing.state);
  return watch.pickupCities.some((p) => p.city === city && p.state === state);
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run tests/matcher.test.ts`
Expected: PASS.

- [ ] **Step 7: Escrever o teste com títulos reais — `tests/matcher-real-titles.test.ts`**

Listas geradas a partir de `tests/fixtures/titles.json` (coleta de 2026-10-14) e conferidas contra a seção 5 da spec.

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Watch } from '../src/config.ts';
import { match, matchText } from '../src/matcher.ts';
import { DEFAULT_EXCLUDE, makeListing, makeWatch } from './helpers.ts';

type Bucket = [title: string, priceReais: number][];
const data = JSON.parse(readFileSync(new URL('./fixtures/titles.json', import.meta.url), 'utf8')) as Record<
  string,
  Bucket
>;

const NO_MAX = 100_000_000;
const lite = makeWatch({
  id: 'switch-lite',
  startsWith: ['switch lite|swich lite|switchlite'],
  exclude: DEFAULT_EXCLUDE,
  minPriceCents: 40_000,
  maxPriceCents: NO_MAX,
});
const sw = makeWatch({ minPriceCents: 40_000, maxPriceCents: NO_MAX });
const vita = makeWatch({
  id: 'ps-vita',
  startsWith: ['ps vita|psvita|vita'],
  exclude: DEFAULT_EXCLUDE,
  minPriceCents: 30_000,
  maxPriceCents: NO_MAX,
});

/** Na busca "switch lite", tudo é console aprovado, menos estes. */
const LITE_REJECTED = [
  'Case Nintendo switch LITE',
  'Controle Sem Fio Compatível com Nintendo Switch, Switch OLED e Switch Lite - LinYuvo KS37B',
  'Controle Sem Fio Para Nintendo Switch/Lite/Oled Gato Cat Mãos Pequenas',
  'Controle Sem Fio Gato para Nintendo Switch / Lite / Oled / PC - Ideal para mãos pequenas',
  'Controle Original PC/Android/iOS/Switch GameSir Nova Lite- Multiplataforma',
  'Controle sem fio Gamesir NOVA Lite - NOVO',
  'Nintendo Switch Desbloqueado + MicroSD de 32gb + Carregador Original e Capa Protetora',
];

/** Na busca "nintendo switch", só estes passam no texto (jogos, acessórios e Lites são recusados). */
const SWITCH_APPROVED = [
  'Nintendo Switch V2 HAC-001(-01)',
  'Nintendo Switch 2 - EA FC 26',
  'Nintendo Switch',
  'Nintendo switch oled desbloqueado',
  'Console Nintendo Switch Oled Desbloqueado ( Semi Novo )',
  'SWITCH OLED NOVO',
  'Nintendo Switch OLED - Acessórios',
  'Console Nintendo Switch 2 NOVO',
  'Nintendo SWITCH',
  'Nintendo Switch V1 Desbloqueável + 3 Jogos + Acessórios',
  'Nintendo Switch Oled',
  'Nintendo Switch Oled desbloqueado 256GB + Acessórios - Perfeito para Gamers!',
  'Nintendo switch V2 desbloqueado',
  'Nintendo Switch Oled Desbloqueado 128GB Kit Completo + Acessórios extras - Faço envio olx',
  'Nintendo Switch 2 novo',
  'Nintendo Switch OLED Completo + Controle Pro + Headset Redragon + Case Zelda',
  'nintendo switch 2',
  'Nintendo Switch OLED',
  'Nintendo Switch Oled Completo - Na caixa',
  'Nintendo Switch OLED desbloqueado',
  'Nintendo Switch OLED | Dock e Todos Acessórios Originais',
  'Nintendo Switch 2 Nacional - Impecável / Completo na Caixa | LEIA A DESCRIÇÃO',
  'Nintendo Switch - Diablo Edition (Versão colecionador)',
  'Nintendo Switch V2 Desbloqueado',
  'Nintendo Switch V1',
  'NINTENDO SWITCH',
];

/** Na busca "ps vita", só estes passam no texto. */
const VITA_APPROVED = [
  'PS Vita Oled Destravado 128gb + Case e Grip - Parcelo e Entrego',
  'Psvita',
  'Ps vita desbloqueado 128gb',
  'Psvita - Caligula Japonês Raro Jogo Ps Vita',
  'Psvita - Stranger of Sword City Japonês Raro + Carta Last Chronicle Tsukisada Riha',
  'PS Vita FAT (Desbloqueado)',
  'PSVITA COM 32GB E 2 JOGOS FISICOS',
  'PS Vita 64gb. Avaliamos Troca, loja física desde 2004, próximo ao Metrô.',
  'PS Vita slim branco raro 128gb em ótimo estado',
  'Psvita - MotoGP 13 Europeu Raro Capa Impressa',
  'Ps Vita Slim Pch-2000 Edição Especial Final Fantasy, Cartao original 16GB, Strap',
  'PSVita - 128GB Desbloqueado',
  'Ps vita fat',
  'PS Vita',
  'Ps vita',
  'PlayStation Vita FAT (Modelo 1000) - Excelente Estado e Funcionando',
  'PsVita Fat Oled Desbloqueado',
  'PS Vita OLED - Sapphire Blue (CIB) [PCH-1000]',
  'PS Vita Slim - Pink/Black (CIB) [PCH-2000]',
  'PS Vita Slim - God Eater 2 Fenrir Edition (CIB) [PCH-2000]',
];

/** Jogos que escapam do texto ("<produto> - <jogo>") e devem cair no minPrice. */
const LOW_PRICE = [
  'Nintendo Switch 2 - EA FC 26',
  'Psvita - Caligula Japonês Raro Jogo Ps Vita',
  'Psvita - Stranger of Sword City Japonês Raro + Carta Last Chronicle Tsukisada Riha',
  'Psvita - MotoGP 13 Europeu Raro Capa Impressa',
];

const CASES: [string, Watch, (title: string) => boolean][] = [
  ['switch lite', lite, (t) => !LITE_REJECTED.includes(t)],
  ['nintendo switch', sw, (t) => SWITCH_APPROVED.includes(t)],
  ['ps vita', vita, (t) => VITA_APPROVED.includes(t)],
];

for (const [bucket, watch, approved] of CASES) {
  describe(`títulos reais — busca "${bucket}"`, () => {
    for (const [title] of data[bucket]) {
      it(`${approved(title) ? 'aprova' : 'recusa'}: ${title}`, () => {
        expect(matchText(title, watch).ok).toBe(approved(title));
      });
    }

    it('o piso de preço elimina só os jogos que escaparam do texto', () => {
      for (const [title, price] of data[bucket]) {
        if (!approved(title)) continue;
        const ok = match(makeListing({ title, priceCents: price * 100 }), watch).ok;
        expect(ok, title).toBe(!LOW_PRICE.includes(title));
      }
    });
  });
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run tests/matcher-real-titles.test.ts`
Expected: PASS (≈150 casos). Se algum título falhar, **não altere a lista para fazer passar**: o matcher está errado. Compare com a seção 5 da spec.

- [ ] **Step 9: Commit**

```bash
git add src/listing.ts src/matcher.ts tests/helpers.ts tests/matcher.test.ts tests/matcher-real-titles.test.ts
git commit -m "feat: matcher (título começa com o produto, preço, compra e entrega)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Decisão de alerta (`decide`)

**Files:**
- Create: `src/decide.ts`
- Test: `tests/decide.test.ts`

**Interfaces:**
- Consumes: `AlertKind` (Task 3).
- Produces (`src/decide.ts`):
  - `interface StoredListing { lastPriceCents: number | null; notifiedPriceCents: number | null; lastMatched: boolean }`
  - `interface Decision { alert: AlertKind; previousPriceCents?: number }`
  - `decide(matched: boolean, priceCents: number | null, stored: StoredListing | undefined): Decision | null`

- [ ] **Step 1: Escrever o teste que falha — `tests/decide.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { decide, type StoredListing } from '../src/decide.ts';

const stored = (over: Partial<StoredListing> = {}): StoredListing => ({
  lastPriceCents: 100_000,
  notifiedPriceCents: null,
  lastMatched: false,
  ...over,
});

describe('decide (tabela da spec §6)', () => {
  it('inexistente + passa → NOVO', () => {
    expect(decide(true, 90_000, undefined)).toEqual({ alert: 'new' });
  });

  it('inexistente + não passa → silêncio', () => {
    expect(decide(false, 90_000, undefined)).toBeNull();
  });

  it('existe, nunca notificado, antes fora do filtro, agora passa → PREÇO BAIXOU com preço anterior', () => {
    expect(decide(true, 90_000, stored({ lastPriceCents: 130_000 }))).toEqual({
      alert: 'price_drop',
      previousPriceCents: 130_000,
    });
  });

  it('price_drop sem preço anterior conhecido não inventa valor', () => {
    expect(decide(true, 90_000, stored({ lastPriceCents: null }))).toEqual({ alert: 'price_drop' });
  });

  it('existe, notificado, preço menor que o notificado → BAIXOU DE NOVO', () => {
    expect(decide(true, 80_000, stored({ notifiedPriceCents: 90_000, lastMatched: true }))).toEqual({
      alert: 'price_drop_again',
      previousPriceCents: 90_000,
    });
  });

  it('existe, notificado, preço igual ou maior → nada', () => {
    expect(decide(true, 90_000, stored({ notifiedPriceCents: 90_000, lastMatched: true }))).toBeNull();
    expect(decide(true, 95_000, stored({ notifiedPriceCents: 90_000, lastMatched: true }))).toBeNull();
  });

  it('existe e não passa → nada', () => {
    expect(decide(false, 50_000, stored({ notifiedPriceCents: 90_000 }))).toBeNull();
  });

  it('passou antes mas o envio falhou (nunca notificado) → NOVO de novo', () => {
    expect(decide(true, 90_000, stored({ lastPriceCents: 90_000, lastMatched: true }))).toEqual({ alert: 'new' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/decide.test.ts`
Expected: FAIL — `Failed to resolve import "../src/decide.ts"`.

- [ ] **Step 3: Implementar `src/decide.ts`**

```ts
import type { AlertKind } from './listing.ts';

export interface StoredListing {
  lastPriceCents: number | null;
  notifiedPriceCents: number | null;
  /** O anúncio passou no filtro na última vez que foi visto. */
  lastMatched: boolean;
}

export interface Decision {
  alert: AlertKind;
  previousPriceCents?: number;
}

/** Tabela "Decisão de alerta" da spec §6. Função pura. */
export function decide(
  matched: boolean,
  priceCents: number | null,
  stored: StoredListing | undefined,
): Decision | null {
  if (!matched) return null;
  if (!stored) return { alert: 'new' };
  if (stored.notifiedPriceCents === null) {
    // Já passava no filtro e nunca foi notificado: o envio anterior falhou.
    if (stored.lastMatched) return { alert: 'new' };
    return stored.lastPriceCents === null
      ? { alert: 'price_drop' }
      : { alert: 'price_drop', previousPriceCents: stored.lastPriceCents };
  }
  if (priceCents !== null && priceCents < stored.notifiedPriceCents) {
    return { alert: 'price_drop_again', previousPriceCents: stored.notifiedPriceCents };
  }
  return null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/decide.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/decide.ts tests/decide.test.ts
git commit -m "feat: decisão de alerta (novo, preço baixou, baixou de novo)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Histórico em SQLite (`Store`)

**Files:**
- Create: `src/store.ts`
- Test: `tests/store.test.ts`

**Interfaces:**
- Consumes: `StoredListing` (Task 4); `Listing` (Task 3).
- Produces (`src/store.ts`): `class Store` com
  - `constructor(path: string)` (`':memory:'` para testes; cria a pasta se preciso)
  - `get(watchId: string, l: Pick<Listing, 'source' | 'id'>): StoredListing | undefined`
  - `hasAny(watchId: string): boolean`
  - `recordSeen(watchId: string, l: Listing, matched: boolean, now: Date): void`
  - `markNotified(watchId: string, l: Listing, now: Date): void`
  - `purgeOlderThan(cutoff: Date): number`
  - `close(): void`

- [ ] **Step 1: Escrever o teste que falha — `tests/store.test.ts`**

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.ts';
import { makeListing } from './helpers.ts';

const T0 = new Date('2026-10-14T10:00:00Z');

describe('Store', () => {
  it('começa vazio', () => {
    const s = new Store(':memory:');
    expect(s.hasAny('switch')).toBe(false);
    expect(s.get('switch', makeListing())).toBeUndefined();
  });

  it('registra visto e devolve o histórico por produto', () => {
    const s = new Store(':memory:');
    const l = makeListing({ id: '1', priceCents: 100_000 });
    s.recordSeen('switch', l, true, T0);
    expect(s.hasAny('switch')).toBe(true);
    expect(s.hasAny('ps-vita')).toBe(false);
    expect(s.get('switch', l)).toEqual({ lastPriceCents: 100_000, notifiedPriceCents: null, lastMatched: true });
    expect(s.get('ps-vita', l)).toBeUndefined();
  });

  it('atualiza preço e filtro ao ver de novo', () => {
    const s = new Store(':memory:');
    s.recordSeen('switch', makeListing({ id: '1', priceCents: 100_000 }), false, T0);
    s.recordSeen('switch', makeListing({ id: '1', priceCents: 80_000 }), true, T0);
    expect(s.get('switch', makeListing({ id: '1' }))).toEqual({
      lastPriceCents: 80_000,
      notifiedPriceCents: null,
      lastMatched: true,
    });
  });

  it('marca como notificado com o preço atual', () => {
    const s = new Store(':memory:');
    const l = makeListing({ id: '1', priceCents: 90_000 });
    s.recordSeen('switch', l, true, T0);
    s.markNotified('switch', l, T0);
    expect(s.get('switch', l)?.notifiedPriceCents).toBe(90_000);
  });

  it('aceita anúncio sem preço', () => {
    const s = new Store(':memory:');
    const l = makeListing({ id: '1', priceCents: null });
    s.recordSeen('switch', l, false, T0);
    expect(s.get('switch', l)?.lastPriceCents).toBeNull();
  });

  it('remove registros não vistos desde a data de corte', () => {
    const s = new Store(':memory:');
    s.recordSeen('switch', makeListing({ id: 'old' }), false, new Date('2026-09-01T00:00:00Z'));
    s.recordSeen('switch', makeListing({ id: 'new' }), false, T0);
    expect(s.purgeOlderThan(new Date('2026-09-14T00:00:00Z'))).toBe(1);
    expect(s.get('switch', makeListing({ id: 'old' }))).toBeUndefined();
    expect(s.get('switch', makeListing({ id: 'new' }))).toBeDefined();
  });

  it('persiste em arquivo entre aberturas', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'store-')), 'sub', 'tracker.db');
    const a = new Store(path);
    a.recordSeen('switch', makeListing({ id: '1' }), true, T0);
    a.close();
    const b = new Store(path);
    expect(b.hasAny('switch')).toBe(true);
    b.close();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/store.test.ts`
Expected: FAIL — `Failed to resolve import "../src/store.ts"`.

- [ ] **Step 3: Implementar `src/store.ts`**

```ts
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { StoredListing } from './decide.ts';
import type { Listing } from './listing.ts';

type Key = Pick<Listing, 'source' | 'id'>;

interface Row {
  last_price_cents: number | null;
  notified_price_cents: number | null;
  last_matched: number;
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS listings (
        source TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        watch_id TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        last_price_cents INTEGER,
        last_matched INTEGER NOT NULL DEFAULT 0,
        notified_price_cents INTEGER,
        notified_at TEXT,
        PRIMARY KEY (source, listing_id, watch_id)
      )`);
  }

  get(watchId: string, l: Key): StoredListing | undefined {
    const row = this.db
      .prepare(
        `SELECT last_price_cents, notified_price_cents, last_matched
         FROM listings WHERE source = ? AND listing_id = ? AND watch_id = ?`,
      )
      .get(l.source, l.id, watchId) as Row | undefined;
    if (!row) return undefined;
    return {
      lastPriceCents: row.last_price_cents,
      notifiedPriceCents: row.notified_price_cents,
      lastMatched: row.last_matched === 1,
    };
  }

  hasAny(watchId: string): boolean {
    return this.db.prepare('SELECT 1 FROM listings WHERE watch_id = ? LIMIT 1').get(watchId) !== undefined;
  }

  recordSeen(watchId: string, l: Listing, matched: boolean, now: Date): void {
    const ts = now.toISOString();
    this.db
      .prepare(
        `INSERT INTO listings
           (source, listing_id, watch_id, title, url, first_seen, last_seen, last_price_cents, last_matched)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (source, listing_id, watch_id) DO UPDATE SET
           title = excluded.title,
           url = excluded.url,
           last_seen = excluded.last_seen,
           last_price_cents = excluded.last_price_cents,
           last_matched = excluded.last_matched`,
      )
      .run(l.source, l.id, watchId, l.title, l.url, ts, ts, l.priceCents, matched ? 1 : 0);
  }

  markNotified(watchId: string, l: Listing, now: Date): void {
    this.db
      .prepare(
        `UPDATE listings SET notified_price_cents = ?, notified_at = ?
         WHERE source = ? AND listing_id = ? AND watch_id = ?`,
      )
      .run(l.priceCents, now.toISOString(), l.source, l.id, watchId);
  }

  purgeOlderThan(cutoff: Date): number {
    const r = this.db.prepare('DELETE FROM listings WHERE last_seen < ?').run(cutoff.toISOString());
    return Number(r.changes);
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/store.test.ts`
Expected: PASS. Um aviso `ExperimentalWarning: SQLite is an experimental feature` no console é esperado e inofensivo.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat: histórico de anúncios em SQLite

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Notificador Discord

**Files:**
- Create: `src/notifiers/index.ts`, `src/notifiers/discord.ts`
- Test: `tests/discord.test.ts`

**Interfaces:**
- Consumes: `Alert`, `Listing` (Task 3); `Watch`, `Settings` (Task 2).
- Produces:
  - `src/notifiers/index.ts`: `interface Notifier { send(alerts: Alert[]): Promise<void>; notify(text: string): Promise<void> }`, `createNotifier(settings: Settings, env?: Record<string, string | undefined>): Notifier`
  - `src/notifiers/discord.ts`: `formatBRL(cents: number): string`, `interface DiscordEmbed`, `buildEmbed(a: Alert): DiscordEmbed`, `class DiscordNotifier implements Notifier` com `constructor(opts: { defaultUrl: string; env?: Record<string, string | undefined>; fetchFn?: FetchFn; sleep?: (ms: number) => Promise<void>; maxAttempts?: number })`
  - Contrato de `send`: recebe no máximo 10 alertas **do mesmo produto**; lança erro se o Discord não confirmar.

- [ ] **Step 1: Escrever o teste que falha — `tests/discord.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Alert } from '../src/listing.ts';
import { DiscordNotifier, buildEmbed, formatBRL } from '../src/notifiers/discord.ts';
import { createNotifier } from '../src/notifiers/index.ts';
import { makeListing, makeWatch } from './helpers.ts';

const alert = (over: Partial<Alert> = {}): Alert => ({
  kind: 'new',
  watch: makeWatch({ name: 'Nintendo Switch' }),
  listing: makeListing({ image: 'https://img.olx.com.br/x.webp' }),
  ...over,
});

const ok204 = () => vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));

describe('formatBRL', () => {
  it('formata em reais com espaço comum', () => {
    expect(formatBRL(100_000)).toBe('R$ 1.000,00');
    expect(formatBRL(85_050)).toBe('R$ 850,50');
  });
});

describe('buildEmbed', () => {
  it('monta o alerta NOVO completo', () => {
    expect(buildEmbed(alert())).toEqual({
      title: 'Nintendo Switch V2 desbloqueado',
      url: 'https://go.olx.com.br/x/nintendo-switch-1000',
      description: '🆕 NOVO',
      color: 0x2ecc71,
      fields: [
        { name: 'Preço', value: 'R$ 1.000,00', inline: true },
        { name: 'Local', value: 'Goiânia/GO', inline: true },
        { name: 'Entrega', value: '🚚 Entrega Fácil', inline: true },
        { name: 'Publicado', value: 'Hoje, 10:00', inline: true },
      ],
      thumbnail: { url: 'https://img.olx.com.br/x.webp' },
      footer: { text: 'Nintendo Switch' },
    });
  });

  it('PREÇO BAIXOU mostra o preço anterior', () => {
    const e = buildEmbed(
      alert({ kind: 'price_drop', previousPriceCents: 95_000, listing: makeListing({ priceCents: 85_000 }) }),
    );
    expect(e.description).toBe('📉 PREÇO BAIXOU de R$ 950,00');
    expect(e.color).toBe(0xe67e22);
  });

  it('BAIXOU DE NOVO mostra o preço notificado antes', () => {
    const e = buildEmbed(
      alert({ kind: 'price_drop_again', previousPriceCents: 90_000, listing: makeListing({ priceCents: 85_000 }) }),
    );
    expect(e.description).toBe('📉 BAIXOU DE NOVO de R$ 900,00');
  });

  it('teto aumentado (preço não caiu) mostra AGORA DENTRO DO LIMITE', () => {
    const l = makeListing({ priceCents: 85_000 });
    expect(buildEmbed(alert({ kind: 'price_drop', previousPriceCents: 85_000, listing: l })).description).toBe(
      '✅ AGORA DENTRO DO LIMITE',
    );
    expect(buildEmbed(alert({ kind: 'price_drop', listing: l })).description).toBe('✅ AGORA DENTRO DO LIMITE');
  });

  it('marca destaque e corta título longo', () => {
    const e = buildEmbed(alert({ listing: makeListing({ boosted: true, title: 'x'.repeat(300) }) }));
    expect(e.description).toBe('🆕 NOVO · ⭐ Destaque');
    expect(e.title).toHaveLength(256);
  });

  it('omite campos ausentes', () => {
    const l = makeListing({ city: undefined, state: undefined, location: undefined, deliveryLabel: undefined, postedAt: undefined });
    expect(buildEmbed(alert({ listing: l })).fields).toEqual([{ name: 'Preço', value: 'R$ 1.000,00', inline: true }]);
  });
});

describe('DiscordNotifier', () => {
  it('envia embeds para o webhook padrão', async () => {
    const fetchFn = ok204();
    const a = alert();
    await new DiscordNotifier({ defaultUrl: 'https://discord.test/default', fetchFn }).send([a]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://discord.test/default');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ embeds: [buildEmbed(a)] });
  });

  it('usa o webhook do produto quando webhookEnv está definido', async () => {
    const fetchFn = ok204();
    const n = new DiscordNotifier({
      defaultUrl: 'https://discord.test/default',
      env: { DISCORD_WEBHOOK_SWITCH: 'https://discord.test/switch' },
      fetchFn,
    });
    await n.send([alert({ watch: makeWatch({ webhookEnv: 'DISCORD_WEBHOOK_SWITCH' }) })]);
    expect(fetchFn.mock.calls[0][0]).toBe('https://discord.test/switch');
  });

  it('falha clara quando a variável do webhook do produto não existe', async () => {
    const n = new DiscordNotifier({ defaultUrl: 'https://discord.test/default', env: {}, fetchFn: ok204() });
    await expect(n.send([alert({ watch: makeWatch({ webhookEnv: 'DISCORD_WEBHOOK_X' }) })])).rejects.toThrow(
      /DISCORD_WEBHOOK_X/,
    );
  });

  it('em 429 espera retry_after e reenvia', async () => {
    const fetchFn = vi
      .fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ retry_after: 1.5 }), { status: 429, headers: { 'content-type': 'application/json' } }),
      );
    const sleep = vi.fn(async (_ms: number) => {});
    await new DiscordNotifier({ defaultUrl: 'https://discord.test/d', fetchFn, sleep }).send([alert()]);
    expect(sleep).toHaveBeenCalledWith(1500);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('lança erro em falha definitiva', async () => {
    const fetchFn = vi.fn(async () => new Response('boom', { status: 500 }));
    await expect(new DiscordNotifier({ defaultUrl: 'https://discord.test/d', fetchFn }).send([alert()])).rejects.toThrow(
      /500/,
    );
  });

  it('desiste após o número máximo de 429', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ retry_after: 0 }), { status: 429 }));
    const n = new DiscordNotifier({ defaultUrl: 'https://discord.test/d', fetchFn, sleep: async () => {}, maxAttempts: 3 });
    await expect(n.send([alert()])).rejects.toThrow(/429/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('recusa mais de 10 alertas numa mensagem e ignora lista vazia', async () => {
    const fetchFn = ok204();
    const n = new DiscordNotifier({ defaultUrl: 'https://discord.test/d', fetchFn });
    await expect(n.send(Array.from({ length: 11 }, () => alert()))).rejects.toThrow(/10/);
    await n.send([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('notify envia texto simples ao webhook padrão', async () => {
    const fetchFn = ok204();
    await new DiscordNotifier({ defaultUrl: 'https://discord.test/d', fetchFn }).notify('🟢 iniciado');
    expect(JSON.parse(fetchFn.mock.calls[0][1].body as string)).toEqual({ content: '🟢 iniciado' });
  });
});

describe('createNotifier', () => {
  const settings = { intervalSeconds: 30, jitterSeconds: 10, headless: false, notifier: 'discord' as const, initialPages: 3, retentionDays: 30 };

  it('exige DISCORD_WEBHOOK_URL', () => {
    expect(() => createNotifier(settings, {})).toThrow(/DISCORD_WEBHOOK_URL/);
  });

  it('cria o notificador do Discord', () => {
    expect(createNotifier(settings, { DISCORD_WEBHOOK_URL: 'https://discord.test/d' })).toBeInstanceOf(DiscordNotifier);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/discord.test.ts`
Expected: FAIL — `Failed to resolve import "../src/notifiers/discord.ts"`.

- [ ] **Step 3: Implementar `src/notifiers/discord.ts`**

```ts
import type { Watch } from '../config.ts';
import type { Alert } from '../listing.ts';
import type { Notifier } from './index.ts';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface DiscordEmbed {
  title: string;
  url: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  thumbnail?: { url: string };
  footer: { text: string };
}

const GREEN = 0x2ecc71;
const ORANGE = 0xe67e22;

/** "R$ 1.100,00" com espaço comum (o Intl usa espaço não separável). */
export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(cents / 100)
    .replace(/\s/g, ' ');
}

function headline(a: Alert): string {
  if (a.kind === 'new') return '🆕 NOVO';
  const price = a.listing.priceCents;
  if (a.previousPriceCents !== undefined && price !== null && price < a.previousPriceCents) {
    const label = a.kind === 'price_drop_again' ? 'BAIXOU DE NOVO' : 'PREÇO BAIXOU';
    return `📉 ${label} de ${formatBRL(a.previousPriceCents)}`;
  }
  return '✅ AGORA DENTRO DO LIMITE';
}

export function buildEmbed(a: Alert): DiscordEmbed {
  const l = a.listing;
  const tags = [headline(a)];
  if (l.boosted) tags.push('⭐ Destaque');

  const fields: DiscordEmbed['fields'] = [
    { name: 'Preço', value: l.priceCents === null ? '—' : formatBRL(l.priceCents), inline: true },
  ];
  const place = l.city && l.state ? `${l.city}/${l.state}` : l.location;
  if (place) fields.push({ name: 'Local', value: place, inline: true });
  if (l.deliveryLabel) fields.push({ name: 'Entrega', value: `🚚 ${l.deliveryLabel}`, inline: true });
  if (l.postedAt) fields.push({ name: 'Publicado', value: l.postedAt, inline: true });

  return {
    title: l.title.slice(0, 256),
    url: l.url,
    description: tags.join(' · '),
    color: a.kind === 'new' ? GREEN : ORANGE,
    fields,
    thumbnail: l.image ? { url: l.image } : undefined,
    footer: { text: a.watch.name },
  };
}

export class DiscordNotifier implements Notifier {
  constructor(
    private readonly opts: {
      defaultUrl: string;
      env?: Record<string, string | undefined>;
      fetchFn?: FetchFn;
      sleep?: (ms: number) => Promise<void>;
      maxAttempts?: number;
    },
  ) {}

  private webhookFor(watch: Watch): string {
    if (!watch.webhookEnv) return this.opts.defaultUrl;
    const url = (this.opts.env ?? process.env)[watch.webhookEnv];
    if (!url) throw new Error(`Variável ${watch.webhookEnv} (webhookEnv do produto "${watch.id}") não definida no .env`);
    return url;
  }

  async send(alerts: Alert[]): Promise<void> {
    if (alerts.length === 0) return;
    if (alerts.length > 10) throw new Error('o Discord aceita no máximo 10 alertas por mensagem');
    await this.post(this.webhookFor(alerts[0].watch), { embeds: alerts.map(buildEmbed) });
  }

  async notify(text: string): Promise<void> {
    await this.post(this.opts.defaultUrl, { content: text.slice(0, 2000) });
  }

  private async post(url: string, body: unknown): Promise<void> {
    const fetchFn = this.opts.fetchFn ?? fetch;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const maxAttempts = this.opts.maxAttempts ?? 4;
    for (let attempt = 1; ; attempt++) {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return;
      if (res.status === 429 && attempt < maxAttempts) {
        const data = (await res.json().catch(() => ({}))) as { retry_after?: number };
        await sleep(Math.ceil((data.retry_after ?? 1) * 1000));
        continue;
      }
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`Discord respondeu ${res.status}${detail ? `: ${detail}` : ''}`);
    }
  }
}
```

- [ ] **Step 4: Implementar `src/notifiers/index.ts`**

```ts
import type { Settings } from '../config.ts';
import type { Alert } from '../listing.ts';
import { DiscordNotifier } from './discord.ts';

export interface Notifier {
  /** Até 10 alertas do mesmo produto; lança erro se o envio não for confirmado. */
  send(alerts: Alert[]): Promise<void>;
  /** Aviso operacional em texto (iniciado, bloqueio, config inválida...). */
  notify(text: string): Promise<void>;
}

export function createNotifier(
  settings: Settings,
  env: Record<string, string | undefined> = process.env,
): Notifier {
  switch (settings.notifier) {
    case 'discord': {
      const url = env.DISCORD_WEBHOOK_URL;
      if (!url) throw new Error('DISCORD_WEBHOOK_URL não definida. Copie .env.example para .env e cole a URL do webhook.');
      return new DiscordNotifier({ defaultUrl: url, env });
    }
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/discord.test.ts && npx tsc --noEmit`
Expected: PASS e typecheck limpo.

- [ ] **Step 6: Commit**

```bash
git add src/notifiers tests/discord.test.ts
git commit -m "feat: notificador Discord (embeds, limite de taxa, avisos)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Adaptador da OLX

**Files:**
- Create: `src/sources/index.ts`, `src/sources/olx.ts`, `tests/fixtures/olx-search.html`, `tests/fixtures/olx-empty.html`, `tests/fixtures/cloudflare-challenge.html`, `tests/fixtures/cloudflare-blocked.html`
- Test: `tests/olx.test.ts` (funções puras), `tests/olx-browser.test.ts` (Chromium sem rede)

**Interfaces:**
- Consumes: `Watch` (Task 2); `Listing` (Task 3); `makeWatch` (tests/helpers.ts).
- Produces:
  - `src/sources/index.ts`: `type BlockStatus = 'ok' | 'challenge' | 'blocked'`, `interface ExtractResult { listings: Listing[]; emptyResult: boolean }`, `interface Source { id: string; buildUrl(watch: Watch, page: number): string; extract(page: Page): Promise<ExtractResult>; detectBlock(page: Page, status: number | null): Promise<BlockStatus>; waitForResults(page: Page): Promise<void> }`, `const sources: Record<string, Source>`, `getSource(id: string): Source`
  - `src/sources/olx.ts`: `interface RawCard`, `buildUrl`, `parsePrice(text: string | null): number | null`, `parseCard(c: RawCard): Listing | null`, `const olx: Source`

Estrutura real do card (verificada em 2026-10-14):
- `section.olx-adcard`, link `a[data-testid="adcard-link"]` com `title` e `href` terminando em `-<id>`, título em `h2`
- preço em `h3.olx-adcard__price` ("R$ 1.100")
- selos em `.olx-adcard__badges .olx-core-badge` ("Frete grátis", "Entrega Fácil", "Parcele sem juros", "Até 10x sem juros")
- "Destaque" em `.olx-adcard__primary-badge`
- `.olx-adcard__location` ("Americana, Jardim Boer I") e `.olx-adcard__date` ("Hoje, 10:23")
- UF no subdomínio do link (`sp.olx.com.br`)

- [ ] **Step 1: Criar as fixtures HTML**

`tests/fixtures/olx-search.html` (montada a partir do DOM real; os cards 2 e 4 têm ids sintéticos):

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>"switch lite" - Games no Brasil</title></head>
<body>
<main>
<section class="olx-adcard olx-adcard__horizontal" data-mode="horizontal"><div class="olx-adcard__content" data-mode="horizontal"><div class="olx-adcard__topbody" data-mode="horizontal"><a data-testid="adcard-link" class="olx-adcard__link" title="Switch Lite Em ótimo estado bloqueado com caixa + película " href="https://sp.olx.com.br/grande-campinas/games/consoles-de-video-game/switch-lite-em-otimo-estado-bloqueado-com-caixa-pelicula-1543000244"><h2 class="typo-body-large olx-adcard__title font-semibold">Switch Lite Em ótimo estado bloqueado com caixa + película </h2></a><div class="olx-adcard__badges"><div class="olx-core-badge olx-core-badge--primary">Frete grátis</div><div class="olx-core-badge olx-core-badge--primary">Até 10x sem juros</div></div></div><div class="olx-adcard__mediumbody"><h3 class="typo-body-large olx-adcard__price font-semibold">R$ 1.100</h3><div data-testid="adcard-price-info-list" class="olx-adcard__price-info-list"><div class="olx-adcard__price-info"><span class="typo-caption">em até <span class="typo-caption font-bold inline">10x de R$&nbsp;110,00</span> sem juros</span></div></div></div><div class="olx-adcard__bottombody"><div class="olx-adcard__location-date"><p class="typo-caption olx-adcard__location"> <!-- -->Americana, Jardim Boer I</p><p class="typo-caption olx-adcard__date">Hoje, 10:23</p></div></div></div><div class="olx-adcard__media" data-mode="horizontal"><picture><img alt="Switch Lite" src="https://img.olx.com.br/thumbs700x500/95/956689335817784.webp" loading="lazy"></picture><div class="olx-core-badge olx-adcard__primary-badge" aria-label="Anúncio em destaque">Destaque</div></div></section>

<section class="olx-adcard olx-adcard__horizontal" data-mode="horizontal"><div class="olx-adcard__content"><div class="olx-adcard__topbody"><a data-testid="adcard-link" class="olx-adcard__link" title="Nintendo Switch Lite Turquesa" href="https://go.olx.com.br/grande-goiania-e-anapolis/games/consoles-de-video-game/nintendo-switch-lite-turquesa-1544200001?lis=listing_1"><h2 class="typo-body-large olx-adcard__title font-semibold">Nintendo Switch Lite Turquesa</h2></a><div class="olx-adcard__badges"><div class="olx-core-badge olx-core-badge--primary">Entrega Fácil</div><div class="olx-core-badge olx-core-badge--primary">Parcele sem juros</div></div></div><div class="olx-adcard__mediumbody"><h3 class="typo-body-large olx-adcard__price font-semibold">R$ 850</h3></div><div class="olx-adcard__bottombody"><div class="olx-adcard__location-date"><p class="typo-caption olx-adcard__location">Goiânia, Setor Bueno</p><p class="typo-caption olx-adcard__date">Hoje, 11:27</p></div></div></div><div class="olx-adcard__media"><picture><img alt="Switch Lite" src="https://img.olx.com.br/thumbs700x500/11/111111111111111.webp"></picture></div></section>

<section class="olx-adcard olx-adcard__horizontal" data-mode="horizontal"><div class="olx-adcard__content"><div class="olx-adcard__topbody"><a data-testid="adcard-link" class="olx-adcard__link" title="Nintendo switch  lite desbloqueado" href="https://ba.olx.com.br/grande-salvador/games/consoles-de-video-game/nintendo-switch-lite-desbloqueado-1544146354"><h2 class="typo-body-large olx-adcard__title font-semibold">Nintendo switch  lite desbloqueado</h2></a><div class="olx-adcard__badges"><div class="olx-core-badge olx-core-badge--primary">Parcele sem juros</div></div></div><div class="olx-adcard__mediumbody"><h3 class="typo-body-large olx-adcard__price font-semibold">R$ 1.500</h3></div><div class="olx-adcard__bottombody"><div class="olx-adcard__location-date"><p class="typo-caption olx-adcard__location">Salvador, Dom Avelar</p><p class="typo-caption olx-adcard__date">Hoje, 12:07</p></div></div></div><div class="olx-adcard__media"><picture><img alt="Switch Lite" src="https://img.olx.com.br/thumbs700x500/22/222222222222222.webp"></picture></div></section>

<section class="olx-adcard olx-adcard__horizontal" data-mode="horizontal"><div class="olx-adcard__content"><div class="olx-adcard__topbody"><a data-testid="adcard-link" class="olx-adcard__link" title="Nintendo Switch Lite" href="https://sc.olx.com.br/norte-de-santa-catarina/games/consoles-de-video-game/nintendo-switch-lite-1544100002"><h2 class="typo-body-large olx-adcard__title font-semibold">Nintendo Switch Lite</h2></a><div class="olx-adcard__badges"></div></div><div class="olx-adcard__mediumbody"></div><div class="olx-adcard__bottombody"><div class="olx-adcard__location-date"><p class="typo-caption olx-adcard__location">Joinville, Vila Nova</p><p class="typo-caption olx-adcard__date">Ontem, 19:55</p></div></div></div></section>
</main>
</body>
</html>
```

`tests/fixtures/olx-empty.html`:

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>"xyzqwvutnaoexiste123" - Games no Brasil</title></head>
<body><main><div><h2>Ops! Nenhum anúncio foi encontrado.</h2><p>Tente buscar por outro termo.</p></div></main></body>
</html>
```

`tests/fixtures/cloudflare-challenge.html`:

```html
<!DOCTYPE html>
<html lang="en-US">
<head><meta charset="utf-8"><title>Just a moment...</title></head>
<body><div class="main-wrapper"><h1>www.olx.com.br</h1><p>Verifying you are human. This may take a few seconds.</p><div id="challenge-form"></div></div></body>
</html>
```

`tests/fixtures/cloudflare-blocked.html`:

```html
<!DOCTYPE html>
<html lang="en-US">
<head><meta charset="utf-8"><title>Attention Required! | Cloudflare</title></head>
<body><div id="cf-wrapper"><h1>Sorry, you have been blocked</h1><h2>You are unable to access olx.com.br</h2></div></body>
</html>
```

- [ ] **Step 2: Escrever o teste puro que falha — `tests/olx.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { type RawCard, buildUrl, parseCard, parsePrice } from '../src/sources/olx.ts';
import { makeWatch } from './helpers.ts';

describe('buildUrl', () => {
  it('Brasil todo, página 1, sempre com opst=2 e mais recentes', () => {
    expect(buildUrl(makeWatch({ query: 'switch lite', region: 'brasil' }), 1)).toBe(
      'https://www.olx.com.br/games?q=switch+lite&sf=1&opst=2',
    );
  });

  it('estado e paginação', () => {
    expect(buildUrl(makeWatch({ query: 'switch lite', region: 'go' }), 2)).toBe(
      'https://www.olx.com.br/games/estado-go?q=switch+lite&sf=1&opst=2&o=2',
    );
  });

  it('estado/região', () => {
    expect(buildUrl(makeWatch({ query: 'switch', region: 'go/grande-goiania-e-anapolis' }), 1)).toBe(
      'https://www.olx.com.br/games/estado-go/grande-goiania-e-anapolis?q=switch&sf=1&opst=2',
    );
  });

  it('codifica acentos na busca', () => {
    expect(buildUrl(makeWatch({ query: 'ps vita edição', region: 'brasil' }), 1)).toBe(
      'https://www.olx.com.br/games?q=ps+vita+edi%C3%A7%C3%A3o&sf=1&opst=2',
    );
  });

  it('searchUrl recebe opst=2, ordenação e paginação por cima', () => {
    const w = makeWatch({
      query: undefined,
      searchUrl: 'https://www.olx.com.br/games/consoles-de-video-game/estado-go?q=switch&opst=1&o=5&sp=2',
    });
    const p1 = new URL(buildUrl(w, 1));
    expect(p1.pathname).toBe('/games/consoles-de-video-game/estado-go');
    expect(p1.searchParams.get('q')).toBe('switch');
    expect(p1.searchParams.get('opst')).toBe('2');
    expect(p1.searchParams.get('sf')).toBe('1');
    expect(p1.searchParams.get('sp')).toBe('2');
    expect(p1.searchParams.has('o')).toBe(false);
    expect(new URL(buildUrl(w, 3)).searchParams.get('o')).toBe('3');
  });
});

describe('parsePrice', () => {
  it('lê reais e centavos', () => {
    expect(parsePrice('R$ 1.100')).toBe(110_000);
    expect(parsePrice('R$ 850')).toBe(85_000);
    expect(parsePrice('R$ 1.299,90')).toBe(129_990);
    expect(parsePrice('R$ 99,5')).toBe(9_950);
    expect(parsePrice('R$\u00a01.400')).toBe(140_000);
  });

  it('sem preço legível vira null', () => {
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice('Grátis')).toBeNull();
  });
});

const raw = (over: Partial<RawCard> = {}): RawCard => ({
  title: 'Nintendo Switch Lite',
  href: 'https://go.olx.com.br/grande-goiania-e-anapolis/games/consoles-de-video-game/nintendo-switch-lite-123?lis=x',
  priceText: 'R$ 850',
  badges: ['Entrega Fácil', 'Parcele sem juros'],
  primaryBadge: null,
  location: 'Goiânia, Setor Bueno',
  date: 'Hoje, 11:27',
  image: 'https://img.olx.com.br/a.webp',
  ...over,
});

describe('parseCard', () => {
  it('converte o card em Listing', () => {
    expect(parseCard(raw())).toEqual({
      source: 'olx',
      id: '123',
      title: 'Nintendo Switch Lite',
      priceCents: 85_000,
      url: 'https://go.olx.com.br/grande-goiania-e-anapolis/games/consoles-de-video-game/nintendo-switch-lite-123',
      image: 'https://img.olx.com.br/a.webp',
      location: 'Goiânia, Setor Bueno',
      city: 'Goiânia',
      state: 'GO',
      postedAt: 'Hoje, 11:27',
      boosted: false,
      buyable: true,
      delivery: true,
      deliveryLabel: 'Entrega Fácil',
    });
  });

  it('"Parcele sem juros" sozinho não é comprável', () => {
    const l = parseCard(raw({ badges: ['Parcele sem juros'] }))!;
    expect(l.buyable).toBe(false);
    expect(l.delivery).toBe(false);
    expect(l.deliveryLabel).toBeUndefined();
  });

  it('reconhece selo com caixa e espaços diferentes', () => {
    expect(parseCard(raw({ badges: ['  FRETE GRÁTIS '] }))!.deliveryLabel).toBe('FRETE GRÁTIS');
  });

  it('destaque/impulsionado viram boosted', () => {
    expect(parseCard(raw({ primaryBadge: 'Destaque' }))!.boosted).toBe(true);
    expect(parseCard(raw({ primaryBadge: 'Impulsionado' }))!.boosted).toBe(true);
  });

  it('colapsa espaços do título', () => {
    expect(parseCard(raw({ title: ' Nintendo switch  lite ' }))!.title).toBe('Nintendo switch lite');
  });

  it('host www não vira UF', () => {
    expect(parseCard(raw({ href: 'https://www.olx.com.br/item/switch-lite-55' }))!.state).toBeUndefined();
  });

  it('card sem id, sem link válido ou sem título é descartado', () => {
    expect(parseCard(raw({ href: 'https://go.olx.com.br/games/sem-id' }))).toBeNull();
    expect(parseCard(raw({ href: '' }))).toBeNull();
    expect(parseCard(raw({ title: '  ' }))).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/olx.test.ts`
Expected: FAIL — `Failed to resolve import "../src/sources/olx.ts"`.

- [ ] **Step 4: Implementar `src/sources/index.ts`**

```ts
import type { Page } from 'playwright';
import type { Watch } from '../config.ts';
import type { Listing } from '../listing.ts';
import { olx } from './olx.ts';

export type BlockStatus = 'ok' | 'challenge' | 'blocked';

export interface ExtractResult {
  listings: Listing[];
  /** A fonte disse explicitamente que a busca não tem resultados. */
  emptyResult: boolean;
}

export interface Source {
  id: string;
  buildUrl(watch: Watch, page: number): string;
  extract(page: Page): Promise<ExtractResult>;
  detectBlock(page: Page, status: number | null): Promise<BlockStatus>;
  /** Espera os resultados (ou a mensagem de busca vazia) aparecerem; não lança em timeout. */
  waitForResults(page: Page): Promise<void>;
}

export const sources: Record<string, Source> = { [olx.id]: olx };

export function getSource(id: string): Source {
  const s = sources[id];
  if (!s) throw new Error(`Fonte desconhecida: "${id}"`);
  return s;
}
```

- [ ] **Step 5: Implementar `src/sources/olx.ts`**

```ts
import type { Page } from 'playwright';
import type { Watch } from '../config.ts';
import type { Listing } from '../listing.ts';
import type { BlockStatus, ExtractResult, Source } from './index.ts';

/** Dados crus de um card, lidos no navegador. */
export interface RawCard {
  title: string;
  href: string;
  priceText: string | null;
  badges: string[];
  primaryBadge: string | null;
  location: string | null;
  date: string | null;
  image: string | null;
}

const BASE = 'https://www.olx.com.br/games';
/** Selos que indicam botão "Comprar" com Garantia da OLX (spec §2). "Parcele sem juros" NÃO conta. */
const DELIVERY_BADGES = ['entrega fácil', 'frete grátis'];
const EMPTY_TEXT = 'Nenhum anúncio foi encontrado';

export function buildUrl(watch: Watch, page: number): string {
  let url: URL;
  if (watch.searchUrl) {
    url = new URL(watch.searchUrl);
  } else {
    url = new URL(watch.region === 'brasil' ? BASE : `${BASE}/${regionPath(watch.region)}`);
    url.searchParams.set('q', watch.query ?? '');
  }
  url.searchParams.set('sf', '1'); // mais recentes
  url.searchParams.set('opst', '2'); // só anúncios com entrega/compra imediata (regra fixa)
  if (page > 1) url.searchParams.set('o', String(page));
  else url.searchParams.delete('o');
  return url.toString();
}

function regionPath(region: string): string {
  const [uf, sub] = region.split('/');
  return sub ? `estado-${uf}/${sub}` : `estado-${uf}`;
}

export function parsePrice(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/R\$\s*([\d.]+)(?:,(\d{1,2}))?/);
  if (!m) return null;
  const reais = Number(m[1].replace(/\./g, ''));
  const cents = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  return reais * 100 + cents;
}

export function parseCard(c: RawCard): Listing | null {
  let u: URL;
  try {
    u = new URL(c.href);
  } catch {
    return null;
  }
  const id = u.pathname.match(/-(\d+)\/?$/)?.[1];
  const title = c.title.replace(/\s+/g, ' ').trim();
  if (!id || !title) return null;

  const deliveryLabel = c.badges
    .map((b) => b.replace(/\s+/g, ' ').trim())
    .find((b) => DELIVERY_BADGES.includes(b.toLowerCase()));
  const sub = u.hostname.split('.')[0];
  const location = c.location?.replace(/\s+/g, ' ').trim() || undefined;

  return {
    source: 'olx',
    id,
    title,
    priceCents: parsePrice(c.priceText),
    url: `${u.origin}${u.pathname}`,
    image: c.image ?? undefined,
    location,
    city: location?.split(',')[0].trim() || undefined,
    state: /^[a-z]{2}$/.test(sub) ? sub.toUpperCase() : undefined,
    postedAt: c.date?.trim() || undefined,
    boosted: /destaque|impulsionado/i.test(c.primaryBadge ?? ''),
    buyable: deliveryLabel !== undefined,
    delivery: deliveryLabel !== undefined,
    deliveryLabel,
  };
}

async function extract(page: Page): Promise<ExtractResult> {
  const raw: RawCard[] = await page.$$eval('section.olx-adcard', (cards) =>
    cards.map((c) => {
      const text = (sel: string) => c.querySelector(sel)?.textContent?.trim() || null;
      const link = c.querySelector<HTMLAnchorElement>('a[data-testid="adcard-link"], a.olx-adcard__link');
      return {
        title: text('h2') ?? link?.getAttribute('title') ?? '',
        href: link?.href ?? '',
        priceText: text('.olx-adcard__price'),
        badges: [...c.querySelectorAll('.olx-adcard__badges .olx-core-badge')].map((b) => b.textContent ?? ''),
        primaryBadge: text('.olx-adcard__primary-badge'),
        location: text('.olx-adcard__location'),
        date: text('.olx-adcard__date'),
        image: c.querySelector('img')?.getAttribute('src') ?? null,
      };
    }),
  );
  const listings = raw.map(parseCard).filter((l): l is Listing => l !== null);
  const emptyResult = raw.length === 0 && (await page.getByText(EMPTY_TEXT).count()) > 0;
  return { listings, emptyResult };
}

async function detectBlock(page: Page, status: number | null): Promise<BlockStatus> {
  const title = await page.title().catch(() => '');
  const body = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
  if (/you have been blocked|voc[eê] foi bloquead/i.test(body)) return 'blocked';
  if (/just a moment|um momento|attention required/i.test(title)) return 'challenge';
  const widgets = await page
    .locator('#challenge-form, iframe[src*="challenges.cloudflare.com"], iframe[src*="challenge-platform"]')
    .count();
  if (widgets > 0) return 'challenge';
  if (status === 403 || status === 429) return 'blocked';
  return 'ok';
}

async function waitForResults(page: Page): Promise<void> {
  await page
    .locator('section.olx-adcard')
    .or(page.getByText(EMPTY_TEXT))
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
}

export const olx: Source = { id: 'olx', buildUrl, extract, detectBlock, waitForResults };
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run tests/olx.test.ts`
Expected: PASS.

- [ ] **Step 7: Escrever o teste no navegador — `tests/olx-browser.test.ts`**

```ts
import { readFileSync } from 'node:fs';
import { type Browser, type Page, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { olx } from '../src/sources/olx.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.route('**/*', (route) => route.abort()); // nenhum acesso à rede
});

afterAll(async () => {
  await browser.close();
});

describe('olx.extract', () => {
  it('lê os 4 cards da fixture', async () => {
    await page.setContent(fixture('olx-search.html'));
    const { listings, emptyResult } = await olx.extract(page);
    expect(emptyResult).toBe(false);
    expect(listings).toEqual([
      {
        source: 'olx',
        id: '1543000244',
        title: 'Switch Lite Em ótimo estado bloqueado com caixa + película',
        priceCents: 110_000,
        url: 'https://sp.olx.com.br/grande-campinas/games/consoles-de-video-game/switch-lite-em-otimo-estado-bloqueado-com-caixa-pelicula-1543000244',
        image: 'https://img.olx.com.br/thumbs700x500/95/956689335817784.webp',
        location: 'Americana, Jardim Boer I',
        city: 'Americana',
        state: 'SP',
        postedAt: 'Hoje, 10:23',
        boosted: true,
        buyable: true,
        delivery: true,
        deliveryLabel: 'Frete grátis',
      },
      {
        source: 'olx',
        id: '1544200001',
        title: 'Nintendo Switch Lite Turquesa',
        priceCents: 85_000,
        url: 'https://go.olx.com.br/grande-goiania-e-anapolis/games/consoles-de-video-game/nintendo-switch-lite-turquesa-1544200001',
        image: 'https://img.olx.com.br/thumbs700x500/11/111111111111111.webp',
        location: 'Goiânia, Setor Bueno',
        city: 'Goiânia',
        state: 'GO',
        postedAt: 'Hoje, 11:27',
        boosted: false,
        buyable: true,
        delivery: true,
        deliveryLabel: 'Entrega Fácil',
      },
      {
        source: 'olx',
        id: '1544146354',
        title: 'Nintendo switch lite desbloqueado',
        priceCents: 150_000,
        url: 'https://ba.olx.com.br/grande-salvador/games/consoles-de-video-game/nintendo-switch-lite-desbloqueado-1544146354',
        image: 'https://img.olx.com.br/thumbs700x500/22/222222222222222.webp',
        location: 'Salvador, Dom Avelar',
        city: 'Salvador',
        state: 'BA',
        postedAt: 'Hoje, 12:07',
        boosted: false,
        buyable: false,
        delivery: false,
        deliveryLabel: undefined,
      },
      {
        source: 'olx',
        id: '1544100002',
        title: 'Nintendo Switch Lite',
        priceCents: null,
        url: 'https://sc.olx.com.br/norte-de-santa-catarina/games/consoles-de-video-game/nintendo-switch-lite-1544100002',
        image: undefined,
        location: 'Joinville, Vila Nova',
        city: 'Joinville',
        state: 'SC',
        postedAt: 'Ontem, 19:55',
        boosted: false,
        buyable: false,
        delivery: false,
        deliveryLabel: undefined,
      },
    ]);
  });

  it('reconhece busca sem resultados', async () => {
    await page.setContent(fixture('olx-empty.html'));
    expect(await olx.extract(page)).toEqual({ listings: [], emptyResult: true });
  });

  it('página sem cards e sem aviso de vazio não é "vazia"', async () => {
    await page.setContent('<html><body><main>layout novo</main></body></html>');
    expect(await olx.extract(page)).toEqual({ listings: [], emptyResult: false });
  });
});

describe('olx.detectBlock', () => {
  it('página normal com 200 é ok', async () => {
    await page.setContent(fixture('olx-search.html'));
    expect(await olx.detectBlock(page, 200)).toBe('ok');
  });

  it('desafio "Just a moment" é challenge', async () => {
    await page.setContent(fixture('cloudflare-challenge.html'));
    expect(await olx.detectBlock(page, 403)).toBe('challenge');
  });

  it('"you have been blocked" é blocked', async () => {
    await page.setContent(fixture('cloudflare-blocked.html'));
    expect(await olx.detectBlock(page, 403)).toBe('blocked');
  });

  it('403/429 sem página de desafio é blocked', async () => {
    await page.setContent(fixture('olx-empty.html'));
    expect(await olx.detectBlock(page, 403)).toBe('blocked');
    expect(await olx.detectBlock(page, 429)).toBe('blocked');
  });
});

describe('olx.waitForResults', () => {
  it('retorna logo quando há cards ou aviso de vazio', async () => {
    for (const name of ['olx-search.html', 'olx-empty.html']) {
      await page.setContent(fixture(name));
      const t = Date.now();
      await olx.waitForResults(page);
      expect(Date.now() - t).toBeLessThan(2000);
    }
  });
});
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run tests/olx-browser.test.ts && npx tsc --noEmit`
Expected: PASS (abre um Chromium headless, sem rede) e typecheck limpo.

- [ ] **Step 9: Commit**

```bash
git add src/sources tests/olx.test.ts tests/olx-browser.test.ts tests/fixtures/olx-search.html tests/fixtures/olx-empty.html tests/fixtures/cloudflare-challenge.html tests/fixtures/cloudflare-blocked.html
git commit -m "feat: adaptador OLX (URL com opst=2, leitura dos cards, detecção de bloqueio)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Agendador (intervalo, recuo, pausa)

**Files:**
- Create: `src/scheduler.ts`
- Test: `tests/scheduler.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces (`src/scheduler.ts`): `interface Timing { intervalMs: number; jitterMs: number }`, `class Scheduler` com
  - `constructor(o: Timing & { now?: () => number; random?: () => number })`
  - `setTiming(t: Timing): void`
  - `setWatches(watches: readonly { id: string; source: string }[]): void` (novos vencem já; removidos saem)
  - `next(): { watchId: string; at: number } | undefined` (ignora fontes pausadas; respeita recuo)
  - `done(watchId: string): void` (agenda o próximo ciclo)
  - `delay(): number`
  - `reportBlocked(source: string): { failures: number; waitMs: number }` (1, 2, 4, 8, 15 min, teto 15)
  - `reportOk(source: string): { recoveredFrom: number }`
  - `pause(source: string): void`, `resume(source: string): void`, `isPaused(source: string): boolean`

- [ ] **Step 1: Escrever o teste que falha — `tests/scheduler.test.ts`**

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/scheduler.test.ts`
Expected: FAIL — `Failed to resolve import "../src/scheduler.ts"`.

- [ ] **Step 3: Implementar `src/scheduler.ts`**

```ts
export interface Timing {
  intervalMs: number;
  jitterMs: number;
}

interface SourceState {
  failures: number;
  until: number;
  paused: boolean;
}

const BACKOFF_MINUTES = [1, 2, 4, 8, 15];

export class Scheduler {
  private readonly due = new Map<string, { source: string; at: number }>();
  private readonly states = new Map<string, SourceState>();
  private timing: Timing;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(o: Timing & { now?: () => number; random?: () => number }) {
    this.timing = { intervalMs: o.intervalMs, jitterMs: o.jitterMs };
    this.now = o.now ?? Date.now;
    this.random = o.random ?? Math.random;
  }

  setTiming(t: Timing): void {
    this.timing = t;
  }

  setWatches(watches: readonly { id: string; source: string }[]): void {
    const ids = new Set(watches.map((w) => w.id));
    for (const id of [...this.due.keys()]) if (!ids.has(id)) this.due.delete(id);
    for (const w of watches) {
      const d = this.due.get(w.id);
      if (d) d.source = w.source;
      else this.due.set(w.id, { source: w.source, at: this.now() });
    }
  }

  next(): { watchId: string; at: number } | undefined {
    let best: { watchId: string; at: number } | undefined;
    for (const [watchId, d] of this.due) {
      const s = this.states.get(d.source);
      if (s?.paused) continue;
      const at = Math.max(d.at, s?.until ?? 0);
      if (!best || at < best.at) best = { watchId, at };
    }
    return best;
  }

  done(watchId: string): void {
    const d = this.due.get(watchId);
    if (d) d.at = this.now() + this.delay();
  }

  /** Entre interval − jitter/2 e interval + jitter (30s/10s → 25s a 40s). */
  delay(): number {
    const { intervalMs, jitterMs } = this.timing;
    return Math.max(1000, Math.round(intervalMs + (this.random() * 1.5 - 0.5) * jitterMs));
  }

  reportBlocked(source: string): { failures: number; waitMs: number } {
    const s = this.state(source);
    s.failures++;
    const waitMs = BACKOFF_MINUTES[Math.min(s.failures, BACKOFF_MINUTES.length) - 1] * 60_000;
    s.until = this.now() + waitMs;
    return { failures: s.failures, waitMs };
  }

  reportOk(source: string): { recoveredFrom: number } {
    const s = this.state(source);
    const recoveredFrom = s.failures;
    s.failures = 0;
    s.until = 0;
    return { recoveredFrom };
  }

  pause(source: string): void {
    this.state(source).paused = true;
  }

  resume(source: string): void {
    this.state(source).paused = false;
  }

  isPaused(source: string): boolean {
    return this.states.get(source)?.paused ?? false;
  }

  private state(source: string): SourceState {
    let s = this.states.get(source);
    if (!s) {
      s = { failures: 0, until: 0, paused: false };
      this.states.set(source, s);
    }
    return s;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/scheduler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scheduler.ts tests/scheduler.test.ts
git commit -m "feat: agendador com variação, recuo exponencial e pausa por fonte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Avisos operacionais e espera de verificação

**Files:**
- Create: `src/ops.ts`, `src/challenge.ts`
- Test: `tests/ops.test.ts`, `tests/challenge.test.ts`

**Interfaces:**
- Consumes: `BlockStatus` (Task 7).
- Produces:
  - `src/ops.ts`: `class OpsAlerts` com `constructor(send: (text: string) => Promise<void>, log?: (msg: string) => void)`, `raise(key: string, text: string): Promise<void>` (envia só se a chave não estava ativa), `clear(key: string, text?: string): Promise<void>` (envia a recuperação só se estava ativa), `isActive(key: string): boolean`. Nunca lança.
  - `src/challenge.ts`: `waitForChallenge(o: { check: () => Promise<BlockStatus>; onRemind: () => Promise<void>; intervalMs?: number; remindEveryMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number; signal?: AbortSignal }): Promise<'resolved' | 'aborted'>`

- [ ] **Step 1: Escrever os testes que falham**

`tests/ops.test.ts`:

```ts
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

  it('falha de envio é registrada no log e não lança', async () => {
    const log = vi.fn();
    const ops = new OpsAlerts(async () => {
      throw new Error('discord fora');
    }, log);
    await expect(ops.raise('k', 'a')).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('discord fora'));
  });
});
```

`tests/challenge.test.ts`:

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/ops.test.ts tests/challenge.test.ts`
Expected: FAIL — imports `../src/ops.ts` e `../src/challenge.ts` não resolvem.

- [ ] **Step 3: Implementar `src/ops.ts`**

```ts
/** Avisos operacionais que não se repetem enquanto o estado não muda (spec §7). */
export class OpsAlerts {
  private readonly active = new Set<string>();

  constructor(
    private readonly send: (text: string) => Promise<void>,
    private readonly log: (msg: string) => void = console.error,
  ) {}

  async raise(key: string, text: string): Promise<void> {
    if (this.active.has(key)) return;
    this.active.add(key);
    await this.safeSend(text);
  }

  async clear(key: string, text?: string): Promise<void> {
    if (!this.active.delete(key)) return;
    if (text) await this.safeSend(text);
  }

  isActive(key: string): boolean {
    return this.active.has(key);
  }

  private async safeSend(text: string): Promise<void> {
    try {
      await this.send(text);
    } catch (e) {
      this.log(`falha ao enviar aviso: ${(e as Error).message}`);
    }
  }
}
```

- [ ] **Step 4: Implementar `src/challenge.ts`**

```ts
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
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/ops.test.ts tests/challenge.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ops.ts src/challenge.ts tests/ops.test.ts tests/challenge.test.ts
git commit -m "feat: avisos operacionais sem repetição e espera de verificação manual

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Ciclo de um produto (`runCycle`)

**Files:**
- Create: `src/cycle.ts`
- Test: `tests/cycle.test.ts`

**Interfaces:**
- Consumes: `Watch` (Task 2); `Listing`, `Alert`, `match` (Task 3); `decide` (Task 4); `Store` (Task 5); `Notifier` (Task 6); `Source` (Task 7).
- Produces (`src/cycle.ts`):
  - `type FetchOutcome = { kind: 'ok'; listings: Listing[]; emptyResult: boolean } | { kind: 'challenge' } | { kind: 'blocked'; status: number | null } | { kind: 'error'; error: Error }`
  - `interface PageFetcher { fetch(source: Source, url: string): Promise<FetchOutcome> }`
  - `interface CycleDeps { fetcher: PageFetcher; getSource: (id: string) => Source; store: Store; notifier: Notifier; initialPages: number; now?: () => Date }`
  - `interface CycleResult { outcome: FetchOutcome['kind']; pagesRead: number; read: number; matched: number; alerts: number; notifyErrors: string[]; brokenLayout: boolean; error?: string; ms: number }` (`alerts` = alertas **entregues**)
  - `chunk<T>(items: T[], size: number): T[][]`
  - `isBrokenLayout(listings: Listing[], emptyResult: boolean): boolean`
  - `runCycle(watch: Watch, deps: CycleDeps): Promise<CycleResult>`

- [ ] **Step 1: Escrever o teste que falha — `tests/cycle.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { Watch } from '../src/config.ts';
import { type FetchOutcome, type PageFetcher, chunk, isBrokenLayout, runCycle } from '../src/cycle.ts';
import type { Alert, Listing } from '../src/listing.ts';
import type { Notifier } from '../src/notifiers/index.ts';
import type { Source } from '../src/sources/index.ts';
import { Store } from '../src/store.ts';
import { makeListing, makeWatch } from './helpers.ts';

const fakeSource: Source = {
  id: 'olx',
  buildUrl: (w, p) => `fake://${w.id}/${p}`,
  extract: async () => ({ listings: [], emptyResult: true }),
  detectBlock: async () => 'ok',
  waitForResults: async () => {},
};

class FakeFetcher implements PageFetcher {
  calls: string[] = [];
  constructor(public pages: Record<string, FetchOutcome> = {}) {}
  async fetch(_s: Source, url: string): Promise<FetchOutcome> {
    this.calls.push(url);
    return this.pages[url] ?? { kind: 'ok', listings: [], emptyResult: true };
  }
}

class FakeNotifier implements Notifier {
  sent: Alert[][] = [];
  failNext = false;
  async send(alerts: Alert[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('discord fora');
    }
    this.sent.push(alerts);
  }
  async notify(): Promise<void> {}
}

const ok = (...listings: Listing[]): FetchOutcome => ({ kind: 'ok', listings, emptyResult: false });
const A = makeListing({ id: 'A', title: 'Nintendo Switch V1', priceCents: 100_000 });
const B = makeListing({ id: 'B', title: 'Case Nintendo Switch', priceCents: 5_000 });
const C = makeListing({ id: 'C', title: 'Nintendo Switch OLED', priceCents: 110_000 });

function setup(watch: Watch = makeWatch()) {
  const fetcher = new FakeFetcher();
  const notifier = new FakeNotifier();
  const store = new Store(':memory:');
  const run = (w: Watch = watch) =>
    runCycle(w, { fetcher, getSource: () => fakeSource, store, notifier, initialPages: 3 });
  return { fetcher, notifier, store, run };
}

describe('runCycle', () => {
  it('1º ciclo lê as páginas iniciais e notifica os que passam', async () => {
    const { fetcher, notifier, store, run } = setup();
    fetcher.pages = { 'fake://switch/1': ok(A, B), 'fake://switch/2': ok(C), 'fake://switch/3': ok() };
    const r = await run();
    expect(fetcher.calls).toEqual(['fake://switch/1', 'fake://switch/2', 'fake://switch/3']);
    expect(r).toMatchObject({ outcome: 'ok', pagesRead: 3, read: 3, matched: 2, alerts: 2, brokenLayout: false });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0].map((a) => [a.kind, a.listing.id])).toEqual([['new', 'A'], ['new', 'C']]);
    expect(store.get('switch', A)?.notifiedPriceCents).toBe(100_000);
    expect(store.get('switch', B)).toEqual({ lastPriceCents: 5_000, notifiedPriceCents: null, lastMatched: false });
  });

  it('2º ciclo lê só a página 1 e não repete alerta', async () => {
    const { fetcher, notifier, run } = setup();
    fetcher.pages = { 'fake://switch/1': ok(A) };
    await run();
    fetcher.calls = [];
    const r = await run();
    expect(fetcher.calls).toEqual(['fake://switch/1']);
    expect(r.alerts).toBe(0);
    expect(notifier.sent).toHaveLength(1);
  });

  it('nova queda de preço gera BAIXOU DE NOVO', async () => {
    const { fetcher, notifier, run } = setup();
    fetcher.pages = { 'fake://switch/1': ok(A) };
    await run();
    fetcher.pages = { 'fake://switch/1': ok({ ...A, priceCents: 90_000 }) };
    await run();
    expect(notifier.sent[1][0]).toMatchObject({ kind: 'price_drop_again', previousPriceCents: 100_000 });
  });

  it('aumentar o teto notifica anúncio que antes estava acima', async () => {
    const { fetcher, notifier, run } = setup();
    const caro = makeListing({ id: 'D', title: 'Nintendo Switch OLED', priceCents: 130_000 });
    fetcher.pages = { 'fake://switch/1': ok(caro) };
    await run();
    expect(notifier.sent).toHaveLength(0);
    await run(makeWatch({ maxPriceCents: 150_000 }));
    expect(notifier.sent[0][0]).toMatchObject({ kind: 'price_drop', previousPriceCents: 130_000 });
  });

  it('falha no Discord: não marca e reenvia como NOVO no ciclo seguinte', async () => {
    const { fetcher, notifier, store, run } = setup();
    fetcher.pages = { 'fake://switch/1': ok(A) };
    notifier.failNext = true;
    const r1 = await run();
    expect(r1.alerts).toBe(0);
    expect(r1.notifyErrors).toEqual(['discord fora']);
    expect(store.get('switch', A)?.notifiedPriceCents).toBeNull();
    await run();
    expect(notifier.sent[0][0]).toMatchObject({ kind: 'new' });
    expect(store.get('switch', A)?.notifiedPriceCents).toBe(100_000);
  });

  it('desafio na página 1: nada é gravado nem enviado', async () => {
    const { fetcher, notifier, store, run } = setup();
    fetcher.pages = { 'fake://switch/1': { kind: 'challenge' } };
    const r = await run();
    expect(r.outcome).toBe('challenge');
    expect(store.hasAny('switch')).toBe(false);
    expect(notifier.sent).toHaveLength(0);
  });

  it('erro na página 1 devolve a mensagem', async () => {
    const { fetcher, run } = setup();
    fetcher.pages = { 'fake://switch/1': { kind: 'error', error: new Error('net::ERR_TIMED_OUT') } };
    expect(await run()).toMatchObject({ outcome: 'error', error: 'net::ERR_TIMED_OUT' });
  });

  it('falha numa página extra da leitura inicial: processa o que já leu', async () => {
    const { fetcher, notifier, run } = setup();
    fetcher.pages = { 'fake://switch/1': ok(A), 'fake://switch/2': { kind: 'blocked', status: 403 } };
    const r = await run();
    expect(r).toMatchObject({ outcome: 'ok', pagesRead: 1, alerts: 1 });
    expect(notifier.sent[0][0].listing.id).toBe('A');
  });

  it('o mesmo anúncio repetido gera um único alerta', async () => {
    const { fetcher, notifier, run } = setup();
    fetcher.pages = { 'fake://switch/1': ok(A, A), 'fake://switch/2': ok(A), 'fake://switch/3': ok() };
    const r = await run();
    expect(r.read).toBe(1);
    expect(notifier.sent.flat()).toHaveLength(1);
  });

  it('mais de 10 alertas vão em mensagens de até 10', async () => {
    const { fetcher, notifier, run } = setup();
    const many = Array.from({ length: 12 }, (_, i) =>
      makeListing({ id: `L${i}`, title: 'Nintendo Switch V1', priceCents: 100_000 }),
    );
    fetcher.pages = { 'fake://switch/1': ok(...many) };
    const r = await run();
    expect(notifier.sent.map((m) => m.length)).toEqual([10, 2]);
    expect(r.alerts).toBe(12);
  });

  it('marca layout quebrado quando a página não traz anúncios válidos', async () => {
    const { fetcher, run } = setup();
    fetcher.pages = { 'fake://switch/1': { kind: 'ok', listings: [], emptyResult: false } };
    expect((await run()).brokenLayout).toBe(true);
  });
});

describe('isBrokenLayout', () => {
  it('busca vazia declarada não é quebra', () => {
    expect(isBrokenLayout([], true)).toBe(false);
    expect(isBrokenLayout([], false)).toBe(true);
  });

  it('mais da metade sem preço é quebra', () => {
    const sem = makeListing({ priceCents: null });
    const com = makeListing();
    expect(isBrokenLayout([sem, sem, com], false)).toBe(true);
    expect(isBrokenLayout([sem, com], false)).toBe(false);
  });
});

describe('chunk', () => {
  it('divide em blocos', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/cycle.test.ts`
Expected: FAIL — `Failed to resolve import "../src/cycle.ts"`.

- [ ] **Step 3: Implementar `src/cycle.ts`**

```ts
import type { Watch } from './config.ts';
import { decide } from './decide.ts';
import type { Alert, Listing } from './listing.ts';
import { match } from './matcher.ts';
import type { Notifier } from './notifiers/index.ts';
import type { Source } from './sources/index.ts';
import type { Store } from './store.ts';

export type FetchOutcome =
  | { kind: 'ok'; listings: Listing[]; emptyResult: boolean }
  | { kind: 'challenge' }
  | { kind: 'blocked'; status: number | null }
  | { kind: 'error'; error: Error };

export interface PageFetcher {
  fetch(source: Source, url: string): Promise<FetchOutcome>;
}

export interface CycleDeps {
  fetcher: PageFetcher;
  getSource: (id: string) => Source;
  store: Store;
  notifier: Notifier;
  initialPages: number;
  now?: () => Date;
}

export interface CycleResult {
  outcome: FetchOutcome['kind'];
  pagesRead: number;
  read: number;
  matched: number;
  /** Alertas entregues ao notificador. */
  alerts: number;
  notifyErrors: string[];
  brokenLayout: boolean;
  error?: string;
  ms: number;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Página carregou, mas não deu para ler anúncios: provável mudança de layout (spec §7). */
export function isBrokenLayout(listings: Listing[], emptyResult: boolean): boolean {
  if (listings.length === 0) return !emptyResult;
  return listings.filter((l) => l.priceCents === null).length > listings.length / 2;
}

export async function runCycle(watch: Watch, deps: CycleDeps): Promise<CycleResult> {
  const started = Date.now();
  const source = deps.getSource(watch.source);
  const totalPages = deps.store.hasAny(watch.id) ? 1 : deps.initialPages;
  const byId = new Map<string, Listing>();
  let pagesRead = 0;
  let brokenLayout = false;

  for (let p = 1; p <= totalPages; p++) {
    const out = await deps.fetcher.fetch(source, source.buildUrl(watch, p));
    if (out.kind !== 'ok') {
      if (p === 1) {
        return {
          outcome: out.kind,
          pagesRead: 0,
          read: 0,
          matched: 0,
          alerts: 0,
          notifyErrors: [],
          brokenLayout: false,
          error: out.kind === 'error' ? out.error.message : undefined,
          ms: Date.now() - started,
        };
      }
      break; // página extra da leitura inicial falhou: segue com o que já leu
    }
    pagesRead++;
    if (p === 1) brokenLayout = isBrokenLayout(out.listings, out.emptyResult);
    for (const l of out.listings) if (!byId.has(l.id)) byId.set(l.id, l);
    if (out.listings.length === 0) break;
  }

  const now = (deps.now ?? (() => new Date()))();
  const alerts: Alert[] = [];
  let matched = 0;
  for (const l of byId.values()) {
    const result = match(l, watch);
    if (result.ok) matched++;
    const d = decide(result.ok, l.priceCents, deps.store.get(watch.id, l));
    deps.store.recordSeen(watch.id, l, result.ok, now);
    if (d) alerts.push({ kind: d.alert, watch, listing: l, previousPriceCents: d.previousPriceCents });
  }

  const notifyErrors: string[] = [];
  let delivered = 0;
  for (const group of chunk(alerts, 10)) {
    try {
      await deps.notifier.send(group);
      for (const a of group) deps.store.markNotified(watch.id, a.listing, now);
      delivered += group.length;
    } catch (e) {
      notifyErrors.push((e as Error).message);
    }
  }

  return {
    outcome: 'ok',
    pagesRead,
    read: byId.size,
    matched,
    alerts: delivered,
    notifyErrors,
    brokenLayout,
    ms: Date.now() - started,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/cycle.test.ts && npx tsc --noEmit`
Expected: PASS e typecheck limpo.

- [ ] **Step 5: Commit**

```bash
git add src/cycle.ts tests/cycle.test.ts
git commit -m "feat: ciclo de um produto (busca, filtro, decisão, envio)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Navegador, logs e orquestração (`npm start`)

**Files:**
- Create: `src/log.ts`, `src/browser.ts`, `src/main.ts`
- Test: `tests/log.test.ts`

**Interfaces:**
- Consumes: tudo das tasks 2–10.
- Produces:
  - `src/log.ts`: `type Logger = (msg: string) => void`, `createLogger(dir?: string, now?: () => Date): Logger`
  - `src/browser.ts`: `class BrowserManager` com `constructor(o: { profileDir: string; headless: boolean })`, `page(key: string): Promise<Page>`, `bringToFront(key: string): Promise<void>`, `snapshot(key: string, dir: string, name: string): Promise<string>`, `close(): Promise<void>`; `class BrowserFetcher implements PageFetcher` com `constructor(browser: BrowserManager, timeoutMs?: number)`
  - `src/main.ts`: ponto de entrada (sem exports)

- [ ] **Step 1: Escrever o teste que falha — `tests/log.test.ts`**

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/log.test.ts`
Expected: FAIL — `Failed to resolve import "../src/log.ts"`.

- [ ] **Step 3: Implementar `src/log.ts`**

```ts
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type Logger = (msg: string) => void;

const pad = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const time = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** Uma linha por evento, no terminal e em <dir>/AAAA-MM-DD.log (horário local). */
export function createLogger(dir = 'logs', now: () => Date = () => new Date()): Logger {
  mkdirSync(dir, { recursive: true });
  return (msg) => {
    const d = now();
    const line = `${day(d)} ${time(d)} ${msg}`;
    console.log(line);
    try {
      appendFileSync(join(dir, `${day(d)}.log`), `${line}\n`);
    } catch {
      // disco cheio ou arquivo travado: o terminal ainda mostra a linha
    }
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/log.test.ts`
Expected: PASS.

- [ ] **Step 5: Implementar `src/browser.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserContext, type Page, chromium } from 'playwright';
import type { FetchOutcome, PageFetcher } from './cycle.ts';
import type { Source } from './sources/index.ts';

/** Um Chromium com perfil persistente e uma aba por chave (fonte). Relança se fechar. */
export class BrowserManager {
  private ctx: BrowserContext | undefined;
  private readonly pages = new Map<string, Page>();

  constructor(private readonly o: { profileDir: string; headless: boolean }) {}

  private async context(): Promise<BrowserContext> {
    if (!this.ctx) {
      mkdirSync(this.o.profileDir, { recursive: true });
      const ctx = await chromium.launchPersistentContext(this.o.profileDir, {
        headless: this.o.headless,
        locale: 'pt-BR',
        viewport: { width: 1280, height: 900 },
      });
      ctx.on('close', () => {
        this.ctx = undefined;
        this.pages.clear();
      });
      this.ctx = ctx;
    }
    return this.ctx;
  }

  async page(key: string): Promise<Page> {
    const existing = this.pages.get(key);
    if (existing && !existing.isClosed()) return existing;
    const page = await (await this.context()).newPage();
    this.pages.set(key, page);
    return page;
  }

  async bringToFront(key: string): Promise<void> {
    await this.pages.get(key)?.bringToFront();
  }

  /** Salva HTML + screenshot da aba para diagnóstico (layout quebrado). */
  async snapshot(key: string, dir: string, name: string): Promise<string> {
    const page = this.pages.get(key);
    if (!page || page.isClosed()) throw new Error(`nenhuma aba aberta para "${key}"`);
    mkdirSync(dir, { recursive: true });
    const base = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}`);
    writeFileSync(`${base}.html`, await page.content());
    await page.screenshot({ path: `${base}.png`, fullPage: true });
    return base;
  }

  async close(): Promise<void> {
    await this.ctx?.close();
  }
}

export class BrowserFetcher implements PageFetcher {
  constructor(
    private readonly browser: BrowserManager,
    private readonly timeoutMs = 30_000,
  ) {}

  async fetch(source: Source, url: string): Promise<FetchOutcome> {
    try {
      const page = await this.browser.page(source.id);
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.timeoutMs });
      const status = res?.status() ?? null;
      const block = await source.detectBlock(page, status);
      if (block === 'challenge') return { kind: 'challenge' };
      if (block === 'blocked') return { kind: 'blocked', status };
      await source.waitForResults(page);
      const { listings, emptyResult } = await source.extract(page);
      return { kind: 'ok', listings, emptyResult };
    } catch (e) {
      return { kind: 'error', error: e instanceof Error ? e : new Error(String(e)) };
    }
  }
}
```

- [ ] **Step 6: Implementar `src/main.ts`**

```ts
import { setTimeout as sleep } from 'node:timers/promises';
import { BrowserFetcher, BrowserManager } from './browser.ts';
import { waitForChallenge } from './challenge.ts';
import { type Config, type Watch, loadConfig, watchConfig } from './config.ts';
import { type CycleResult, runCycle } from './cycle.ts';
import { createLogger } from './log.ts';
import { createNotifier } from './notifiers/index.ts';
import { OpsAlerts } from './ops.ts';
import { Scheduler } from './scheduler.ts';
import { getSource, sources } from './sources/index.ts';
import { Store } from './store.ts';

const CONFIG_PATH = process.env.WATCHES_FILE ?? 'watches.yaml';
const KNOWN_SOURCES = Object.keys(sources);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env');
  } catch {
    // sem .env: usa só as variáveis de ambiente (ex.: Docker)
  }
  const log = createLogger('logs');
  let config: Config = loadConfig(CONFIG_PATH, KNOWN_SOURCES);
  const notifier = createNotifier(config.settings);
  const safeNotify = async (text: string) => {
    try {
      await notifier.notify(text);
    } catch (e) {
      log(`falha ao enviar aviso ao Discord: ${(e as Error).message}`);
    }
  };
  const ops = new OpsAlerts((t) => notifier.notify(t), log);
  const store = new Store('data/tracker.db');
  const browser = new BrowserManager({ profileDir: 'data/browser-profile', headless: config.settings.headless });
  const fetcher = new BrowserFetcher(browser);
  const timing = (c: Config) => ({
    intervalMs: c.settings.intervalSeconds * 1000,
    jitterMs: c.settings.jitterSeconds * 1000,
  });
  const sched = new Scheduler(timing(config));
  const enabled = () => config.watches.filter((w) => w.enabled);
  sched.setWatches(enabled());

  const stopWatching = watchConfig(
    CONFIG_PATH,
    (c) => {
      if (c.settings.headless !== config.settings.headless) log('mudança em "headless" só vale após reiniciar');
      config = c;
      sched.setTiming(timing(c));
      sched.setWatches(enabled());
      log(`config recarregada: ${enabled().length} produtos ativos`);
    },
    (e) => {
      log(`watches.yaml inválido, mantendo a versão anterior: ${e.message}`);
      void safeNotify(`⚠️ watches.yaml inválido, mantendo a versão anterior.\n${e.message}`);
    },
    KNOWN_SOURCES,
  );

  const abort = new AbortController();
  let running = true;
  const stop = (signal: string) => {
    if (!running) return;
    running = false;
    abort.abort();
    log(`encerrando (${signal})...`);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  const errorSince = new Map<string, number>();

  function startChallengeWatch(src: string): void {
    if (sched.isPaused(src)) return;
    sched.pause(src);
    log(`[${src}] verificação de segurança detectada; fonte pausada até ser resolvida`);
    void (async () => {
      await browser.bringToFront(src).catch(() => {});
      await safeNotify(
        `⚠️ ${src.toUpperCase()} pediu verificação ("sou humano"). Resolva na janela do navegador do rastreador; depois eu continuo sozinho.`,
      );
      const page = await browser.page(src);
      const result = await waitForChallenge({
        check: () => getSource(src).detectBlock(page, null),
        onRemind: () => safeNotify(`⏰ ${src.toUpperCase()} ainda está pedindo verificação na janela do navegador.`),
        signal: abort.signal,
      });
      sched.resume(src);
      if (result === 'resolved') {
        log(`[${src}] verificação resolvida`);
        await safeNotify(`✅ Verificação resolvida. ${src.toUpperCase()} retomado.`);
      }
    })().catch((e) => {
      sched.resume(src);
      log(`[${src}] erro aguardando verificação: ${(e as Error).message}`);
    });
  }

  async function handle(watch: Watch, r: CycleResult): Promise<void> {
    const src = watch.source;
    log(
      `[${watch.id}] ${r.outcome} páginas=${r.pagesRead} lidos=${r.read} aprovados=${r.matched} alertas=${r.alerts} ${r.ms}ms` +
        (r.error ? ` erro=${r.error}` : ''),
    );
    for (const e of r.notifyErrors) log(`[${watch.id}] falha ao notificar (tento de novo no próximo ciclo): ${e}`);

    if (r.outcome !== 'error') {
      errorSince.delete(src);
      await ops.clear(`error:${src}`, `✅ Conexão com ${src} restabelecida.`);
    }

    switch (r.outcome) {
      case 'ok':
        sched.reportOk(src);
        await ops.clear(`blocked:${src}`, `✅ ${src} voltou a responder normalmente.`);
        if (r.brokenLayout) {
          await browser
            .snapshot(src, 'debug', watch.id)
            .catch((e) => log(`falha ao salvar snapshot: ${(e as Error).message}`));
          await ops.raise(
            `layout:${watch.id}`,
            `🛠️ O adaptador ${src} pode estar quebrado (produto ${watch.id}): a página carregou, mas não consegui ler os anúncios. Snapshot salvo em debug/.`,
          );
        } else {
          await ops.clear(`layout:${watch.id}`, `✅ Leitura de anúncios de ${watch.id} normalizada.`);
        }
        break;
      case 'challenge':
        if (!config.settings.headless) {
          startChallengeWatch(src);
          break;
        }
      // em modo headless ninguém resolve o desafio: trata como bloqueio
      // falls through
      case 'blocked': {
        const { failures, waitMs } = sched.reportBlocked(src);
        log(`[${src}] bloqueado (${failures}ª vez seguida); próxima tentativa em ${waitMs / MINUTE} min`);
        if (failures >= 3) {
          await ops.raise(
            `blocked:${src}`,
            `⛔ ${src} está bloqueando as consultas (${failures} falhas seguidas). Vou tentando com intervalos maiores (até 15 min).`,
          );
        }
        break;
      }
      case 'error': {
        const since = errorSince.get(src) ?? Date.now();
        errorSince.set(src, since);
        if (Date.now() - since > 5 * MINUTE) {
          await ops.raise(`error:${src}`, `📡 Não consigo acessar ${src} há mais de 5 minutos. Último erro: ${r.error}`);
        }
        break;
      }
    }
  }

  await safeNotify(`🟢 Rastreador iniciado (${enabled().length} produtos)`);
  log(`rastreador iniciado com ${enabled().length} produtos`);

  let lastPurge = 0;
  while (running) {
    if (Date.now() - lastPurge > HOUR) {
      lastPurge = Date.now();
      const removed = store.purgeOlderThan(new Date(Date.now() - config.settings.retentionDays * 24 * HOUR));
      if (removed > 0) log(`limpeza: ${removed} anúncios antigos removidos do histórico`);
    }

    const next = sched.next();
    const wait = next ? next.at - Date.now() : 1000;
    if (!next || wait > 0) {
      await sleep(Math.min(Math.max(wait, 0), 1000));
      continue;
    }

    const watch = config.watches.find((w) => w.id === next.watchId && w.enabled);
    if (!watch) {
      sched.setWatches(enabled());
      continue;
    }

    try {
      const r = await runCycle(watch, {
        fetcher,
        getSource,
        store,
        notifier,
        initialPages: config.settings.initialPages,
      });
      sched.done(watch.id);
      await handle(watch, r);
    } catch (e) {
      sched.done(watch.id);
      log(`[${watch.id}] erro inesperado: ${(e as Error).stack ?? String(e)}`);
    }
  }

  await safeNotify('🔴 Rastreador parado');
  stopWatching();
  await browser.close().catch(() => {});
  store.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 7: Verificar tipos e a suíte inteira**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck limpo e todos os testes passando.

- [ ] **Step 8: Teste rápido de arranque sem webhook (deve falhar com mensagem clara)**

Run: `npx tsx src/main.ts`
Expected: sai com código 1 e a mensagem `DISCORD_WEBHOOK_URL não definida. Copie .env.example para .env e cole a URL do webhook.` (sem `.env` ainda). Nenhum navegador é aberto.

- [ ] **Step 9: Commit**

```bash
git add src/log.ts src/browser.ts src/main.ts tests/log.test.ts
git commit -m "feat: navegador persistente, logs e laço principal do rastreador

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Comandos `check`, `test-notify` e `capture-fixture`

**Files:**
- Create: `src/cli/format.ts`, `src/cli/check.ts`, `src/cli/test-notify.ts`, `src/cli/capture-fixture.ts`
- Test: `tests/format.test.ts`

**Interfaces:**
- Consumes: `loadConfig` (Task 2); `match`, `MatchResult`, `Listing` (Task 3); `formatBRL` (Task 6); `getSource`, `sources` (Task 7); `waitForChallenge` (Task 9); `BrowserManager`, `BrowserFetcher` (Task 11); `createNotifier` (Task 6).
- Produces: `src/cli/format.ts`: `formatCheckLine(l: Listing, m: MatchResult): string`. Os três scripts são pontos de entrada.

- [ ] **Step 1: Escrever o teste que falha — `tests/format.test.ts`**

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/format.test.ts`
Expected: FAIL — `Failed to resolve import "../src/cli/format.ts"`.

- [ ] **Step 3: Implementar `src/cli/format.ts`**

```ts
import type { Listing } from '../listing.ts';
import type { MatchResult } from '../matcher.ts';
import { formatBRL } from '../notifiers/discord.ts';

export function formatCheckLine(l: Listing, m: MatchResult): string {
  const price = l.priceCents === null ? '—' : formatBRL(l.priceCents);
  const head = `${m.ok ? '✅' : '❌'} ${price.padStart(12)}  ${l.title}`;
  return m.ok ? head : `${head}  [${m.reason}]`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Implementar `src/cli/check.ts`**

```ts
import { BrowserFetcher, BrowserManager } from '../browser.ts';
import { waitForChallenge } from '../challenge.ts';
import { loadConfig } from '../config.ts';
import { match } from '../matcher.ts';
import { getSource, sources } from '../sources/index.ts';
import { formatCheckLine } from './format.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // opcional para este comando
}

const id = process.argv[2];
const config = loadConfig(process.env.WATCHES_FILE ?? 'watches.yaml', Object.keys(sources));
const watch = config.watches.find((w) => w.id === id);
if (!watch) {
  console.error(`Uso: npm run check -- <id>\nProdutos: ${config.watches.map((w) => w.id).join(', ')}`);
  process.exit(1);
}

const source = getSource(watch.source);
// perfil separado: o rastreador pode estar rodando com o perfil principal travado
const browser = new BrowserManager({ profileDir: 'data/browser-profile-cli', headless: config.settings.headless });
const fetcher = new BrowserFetcher(browser);

try {
  const url = source.buildUrl(watch, 1);
  console.log(`Buscando: ${url}\n`);
  let out = await fetcher.fetch(source, url);
  if (out.kind === 'challenge') {
    console.log('A página pediu verificação. Resolva na janela do navegador (até 3 min)...');
    const page = await browser.page(source.id);
    await browser.bringToFront(source.id);
    const r = await waitForChallenge({
      check: () => source.detectBlock(page, null),
      onRemind: async () => {},
      intervalMs: 3000,
      signal: AbortSignal.timeout(180_000),
    });
    if (r === 'resolved') out = await fetcher.fetch(source, url);
  }
  if (out.kind !== 'ok') {
    console.error(`Não foi possível ler a busca: ${out.kind}${out.kind === 'error' ? ` (${out.error.message})` : ''}`);
    process.exitCode = 2;
  } else {
    let approved = 0;
    for (const l of out.listings) {
      const m = match(l, watch);
      if (m.ok) approved++;
      console.log(formatCheckLine(l, m));
      if (m.ok) console.log(`                 ${l.url}`);
    }
    console.log(`\n${out.listings.length} anúncios lidos, ${approved} aprovados para "${watch.name}".`);
  }
} finally {
  await browser.close();
}
```

- [ ] **Step 6: Implementar `src/cli/test-notify.ts`**

```ts
import { loadConfig } from '../config.ts';
import { createNotifier } from '../notifiers/index.ts';
import { sources } from '../sources/index.ts';

try {
  process.loadEnvFile('.env');
} catch {
  // sem .env: createNotifier explica o que falta
}

const config = loadConfig(process.env.WATCHES_FILE ?? 'watches.yaml', Object.keys(sources));
const notifier = createNotifier(config.settings);
const watch = config.watches[0];

await notifier.notify('🔔 Teste do rastreador: se isto chegou no seu celular, o webhook está funcionando.');
await notifier.send([
  {
    kind: 'new',
    watch,
    listing: {
      source: 'olx',
      id: 'exemplo',
      title: `${watch.name} (EXEMPLO — não é um anúncio real)`,
      priceCents: watch.maxPriceCents,
      url: 'https://www.olx.com.br',
      location: 'Goiânia, Setor Bueno',
      city: 'Goiânia',
      state: 'GO',
      postedAt: 'agora',
      boosted: false,
      buyable: true,
      delivery: true,
      deliveryLabel: 'Entrega Fácil',
    },
  },
]);
console.log('Mensagens de teste enviadas. Confira o Discord.');
```

- [ ] **Step 7: Implementar `src/cli/capture-fixture.ts`**

```ts
import { writeFileSync } from 'node:fs';
import { BrowserManager } from '../browser.ts';
import { loadConfig } from '../config.ts';
import { getSource, sources } from '../sources/index.ts';

const id = process.argv[2];
const config = loadConfig(process.env.WATCHES_FILE ?? 'watches.yaml', Object.keys(sources));
const watch = config.watches.find((w) => w.id === id);
if (!watch) {
  console.error(`Uso: npm run capture-fixture -- <id>\nProdutos: ${config.watches.map((w) => w.id).join(', ')}`);
  process.exit(1);
}

const source = getSource(watch.source);
const browser = new BrowserManager({ profileDir: 'data/browser-profile-cli', headless: config.settings.headless });
try {
  const page = await browser.page(source.id);
  const res = await page.goto(source.buildUrl(watch, 1), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const block = await source.detectBlock(page, res?.status() ?? null);
  if (block !== 'ok') {
    console.error(`Página bloqueada (${block}). Rode "npm run check -- ${watch.id}", resolva a verificação e tente de novo.`);
    process.exitCode = 2;
  } else {
    await source.waitForResults(page);
    // remove scripts/estilos para a fixture ficar pequena e não executar nada nos testes
    await page.evaluate(() =>
      document.querySelectorAll('script, style, link, noscript, svg, iframe').forEach((e) => e.remove()),
    );
    const file = `tests/fixtures/${source.id}-real-${watch.id}.html`;
    writeFileSync(file, await page.content());
    console.log(`Salvo em ${file}`);
  }
} finally {
  await browser.close();
}
```

- [ ] **Step 8: Verificar tipos e a suíte inteira**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck limpo e todos os testes passando.

- [ ] **Step 9: Commit**

```bash
git add src/cli tests/format.test.ts
git commit -m "feat: comandos check, test-notify e capture-fixture

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Documentação, Docker e verificação real (com o usuário)

**Files:**
- Create: `README.md`, `iniciar.bat`, `Dockerfile`, `.dockerignore`, `tests/olx-real-fixture.test.ts`, `tests/fixtures/olx-real-switch-lite.html` (gerado)
- Modify: nenhum código de produção (só se a verificação real revelar defeito, e aí com teste primeiro)

**Interfaces:**
- Consumes: comandos da Task 12; `olx` (Task 7).
- Produces: documentação de operação e uma fixture real da OLX coberta por teste.

- [ ] **Step 1: Criar `iniciar.bat`**

```bat
@echo off
cd /d "%~dp0"
npm start
```

- [ ] **Step 2: Criar `Dockerfile` e `.dockerignore`**

`Dockerfile`:

```dockerfile
# A versão da imagem deve ser IGUAL à do pacote playwright no package.json
FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
VOLUME ["/app/data", "/app/logs", "/app/debug"]
# navegador "visível" num monitor virtual: a Cloudflare desconfia mais de headless
CMD ["xvfb-run", "-a", "npm", "start"]
```

`.dockerignore`:

```
node_modules
data
logs
debug
.env
.git
```

- [ ] **Step 3: Criar `README.md`**

~~~~markdown
# Rastreador de Produtos

Avisa no Discord, em segundos, quando aparece na OLX um anúncio **comprável agora** (botão "Comprar" com Garantia da OLX) de um produto que você monitora, com preço dentro do seu limite.

Começa com PS Vita, Nintendo Switch e Switch Lite, mas qualquer produto pode ser adicionado editando `watches.yaml`.

## Instalação (Windows)

1. Instale o Node.js 24 LTS: https://nodejs.org
2. Na pasta do projeto:
   ```bash
   npm install
   npx playwright install chromium
   ```
3. Crie o webhook no Discord:
   - Crie um servidor só seu (botão "+" → "Criar o meu") e um canal, por exemplo `#alertas`.
   - Editar canal → Integrações → Webhooks → Novo webhook → **Copiar URL do webhook**.
   - No app do celular, deixe o canal em **Notificações → Todas as mensagens**.
4. Copie `.env.example` para `.env` e cole a URL em `DISCORD_WEBHOOK_URL`.
5. Teste:
   ```bash
   npm run test-notify
   ```
   Deve chegar uma mensagem e um alerta de exemplo no celular.

## Configurar produtos (`watches.yaml`)

Cada item em `watches` é um produto. Campos principais:

| Campo | O que faz |
|---|---|
| `query` | texto da busca na OLX |
| `region` | `brasil`, `go` ou `go/grande-goiania-e-anapolis` |
| `maxPrice` / `minPrice` | faixa de preço em reais (inclusiva). O mínimo corta jogos e acessórios baratos. |
| `startsWith` | o título precisa **começar** com uma destas formas (`a\|b` = alternativas). É o que separa "Switch Lite com case" (aprovado) de "Case para Switch Lite" (recusado). |
| `exclude` | palavras que descartam o anúncio (somadas às de `defaults`) |
| `pickupCities` | cidades onde você aceita retirada em mãos; fora delas, só com entrega |
| `enabled: false` | pausa o produto sem apagar |

O arquivo é recarregado sozinho ao salvar. Se ficar inválido, o rastreador mantém a versão anterior e avisa no Discord o que está errado.

Só anúncios **compráveis imediatamente** geram alerta. Anúncios em que é preciso "Solicitar" ao vendedor são sempre ignorados (regra fixa).

### Calibrar filtros

```bash
npm run check -- switch-lite
```

Faz uma busca real e lista cada anúncio com ✅ ou ❌ e o motivo (`startsWith`, `exclude:"defeito"`, `price>max`, `not-buyable`...). Não notifica nem grava nada, e pode rodar com o rastreador ligado.

## Rodar

```bash
npm start
```

- Abre uma janela do Chromium (pode minimizar, **não feche**).
- Cada produto é consultado a cada 25–40 segundos.
- Na primeira vez, lê as 3 primeiras páginas e avisa o que já existe dentro das regras. Depois, só anúncios novos ou que baixaram de preço.
- Se a OLX pedir verificação ("sou humano"), você recebe um aviso no Discord. Resolva na janela do rastreador e ele continua sozinho.
- Logs em `logs/AAAA-MM-DD.log`.
- `Ctrl+C` encerra e avisa "🔴 Rastreador parado".

### Iniciar junto com o Windows

1. Abra o **Prompt de Comando (cmd)**, não o PowerShell, e rode (ajuste o caminho se mudou a pasta):
   ```bat
   schtasks /Create /TN "Rastreador de Produtos" /TR "\"D:\Projetos\Rastreador videogame\iniciar.bat\"" /SC ONLOGON
   ```
2. Evite que o PC entre em suspensão: Configurações → Sistema → Energia → "Suspender" → **Nunca** (na tomada).

## Avisos que você pode receber

| Aviso | Significado |
|---|---|
| ⚠️ pediu verificação | resolva na janela do navegador do rastreador |
| ⛔ bloqueando as consultas | a OLX recusou várias vezes; ele tenta de novo com intervalos maiores (até 15 min) |
| 🛠️ adaptador pode estar quebrado | a OLX mudou a página; snapshot salvo em `debug/` para correção |
| 📡 não consigo acessar | sem internet ou OLX fora do ar há mais de 5 min |

## Servidor (Docker)

```bash
docker build -t rastreador .
docker run -d --name rastreador --env-file .env -v ./data:/app/data -v ./logs:/app/logs -v ./watches.yaml:/app/watches.yaml rastreador
```

Observação: IPs de datacenter costumam ser mais bloqueados pela OLX, e no servidor não há ninguém para resolver verificações. A migração é possível, mas sem garantia de funcionar tão bem quanto no PC de casa.

## Quando a OLX mudar o layout

```bash
npm run capture-fixture -- switch-lite
npm test
```

O teste `olx-real-fixture` passa a falhar com a página nova. Corrija `src/sources/olx.ts` até ele passar de novo.

## Desenvolvimento

```bash
npm test          # testes (nenhum acessa OLX/Discord)
npm run typecheck
```
~~~~

- [ ] **Step 4: Escrever o teste da fixture real — `tests/olx-real-fixture.test.ts`**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { type Browser, chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { olx } from '../src/sources/olx.ts';

const file = new URL('./fixtures/olx-real-switch-lite.html', import.meta.url);

describe.skipIf(!existsSync(file))('fixture real da OLX (busca switch lite, opst=2)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  it('o adaptador ainda lê a página real', async () => {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
    await page.setContent(readFileSync(file, 'utf8'));
    const { listings, emptyResult } = await olx.extract(page);
    expect(emptyResult).toBe(false);
    expect(listings.length).toBeGreaterThanOrEqual(40);
    for (const l of listings) {
      expect(l.id).toMatch(/^\d+$/);
      expect(l.url).toMatch(/^https:\/\/[a-z]{2}\.olx\.com\.br\//);
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.state).toMatch(/^[A-Z]{2}$/);
      expect(l.buyable).toBe(true); // a busca usa opst=2
    }
    const priced = listings.filter((l) => l.priceCents !== null).length;
    expect(priced / listings.length).toBeGreaterThanOrEqual(0.9);
    expect(await olx.detectBlock(page, 200)).toBe('ok');
  });
});
```

- [ ] **Step 5: Capturar a fixture real**

Run: `npm run capture-fixture -- switch-lite`
Expected: `Salvo em tests/fixtures/olx-real-switch-lite.html`. Uma janela do Chromium abre e fecha. Se aparecer "Página bloqueada (challenge)", rode `npm run check -- switch-lite`, peça ao usuário para resolver a verificação na janela e repita.

- [ ] **Step 6: Rodar o teste da fixture real**

Run: `npx vitest run tests/olx-real-fixture.test.ts`
Expected: PASS (1 teste, não pulado). Se falhar, o DOM real divergiu do mapeado na Task 7: inspecione o HTML salvo, ajuste os seletores em `src/sources/olx.ts` e mantenha `tests/olx-browser.test.ts` passando.

- [ ] **Step 7: Suíte completa**

Run: `npx tsc --noEmit && npm test`
Expected: tudo passando.

- [ ] **Step 8: Commit**

```bash
git add README.md iniciar.bat Dockerfile .dockerignore tests/olx-real-fixture.test.ts tests/fixtures/olx-real-switch-lite.html
git commit -m "docs: README, Docker, inicialização no Windows e fixture real da OLX

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Verificação manual com o usuário (spec §8)**

Precisa do usuário. Peça para ele:
1. Criar o webhook e preencher o `.env` (README, Instalação, passos 3–4). **Não** pedir que cole a URL do webhook no chat; ele mesmo edita o arquivo.
2. Rodar `npm run test-notify` e confirmar que **as duas mensagens chegaram no celular**.
3. Rodar `npm run check -- switch-lite`, `npm run check -- switch` e `npm run check -- ps-vita` e comparar com o site da OLX (mesma busca, filtro "Entrega", mais recentes): os ✅ devem ser consoles compráveis dentro da faixa; os ❌ devem ter motivo coerente.
4. Rodar `npm start` e deixar **15 minutos**. Conferir em `logs/` que cada produto roda a cada 25–40s sem `blocked`/`challenge`, e que chegaram "🟢 Rastreador iniciado" e os alertas da primeira leitura.
5. `Ctrl+C` e confirmar "🔴 Rastreador parado".

Registre o resultado de cada item no relato final. Se algum falhar, trate como bug (superpowers:systematic-debugging) antes de concluir.

- [ ] **Step 10: Push**

```bash
git push
```
