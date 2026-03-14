import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { Link, NavLink } from 'react-router-dom';
import { navItems } from './BottomNav';

type AutoReminderStatus = {
  enabled: boolean;
  isRunning: boolean;
  intervalMinutes: number;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  lastResult: {
    matched: number;
    sent: number;
    failed: number;
  } | null;
};

const formatStatusTime = (value?: string | null) => {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString('en-NZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const TopBar = () => {
  const { user, logout } = useAuth();
  const { data: autoReminderStatus } = useQuery<AutoReminderStatus>({
    queryKey: ['auto-reminder-status'],
    enabled: Boolean(user),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
    queryFn: async () =>
      (await api.get('/service-schedules/reminders/renewals/status')).data as AutoReminderStatus,
  });

  const autoReminderLabel = !autoReminderStatus
    ? 'Auto reminders: checking'
    : !autoReminderStatus.enabled
      ? 'Auto reminders: off'
      : autoReminderStatus.isRunning
        ? 'Auto reminders: running'
        : autoReminderStatus.lastError
          ? 'Auto reminders: error'
          : 'Auto reminders: active';

  const autoReminderBadgeClass = !autoReminderStatus
    ? 'bg-white/10 text-white/70 border-white/10'
    : !autoReminderStatus.enabled
      ? 'bg-white/10 text-white/70 border-white/10'
      : autoReminderStatus.isRunning
        ? 'bg-blue-500/20 text-blue-200 border-blue-400/30'
        : autoReminderStatus.lastError
          ? 'bg-red-500/20 text-red-200 border-red-400/30'
          : 'bg-green-500/20 text-green-200 border-green-400/30';

  const autoReminderTitle = autoReminderStatus
    ? `Last success: ${formatStatusTime(autoReminderStatus.lastSuccessAt)} • Next run: ${formatStatusTime(autoReminderStatus.nextRunAt)}${
        autoReminderStatus.lastError ? ` • Last error: ${autoReminderStatus.lastError}` : ''
      }`
    : 'Checking automatic reminder runner status...';

  return (
    <header className="sticky top-0 z-20 bg-[#0a0a0a]/80 backdrop-blur border-b border-white/5 px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center gap-4">
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="w-10 h-10 rounded-full bg-brand-primary text-black font-bold grid place-items-center shadow-soft">
          CM
        </div>
        <div>
          <p className="text-white font-semibold text-sm leading-tight">Carmaster</p>
          <p className="text-xs text-white/60 leading-tight">powered by Workshop Pro</p>
        </div>
      </div>

      <nav className="w-full sm:flex-1 flex flex-wrap sm:flex-nowrap items-center gap-2 text-sm text-white overflow-x-auto sm:overflow-visible">
        {navItems
          .filter((item) => !item.adminOnly || user?.role === 'admin')
          .map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-full border transition ${
                  isActive
                    ? 'bg-brand-primary/15 text-brand-primary border-brand-primary/30'
                    : 'bg-white/5 text-white/80 border-white/10 hover:bg-white/10'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
      </nav>

      <div className="flex items-center gap-2 text-white text-sm sm:ml-auto">
        <span
          title={autoReminderTitle}
          className={`px-3 py-1.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${autoReminderBadgeClass}`}
        >
          {autoReminderLabel}
        </span>
        {user && <span className="hidden sm:block text-white/70">{user.displayName}</span>}
        {user ? (
          <button
            onClick={logout}
            className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-xs border border-white/10 transition"
          >
            Logout
          </button>
        ) : (
          <Link to="/login" className="text-brand-primary font-semibold">
            Login
          </Link>
        )}
      </div>
    </header>
  );
};
