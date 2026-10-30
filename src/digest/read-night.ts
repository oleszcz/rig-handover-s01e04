import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, DigestStatus, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error: string | null;
};

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || match[0] !== value) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function parseEvent(line: string): RunEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (!isTimestamp(event.at) || typeof event.job !== 'string' || !event.job.trim()) return null;
  if (event.status !== 'ok' && event.status !== 'retry' && event.status !== 'fail') return null;
  if (event.owner != null && typeof event.owner !== 'string') return null;
  if (event.error != null && typeof event.error !== 'string') return null;
  return {
    at: event.at,
    job: event.job,
    status: event.status,
    owner: event.owner ?? null,
    error: event.error ?? null,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (night.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(night)) return null;
  let content: string;
  try {
    content = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const jobs = new Map<string, DigestRow>();
  const totals = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const event = parseEvent(line);
    if (!event) {
      badLines += 1;
      continue;
    }
    totals[event.status] += 1;
    const row = jobs.get(event.job);
    if (row) {
      row.owner = event.owner;
      row.runs += 1;
      row.retries += event.status === 'retry' ? 1 : 0;
      row.lastStatus = event.status;
      row.lastError = event.error;
      row.lastAt = event.at;
    } else {
      jobs.set(event.job, {
        job: event.job,
        owner: event.owner,
        runs: 1,
        retries: event.status === 'retry' ? 1 : 0,
        lastStatus: event.status,
        lastError: event.error,
        firstAt: event.at,
        lastAt: event.at,
      });
    }
  }
  const rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { night, rows, badLines, totals };
};
