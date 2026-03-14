import type { FormEvent } from 'react';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Navigate, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useQuery } from '@tanstack/react-query';

export const LoginPage = () => {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@carmaster.co.nz');
  const [password, setPassword] = useState('ChangeMe123!');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { data: publicConfig } = useQuery({
    queryKey: ['public-config'],
    queryFn: async () => (await api.get('/public/config')).data,
  });
  const businessName = publicConfig?.businessName || 'Carmaster';
  const logoUrl = publicConfig?.logoUrl;

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError('Login failed. Check credentials.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loginWithAzure = async () => {
    const { data } = await api.get('/auth/azure/login-url');
    window.location.href = data.url;
  };

  if (user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0d0d0d] to-black text-white flex items-center justify-center px-4">
      <div className="w-full max-w-md glass rounded-2xl p-6 border border-white/10">
        <div className="flex items-center gap-3 mb-4">
          {logoUrl ? (
            <div className="w-12 h-12 rounded-full bg-white/10 border border-white/10 grid place-items-center overflow-hidden p-1">
              <img src={logoUrl} alt={`${businessName} logo`} className="w-full h-full object-contain" />
            </div>
          ) : (
            <div className="w-12 h-12 rounded-full bg-brand-primary text-black font-bold grid place-items-center">CM</div>
          )}
          <div>
            <p className="text-sm text-white/60">{businessName}</p>
            <p className="text-xl font-semibold">Staff Portal</p>
          </div>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-sm text-white/70">Email</label>
            <input
              className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 focus:outline-none focus:border-brand-primary"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              required
            />
          </div>
          <div>
            <label className="text-sm text-white/70">Password</label>
            <input
              className="w-full mt-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 focus:outline-none focus:border-brand-primary"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              required
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-primary text-black font-semibold py-2 rounded-xl shadow-soft hover:opacity-90 transition"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
        <div className="mt-4">
          <button
            onClick={loginWithAzure}
            className="w-full border border-white/20 text-white py-2 rounded-xl hover:border-brand-primary transition"
          >
            Sign in with Office 365
          </button>
        </div>
        <p className="text-xs text-white/50 mt-3">Restricting sign-ins to @carmaster.co.nz</p>
        <p className="text-xs text-white/45 mt-2 text-center">Powered by Workshop Pro, created by Edgepoint.</p>
      </div>
    </div>
  );
};
