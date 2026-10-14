export interface Timing {
  intervalMs: number;
  jitterMs: number;
}

interface SourceState {
  failures: number;
  until: number;
  paused: boolean;
}

const BACKOFF_MINUTES = [1, 2, 4, 8, 15];

export class Scheduler {
  private readonly due = new Map<string, { source: string; at: number }>();
  private readonly states = new Map<string, SourceState>();
  private timing: Timing;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(o: Timing & { now?: () => number; random?: () => number }) {
    this.timing = { intervalMs: o.intervalMs, jitterMs: o.jitterMs };
    this.now = o.now ?? Date.now;
    this.random = o.random ?? Math.random;
  }

  setTiming(t: Timing): void {
    this.timing = t;
  }

  setWatches(watches: readonly { id: string; source: string }[]): void {
    const ids = new Set(watches.map((w) => w.id));
    for (const id of [...this.due.keys()]) if (!ids.has(id)) this.due.delete(id);
    for (const w of watches) {
      const d = this.due.get(w.id);
      if (d) d.source = w.source;
      else this.due.set(w.id, { source: w.source, at: this.now() });
    }
  }

  next(): { watchId: string; at: number } | undefined {
    let best: { watchId: string; at: number } | undefined;
    for (const [watchId, d] of this.due) {
      const s = this.states.get(d.source);
      if (s?.paused) continue;
      const at = Math.max(d.at, s?.until ?? 0);
      if (!best || at < best.at) best = { watchId, at };
    }
    return best;
  }

  done(watchId: string): void {
    const d = this.due.get(watchId);
    if (d) d.at = this.now() + this.delay();
  }

  /** Entre interval − jitter/2 e interval + jitter (30s/10s → 25s a 40s). */
  delay(): number {
    const { intervalMs, jitterMs } = this.timing;
    return Math.max(1000, Math.round(intervalMs + (this.random() * 1.5 - 0.5) * jitterMs));
  }

  reportBlocked(source: string): { failures: number; waitMs: number } {
    const s = this.state(source);
    s.failures++;
    const waitMs = BACKOFF_MINUTES[Math.min(s.failures, BACKOFF_MINUTES.length) - 1] * 60_000;
    s.until = this.now() + waitMs;
    return { failures: s.failures, waitMs };
  }

  reportOk(source: string): { recoveredFrom: number } {
    const s = this.state(source);
    const recoveredFrom = s.failures;
    s.failures = 0;
    s.until = 0;
    return { recoveredFrom };
  }

  pause(source: string): void {
    this.state(source).paused = true;
  }

  resume(source: string): void {
    this.state(source).paused = false;
  }

  isPaused(source: string): boolean {
    return this.states.get(source)?.paused ?? false;
  }

  private state(source: string): SourceState {
    let s = this.states.get(source);
    if (!s) {
      s = { failures: 0, until: 0, paused: false };
      this.states.set(source, s);
    }
    return s;
  }
}
