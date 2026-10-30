import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import { readNight } from '../src/digest/read-night.js';
import type { DigestNight } from '../src/digest/types.js';

const night = '2026-10-28';
const at = '2026-10-28T23:00:00+01:00';
const temporaryDirs: string[] = [];

function configFor(runsDir: string): RigConfig {
  return { adapter: 'shim', installed: at, beatEverySeconds: 60, runsDir };
}

function tempRuns(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
  temporaryDirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

function jsonl(events: unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

// Returns the <tr> fragment whose text includes the job name.
function rowFor(html: string, job: string): string {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
  const row = rows.find((candidate) => candidate.includes(job));
  if (!row) throw new Error(`no row for ${job}`);
  return row;
}

// Returns job names in the order they appear in the page.
function jobOrder(html: string, jobs: string[]): string[] {
  return jobs
    .map((job) => ({ job, index: html.indexOf(job) }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.job);
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sample = [
  { at: '2026-10-28T23:00:02+01:00', job: 'rig/rotate-logs', status: 'ok', owner: 'lane-07' },
  { at: '2026-10-28T23:00:06+01:00', job: 'lane/sync', status: 'retry', owner: 'rook', error: 'lock held' },
  { at: '2026-10-28T23:01:06+01:00', job: 'lane/sync', status: 'retry', owner: 'rook', error: 'lock held' },
  { at: '2026-10-28T23:02:06+01:00', job: 'lane/sync', status: 'retry', owner: 'rook', error: 'lock held' },
  { at: '2026-10-28T23:03:06+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' },
  { at: '2026-10-29T04:00:01+01:00', job: 'notes/backup', status: 'fail', owner: 'lane-07', error: 'quota exceeded' },
  { at: '2026-10-29T05:41:09+01:00', job: 'digest/render', status: 'ok', owner: null },
];

describe('digest page GET /digest/:night', () => {
  it('renders 200 with one sorted row per job, owners, and missing owners as —', async () => {
    const runs = tempRuns({ [`${night}.jsonl`]: jsonl(sample) });
    const res = await createApp(configFor(runs)).request(`/digest/${night}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(jobOrder(html, ['digest/render', 'lane/sync', 'notes/backup', 'rig/rotate-logs']))
      .toEqual(['digest/render', 'lane/sync', 'notes/backup', 'rig/rotate-logs']);
    expect(rowFor(html, 'digest/render')).toContain('—');
    expect(rowFor(html, 'digest/render')).not.toContain('null');
    expect(rowFor(html, 'rig/rotate-logs')).toContain('lane-07');
    expect(rowFor(html, 'lane/sync')).toContain('rook');
  });

  it('marks retries of 3 or more and any fail visibly, but not a plain ok row', async () => {
    const runs = tempRuns({ [`${night}.jsonl`]: jsonl(sample) });
    const html = await (await createApp(configFor(runs)).request(`/digest/${night}`)).text();
    const plain = rowFor(html, 'rig/rotate-logs');
    const retried = rowFor(html, 'lane/sync');
    const failed = rowFor(html, 'notes/backup');
    expect(retried).toContain('3');
    expect(retried).not.toBe(plain);
    expect(failed).toContain('fail');
    expect(failed).not.toBe(plain);
    expect(failed).toContain('quota exceeded');
  });

  it('returns 404 for a night with no file', async () => {
    const runs = tempRuns();
    const res = await createApp(configFor(runs)).request(`/digest/${night}`);
    expect(res.status).toBe(404);
  });

  it('renders "nothing ran" for an empty night file', async () => {
    const runs = tempRuns({ [`${night}.jsonl`]: '' });
    const res = await createApp(configFor(runs)).request(`/digest/${night}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html.toLowerCase()).toContain('nothing ran');
  });

  it('renders a night with a bad line, counting it and keeping valid rows', async () => {
    const runs = tempRuns({ [`${night}.jsonl`]: `${jsonl(sample)}\n{bad json\n` });
    const res = await createApp(configFor(runs)).request(`/digest/${night}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('lane/sync');
    expect(html).toContain('notes/backup');
    expect(html).toMatch(/bad/i);
    expect(html).toMatch(/bad[\s\S]{0,80}\b1\b|\b1\b[\s\S]{0,80}bad/i);
  });
});

describe('digest JSON GET /api/digest/:night', () => {
  it('returns the full DigestNight object with rows', async () => {
    const runs = tempRuns({ [`${night}.jsonl`]: `${jsonl(sample)}\n{bad json\n` });
    const res = await createApp(configFor(runs)).request(`/api/digest/${night}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestNight;
    expect(body).toEqual(readNight(runs, night));
    expect(body.night).toBe(night);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((row) => row.job)).toEqual(['digest/render', 'lane/sync', 'notes/backup', 'rig/rotate-logs']);
  });

  it('returns 404 for a night with no file', async () => {
    const runs = tempRuns();
    const res = await createApp(configFor(runs)).request(`/api/digest/${night}`);
    expect(res.status).toBe(404);
  });

  it('returns empty rows for an empty night', async () => {
    const runs = tempRuns({ [`${night}.jsonl`]: '' });
    const res = await createApp(configFor(runs)).request(`/api/digest/${night}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestNight;
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('lists the same jobs in the same order as the page', async () => {
    const runs = tempRuns({ [`${night}.jsonl`]: jsonl(sample) });
    const app = createApp(configFor(runs));
    const html = await (await app.request(`/digest/${night}`)).text();
    const body = (await (await app.request(`/api/digest/${night}`)).json()) as DigestNight;
    const jobs = body.rows.map((row) => row.job);
    expect(jobOrder(html, jobs)).toEqual(jobs);
  });
});

describe('status board links to digests', () => {
  it('links each night on disk to its digest with ok / retry / fail counts', async () => {
    const runs = tempRuns({
      [`${night}.jsonl`]: jsonl(sample),
      '2026-10-27.jsonl': jsonl([{ at: '2026-10-27T23:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook' }]),
    });
    const html = await (await createApp(configFor(runs)).request('/')).text();
    expect(html).toContain(`href="/digest/${night}"`);
    expect(html).toContain('href="/digest/2026-10-27"');

    const totals = readNight(runs, night)?.totals;
    expect(totals).toEqual({ ok: 3, retry: 3, fail: 1 });
    const linkIndex = html.indexOf(`href="/digest/${night}"`);
    const beside = html.slice(linkIndex, linkIndex + 400);
    expect(beside).toMatch(/ok\D{0,20}3/);
    expect(beside).toMatch(/retry\D{0,20}3/);
    expect(beside).toMatch(/fail\D{0,20}1/);
  });
});
