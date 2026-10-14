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
