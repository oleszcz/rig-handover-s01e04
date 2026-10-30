export type DigestStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  // Owner of the last event; missing owners are normalized to null.
  owner: string | null;
  // Every valid event counts as a run, including retries and failures.
  runs: number;
  retries: number;
  lastStatus: DigestStatus;
  // Error of the last event, or null when that event has no error.
  lastError: string | null;
  // First/last refer to log order, preserving the original timestamp strings.
  firstAt: string;
  lastAt: string;
};

export type DigestNight = {
  night: string;
  // Ascending job order using string comparison, independent of host locale.
  rows: DigestRow[];
  // Invalid JSON and schema lines; blank lines are ignored.
  badLines: number;
  // Counts of all valid events, not just each job's final status.
  totals: Record<DigestStatus, number>;
};

// Implemented/exported by ./read-night.js. Only YYYY-MM-DD names are accepted.
// Missing files or unsafe night names return null; empty files return zero totals
// and no rows. Other filesystem errors propagate rather than masquerade as 404s.
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
