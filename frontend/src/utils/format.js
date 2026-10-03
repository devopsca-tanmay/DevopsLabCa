// Indian rupee formatting, matching the figures used throughout the dashboard.
const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const currencyPrecise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value, precise = false) {
  const n = Number(value) || 0;
  return precise ? currencyPrecise.format(n) : currency.format(n);
}

export function formatPercent(value, digits = 0) {
  const n = Number(value) || 0;
  return `${n.toFixed(digits)}%`;
}

/** "2026-10" -> "Oct 2026" for chart axis labels. */
export function formatMonthLabel(yyyymm) {
  if (typeof yyyymm !== 'string') return '';
  const [year, month] = yyyymm.split('-').map(Number);
  if (!year || !month) return yyyymm;
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** "2026-10-03" -> "3 Oct 2026" for the transaction table. */
export function formatDate(isoDate) {
  if (!isoDate) return '';
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/** Today's date as YYYY-MM-DD, for date input defaults. */
export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
