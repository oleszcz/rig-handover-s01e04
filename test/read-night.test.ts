import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read-night.js';

const fixtures = fileURLToPath(new URL('../runs/', import.meta.url));
const night = '2026-10-28';
const at = '2026-10-28T23:00:00+01:00';
const temporaryDirs: string[] = [];

function tempRuns(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  temporaryDirs.push(dir);
  if (content !== undefined) writeFileSync(join(dir, `${night}.jsonl`), content);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readNight', () => {
  it('reads the real night: five sorted jobs, one bad line, and event totals', () => {
    const result = readNight(fixtures, night);
    expect(result).toEqual({
      night,
      badLines: 1,
      totals: { ok: 10, retry: 4, fail: 1 },
      rows: [
        { job: 'digest/render', owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00' },
        { job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00' },
        { job: 'lane/sync', owner: 'rook', runs: 8, retries: 1, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' },
        { job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00' },
        { job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0, lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00' },
      ],
    });
  });

  it('reads the other fixture without bad lines', () => {
    const result = readNight(fixtures, '2026-10-27');
    expect(result?.rows).toHaveLength(4);
    expect(result?.badLines).toBe(0);
    expect(result?.totals).toEqual({ ok: 7, retry: 0, fail: 0 });
  });

  it('distinguishes an absent file from an empty or whitespace-only file', () => {
    expect(readNight(tempRuns(), night)).toBeNull();
    expect(readNight(join(tempRuns(), 'absent-directory'), night)).toBeNull();
    for (const content of ['', '\r\n  \r\n\t\n']) {
      expect(readNight(tempRuns(content), night)).toEqual({
        night, rows: [], badLines: 0, totals: { ok: 0, retry: 0, fail: 0 },
      });
    }
  });

  it('counts malformed JSON and schema lines without losing valid events', () => {
    const valid = { at, job: 'sync', status: 'ok', owner: 'rook' };
    const invalid: unknown[] = [
      null, [], 42, 'text', {},
      { ...valid, at: null }, { ...valid, at: 'yesterday' },
      { ...valid, at: '2026-02-29T23:00:00+01:00' },
      { ...valid, at: '2026-10-28T24:00:00+01:00' },
      { ...valid, at: '2026-10-28T23:00:00' },
      { ...valid, at: `${at}\n` },
      { ...valid, job: 1 }, { ...valid, job: ' ' },
      { ...valid, status: 'unknown' }, { ...valid, status: null },
      { ...valid, owner: false }, { ...valid, error: {} },
    ];
    const lines = [JSON.stringify(valid), '{bad', ...invalid.map((value) => JSON.stringify(value)), JSON.stringify(valid)];
    const result = readNight(tempRuns(lines.join('\r\n')), night);
    expect(result?.badLines).toBe(invalid.length + 1);
    expect(result?.rows).toHaveLength(1);
    expect(result?.rows[0].runs).toBe(2);
    expect(result?.totals).toEqual({ ok: 2, retry: 0, fail: 0 });
  });

  it('returns an existing all-invalid night rather than treating it as absent', () => {
    expect(readNight(tempRuns('null\n{bad\n'), night)).toEqual({
      night, rows: [], badLines: 2, totals: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('keeps log order and exact offsets while using the latest owner, status, and error', () => {
    const events = [
      { at: '2026-10-28T23:00:00.123+05:30', job: 'sync', status: 'retry', owner: 'rook', error: 'lock' },
      { at: '2026-10-28T18:00:00-03:30', job: 'sync', status: 'fail', owner: null, error: 'quota' },
      { at: '2026-10-28T01:00:00Z', job: 'sync', status: 'ok' },
    ];
    const dir = tempRuns(events.map((event) => JSON.stringify(event)).join('\n'));
    const result = readNight(dir, night);
    expect(result?.rows).toEqual([{
      job: 'sync', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: null,
      firstAt: events[0].at, lastAt: events[2].at,
    }]);
    expect(result?.totals).toEqual({ ok: 1, retry: 1, fail: 1 });
    expect(readNight(dir, night)).toEqual(result);
  });

  it('keeps explicit null errors and accepts valid leap days', () => {
    const event = { at: '2024-02-29T23:00:00+01:00', job: 'sync', status: 'fail', error: null };
    const result = readNight(tempRuns(JSON.stringify(event)), night);
    expect(result?.badLines).toBe(0);
    expect(result?.rows[0]).toMatchObject({ owner: null, lastError: null, lastStatus: 'fail' });
  });

  it('sorts jobs by string comparison, including names with special object keys', () => {
    const jobs = ['z', '__proto__', 'a', 'Z', 'constructor', 'A'];
    const content = jobs.map((job) => JSON.stringify({ at, job, status: 'ok' })).join('\n');
    expect(readNight(tempRuns(content), night)?.rows.map((row) => row.job))
      .toEqual(['A', 'Z', '__proto__', 'a', 'constructor', 'z']);
  });

  it.each(['../2026-10-28', '../../2026-10-28', '/2026-10-28', '..\\2026-10-28',
    '2026-10-28/extra', '2026-10-28.jsonl', '2026-1-2', '2026-10-28\n', '2026-10-28\0'])
  ('rejects unsafe or non-night names: %s', (unsafe) => {
    expect(readNight(tempRuns(''), unsafe)).toBeNull();
  });

  it('propagates filesystem errors other than missing files', () => {
    const dir = tempRuns();
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow();
  });
});
