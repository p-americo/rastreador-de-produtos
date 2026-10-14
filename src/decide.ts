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
