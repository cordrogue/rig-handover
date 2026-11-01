import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { readNight } from '../src/digest/reader.js';
import type { Night } from '../src/digest/types.js';

// Nights written into a temp runs dir. runs/ itself is read-only and never touched here.
const NORMAL = '2026-10-30'; // unsorted log; fixtures/refresh retried 3 times; notes/backup failed; null owner
const EMPTY = '2026-10-31'; // empty file
const BAD = '2026-11-01'; // one line that doesn't parse
const MISSING = '2026-01-01'; // no file

const NORMAL_LINES = [
  '{"at":"2026-10-30T01:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  '{"at":"2026-10-30T01:10:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"timeout"}',
  '{"at":"2026-10-30T01:20:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"timeout"}',
  '{"at":"2026-10-30T01:30:00+01:00","job":"fixtures/refresh","status":"retry","owner":"rook","error":"timeout"}',
  '{"at":"2026-10-30T01:40:00+01:00","job":"fixtures/refresh","status":"ok","owner":"rook"}',
  '{"at":"2026-10-30T02:00:00+01:00","job":"notes/backup","status":"fail","owner":"rook","error":"quota exceeded"}',
  '{"at":"2026-10-30T03:00:00+01:00","job":"digest/render","status":"ok","owner":null}',
];
const BAD_LINES = [
  '{"at":"2026-11-01T01:00:00+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  'not json',
  '{"at":"2026-11-01T02:00:00+01:00","job":"rig/rotate-logs","status":"ok","owner":"rook"}',
];
const JOBS_IN_ORDER = ['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup'];

let runsDir: string;
let app: ReturnType<typeof createApp>;

// Hono escapes text (e.g. ' becomes &#39;). Compare against the rendered text, not the escaped source.
function decoded(html: string): string {
  return html
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function page(night: string) {
  const res = await app.request(`/digest/${night}`);
  return { res, html: decoded(await res.text()) };
}

// A non-JSON body (e.g. Hono's default "404 Not Found") is kept as text so the assertion reports it.
async function json(night: string) {
  const res = await app.request(`/api/digest/${night}`);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep the text
  }
  return { res, body };
}

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  writeFileSync(join(runsDir, `${NORMAL}.jsonl`), NORMAL_LINES.join('\n') + '\n');
  writeFileSync(join(runsDir, `${EMPTY}.jsonl`), '');
  writeFileSync(join(runsDir, `${BAD}.jsonl`), BAD_LINES.join('\n') + '\n');
  app = createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

describe('GET /digest/:night', () => {
  it('renders a night: 200, the layout heading, and every job', async () => {
    const { res, html } = await page(NORMAL);
    expect(res.status).toBe(200);
    expect(html).toContain(`digest · ${NORMAL}`);
    for (const job of JOBS_IN_ORDER) expect(html).toContain(job);
  });

  it('marks a row with retries >= 3 or fails > 0 with class warn', async () => {
    const { html } = await page(NORMAL);
    expect(html).toContain('class="warn"');
  });

  it('renders a null owner as —', async () => {
    const { html } = await page(NORMAL);
    expect(html).toContain('digest/render');
    expect(html).toContain('—');
  });

  it('renders an empty night as "nothing ran"', async () => {
    const { res, html } = await page(EMPTY);
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
  });

  it('returns 404 for a night with no file', async () => {
    const { res } = await page(MISSING);
    expect(res.status).toBe(404);
  });

  it('keeps the good rows and says a line did not parse', async () => {
    const { res, html } = await page(BAD);
    expect(res.status).toBe(200);
    expect(html).toContain("1 line didn't parse");
    expect(html).toContain('lane/sync');
    expect(html).toContain('rig/rotate-logs');
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the night as JSON, rows sorted by job, same as readNight', async () => {
    const { res, body } = await json(NORMAL);
    expect(res.status).toBe(200);
    expect(body).toEqual(readNight(runsDir, NORMAL));
    const night = body as Night;
    expect(night.badLines).toBe(0);
    expect(night.rows.map((r) => r.job)).toEqual(JOBS_IN_ORDER);
    expect(night.rows.find((r) => r.job === 'fixtures/refresh')).toMatchObject({ retries: 3, fails: 0 });
    expect(night.rows.find((r) => r.job === 'digest/render')).toMatchObject({ owner: null });
  });

  it('returns no rows and zero bad lines for an empty night', async () => {
    const { res, body } = await json(EMPTY);
    expect(res.status).toBe(200);
    expect(body).toEqual({ night: EMPTY, rows: [], badLines: 0 });
  });

  it('returns 404 with an error body for a night with no file', async () => {
    const { res, body } = await json(MISSING);
    expect(res.status).toBe(404);
    expect(body).toEqual({ error: 'no run log', night: MISSING });
  });

  it('counts the bad line and still returns the good rows', async () => {
    const { res, body } = await json(BAD);
    expect(res.status).toBe(200);
    const night = body as Night;
    expect(night.badLines).toBe(1);
    expect(night.rows.map((r) => r.job)).toEqual(['lane/sync', 'rig/rotate-logs']);
  });
});

describe('page and JSON agree', () => {
  it('lists the jobs in the page in the same order as the JSON rows', async () => {
    const { html } = await page(NORMAL);
    const { res, body } = await json(NORMAL);
    expect(res.status).toBe(200);
    const jobs = (body as Night).rows.map((r) => r.job);
    const positions = jobs.map((job) => html.indexOf(job));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
