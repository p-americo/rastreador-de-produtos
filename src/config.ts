import { readFileSync, realpathSync, watch as fsWatch } from 'node:fs';
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
 *
 * A pasta é canonicalizada (`realpathSync.native`) antes de observar: no Windows, um caminho
 * em formato 8.3 (ex.: `C:\Users\PEDROA~1\...`, comum em `os.tmpdir()`) faz o libuv abortar o
 * processo inteiro (`Assertion failed: !_wcsnicmp(filename, dir, dirlen)`), sem exceção capturável.
 */
export function watchConfig(
  path: string,
  onChange: (c: Config) => void,
  onError: (e: Error) => void,
  knownSources?: readonly string[],
): () => void {
  const name = basename(path);
  let timer: NodeJS.Timeout | undefined;
  const watcher = fsWatch(realpathSync.native(dirname(path)), (_event, filename) => {
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
