import { useEffect, useState } from 'react';
import client, { errorMessage } from '../api/client.js';
import Card from '../components/Card.jsx';
import Alert from '../components/Alert.jsx';
import StatCard from '../components/StatCard.jsx';
import IncomeExpenseChart from '../components/IncomeExpenseChart.jsx';
import CategoryBreakdown from '../components/CategoryBreakdown.jsx';
import BudgetUsage from '../components/BudgetUsage.jsx';
import HealthScore from '../components/HealthScore.jsx';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await client.get('/dashboard');
        if (!cancelled) setData(response.data);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, 'Could not load the dashboard'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="py-16 text-center text-sm text-ink-muted">Loading dashboard…</p>;
  }

  if (error) {
    return <Alert kind="error">{error}</Alert>;
  }

  const summary = data.summary;
  // A negative balance is a genuine state worth flagging; it takes the
  // reserved critical status colour, with the minus sign carrying the meaning
  // in text as well.
  const balanceAccent = summary.balance < 0 ? '#d03b3b' : undefined;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-primary">
          FinTrack Dashboard
        </h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          Your finances for {String(data.period.month).padStart(2, '0')}/{data.period.year}
        </p>
      </div>

      {/* Four hero numbers - single magnitudes, so stat tiles rather than a chart. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Balance" value={summary.balance} accent={balanceAccent} />
        <StatCard label="Total Income" value={summary.totalIncome} />
        <StatCard label="Total Expenses" value={summary.totalExpenses} />
        <StatCard
          label="Savings Rate"
          value={summary.savingsRate}
          kind="percent"
          hint={`${summary.transactionCount} transactions`}
        />
      </div>

      <Card title="Income vs Expenses">
        <IncomeExpenseChart data={data.monthlyTrend} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Expense Categories" className="lg:col-span-2">
          <CategoryBreakdown categories={data.categoryBreakdown} />
        </Card>

        <Card title="Financial Health Score">
          <HealthScore health={data.healthScore} />
        </Card>
      </div>

      <Card title="Budget Usage">
        <BudgetUsage budgets={data.budgetUsage} />
      </Card>
    </div>
  );
}
