import { formatCurrency, formatPercent } from '../utils/format.js';

// Budget usage meters.
//
// Form: this is not a chart - each row is a single value against a target, so
// a meter is the right form. The number is shown in text; the bar is support.
//
// Colour: the reserved STATUS palette (good / warning / critical), never the
// categorical series slots. Status colour never carries meaning alone - every
// row ships an icon and a word ("On track" / "Close to limit" / "Over budget")
// alongside it, which is also what makes it readable in forced-colors mode and
// in print.

const STATUS = {
  ok: { color: '#0ca30c', label: 'On track', icon: '✓' },
  warning: { color: '#fab219', label: 'Close to limit', icon: '!' },
  over: { color: '#d03b3b', label: 'Over budget', icon: '×' },
};

export default function BudgetUsage({ budgets = [] }) {
  if (!budgets.length) {
    return (
      <p className="py-8 text-center text-sm text-ink-muted">
        No budgets set for this month. Create one to track your spending against a target.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {budgets.map((budget) => {
        const status = STATUS[budget.status] || STATUS.ok;

        return (
          <li key={budget.id ?? budget.category}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink-secondary">{budget.category}</span>
              <span className="tabular font-medium text-ink-primary">
                {formatCurrency(budget.spent)}
                <span className="font-normal text-ink-muted"> / {formatCurrency(budget.budgeted)}</span>
              </span>
            </div>

            <div className="h-2 w-full overflow-hidden rounded bg-hairline">
              <div
                className="h-full rounded"
                style={{ width: `${budget.used}%`, background: status.color }}
              />
            </div>

            <div className="mt-1 flex items-center justify-between text-xs">
              {/* Icon + label: the status is legible without seeing the colour. */}
              <span className="flex items-center gap-1.5 text-ink-secondary">
                <span
                  aria-hidden="true"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ background: status.color }}
                >
                  {status.icon}
                </span>
                {status.label}
              </span>
              <span className="tabular text-ink-muted">
                {formatPercent(budget.percentage)} used
                {budget.remaining < 0
                  ? ` · ${formatCurrency(Math.abs(budget.remaining))} over`
                  : ` · ${formatCurrency(budget.remaining)} left`}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
