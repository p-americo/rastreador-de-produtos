export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} excedeu o limite de ${ms / 1000}s`);
    this.name = 'TimeoutError';
  }
}

/** Rejeita com TimeoutError se `promise` não terminar em `ms`; sempre limpa o timer. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([promise, limit]);
  } finally {
    clearTimeout(timer);
    // se o limite venceu, a promessa original pode rejeitar depois: evita unhandledRejection
    promise.catch(() => {});
  }
}
