import { useState } from 'react';
import { formatCurrency, formatMonthLabel } from '../utils/format.js';

// Income vs Expenses, grouped bars, one group per month.
//
// Form: the job is comparing two magnitudes across a time sequence, so bars
// grouped by month - NOT two lines on two scales. Both series are rupees on a
// single shared y-axis; a dual axis would be meaningless here.
//
// Colour: categorical slots 1 and 2 of the validated palette (blue #2a78d6,
// orange #eb6834). The pair passes the lightness band, chroma floor, CVD
// separation (ΔE 24.7 protan) and 3:1 surface contrast in both modes.
// Identity is never colour-alone: a legend is always present, and the hover
// tooltip names each series in text.

const INCOME = 'var(--series-income)';
const EXPENSE = 'var(--series-expense)';

/** Picks a round axis maximum so gridline labels are readable numbers. */
function niceMax(value) {
  if (value <= 0) return 100;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalised = value / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

function compactRupee(value) {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(1)}Cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (value >= 1000) return `₹${Math.round(value / 1000)}k`;
  return `₹${value}`;
}

export default function IncomeExpenseChart({ data = [] }) {
  const [hovered, setHovered] = useState(null);

  if (!data.length) {
    return (
      <p className="py-10 text-center text-sm text-ink-muted">
        No transactions yet - add income or an expense to see the trend.
      </p>
    );
  }

  // Geometry. The viewBox scales to the container; everything below is in
  // viewBox units, so the chart stays crisp at any width.
  const width = 720;
  const height = 280;
  const margin = { top: 16, right: 16, bottom: 36, left: 56 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const peak = Math.max(...data.flatMap((d) => [d.income, d.expenses]), 0);
  const axisMax = niceMax(peak);

  const groupWidth = plotWidth / data.length;
  // 2px surface gap between the two bars in a group, per the mark spec.
  const gap = 2;
  const barWidth = Math.min(28, (groupWidth - 24 - gap) / 2);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * axisMax);
  const yOf = (value) => margin.top + plotHeight - (value / axisMax) * plotHeight;

  return (
    <figure className="m-0">
      {/* Legend: always present for two or more series, so identity never
          depends on colour alone. */}
      <figcaption className="mb-3 flex items-center gap-4 text-xs text-ink-secondary">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: INCOME }} aria-hidden="true" />
          Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: EXPENSE }} aria-hidden="true" />
          Expenses
        </span>
      </figcaption>

      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          role="img"
          aria-label="Monthly income compared with expenses"
        >
          {/* Recessive gridlines and value axis. */}
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={yOf(tick)}
                y2={yOf(tick)}
                stroke="var(--gridline)"
                strokeWidth="1"
              />
              <text
                x={margin.left - 8}
                y={yOf(tick) + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--text-muted)"
                className="tabular"
              >
                {compactRupee(Math.round(tick))}
              </text>
            </g>
          ))}

          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={yOf(0)}
            y2={yOf(0)}
            stroke="var(--baseline)"
            strokeWidth="1"
          />

          {data.map((point, index) => {
            const groupX = margin.left + index * groupWidth;
            const centre = groupX + groupWidth / 2;
            const incomeX = centre - barWidth - gap / 2;
            const expenseX = centre + gap / 2;
            const isHovered = hovered === index;

            return (
              <g key={point.month}>
                {/* A full-height hit target: the hover area is larger than the
                    marks themselves, so thin bars are still easy to reach. */}
                <rect
                  x={groupX}
                  y={margin.top}
                  width={groupWidth}
                  height={plotHeight}
                  fill={isHovered ? 'rgba(11,11,11,0.035)' : 'transparent'}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                />

                {/* 4px rounded data-ends, anchored to the baseline. */}
                <rect
                  x={incomeX}
                  y={yOf(point.income)}
                  width={barWidth}
                  height={Math.max(0, yOf(0) - yOf(point.income))}
                  rx="4"
                  fill={INCOME}
                  pointerEvents="none"
                />
                <rect
                  x={expenseX}
                  y={yOf(point.expenses)}
                  width={barWidth}
                  height={Math.max(0, yOf(0) - yOf(point.expenses))}
                  rx="4"
                  fill={EXPENSE}
                  pointerEvents="none"
                />

                <text
                  x={centre}
                  y={height - 14}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--text-muted)"
                  pointerEvents="none"
                >
                  {formatMonthLabel(point.month)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip. Values are in text ink, never the series colour - the
            colour swatch beside each label carries identity. */}
        {hovered !== null && data[hovered] && (
          <div
            className="pointer-events-none absolute top-2 rounded-md border border-hairline bg-surface px-3 py-2 text-xs shadow-sm"
            style={{
              left: `${((hovered + 0.5) / data.length) * 100}%`,
              transform: 'translateX(-50%)',
            }}
          >
            <p className="mb-1 font-medium text-ink-primary">
              {formatMonthLabel(data[hovered].month)}
            </p>
            <p className="flex items-center gap-1.5 text-ink-secondary">
              <span className="h-2 w-2 rounded-sm" style={{ background: INCOME }} aria-hidden="true" />
              Income
              <span className="tabular ml-auto pl-3 font-medium text-ink-primary">
                {formatCurrency(data[hovered].income)}
              </span>
            </p>
            <p className="flex items-center gap-1.5 text-ink-secondary">
              <span className="h-2 w-2 rounded-sm" style={{ background: EXPENSE }} aria-hidden="true" />
              Expenses
              <span className="tabular ml-auto pl-3 font-medium text-ink-primary">
                {formatCurrency(data[hovered].expenses)}
              </span>
            </p>
          </div>
        )}
      </div>

      {/* The table view: the same numbers without relying on sight of colour. */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-ink-muted hover:text-ink-secondary">
          View as table
        </summary>
        <table className="mt-2 w-full text-xs">
          <thead>
            <tr className="border-b border-hairline text-left text-ink-muted">
              <th className="py-1.5 font-medium">Month</th>
              <th className="py-1.5 text-right font-medium">Income</th>
              <th className="py-1.5 text-right font-medium">Expenses</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {data.map((point) => (
              <tr key={point.month} className="border-b border-hairline/60">
                <td className="py-1.5 text-ink-secondary">{formatMonthLabel(point.month)}</td>
                <td className="py-1.5 text-right text-ink-primary">{formatCurrency(point.income)}</td>
                <td className="py-1.5 text-right text-ink-primary">{formatCurrency(point.expenses)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
