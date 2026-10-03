import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Alert from '../components/Alert.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function update(field) {
    return (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    // Mirror of the server-side rule, so the user gets feedback without a
    // round trip. The server still enforces it - this is convenience only.
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setSubmitting(true);
    const result = await register(form.name, form.email, form.password);
    setSubmitting(false);

    if (result.ok) navigate('/dashboard', { replace: true });
    else setError(result.message);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-plane px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-semibold tracking-tight text-ink-primary">
          FinTrack
        </h1>
        <p className="mb-6 text-center text-sm text-ink-muted">Create your account</p>

        <form onSubmit={handleSubmit} className="rounded-lg border border-hairline bg-surface p-6">
          <Alert kind="error">{error}</Alert>

          <label className="mb-1 block text-sm font-medium text-ink-secondary" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            required
            autoComplete="name"
            value={form.name}
            onChange={update('name')}
            className="mb-4 w-full rounded border border-hairline px-3 py-2 text-sm outline-none focus:border-series-income"
          />

          <label className="mb-1 block text-sm font-medium text-ink-secondary" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={update('email')}
            className="mb-4 w-full rounded border border-hairline px-3 py-2 text-sm outline-none focus:border-series-income"
          />

          <label className="mb-1 block text-sm font-medium text-ink-secondary" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={form.password}
            onChange={update('password')}
            className="mb-1 w-full rounded border border-hairline px-3 py-2 text-sm outline-none focus:border-series-income"
          />
          <p className="mb-5 text-xs text-ink-muted">At least 8 characters.</p>

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-series-income px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-secondary">
          Already registered?{' '}
          <Link to="/login" className="font-medium text-series-income hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
