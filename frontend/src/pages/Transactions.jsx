import { useCallback, useEffect, useState } from 'react';
import client, { errorMessage } from '../api/client.js';
import Card from '../components/Card.jsx';
import Alert from '../components/Alert.jsx';
import { formatCurrency, formatDate, todayIso } from '../utils/format.js';

const INCOME_CATEGORIES = ['Salary', 'Freelance', 'Investment', 'Gift', 'Other Income'];
const EXPENSE_CATEGORIES = [
  'Food', 'Transport', 'Shopping', 'Bills', 'Entertainment',
  'Health', 'Education', 'Rent', 'Other Expense',
];

const EMPTY_FORM = {
  type: 'expense',
  amount: '',
  category: 'Food',
  description: '',
  transaction_date: todayIso(),
};

export default function Transactions() {
  const [transactions, setTransactions] = useState([]);
  const [filters, setFilters] = useState({ type: '', category: '', from: '', to: '' });
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError('');
    try {
      // Only non-empty filters are sent, so the API applies exactly what the
      // user selected.
      const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
      const { data } = await client.get('/transactions', { params });
      setTransactions(data.transactions);
    } catch (err) {
      setError(errorMessage(err, 'Could not load transactions'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  function updateForm(field) {
    return (event) => {
      const value = event.target.value;
      setForm((prev) => {
        // Switching type swaps the category list, so reset to a valid default.
        if (field === 'type') {
          const list = value === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
          return { ...prev, type: value, category: list[0] };
        }
        return { ...prev, [field]: value };
      });
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setNotice('');

    const payload = { ...form, amount: Number(form.amount) };

    try {
      if (editingId) {
        await client.put(`/transactions/${editingId}`, payload);
        setNotice('Transaction updated');
      } else {
        await client.post('/transactions', payload);
        setNotice('Transaction added');
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not save the transaction'));
    }
  }

  function startEdit(transaction) {
    setEditingId(transaction.id);
    setForm({
      type: transaction.type,
      amount: String(transaction.amount),
      category: transaction.category,
      description: transaction.description || '',
      transaction_date: transaction.transaction_date,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleDelete(id) {
    setError('');
    setNotice('');
    try {
      await client.delete(`/transactions/${id}`);
      setNotice('Transaction deleted');
      if (editingId === id) cancelEdit();
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Could not delete the transaction'));
    }
  }

  const categories = form.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const inputClass =
    'w-full rounded border border-hairline px-3 py-2 text-sm outline-none focus:border-series-income';

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold tracking-tight text-ink-primary">Transactions</h1>

      <Alert kind="error">{error}</Alert>
      <Alert kind="success">{notice}</Alert>

      <Card title={editingId ? 'Edit transaction' : 'Add a transaction'}>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <label className="mb-1 block text-xs text-ink-secondary" htmlFor="type">Type</label>
            <select id="type" value={form.type} onChange={updateForm('type')} className={inputClass}>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-secondary" htmlFor="amount">Amount</label>
            <input
              id="amount" type="number" step="0.01" min="0.01" required
              value={form.amount} onChange={updateForm('amount')} className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-secondary" htmlFor="category">Category</label>
            <select id="category" value={form.category} onChange={updateForm('category')} className={inputClass}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-secondary" htmlFor="date">Date</label>
            <input
              id="date" type="date" required
              value={form.transaction_date} onChange={updateForm('transaction_date')} className={inputClass}
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-1">
            <label className="mb-1 block text-xs text-ink-secondary" htmlFor="description">Description</label>
            <input
              id="description" value={form.description}
              onChange={updateForm('description')} className={inputClass}
            />
          </div>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="flex-1 rounded bg-series-income px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              {editingId ? 'Save' : 'Add'}
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

      {/* Filters sit in one row above the data they filter. */}
      <Card title="History">
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs text-ink-secondary" htmlFor="f-type">Type</label>
            <select
              id="f-type" value={filters.type}
              onChange={(e) => setFilters((p) => ({ ...p, type: e.target.value }))}
              className={inputClass}
            >
              <option value="">All</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-secondary" htmlFor="f-category">Category</label>
            <select
              id="f-category" value={filters.category}
              onChange={(e) => setFilters((p) => ({ ...p, category: e.target.value }))}
              className={inputClass}
            >
              <option value="">All</option>
              {[...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-secondary" htmlFor="f-from">From</label>
            <input
              id="f-from" type="date" value={filters.from}
              onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))}
              className={inputClass}
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-ink-secondary" htmlFor="f-to">To</label>
            <input
              id="f-to" type="date" value={filters.to}
              onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))}
              className={inputClass}
            />
          </div>

          <div className="flex items-end">
            <button
              type="button"
              onClick={() => setFilters({ type: '', category: '', from: '', to: '' })}
              className="w-full rounded border border-hairline px-3 py-2 text-sm text-ink-secondary hover:text-ink-primary"
            >
              Clear filters
            </button>
          </div>
        </div>

        {loading ? (
          <p className="py-8 text-center text-sm text-ink-muted">Loading…</p>
        ) : transactions.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-muted">
            No transactions match these filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-xs text-ink-muted">
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Category</th>
                  <th className="py-2 font-medium">Description</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                  <th className="py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {transactions.map((t) => (
                  <tr key={t.id} className="border-b border-hairline/60">
                    <td className="py-2 text-ink-secondary">{formatDate(t.transaction_date)}</td>
                    <td className="py-2">
                      {/* The type is a word, not a colour - it reads the same
                          in greyscale or forced-colors mode. */}
                      <span className="text-ink-secondary">
                        {t.type === 'income' ? 'Income' : 'Expense'}
                      </span>
                    </td>
                    <td className="py-2 text-ink-secondary">{t.category}</td>
                    <td className="py-2 text-ink-muted">{t.description || '—'}</td>
                    <td className="py-2 text-right font-medium text-ink-primary">
                      {t.type === 'income' ? '+' : '−'}{formatCurrency(t.amount, true)}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button" onClick={() => startEdit(t)}
                        className="mr-3 text-xs text-series-income hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button" onClick={() => handleDelete(t.id)}
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
