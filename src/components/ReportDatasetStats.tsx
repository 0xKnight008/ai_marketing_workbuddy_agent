interface DatasetStats {
  items: number;
  taggedItems: number;
  sampledItems: number;
  tagDistribution: Record<string, number>;
  sentiments?: { classified: number; unknown: number; distribution: Record<string, number> };
  ratings?: { rated: number; negative: number };
}

export function ReportDatasetStats({ value }: { value: unknown }) {
  // Older saved reports do not have a full-dataset snapshot. Do not infer one
  // from itemCount or the model's sample-level conclusions.
  if (!value || typeof value !== 'object') return null;
  const stats = value as DatasetStats;
  if (!Number.isInteger(stats.items) || stats.items < 0 || !stats.tagDistribution) return null;
  const percent = (count: number, total: number) => total ? `${(100 * count / total).toFixed(1)}%` : 'N/A';
  return <section className="rounded-xl border border-ink/15 p-4" aria-label="Full dataset statistics">
    <h3 className="font-semibold">Full dataset statistics</h3>
    <p className="mt-2 text-sm">{stats.items} source items · {stats.taggedItems} with intent labels ({percent(stats.taggedItems, stats.items)}) · {stats.sampledItems} sampled for quotations</p>
    <p className="mt-2 text-xs text-ink-soft">Calculated before sampling. Intent labels can overlap; these are not emotion percentages or individual topic frequencies. Unlabelled items may have no actionable signal.</p>
    <ul className="mt-3 flex flex-wrap gap-2">{Object.entries(stats.tagDistribution).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => <li key={tag} className="rounded-full bg-sky-pale px-2 py-1 text-xs">{tag.replaceAll('_', ' ')}: {count} / {stats.items} ({percent(count, stats.items)})</li>)}</ul>
    {stats.ratings && <p className="mt-3 text-sm">Negative reviews: {stats.ratings.negative} / {stats.ratings.rated} rated items ({percent(stats.ratings.negative, stats.ratings.rated)}). Denominator excludes unrated items; negative = rating 1–2 on a 1–5 scale.</p>}
    {stats.sentiments && <section className="mt-4" aria-label="Emotion distribution"><h4 className="font-semibold">Emotion distribution</h4><p className="mt-1 text-xs text-ink-soft">One dominant label per source, verified against an original quote. Percentages use all {stats.items} source items; unknown is not neutral. These are model classifications, not independently measured facts.</p><p className="mt-2 text-sm">Classified: {stats.sentiments.classified} / {stats.items} · Unknown: {stats.sentiments.unknown} ({percent(stats.sentiments.unknown, stats.items)})</p><ul className="mt-2 flex flex-wrap gap-2">{Object.entries(stats.sentiments.distribution).map(([label, count]) => <li key={label} className="rounded-full bg-sun/30 px-2 py-1 text-xs">{label.replaceAll('_', ' ')}: {count} ({percent(count, stats.items)})</li>)}</ul></section>}
  </section>;
}
