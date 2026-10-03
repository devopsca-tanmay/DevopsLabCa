import { useCallback, useEffect, useState } from 'react';
import client, { errorMessage } from '../api/client.js';
import Card from '../components/Card.jsx';
import Alert from '../components/Alert.jsx';
import { formatCurrency } from '../utils/format.js';

const EXPENSE_CATEGORIES = [
  'Food', 'Transport', 'Shopping', 'Bills', 'Entertainment',
  'Health', 'Education', 'Rent', 'Other Expense',
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const now = new Date();

const EMPTY_FORM = {
  category: 'Food',
  amount: '',
  month: now.getMonth() + 1,
  year: now.getFullYear(),
};

export default function Budgets() {
  const [budgets, setBudgets] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data } = await client.get('/budgets');
      setBudgets(data.budgets);
    } catch (err) {
      setError(errorMessage(err, 'Could not load budgets'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function updateForm(field) {
    return (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setNotice('');

    const payload = {
      category: form.category,
      amount: Number(form.amount),
      month: Number(form.month),
      year: Number(form.year),
    };

    try {
      if (editingId) {
        await client.put(`/budgets/${editingId}`, payload);
        setNotice('Budget updated');
      } else {
        await client.post('/budgets', payload);
        setNotice('Budget created');
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      await load();
    } catch (err) {
      // A 409 here means a budget already exists for this category and month -
      // the API's unique constraint, surfaced as a readable message.
      setError(errorMessage(err, 'Could not save the budget'));
    }
  }

  function startEdit(budget) {
    setEditingId(budget.id);
    setForm({
      category: budget.category,
      amount: String(budget.amount),
      month: budget.month,
      year: budget.year,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleDelete(id) {
    setError('');
    setNotice('');
    try {
      await client.delete(`/budgets/${id}`);
      setNotice('Budget deleted');
      if (editingId === id) cancelEdit();
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not delete the budget'));
    }
  }

  const inputClass =
    'w-full rounded border border-hairline px-3 py-2 text-sm outline-none focus:border-series-income';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink-primary">Budgets</h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          Set a monthly spending target per category. The dashboard tracks your actual
          spending against each one.
        </p>
      </div>

      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{notice}</Alert>

      <Card title={editingId ? 'Edit budget' : 'Create a budget'}>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs text-ink-secondary" htmlFor="b-category">Category</label>
            <select id="b-category" value={form.category} onChange={updateForm('category')} className={inputClass}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-secondary" htmlFor="b-amount">Monthly limit</label>
            <input
              id="b-amount" type="number" step="0.01" min="0.01" required
              value={form.amount} onChange={updateForm('amount')} className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-secondary" htmlFor="b-month">Month</label>
            <select id="b-month" value={form.month} onChange={updateForm('month')} className={inputClass}>
              {MONTHS.map((name, index) => (
                <option key={name} value={index + 1}>{name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-secondary" htmlFor="b-year">Year</label>
            <input
              id="b-year" type="number" min="2000" max="2100" required
              value={form.year} onChange={updateForm('year')} className={inputClass}
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="flex-1 rounded bg-series-income px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              {editingId ? 'Save' : 'Create'}
            </button>
            {editingId && (
              <button
                type="button" onClick={cancelEdit}
                className="rounded border border-hairline px-3 py-2 text-sm text-ink-secondary hover:text-ink-primary"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </Card>

      <Card title="Your budgets">
        {loading ? (
          <p className="py-8 text-center text-sm text-ink-muted">Loading…</p>
        ) : budgets.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">
            No budgets yet. Create one above to start tracking.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                  <th className="py-2 font-medium">Category</th>
                  <th className="py-2 font-medium">Period</th>
                  <th className="py-2 text-right font-medium">Monthly limit</th>
                  <th className="py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {budgets.map((b) => (
                  <tr key={b.id} className="border-b border-hairline/60">
                    <td className="py-2 text-ink-primary">{b.category}</td>
                    <td className="py-2 text-ink-secondary">
                      {MONTHS[b.month - 1]} {b.year}
                    </td>
                    <td className="py-2 text-right font-medium text-ink-primary">
                      {formatCurrency(b.amount)}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button" onClick={() => startEdit(b)}
                        className="mr-3 text-xs text-series-income hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button" onClick={() => handleDelete(b.id)}
                        className="text-xs text-status-critical hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
