import type { BlockStatus } from './sources/index.ts';

export type ChallengeVerdict = 'waiting' | 'resolved' | 'tab-lost';

/** Aba que o usuário vê: `undefined` = fechada ou nunca aberta. */
export type TabInfo = { url: string } | undefined;

/**
 * Decide o que fazer enquanto esperamos o usuário resolver a verificação.
 * Aba fechada ou em branco = não dá para saber: encerra a espera e deixa o próximo ciclo
 * navegar de novo (ele detecta de novo se o desafio continuar). Só vale "resolvida"
 * quando a aba está numa página real e a fonte diz que está tudo ok.
 */
export async function judgeChallenge(tab: TabInfo, detect: () => Promise<BlockStatus>): Promise<ChallengeVerdict> {
  if (!tab || tab.url === '' || tab.url === 'about:blank') return 'tab-lost';
  let status: BlockStatus;
  try {
    status = await detect();
  } catch {
    return 'waiting'; // página navegando enquanto o usuário resolve
  }
  return status === 'ok' ? 'resolved' : 'waiting';
}
