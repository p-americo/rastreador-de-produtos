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
