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

// watch.pickupCities já vem normalizado por config.ts (parsePickupCity)
function inPickupCity(listing: Listing, watch: Watch): boolean {
  if (!listing.city || !listing.state) return false;
  const city = normalize(listing.city);
  const state = normalize(listing.state);
  return watch.pickupCities.some((p) => p.city === city && p.state === state);
}
