import { formatCurrency, formatPercent } from '../utils/format.js';

// Expense categories, ranked.
//
// Form: the job is ranked magnitude across a handful of named categories, so
// horizontal bars sorted descending - not a pie. Category names are long, and
// horizontal bars give them room without rotated labels.
//
// Colour: this is ONE series (rupees spent), so it takes one hue rather than a
// categorical palette. Giving each category its own hue would imply the hues
// mean something they do not - identity here is carried by the label, which is
// always visible. Every bar uses categorical slot 1 (blue), and each bar is
// directly labelled with its amount, so nothing depends on colour at all.

export default function CategoryBreakdown({ categories = [] }) {
  if (!categories.length) {
    return (
      <p className="py-8 text-center text-sm text-ink-muted">
        No expenses recorded yet.
      </p>
    );
  }

  const largest = Math.max(...categories.map((c) => c.amount), 0) || 1;

  return (
    <ul className="space-y-3">
      {categories.map((category) => (
        <li key={category.category}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="text-ink-secondary">{category.category}</span>
            {/* Direct label - the value is never colour-encoded. */}
            <span className="tabular font-medium text-ink-primary">
              {formatCurrency(category.amount)}
              <span className="ml-2 text-xs font-normal text-ink-muted">
                {formatPercent(category.percentage)}
              </span>
            </span>
          </div>
          {/* Thin mark, 4px rounded data-end, anchored to the track start. */}
          <div className="h-2 w-full overflow-hidden rounded bg-hairline">
            <div
              className="h-full rounded"
              style={{
                width: `${Math.max(2, (category.amount / largest) * 100)}%`,
                background: 'var(--series-income)',
              }}
              role="img"
              aria-label={`${category.category}: ${formatCurrency(category.amount)}, ${formatPercent(category.percentage)} of expenses`}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
