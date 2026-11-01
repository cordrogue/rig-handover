import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight } from './digest/reader.js';
import { lastBeat, type Beat } from './heartbeat.js';

// Counts are run lines per status; null when the night's file can't be read.
export type NightSummary = { night: string; counts: { ok: number; retry: number; fail: number } | null };

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightSummary[];
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function summarizeNight(runsDir: string, night: string): NightSummary {
  const n = readNight(runsDir, night);
  if (!n) return { night, counts: null };
  const counts = { ok: 0, retry: 0, fail: 0 };
  for (const r of n.rows) {
    counts.ok += r.ok;
    counts.retry += r.retries;
    counts.fail += r.fails;
  }
  return { night, counts };
}

export function readStatus(config: RigConfig): Status {
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights: nightsOnDisk(config.runsDir).map((n) => summarizeNight(config.runsDir, n)),
  };
}
