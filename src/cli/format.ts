import type { Listing } from '../listing.ts';
import type { MatchResult } from '../matcher.ts';
import { formatBRL } from '../notifiers/discord.ts';

export function formatCheckLine(l: Listing, m: MatchResult): string {
  const price = l.priceCents === null ? '—' : formatBRL(l.priceCents);
  const head = `${m.ok ? '✅' : '❌'} ${price.padStart(12)}  ${l.title}`;
  return m.ok ? head : `${head}  [${m.reason}]`;
}
