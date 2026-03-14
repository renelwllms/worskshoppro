import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import api from '../api/client';
import { EmptyState } from '../components/EmptyState';
import { ErrorMessage } from '../components/ErrorMessage';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { PortalShell } from '../components/PortalShell';
import { useToast } from '../context/ToastContext';

type ScheduleView = 'all' | 'overdue' | 'upcoming';
type ReminderChannel = 'EMAIL' | 'SMS';

type ScheduleItem = {
  id: string;
  type: 'SERVICE' | 'WOF' | 'REGO';
  typeLabel: string;
  title: string;
  dueDate: string;
  daysUntil: number;
  bucket: 'overdue' | 'upcoming' | 'future';
  lastReminderAt: string | null;
  reminderCount: number;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    rego: string;
  };
  sourceJob: {
    id: string;
    title: string;
    serviceType: string | null;
    createdAt: string;
  } | null;
};

type ScheduleResponse = {
  daysAhead: number;
  counts: {
    overdue: number;
    upcoming: number;
    future: number;
    total: number;
  };
  items: ScheduleItem[];
};

type ReminderFailureSample = {
  scheduleId: string;
  channel: ReminderChannel;
  customerName: string;
  rego: string;
  reason: string;
};

type SendRemindersResult = {
  attempted: number;
  sent: number;
  failed: number;
  sentByChannel?: Record<string, number>;
  failedByReason?: Record<string, number>;
  failureSamples?: ReminderFailureSample[];
};

type AutoRenewalResult = {
  checked: number;
  matched: number;
  attempted: number;
  sent: number;
  failed: number;
  skippedDuplicates: number;
  skippedNoEmail: number;
  reminderDays: number[];
};

