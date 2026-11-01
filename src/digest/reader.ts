import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunLine, RunStatus } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

// Parse at the edge (styleguide): anything that isn't a well-formed run line is null.
export function parseLine(line: string): RunLine | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.at !== 'string' || Number.isNaN(Date.parse(o.at))) return null;
  if (typeof o.job !== 'string' || o.job === '') return null;
  if (!STATUSES.includes(o.status as RunStatus)) return null;
  if (o.owner !== null && typeof o.owner !== 'string') return null;
  if (o.error !== undefined && typeof o.error !== 'string') return null;
  const run: RunLine = { at: o.at, job: o.job, status: o.status as RunStatus, owner: o.owner };
  if (o.error !== undefined) run.error = o.error;
  return run;
}

// Lines in log order; first/last by time, ties keep log order. Times stay as written.
export function toRows(lines: RunLine[]): DigestRow[] {
  const byJob = new Map<string, DigestRow>();
  for (const l of lines) {
    const t = Date.parse(l.at);
    const row = byJob.get(l.job);
    if (!row) {
      byJob.set(l.job, {
        job: l.job,
        owner: l.owner,
        runs: 1,
        ok: l.status === 'ok' ? 1 : 0,
        retries: l.status === 'retry' ? 1 : 0,
        fails: l.status === 'fail' ? 1 : 0,
        lastStatus: l.status,
        lastError: l.error ?? null,
        firstAt: l.at,
        lastAt: l.at,
      });
      continue;
    }
    row.runs += 1;
    if (l.status === 'ok') row.ok += 1;
    if (l.status === 'retry') row.retries += 1;
    if (l.status === 'fail') row.fails += 1;
    if (t < Date.parse(row.firstAt)) row.firstAt = l.at;
    if (t >= Date.parse(row.lastAt)) {
      row.lastAt = l.at;
      row.lastStatus = l.status;
      row.lastError = l.error ?? null;
      row.owner = l.owner;
    }
  }
  return [...byJob.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  const file = join(runsDir, `${night}.jsonl`);
  if (!existsSync(file)) return null;
  const lines: RunLine[] = [];
  let badLines = 0;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (line) lines.push(line);
    else badLines += 1;
  }
  return { night, rows: toRows(lines), badLines };
};
