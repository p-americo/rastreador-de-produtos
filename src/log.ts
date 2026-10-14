import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type Logger = (msg: string) => void;

const pad = (n: number) => String(n).padStart(2, '0');
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const time = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** Uma linha por evento, no terminal e em <dir>/AAAA-MM-DD.log (horário local). */
export function createLogger(dir = 'logs', now: () => Date = () => new Date()): Logger {
  mkdirSync(dir, { recursive: true });
  return (msg) => {
    const d = now();
    const line = `${day(d)} ${time(d)} ${msg}`;
    console.log(line);
    try {
      appendFileSync(join(dir, `${day(d)}.log`), `${line}\n`);
    } catch {
      // disco cheio ou arquivo travado: o terminal ainda mostra a linha
    }
  };
}
