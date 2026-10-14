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
