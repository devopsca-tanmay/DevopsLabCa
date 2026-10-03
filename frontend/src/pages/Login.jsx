import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Alert from '../components/Alert.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    const result = await login(email, password);
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
        <p className="mb-6 text-center text-sm text-ink-muted">Sign in to your account</p>

        <form onSubmit={handleSubmit} className="rounded-lg border border-hairline bg-surface p-6">
          <Alert kind="error">{error}</Alert>

          <label className="mb-1 block text-sm font-medium text-ink-secondary" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-4 w-full rounded border border-hairline px-3 py-2 text-sm outline-none focus:border-series-income"
          />

          <label className="mb-1 block text-sm font-medium text-ink-secondary" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-5 w-full rounded border border-hairline px-3 py-2 text-sm outline-none focus:border-series-income"
          />

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-series-income px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-secondary">
          No account?{' '}
          <Link to="/register" className="font-medium text-series-income hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
