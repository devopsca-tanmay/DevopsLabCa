import { formatCurrency, formatPercent } from '../utils/format.js';

// A stat tile: one headline number, no plot.
//
// Per the form heuristic, a single magnitude with no comparison is a hero
// number, not a chart. The value uses default proportional figures (tabular
// figures are reserved for columns that must align vertically).

export default function StatCard({ label, value, kind = 'currency', hint, accent }) {
  const display =
    kind === 'percent' ? formatPercent(value, 0)
      : kind === 'raw' ? value
        : formatCurrency(value);

  return (
    <div className="rounded-lg border border-hairline bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{label}</p>
      <p
        className="mt-1.5 text-2xl font-semibold"
        style={{ color: accent || 'var(--text-primary)' }}
      >
        {display}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}
