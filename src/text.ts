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
