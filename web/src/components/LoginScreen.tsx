import { useState } from 'react';
import { useAuthStore } from '../store';
import { Cable, KeyRound, LogIn } from 'lucide-react';

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
          <div className="flex items-center justify-center gap-3 mb-2">
            <Cable size={36} className="text-primary" />
            <h1 className="text-4xl font-bold">Claude Code Remote</h1>
          </div>
          <p className="py-2 text-base-content/60">Sign in to manage your Claude Code sessions</p>
        </div>
        <div className="card w-96 bg-base-100 shadow-xl">
          <form className="card-body" onSubmit={handleSubmit}>
            <div className="form-control">
              <label className="label">
                <span className="label-text flex items-center gap-1.5">
                  <KeyRound size={14} />
                  Password
                </span>
              </label>
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
              <button className="btn btn-primary gap-2" type="submit" disabled={loading}>
                {loading ? <span className="loading loading-spinner" /> : <><LogIn size={16} /> Sign in</>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
