import { z } from 'zod';

/**
 * Header-driven CSV parsing with zero dependencies. Handles quoted fields,
 * embedded commas/newlines and escaped double-quotes per RFC 4180.
 */
export function parseCsv(content: string): Array<Record<string, string>> {
  const rows = splitCsvRows(content);
  const headerRow = rows[0];
  if (rows.length < 2 || !headerRow) return [];
  const header = headerRow.map((cell) => cell.trim().toLowerCase());
  if (header.some((cell) => !cell)) return [];
  const records: Array<Record<string, string>> = [];
  for (const row of rows.slice(1)) {
    if (row.length === 1 && row[0] === '') continue;
    const record: Record<string, string> = {};
    header.forEach((key, index) => { record[key] = (row[index] ?? '').trim(); });
    records.push(record);
  }
  return records;
}

function splitCsvRows(content: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    if (inQuotes) {
      if (char === '"' && content[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') inQuotes = false;
      else field += char;
      continue;
    }
    if (char === '"') { inQuotes = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && content[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      rows.push(row); row = [];
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

const numeric = z.coerce.number().nonnegative().optional();

/** Metrics columns understood by the importer; everything else stays raw text. */
export const metricsSchema = z.object({
  views: numeric,
  likes: numeric,
  comments: numeric,
  shares: numeric,
  saves: numeric,
  rating: z.coerce.number().min(0).max(5).optional(),
}).strip();

export interface ParsedItem {
  platform: string;
  externalId?: string;
  author?: string;
  text: string;
  metrics: Record<string, unknown>;
}

const PLATFORM_ALIASES: Record<string, string> = {
  x: 'twitter', xcom: 'twitter', 小红书: 'rednote', red: 'rednote',
  bilibili: 'bilibili', b站: 'bilibili', yt: 'youtube', ig: 'instagram',
};

export function normalizePlatform(value: string | undefined): string {
  const lowered = (value ?? '').trim().toLowerCase();
  if (!lowered) return 'unknown';
  return PLATFORM_ALIASES[lowered] ?? (lowered.replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'unknown');
}

/** Maps one CSV record to an item. `text` falls back to title for content rows. */
export function csvRecordToItem(record: Record<string, string>): ParsedItem | undefined {
  const text = (record.text || record.comment || record.review || record.title || '').trim();
  if (!text) return undefined;
  const metrics = metricsSchema.parse({
    views: emptyToUndefined(record.views ?? record.plays ?? record.play_count),
    likes: emptyToUndefined(record.likes),
    comments: emptyToUndefined(record.comments ?? record.comment_count),
    shares: emptyToUndefined(record.shares ?? record.reposts),
    saves: emptyToUndefined(record.saves ?? record.favorites ?? record.collects),
    rating: emptyToUndefined(record.rating ?? record.stars),
  });
  const extraMetrics = metrics as Record<string, unknown>;
  if (record.published_at) extraMetrics.publishedAt = record.published_at;
  if (record.sku) extraMetrics.sku = record.sku;
  if (record.url) extraMetrics.url = record.url;
  return {
    platform: normalizePlatform(record.platform),
    externalId: emptyToUndefined(record.external_id ?? record.id ?? record.url),
    author: emptyToUndefined(record.author ?? record.user ?? record.nickname),
    text,
    metrics,
  };
}

/** Paste mode: one item per non-empty line. */
export function pasteToItems(content: string): ParsedItem[] {
  return content.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({ platform: 'unknown', text: line.slice(0, 2_000), metrics: {} }));
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
