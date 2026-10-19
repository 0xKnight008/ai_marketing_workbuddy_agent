import { useState } from 'react';

const columns = ['id', 'event_id', 'created_at', 'run_id', 'operation', 'provider', 'requested_model', 'model_name', 'response_id', 'prompt_tokens', 'completion_tokens', 'reasoning_tokens', 'cached_input_tokens', 'finish_reason', 'total_tokens'] as const;
type Row = Record<typeof columns[number], string | number | null>;
function cell(value: Row[keyof Row]) {
  const text = value == null ? '' : String(value);
  return `"${(/^[\s]*[=+\-@]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
}

export default function AdminTokenUsage({ request }: { request: (path: string, init?: RequestInit) => Promise<Response> }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [message, setMessage] = useState('Load the ledger to view provider-reported tokens.');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [next, setNext] = useState<number>();
  async function page(search: string, before?: number): Promise<Row[]> {
    const response = await request(`/api/admin/token-usage?q=${encodeURIComponent(search)}${before ? `&before=${before}` : ''}`);
    if (!response.ok) throw new Error('Could not load token usage. Check admin access and AI runtime availability.');
    const result: unknown = await response.json();
    if (!Array.isArray(result)) throw new Error('Invalid token ledger response.');
    return result as Row[];
  }
  async function load(more = false) {
    setBusy(true);
    try {
      const search = more ? filter : q.trim();
      const data = await page(search, more ? next : undefined);
      setRows(data); setFilter(search);
      setNext(data.length === 100 ? Number(data[data.length - 1].id) : undefined);
      setMessage(`${data.length} records on this page. Unknown counts are shown as —, not zero.`);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  async function download() {
    setBusy(true);
    try {
      const lines = [columns.join(',')];
      let before: number | undefined;
      let count = 0;
      const search = q.trim();
      for (;;) {
        const data = await page(search, before);
        for (const row of data) lines.push(columns.map(key => cell(row[key])).join(','));
        count += data.length;
        if (data.length < 100) break;
        const cursor = Number(data[data.length - 1].id);
        if (!Number.isSafeInteger(cursor) || (before !== undefined && cursor >= before)) throw new Error('Invalid cursor; export cancelled.');
        before = cursor;
        if (count >= 100_000) throw new Error('Export exceeds 100,000 records. Narrow the filter. No partial file downloaded.');
        setMessage(`Preparing CSV: ${count} records…`);
      }
      const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = 'piggybot-token-usage.csv'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`Exported ${count} records. Blank token cells mean usage was not reported.`);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }
  return <section aria-label="Token usage ledger">
    <h2 className="text-xl font-semibold">Token usage ledger</h2>
    <p>Actual model-step usage, separate from credits and estimated costs. Reasoning/cache tokens are subsets, not additional totals. Historical calls are not backfilled.</p>
    <div className="my-4 flex flex-wrap gap-3">
      <input aria-label="Token usage filter" placeholder="Model, provider or run ID" value={q} onChange={event => setQ(event.target.value)} maxLength={200} className="rounded border p-2" />
      <button disabled={busy} onClick={() => void load()}>Load / first page</button>
      <button disabled={busy || next === undefined} onClick={() => void load(true)}>Next page</button>
      <button disabled={busy} onClick={() => void download()}>Download matching CSV</button>
    </div>
    <p role="status">{message}</p>
    <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{['Time (UTC)', 'Provider', 'Model', 'Operation', 'Input tokens', 'Output tokens', 'Run ID'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} className="border-b">{(['created_at', 'provider', 'model_name', 'operation', 'prompt_tokens', 'completion_tokens', 'run_id'] as const).map(key => <td key={key} className="p-2">{row[key] ?? '—'}</td>)}</tr>)}</tbody></table></div>
  </section>;
}
