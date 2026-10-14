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
