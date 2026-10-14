/** Avisos operacionais que não se repetem enquanto o estado não muda (spec §7). */
export class OpsAlerts {
  private readonly active = new Set<string>();

  constructor(
    private readonly send: (text: string) => Promise<void>,
    private readonly log: (msg: string) => void = console.error,
  ) {}

  async raise(key: string, text: string): Promise<void> {
    if (this.active.has(key)) return;
    this.active.add(key);
    await this.safeSend(text);
  }

  async clear(key: string, text?: string): Promise<void> {
    if (!this.active.delete(key)) return;
    if (text) await this.safeSend(text);
  }

  isActive(key: string): boolean {
    return this.active.has(key);
  }

  private async safeSend(text: string): Promise<void> {
    try {
      await this.send(text);
    } catch (e) {
      this.log(`falha ao enviar aviso: ${(e as Error).message}`);
    }
  }
}
