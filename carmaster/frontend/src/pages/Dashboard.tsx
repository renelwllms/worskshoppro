import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import api from '../api/client';
import { PortalShell } from '../components/PortalShell';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import { Area, AreaChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const StatCard = ({ title, value, detail }: { title: string; value: string | number; detail?: string }) => (
  <div className="bg-white/5 border border-white/10 rounded-2xl p-4 shadow-soft">
    <p className="text-white/60 text-sm">{title}</p>
    <p className="text-3xl font-semibold text-brand-primary">{value}</p>
    {detail && <p className="text-xs text-white/50 mt-1">{detail}</p>}
  </div>
);

const COLORS = ['#f4c430', '#4ade80', '#60a5fa', '#f87171', '#a78bfa', '#fb923c', '#fbbf24', '#34d399'];

export const DashboardPage = () => {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get('/jobs/dashboard')).data,
  });

  const { data: allJobs } = useQuery({
    queryKey: ['all-jobs-for-stats'],
    queryFn: async () => (await api.get('/jobs')).data,
  });

  // Calculate vehicle statistics from all jobs
  const vehicleStats = useMemo(() => {
    if (!allJobs) return [];

    // Count jobs per vehicle brand
    const brandCount: Record<string, { brand: string; count: number; customer: string }> = {};

    allJobs.forEach((job: any) => {
      const brand = (job.vehicle?.vehicleBrand || job.customer?.vehicleBrand || '').trim();
      if (!brand) return;
      if (!brandCount[brand]) {
        brandCount[brand] = {
          brand,
          count: 0,
          customer: `${job.customer?.firstName || ''} ${job.customer?.lastName || ''}`.trim(),
        };
      }
      brandCount[brand].count++;
    });

    // Convert to array and sort by count
    return Object.values(brandCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8) // Top 8 vehicles
      .map((item) => ({
        name: item.brand,
        value: item.count,
        customer: item.customer,
      }));
  }, [allJobs]);

  if (isLoading) {
    return (
      <PortalShell>
        <LoadingSpinner message="Loading dashboard..." />
      </PortalShell>
    );
  }

  if (error) {
    return (
      <PortalShell>
        <ErrorMessage
          message="Failed to load dashboard data. Please try again."
          onRetry={() => refetch()}
        />
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/60">Welcome back</p>
            <h1 className="text-2xl font-semibold">Workshop Pulse</h1>
          </div>
          <span className="px-3 py-1 rounded-full bg-brand-primary text-black text-xs font-semibold hidden sm:inline">
            Mobile-first PWA ready
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard title="Jobs this month" value={data?.currentMonthCount ?? 0} detail="Created in current month" />
          <StatCard title="Overdue items" value={data?.overdue?.length ?? 0} detail="Due date has passed" />
          <StatCard title="Vehicle brands" value={vehicleStats.length} detail="Most serviced this year" />
        </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Jobs per Month Chart */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold">Jobs per month</p>
              <p className="text-xs text-white/50">last 12 months</p>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.monthlyTrend ?? []}>
                  <defs>
                    <linearGradient id="colorJobs" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f4c430" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#f4c430" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="month" stroke="#888" />
                  <YAxis stroke="#888" allowDecimals={false} />
                  <Tooltip
                    wrapperStyle={{ zIndex: 30 }}
                    contentStyle={{ backgroundColor: '#111', border: '1px solid #333', color: '#f9fafb' }}
                    labelStyle={{ color: '#f9fafb' }}
                    itemStyle={{ color: '#f9fafb' }}
                  />
                  <Area type="monotone" dataKey="count" stroke="#f4c430" fillOpacity={1} fill="url(#colorJobs)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Most Serviced Vehicles Pie Chart */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold">Most serviced vehicles</p>
              <p className="text-xs text-white/50">top 8 by job count</p>
            </div>
            {vehicleStats.length > 0 ? (
              <div className="h-64 flex items-stretch">
                <div className="flex-1 h-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={vehicleStats}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }: any) => `${name} (${((percent || 0) * 100).toFixed(0)}%)`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {vehicleStats.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        wrapperStyle={{ zIndex: 30 }}
                        contentStyle={{ backgroundColor: '#111', border: '1px solid #333', color: '#f9fafb' }}
                        labelStyle={{ color: '#f9fafb' }}
                        itemStyle={{ color: '#f9fafb' }}
                        formatter={(value: any, _name: any, props: any) => [
                          `${value} jobs (${props.payload.customer})`,
                          props.payload.name,
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-shrink-0 ml-4 space-y-1">
                  {vehicleStats.map((item, index) => (
                    <div key={item.name} className="flex items-center gap-2 text-xs">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span className="text-white/80">
                        {item.name}: <span className="font-semibold">{item.value}</span> jobs
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-white/40">
                <p className="text-sm">No vehicle data available yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Overdue Warnings */}
        {data?.overdue?.length ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
            <p className="font-semibold text-red-200 mb-2">Overdue warnings</p>
            <div className="space-y-2">
              {data.overdue.map((job: any) => (
                <div key={job.id} className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-semibold">{job.title}</p>
                    <p className="text-white/60">
                      {job.customer.firstName} {job.customer.lastName} • {job.vehicle?.rego || job.customer.rego}
                    </p>
                  </div>
                  <span className="text-xs text-red-200">
                    Due {new Date(job.dueDate).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </PortalShell>
  );
};