const formatDate = (value: string | null) => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const ServiceSchedulePage = () => {
  const [view, setView] = useState<ScheduleView>('all');
  const [daysAhead, setDaysAhead] = useState(7);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [channels, setChannels] = useState<ReminderChannel[]>(['EMAIL']);
  const [reminderErrorDialog, setReminderErrorDialog] = useState<{
    summary: string;
    reasons: Array<{ reason: string; count: number }>;
    samples: ReminderFailureSample[];
  } | null>(null);
  const { showToast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery<ScheduleResponse>({
    queryKey: ['service-schedules', view, daysAhead],
    queryFn: async () =>
      (await api.get('/service-schedules', { params: { view, daysAhead } })).data as ScheduleResponse,
  });

  const sendReminders = useMutation({
    mutationFn: async (payload: {
      scheduleIds?: string[];
      daysAhead: number;
      includeOverdue?: boolean;
      channels: ReminderChannel[];
    }) =>
      (await api.post('/service-schedules/reminders/send', payload)).data as SendRemindersResult,
    onSuccess: (result: SendRemindersResult) => {
      const emailSent = result.sentByChannel?.EMAIL ?? 0;
      const smsSent = result.sentByChannel?.SMS ?? 0;
      if (result.failed > 0) {
        const reasons = Object.entries(result.failedByReason || {})
          .sort((a, b) => b[1] - a[1])
          .map(([reason, count]) => ({ reason, count }));
        const summary = `Processed ${result.attempted}: ${result.sent} sent (${emailSent} email, ${smsSent} sms), ${result.failed} failed.`;
        setReminderErrorDialog({
          summary,
          reasons: reasons.length ? reasons : [{ reason: 'Unknown reason', count: result.failed }],
          samples: result.failureSamples || [],
        });
      } else {
        showToast(`Processed ${result.attempted}: ${result.sent} sent (${emailSent} email, ${smsSent} sms), 0 failed`);
      }
      setSelectedIds([]);
      qc.invalidateQueries({ queryKey: ['service-schedules'] });
    },
    onError: (mutationError: unknown) => {
      console.error(mutationError);
      setReminderErrorDialog({
        summary: 'The reminder request failed before processing.',
        reasons: [{ reason: 'Request failed (network/server error)', count: 1 }],
        samples: [],
      });
    },
  });

  const runAutoRenewals = useMutation({
    mutationFn: async () => (await api.post('/service-schedules/reminders/renewals/run')).data as AutoRenewalResult,
    onSuccess: (result) => {
      showToast(
        `Auto renewal run complete: matched ${result.matched}, sent ${result.sent}, failed ${result.failed}, duplicates skipped ${result.skippedDuplicates}`,
      );
      qc.invalidateQueries({ queryKey: ['service-schedules'] });
    },
    onError: (mutationError: any) => {
      const message = mutationError?.response?.data?.message || 'Failed to run auto renewal reminders';
      showToast(message, 'error');
    },
  });

  const scheduleItems = data?.items ?? [];
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = scheduleItems.length > 0 && scheduleItems.every((item) => selectedSet.has(item.id));

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => prev.filter((id) => !scheduleItems.some((item) => item.id === id)));
      return;
    }
    setSelectedIds((prev) => {
      const combined = new Set(prev);
      scheduleItems.forEach((item) => combined.add(item.id));
      return Array.from(combined);
    });
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]));
  };

  const toggleChannel = (channel: ReminderChannel) => {
    setChannels((prev) => {
      if (prev.includes(channel)) {
        if (prev.length === 1) return prev;
        return prev.filter((entry) => entry !== channel);
      }
      return [...prev, channel];
    });
  };

  if (isLoading) {
    return (
      <PortalShell>
        <LoadingSpinner message="Loading service schedules..." />
      </PortalShell>
    );
  }

  if (error) {
    return (
      <PortalShell>
        <ErrorMessage message="Failed to load schedules. Please try again." onRetry={() => refetch()} />
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-white/60">Customer retention</p>
            <h1 className="text-2xl font-semibold">Service Schedule</h1>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-white/60">Upcoming window (days)</label>
            <input
              type="number"
              min={1}
              max={60}
              value={daysAhead}
              onChange={(e) => {
                const parsed = Number(e.target.value);
                setDaysAhead(Number.isFinite(parsed) ? Math.min(60, Math.max(1, parsed)) : 7);
              }}
              className="input w-20"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => {
              setView('all');
              setSelectedIds([]);
            }}
            className={`rounded-xl border px-4 py-3 text-left ${
              view === 'all' ? 'border-brand-primary bg-brand-primary/10' : 'border-white/10 bg-white/5'
            }`}
          >
            <p className="text-xs text-white/60">All</p>
            <p className="text-xl font-semibold">{data?.counts.total ?? 0}</p>
          </button>
          <button
            type="button"
            onClick={() => {
              setView('overdue');
              setSelectedIds([]);
            }}
            className={`rounded-xl border px-4 py-3 text-left ${
              view === 'overdue' ? 'border-red-400 bg-red-500/10' : 'border-white/10 bg-white/5'
            }`}
          >
            <p className="text-xs text-white/60">Overdue</p>
            <p className="text-xl font-semibold">{data?.counts.overdue ?? 0}</p>
          </button>
          <button
            type="button"
            onClick={() => {
              setView('upcoming');
              setSelectedIds([]);
            }}
            className={`rounded-xl border px-4 py-3 text-left ${
              view === 'upcoming' ? 'border-amber-300 bg-amber-300/10' : 'border-white/10 bg-white/5'
            }`}
          >
            <p className="text-xs text-white/60">Upcoming ({daysAhead}d)</p>
            <p className="text-xl font-semibold">{data?.counts.upcoming ?? 0}</p>
          </button>
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-xs text-white/60">Future</p>
            <p className="text-xl font-semibold">{data?.counts.future ?? 0}</p>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 text-sm text-white/80 px-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={channels.includes('EMAIL')}
                onChange={() => toggleChannel('EMAIL')}
              />
              Email
            </label>
            <label className="flex items-center gap-2 text-sm text-white/80 px-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={channels.includes('SMS')}
                onChange={() => toggleChannel('SMS')}
              />
              SMS
            </label>
            <button
              type="button"
              onClick={() => sendReminders.mutate({ scheduleIds: selectedIds, daysAhead, includeOverdue: true, channels })}
              disabled={sendReminders.isPending || selectedIds.length === 0 || channels.length === 0}
              className="px-3 py-2 rounded-xl bg-brand-primary text-black text-sm font-semibold disabled:opacity-50"
            >
              {sendReminders.isPending ? 'Sending...' : `Send reminders (${selectedIds.length} selected)`}
            </button>
            <button
              type="button"
              onClick={() =>
                sendReminders.mutate({
                  scheduleIds: scheduleItems.map((item) => item.id),
                  daysAhead,
                  includeOverdue: true,
                  channels,
                })
              }
              disabled={sendReminders.isPending || scheduleItems.length === 0 || channels.length === 0}
              className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-sm font-semibold disabled:opacity-50"
            >
              Send all in current view ({scheduleItems.length})
            </button>
            <button
              type="button"
              onClick={() => runAutoRenewals.mutate()}
              disabled={runAutoRenewals.isPending}
              className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-sm font-semibold disabled:opacity-50"
            >
              {runAutoRenewals.isPending ? 'Running auto renewals...' : 'Run auto renewals now (14/7 day WOF/Rego)'}
            </button>
          </div>

          {scheduleItems.length === 0 ? (
            <EmptyState message="No schedules found for this view." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-white/60 border-b border-white/10">
                    <th className="py-2 pr-2">
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
                    </th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Customer</th>
                    <th className="py-2 pr-3">Rego</th>
                    <th className="py-2 pr-3">Due</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Last reminder</th>
                    <th className="py-2">Email</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleItems.map((item) => (
                    <tr key={item.id} className="border-b border-white/5">
                      <td className="py-2 pr-2 align-top">
                        <input
                          type="checkbox"
                          checked={selectedSet.has(item.id)}
                          onChange={() => toggleOne(item.id)}
                        />
                      </td>
                      <td className="py-2 pr-3 align-top">{item.typeLabel}</td>
                      <td className="py-2 pr-3 align-top">
                        {item.customer.firstName} {item.customer.lastName}
                      </td>
                      <td className="py-2 pr-3 align-top">{item.customer.rego}</td>
                      <td className="py-2 pr-3 align-top">
                        {formatDate(item.dueDate)}
                        <div className="text-xs text-white/60">
                          {item.daysUntil < 0 ? `${Math.abs(item.daysUntil)} days overdue` : `in ${item.daysUntil} days`}
                        </div>
                      </td>
                      <td className="py-2 pr-3 align-top">
                        <span
                          className={`px-2 py-1 rounded-full text-xs ${
                            item.bucket === 'overdue'
                              ? 'bg-red-500/20 text-red-200'
                              : item.bucket === 'upcoming'
                                ? 'bg-amber-300/20 text-amber-100'
                                : 'bg-white/10 text-white/80'
                          }`}
                        >
                          {item.bucket}
                        </span>
                      </td>
                      <td className="py-2 pr-3 align-top">
                        {formatDate(item.lastReminderAt)}
                        <div className="text-xs text-white/60">{item.reminderCount} sent</div>
                      </td>
                      <td className="py-2 align-top break-all">{item.customer.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {reminderErrorDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="bg-[#0d0d0d] border border-red-500/30 rounded-2xl p-5 max-w-2xl w-full shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-red-200">Reminder Send Errors</h3>
                  <p className="text-sm text-white/70 mt-1">{reminderErrorDialog.summary}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setReminderErrorDialog(null)}
                  className="px-2 py-1 text-sm rounded-lg bg-white/10 border border-white/10 text-white"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 space-y-2">
                <p className="text-xs uppercase tracking-wide text-white/60">Failure reasons</p>
                <div className="space-y-1">
                  {reminderErrorDialog.reasons.map((entry) => (
                    <div key={`${entry.reason}-${entry.count}`} className="text-sm text-white/90">
                      {entry.reason} ({entry.count})
                    </div>
                  ))}
                </div>
              </div>

              {reminderErrorDialog.samples.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs uppercase tracking-wide text-white/60">Failed records</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {reminderErrorDialog.samples.map((sample) => (
                      <div
                        key={`${sample.scheduleId}-${sample.channel}`}
                        className="text-sm text-white/90 border border-white/10 rounded-lg px-3 py-2 bg-white/5"
                      >
                        {sample.channel} | {sample.customerName} | {sample.rego} | {sample.reason}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </PortalShell>
  );
};
