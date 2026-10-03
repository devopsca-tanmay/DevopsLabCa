import { formatPercent } from '../utils/format.js';

// Financial health score.
//
// Form: a single 0-100 value against a fixed range, so a meter plus a hero
// number - not a chart. The three contributing components are listed as plain
// rows so the score is explainable rather than a black box.
//
// Colour: the reserved status palette, paired with the rating word so the band
// is never communicated by colour alone.

const BANDS = [
  { min: 80, color: '#0ca30c' },
  { min: 65, color: '#0ca30c' },
  { min: 45, color: '#fab219' },
  { min: 0, color: '#d03b3b' },
];

function bandColor(score) {
  return (BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1]).color;
}

export default function HealthScore({ health }) {
  if (!health) return null;

  const color = bandColor(health.score);
  const components = health.components || {};

  return (
    <div>
      <div className="flex items-end gap-3">
        {/* Hero number - the rating word beside it carries the band. */}
        <p className="text-4xl font-semibold leading-none" style={{ color }}>
          {health.score}
        </p>
        <div className="pb-0.5">
          <p className="text-sm font-medium text-ink-primary">{health.rating}</p>
          <p className="text-xs text-ink-muted">out of 100</p>
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded bg-hairline">
        <div className="h-full rounded" style={{ width: `${health.score}%`, background: color }} />
      </div>

      <dl className="mt-4 space-y-2 text-xs">
        <div className="flex justify-between">
          <dt className="text-ink-secondary">Savings rate (50%)</dt>
          <dd className="tabular text-ink-primary">{formatPercent(components.savingsRate)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-secondary">Budget adherence (30%)</dt>
          <dd className="tabular text-ink-primary">
            {components.budgetAdherence === null || components.budgetAdherence === undefined
              ? 'No budgets set'
              : formatPercent(components.budgetAdherence)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-secondary">Expense control (20%)</dt>
          <dd className="tabular text-ink-primary">{formatPercent(components.expenseGrowth)}</dd>
        </div>
      </dl>

      <p className="mt-4 border-t border-hairline pt-3 text-xs leading-relaxed text-ink-muted">
        {health.disclaimer}
      </p>
    </div>
  );
}
