import { useState } from 'react';
import { useAuthStore } from '../store';

export default function LoginScreen() {
  const login = useAuthStore(s => s.login);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const ok = await login(password);
    if (!ok) setError('Invalid password');
    setLoading(false);
  };

  return (
    <div className="hero min-h-screen bg-base-200">
      <div className="hero-content flex-col">
        <div className="text-center">
          <h1 className="text-4xl font-bold">ccremote</h1>
          <p className="py-2 text-base-content/60">Sign in to manage your Claude Code sessions</p>
        </div>
        <div className="card w-96 bg-base-100 shadow-xl">
          <form className="card-body" onSubmit={handleSubmit}>
            <div className="form-control">
              <label className="label"><span className="label-text">Password</span></label>
              <input
                type="password"
                className="input input-bordered"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoFocus
              />
            </div>
            {error && <div className="alert alert-error text-sm py-2">{error}</div>}
            <div className="form-control mt-4">
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? <span className="loading loading-spinner" /> : 'Sign in'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
