// Plan morning-digest § 1. The contract every part of § 2 builds against.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, once parsed.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job. Times keep the log's offset (styleguide); counts are lines per status.
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  ok: number;
  retries: number;
  fails: number;
  lastStatus: RunStatus;
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

// A night: its rows sorted by job, and how many lines didn't parse.
export type Night = {
  night: string;
  rows: DigestRow[];
  badLines: number;
};

// `night` is YYYY-MM-DD. Returns null when runs/<night>.jsonl doesn't exist (or night isn't a date).
export type ReadNight = (runsDir: string, night: string) => Night | null;
