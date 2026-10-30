import type { DigestNight, DigestRow } from '../digest/types.js';

// Missing data is shown as a dash, never as an empty cell (styleguide).
const dash = (value: string | null | undefined): string => (value ? value : '—');

// Retries of 3 or more and any failure are flagged in words too, not only by colour.
function flagOf(row: DigestRow): string | null {
  if (row.lastStatus === 'fail') return 'fail';
  if (row.retries >= 3) return 'retries >=3';
  return null;
}

function DigestRowView({ row }: { row: DigestRow }) {
  const flag = flagOf(row);
  return (
    <tr class={flag ? 'warn' : undefined}>
      <td>{row.job}</td>
      <td>{dash(row.owner)}</td>
      <td>{row.runs}</td>
      <td>{row.retries}</td>
      <td>{row.lastStatus}</td>
      <td>{dash(row.lastError)}</td>
      <td>{dash(row.firstAt)}</td>
      <td>{dash(row.lastAt)}</td>
      <td>{flag ?? '—'}</td>
    </tr>
  );
}

export function DigestPage({ digest }: { digest: DigestNight }) {
  const { totals, badLines, rows } = digest;
  return (
    <>
      <h1>digest · {digest.night}</h1>
      <p>
        ok {totals.ok} · retry {totals.retry} · fail {totals.fail} ·{' '}
        <span class={badLines > 0 ? 'warn' : 'mute'}>bad lines {badLines}</span>
      </p>
      {rows.length === 0 ? (
        <p class="mute">nothing ran</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>job</th>
              <th>owner</th>
              <th>runs</th>
              <th>retries</th>
              <th>last status</th>
              <th>last error</th>
              <th>first</th>
              <th>last</th>
              <th>flag</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <DigestRowView row={row} />
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
