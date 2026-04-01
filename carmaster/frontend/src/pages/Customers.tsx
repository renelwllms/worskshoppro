import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { PortalShell } from '../components/PortalShell';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import { EmptyState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../context/ToastContext';

type CustomerJob = {
  id: string;
  title: string;
  serviceType: string | null;
  createdAt: string;
  wofExpiryDate: string | null;
  regoExpiryDate: string | null;
};

type CustomerRow = {
  id: string;
  rego: string;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  createdAt: string;
  updatedAt: string;
  jobs: CustomerJob[];
  vehicles?: Array<{
    id: string;
    rego: string;
    vehicleBrand: string | null;
    vehicleModel: string | null;
  }>;
};

type CustomerGroup = {
  id: string;
  primary: CustomerRow;
  memberIds: string[];
  regos: string[];
  jobs: CustomerJob[];
};

type OverdueServiceItem = {
  id: string;
  type: 'SERVICE' | 'WOF' | 'REGO';
  dueDate: string;
  daysUntil: number;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    rego: string;
  };
};

type OverdueSchedulesResponse = {
  items: OverdueServiceItem[];
};

type UpdateCustomerPayload = {
  id: string;
  rego: string;
  vehicleBrand: string | null;
  vehicleModel: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
};

type ColumnKey =
  | 'vehicle'
  | 'phone'
  | 'email'
  | 'serviceStatus'
  | 'lastJob'
  | 'wofExpiry'
  | 'regoExpiry'
  | 'updated';
type ColumnWidthKey = 'rego' | 'customer' | ColumnKey;

const COLUMN_OPTIONS: { key: ColumnKey; label: string }[] = [
  { key: 'vehicle', label: 'Vehicle' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'serviceStatus', label: 'Service Status' },
  { key: 'lastJob', label: 'Last Job' },
  { key: 'wofExpiry', label: 'WOF Expiry' },
  { key: 'regoExpiry', label: 'Rego Expiry' },
  { key: 'updated', label: 'Updated' },
];

const DEFAULT_VISIBLE_COLUMNS: Record<ColumnKey, boolean> = {
  vehicle: true,
  phone: true,
  email: true,
  serviceStatus: true,
  lastJob: true,
  wofExpiry: true,
  regoExpiry: true,
  updated: true,
};

const COLUMN_PREFS_KEY = 'cma_customers_visible_columns_v1';
const COLUMN_WIDTH_PREFS_KEY = 'cma_customers_column_widths_v1';
const REGO_COLUMN_WIDTH = 140;
const CUSTOMER_COLUMN_WIDTH = 260;
const ACTIONS_COLUMN_WIDTH = 140;
const MAX_COLUMN_WIDTH = 460;
const GRID_GAP_PX = 16;
const DEFAULT_COLUMN_WIDTHS: Record<ColumnWidthKey, number> = {
  rego: REGO_COLUMN_WIDTH,
  customer: CUSTOMER_COLUMN_WIDTH,
  vehicle: 170,
  phone: 150,
  email: 240,
  serviceStatus: 210,
  lastJob: 180,
  wofExpiry: 140,
  regoExpiry: 140,
  updated: 150,
};
const MIN_COLUMN_WIDTHS: Record<ColumnWidthKey, number> = {
  rego: 110,
  customer: 180,
  vehicle: 140,
  phone: 120,
  email: 180,
  serviceStatus: 160,
  lastJob: 150,
  wofExpiry: 120,
  regoExpiry: 120,
  updated: 120,
};

const loadVisibleColumns = (): Record<ColumnKey, boolean> => {
  if (typeof window === 'undefined') return DEFAULT_VISIBLE_COLUMNS;
  try {
    const raw = window.localStorage.getItem(COLUMN_PREFS_KEY);
    if (!raw) return DEFAULT_VISIBLE_COLUMNS;
    const parsed = JSON.parse(raw) as Partial<Record<ColumnKey, boolean>>;
    return {
      ...DEFAULT_VISIBLE_COLUMNS,
      ...parsed,
    };
  } catch {
    return DEFAULT_VISIBLE_COLUMNS;
  }
};

const clampColumnWidth = (key: ColumnWidthKey, width: number) =>
  Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTHS[key], Math.round(width)));

const loadColumnWidths = (): Record<ColumnWidthKey, number> => {
  if (typeof window === 'undefined') return DEFAULT_COLUMN_WIDTHS;
  try {
    const raw = window.localStorage.getItem(COLUMN_WIDTH_PREFS_KEY);
    if (!raw) return DEFAULT_COLUMN_WIDTHS;
    const parsed = JSON.parse(raw) as Partial<Record<ColumnWidthKey, number>>;
    const merged = { ...DEFAULT_COLUMN_WIDTHS, ...parsed };
    const normalized = { ...DEFAULT_COLUMN_WIDTHS };
    for (const key of Object.keys(DEFAULT_COLUMN_WIDTHS) as ColumnWidthKey[]) {
      const rawWidth = Number(merged[key]);
      normalized[key] = Number.isFinite(rawWidth)
        ? clampColumnWidth(key, rawWidth)
        : DEFAULT_COLUMN_WIDTHS[key];
    }
    return normalized;
  } catch {
    return DEFAULT_COLUMN_WIDTHS;
  }
};

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString('en-NZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const toTimestamp = (value?: string | null) => {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

const normalizePhone = (value?: string | null) => (value || '').replace(/\D/g, '');
const normalizeEmail = (value?: string | null) => (value || '').trim().toLowerCase();
const normalizeRego = (value?: string | null) => (value || '').trim().toUpperCase();

const getLatestExpiry = (jobs: CustomerJob[], field: 'wofExpiryDate' | 'regoExpiryDate') => {
  let latest: string | null = null;
  let latestTime = -Infinity;

  for (const job of jobs) {
    const value = job[field];
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) continue;
    if (time > latestTime) {
      latest = value;
      latestTime = time;
    }
  }

  return latest;
};

export const CustomersPage = () => {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [editingCustomer, setEditingCustomer] = useState<CustomerRow | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [openActionMenu, setOpenActionMenu] = useState<string | null>(null);
  const [visibleColumns, setVisibleColumns] =
    useState<Record<ColumnKey, boolean>>(() => loadVisibleColumns());
  const [columnWidths, setColumnWidths] =
    useState<Record<ColumnWidthKey, number>>(() => loadColumnWidths());
  const [resizingColumn, setResizingColumn] = useState<{
    key: ColumnWidthKey;
    startX: number;
    startWidth: number;
  } | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  const { data: customers, isLoading, error, refetch } = useQuery<CustomerRow[]>({
    queryKey: ['customers', search],
    queryFn: async () => (await api.get('/customers', { params: { search } })).data as CustomerRow[],
  });

  const { data: overdueData } = useQuery<OverdueSchedulesResponse>({
    queryKey: ['customers-page-overdue-services'],
    queryFn: async () =>
      (await api.get('/service-schedules', { params: { view: 'overdue', daysAhead: 7 } }))
        .data as OverdueSchedulesResponse,
    staleTime: 60_000,
  });

  const updateCustomer = useMutation({
    mutationFn: async ({ id, ...payload }: UpdateCustomerPayload) => api.patch(`/customers/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setEditingCustomer(null);
      showToast('Customer updated successfully');
    },
    onError: () => {
      showToast('Failed to update customer', 'error');
    },
  });

  const deleteCustomer = useMutation({
    mutationFn: async (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers'] });
      setOpenActionMenu(null);
      setDeleteDialog(null);
      showToast('Customer deleted successfully');
    },
    onError: () => {
      showToast('Failed to delete customer', 'error');
    },
  });

  const overdueServiceItems = useMemo(
    () => (overdueData?.items ?? []).filter((item) => item.type === 'SERVICE'),
    [overdueData],
  );

  const groupedCustomers = useMemo(() => {
    const groups = new Map<string, CustomerGroup>();

    for (const customer of customers ?? []) {
      const normalizedEmail = normalizeEmail(customer.email);
      const normalizedPhone = normalizePhone(customer.phone);
      const fallbackName = `${customer.firstName} ${customer.lastName}`.trim().toLowerCase();
      const groupKey =
        normalizedEmail || normalizedPhone
          ? `${normalizedEmail}|${normalizedPhone}`
          : `${fallbackName}|${customer.id}`;

      const existing = groups.get(groupKey);
      if (!existing) {
        const initialRegos = (customer.vehicles || []).map((vehicle) => normalizeRego(vehicle.rego)).filter(Boolean);
        groups.set(groupKey, {
          id: customer.id,
          primary: customer,
          memberIds: [customer.id],
          regos: initialRegos.length ? initialRegos : [normalizeRego(customer.rego)],
          jobs: [...(customer.jobs || [])],
        });
        continue;
      }

      existing.memberIds.push(customer.id);
      const currentRegos = (customer.vehicles || []).map((vehicle) => normalizeRego(vehicle.rego)).filter(Boolean);
      const fallbackRego = normalizeRego(customer.rego);
      const nextRegos = currentRegos.length ? currentRegos : fallbackRego ? [fallbackRego] : [];
      nextRegos.forEach((rego) => {
        if (rego && !existing.regos.includes(rego)) {
          existing.regos.push(rego);
        }
      });
      existing.jobs.push(...(customer.jobs || []));

      if (toTimestamp(customer.updatedAt) > toTimestamp(existing.primary.updatedAt)) {
        existing.primary = customer;
        existing.id = customer.id;
      }
    }

    return Array.from(groups.values())
      .map((group) => {
        const uniqueJobs = new Map<string, CustomerJob>();
        for (const job of group.jobs) {
          if (!uniqueJobs.has(job.id)) uniqueJobs.set(job.id, job);
        }
        return {
          ...group,
          regos: group.regos.filter(Boolean).sort((a, b) => a.localeCompare(b)),
          jobs: Array.from(uniqueJobs.values()).sort(
            (a, b) => toTimestamp(b.createdAt) - toTimestamp(a.createdAt),
          ),
        };
      })
      .sort((a, b) => toTimestamp(b.primary.updatedAt) - toTimestamp(a.primary.updatedAt));
  }, [customers]);

  const overdueByCustomerId = useMemo(() => {
    const map = new Map<string, OverdueServiceItem>();
    for (const item of overdueServiceItems) {
      const existing = map.get(item.customer.id);
      if (!existing || item.daysUntil < existing.daysUntil) {
        map.set(item.customer.id, item);
      }
    }
    return map;
  }, [overdueServiceItems]);

  const overdueByGroupId = useMemo(() => {
    const map = new Map<string, OverdueServiceItem>();
    for (const group of groupedCustomers) {
      let selected: OverdueServiceItem | undefined;
      for (const memberId of group.memberIds) {
        const memberItem = overdueByCustomerId.get(memberId);
        if (!memberItem) continue;
        if (!selected || memberItem.daysUntil < selected.daysUntil) {
          selected = memberItem;
        }
      }
      if (selected) map.set(group.id, selected);
    }
    return map;
  }, [groupedCustomers, overdueByCustomerId]);

  const activeColumns = useMemo(
    () => COLUMN_OPTIONS.filter((column) => visibleColumns[column.key]),
    [visibleColumns],
  );

  const gridTemplateColumns = useMemo(() => {
    const columns = [`${columnWidths.rego}px`, `${columnWidths.customer}px`];
    for (const column of activeColumns) {
      columns.push(`${columnWidths[column.key]}px`);
    }
    columns.push(`${ACTIONS_COLUMN_WIDTH}px`);
    return columns.join(' ');
  }, [activeColumns, columnWidths]);

  const gridMinWidth = useMemo(() => {
    const selectedWidth = activeColumns.reduce((sum, column) => sum + columnWidths[column.key], 0);
    const columnCount = 2 + activeColumns.length + 1;
    const gapWidth = (columnCount - 1) * GRID_GAP_PX;
    return columnWidths.rego + columnWidths.customer + selectedWidth + ACTIONS_COLUMN_WIDTH + gapWidth;
  }, [activeColumns, columnWidths]);

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COLUMN_WIDTH_PREFS_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    if (!resizingColumn) return;
    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = clampColumnWidth(
        resizingColumn.key,
        resizingColumn.startWidth + (event.clientX - resizingColumn.startX),
      );
      setColumnWidths((prev) => {
        if (prev[resizingColumn.key] === nextWidth) return prev;
        return { ...prev, [resizingColumn.key]: nextWidth };
      });
    };
    const handlePointerUp = () => setResizingColumn(null);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [resizingColumn]);

  useEffect(() => {
    if (!openActionMenu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) {
        setOpenActionMenu(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenActionMenu(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [openActionMenu]);

  const startResize = (event: ReactPointerEvent<HTMLButtonElement>, key: ColumnWidthKey) => {
    event.preventDefault();
    event.stopPropagation();
    setResizingColumn({
      key,
      startX: event.clientX,
      startWidth: columnWidths[key],
    });
  };

  const handleUpdate = (customer: CustomerRow) => {
    updateCustomer.mutate({
      id: customer.id,
      rego: customer.rego,
      vehicleBrand: customer.vehicleBrand,
      vehicleModel: customer.vehicleModel,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone,
      email: customer.email,
    });
  };

  if (isLoading) {
    return (
      <PortalShell>
        <LoadingSpinner message="Loading customers..." />
      </PortalShell>
    );
  }

  if (error) {
    return (
      <PortalShell>
        <ErrorMessage
          message="Failed to load customers. Please try again."
          onRetry={() => refetch()}
        />
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <ConfirmDialog
        isOpen={!!deleteDialog}
        title="Delete Customer"
        message="Are you sure you want to delete this customer? This will also delete all associated jobs, quotes, and invoices."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteCustomer.mutate(deleteDialog!)}
        onCancel={() => setDeleteDialog(null)}
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">All customers</h1>
              <p className="text-xs text-white/60">{groupedCustomers.length} customers</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by rego, customer, phone, or email..."
                  className="input w-72"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-3">
          <p className="text-xs text-white/60 mb-2">Visible columns</p>
          <div className="flex flex-wrap gap-2">
            {COLUMN_OPTIONS.map((column) => (
              <label
                key={column.key}
                className="inline-flex items-center gap-2 px-2 py-1 rounded-lg border border-white/10 bg-white/5 text-xs"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={visibleColumns[column.key]}
                  onChange={() => toggleColumn(column.key)}
                />
                {column.label}
              </label>
            ))}
          </div>
        </div>

        {overdueServiceItems.length > 0 ? (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-red-200">
                  Overdue service notifications ({overdueServiceItems.length})
                </p>
                <p className="text-sm text-white/70">
                  Vehicles below are overdue for scheduled service and need follow-up.
                </p>
              </div>
              <Link to="/service-schedule" className="text-xs text-red-100 underline hover:text-white">
                Open Service Schedule
              </Link>
            </div>
          </div>
        ) : null}

        {groupedCustomers.length === 0 ? (
          <EmptyState message="No customers found." />
        ) : (
          <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <div className="min-w-full" style={{ minWidth: `${gridMinWidth}px` }}>
                <div
                  className="hidden md:grid gap-4 border-b border-white/10 bg-white/5 px-4 py-3 text-xs text-white/60"
                  style={{ gridTemplateColumns }}
                >
                  <div className="relative">
                    Rego
                    <button
                      type="button"
                      onPointerDown={(event) => startResize(event, 'rego')}
                      className="absolute -right-3 top-1/2 h-7 w-3 -translate-y-1/2 cursor-col-resize rounded-sm border-l border-white/10 hover:bg-white/10"
                      aria-label="Resize Rego column"
                      title="Drag to resize"
                    />
                  </div>
                  <div className="relative">
                    Customer
                    <button
                      type="button"
                      onPointerDown={(event) => startResize(event, 'customer')}
                      className="absolute -right-3 top-1/2 h-7 w-3 -translate-y-1/2 cursor-col-resize rounded-sm border-l border-white/10 hover:bg-white/10"
                      aria-label="Resize Customer column"
                      title="Drag to resize"
                    />
                  </div>
                  {activeColumns.map((column) => (
                    <div key={`header-${column.key}`} className="relative">
                      {column.label}
                      <button
                        type="button"
                        onPointerDown={(event) => startResize(event, column.key)}
                        className="absolute -right-3 top-1/2 h-7 w-3 -translate-y-1/2 cursor-col-resize rounded-sm border-l border-white/10 hover:bg-white/10"
                        aria-label={`Resize ${column.label} column`}
                        title="Drag to resize"
                      />
                    </div>
                  ))}
                  <div className="sticky right-0 z-30 min-w-[140px] text-right border-l border-white/10 pl-3 pr-1 bg-[#171717] shadow-[-8px_0_12px_rgba(0,0,0,0.35)]">
                    Actions
                  </div>
                </div>

                <div className="divide-y divide-white/10">
                  {groupedCustomers.map((group) => {
                    const customer = group.primary;
                    const overdueService = overdueByGroupId.get(group.id);
                    const lastJob = group.jobs?.[0];
                    const latestWofExpiry = getLatestExpiry(group.jobs ?? [], 'wofExpiryDate');
                    const latestRegoExpiry = getLatestExpiry(group.jobs ?? [], 'regoExpiryDate');

                    const renderColumnCell = (key: ColumnKey) => {
                      if (key === 'vehicle') {
                        return (
                          <div className="text-sm text-white/80">
                            {[customer.vehicleBrand, customer.vehicleModel].filter(Boolean).join(' ') || '-'}
                          </div>
                        );
                      }
                      if (key === 'phone') {
                        return <div className="text-sm">{customer.phone || '-'}</div>;
                      }
                      if (key === 'email') {
                        return <div className="text-sm break-all">{customer.email || '-'}</div>;
                      }
                      if (key === 'serviceStatus') {
                        return overdueService ? (
                          <div>
                            <span className="inline-flex rounded-full bg-red-500/20 px-2 py-1 text-xs font-semibold text-red-200 border border-red-500/30">
                              {Math.abs(overdueService.daysUntil)} day
                              {Math.abs(overdueService.daysUntil) === 1 ? '' : 's'} overdue
                            </span>
                            <p className="mt-1 text-xs text-white/60">Due {formatDate(overdueService.dueDate)}</p>
                          </div>
                        ) : (
                          <span className="text-xs text-white/50">No overdue service</span>
                        );
                      }
                      if (key === 'lastJob') {
                        return lastJob ? (
                          <div>
                            <p className="text-sm">{lastJob.serviceType || lastJob.title}</p>
                            <p className="text-xs text-white/60">{formatDate(lastJob.createdAt)}</p>
                          </div>
                        ) : (
                          <span className="text-xs text-white/50">No jobs</span>
                        );
                      }
                      if (key === 'wofExpiry') return <div className="text-sm">{formatDate(latestWofExpiry)}</div>;
                      if (key === 'regoExpiry') return <div className="text-sm">{formatDate(latestRegoExpiry)}</div>;
                      return <div className="text-xs text-white/60">{formatDate(customer.updatedAt)}</div>;
                    };

                    return (
                      <div key={group.id}>
                        {editingCustomer?.id === customer.id ? (
                          <div className="px-4 py-4 bg-white/5">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-white/60">Rego</span>
                                <input
                                  className="input"
                                  value={editingCustomer.rego}
                                  onChange={(e) => setEditingCustomer({ ...editingCustomer, rego: e.target.value })}
                                  placeholder="Rego"
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-white/60">Phone</span>
                                <input
                                  className="input"
                                  value={editingCustomer.phone}
                                  onChange={(e) => setEditingCustomer({ ...editingCustomer, phone: e.target.value })}
                                  placeholder="Phone"
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-white/60">First name</span>
                                <input
                                  className="input"
                                  value={editingCustomer.firstName}
                                  onChange={(e) =>
                                    setEditingCustomer({ ...editingCustomer, firstName: e.target.value })
                                  }
                                  placeholder="First name"
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-white/60">Last name</span>
                                <input
                                  className="input"
                                  value={editingCustomer.lastName}
                                  onChange={(e) => setEditingCustomer({ ...editingCustomer, lastName: e.target.value })}
                                  placeholder="Last name"
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-white/60">Vehicle brand</span>
                                <input
                                  className="input"
                                  value={editingCustomer.vehicleBrand || ''}
                                  onChange={(e) =>
                                    setEditingCustomer({ ...editingCustomer, vehicleBrand: e.target.value })
                                  }
                                  placeholder="Vehicle brand"
                                />
                              </label>
                              <label className="flex flex-col gap-1">
                                <span className="text-xs text-white/60">Vehicle model</span>
                                <input
                                  className="input"
                                  value={editingCustomer.vehicleModel || ''}
                                  onChange={(e) =>
                                    setEditingCustomer({ ...editingCustomer, vehicleModel: e.target.value })
                                  }
                                  placeholder="Vehicle model"
                                />
                              </label>
                            </div>
                            <label className="mb-3 flex flex-col gap-1">
                              <span className="text-xs text-white/60">Email</span>
                              <input
                                type="email"
                                className="input"
                                value={editingCustomer.email}
                                onChange={(e) => setEditingCustomer({ ...editingCustomer, email: e.target.value })}
                                placeholder="Email"
                              />
                            </label>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleUpdate(editingCustomer)}
                                className="px-3 py-1.5 bg-brand-primary text-black rounded-lg text-xs font-semibold"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingCustomer(null)}
                                className="px-3 py-1.5 bg-white/5 border border-white/10 text-white rounded-lg text-xs"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div
                              className={`group relative grid gap-4 px-4 py-3 hover:bg-white/5 transition cursor-pointer ${
                                openActionMenu === group.id ? 'z-40' : 'z-0'
                              }`}
                              style={{ gridTemplateColumns }}
                              onClick={() => setExpandedRow(expandedRow === group.id ? null : group.id)}
                            >
                              <div className="flex items-center">
                                <span className="px-2 py-1 text-xs font-semibold rounded-md bg-brand-primary/20 text-brand-primary border border-brand-primary/30">
                                  {customer.rego}
                                </span>
                              </div>
                              <div>
                                <p className="font-semibold text-white">
                                  {customer.firstName} {customer.lastName}
                                </p>
                                <p className="text-xs text-white/60">
                                  {group.regos.length > 1
                                    ? `Regos: ${group.regos.join(', ')}`
                                    : `Rego: ${group.regos[0] || normalizeRego(customer.rego)}`}
                                </p>
                                {group.memberIds.length > 1 ? (
                                  <p className="text-xs text-amber-200/90 mt-1">
                                    {group.memberIds.length} customer records merged by contact details
                                  </p>
                                ) : null}
                              </div>
                              {activeColumns.map((column) => (
                                <div key={`${group.id}-${column.key}`} className="flex items-center">
                                  {renderColumnCell(column.key)}
                                </div>
                              ))}
                              <div
                                className={`sticky right-0 min-w-[140px] flex items-center justify-end border-l border-white/10 pl-3 pr-1 bg-[#121212] group-hover:bg-[#1a1a1a] shadow-[-8px_0_12px_rgba(0,0,0,0.35)] ${
                                  openActionMenu === group.id ? 'z-50' : 'z-20'
                                }`}
                                ref={openActionMenu === group.id ? actionMenuRef : null}
                              >
                                <div className="relative inline-flex justify-end">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenActionMenu((current) => (current === group.id ? null : group.id));
                                    }}
                                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10"
                                  >
                                    <span>Actions</span>
                                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-brand-primary/50 text-[10px] text-brand-primary">
                                      v
                                    </span>
                                  </button>
                                  {openActionMenu === group.id && (
                                    <div
                                      className="absolute right-0 top-full z-[60] mt-2 min-w-[180px] rounded-2xl border border-white/10 bg-[#111111] p-2 shadow-2xl"
                                      onClick={(event) => event.stopPropagation()}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionMenu(null);
                                          setEditingCustomer(customer);
                                        }}
                                        className="flex w-full items-center rounded-xl px-3 py-2 text-left text-xs text-white/80 transition hover:bg-white/5 hover:text-white"
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionMenu(null);
                                          setExpandedRow((current) => (current === group.id ? null : group.id));
                                        }}
                                        className="flex w-full items-center rounded-xl px-3 py-2 text-left text-xs text-white/80 transition hover:bg-white/5 hover:text-white"
                                      >
                                        {expandedRow === group.id ? 'Hide details' : 'View details'}
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionMenu(null);
                                          setDeleteDialog(customer.id);
                                        }}
                                        className="flex w-full items-center rounded-xl px-3 py-2 text-left text-xs text-red-200 transition hover:bg-red-500/10"
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            {expandedRow === group.id ? (
                              <div className="px-4 py-3 bg-white/5 border-t border-white/10">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="space-y-2">
                                    <div>
                                      <p className="text-xs text-white/60">Contact</p>
                                      <p className="text-sm">{customer.phone} • {customer.email}</p>
                                    </div>
                                    <div>
                                      <p className="text-xs text-white/60">All regos</p>
                                      <div className="flex flex-wrap gap-2 mt-1">
                                        {group.regos.map((rego) => (
                                          <span
                                            key={`${group.id}-${rego}`}
                                            className="px-2 py-1 text-xs rounded-md bg-white/10 border border-white/10"
                                          >
                                            {rego}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                    <div>
                                      <p className="text-xs text-white/60">Updated</p>
                                      <p className="text-sm">{formatDateTime(customer.updatedAt)}</p>
                                    </div>
                                  </div>
                                  <div>
                                    <p className="text-xs text-white/60 mb-2">
                                      Recent jobs ({group.jobs.length})
                                    </p>
                                    <div className="space-y-2">
                                      {group.jobs.slice(0, 5).map((job) => (
                                        <div
                                          key={job.id}
                                          className="rounded-lg border border-white/10 bg-black/20 px-3 py-2"
                                        >
                                          <p className="text-sm font-semibold">{job.serviceType || job.title}</p>
                                          <p className="text-xs text-white/60">
                                            {formatDate(job.createdAt)} • WOF {formatDate(job.wofExpiryDate)} • Rego{' '}
                                            {formatDate(job.regoExpiryDate)}
                                          </p>
                                        </div>
                                      ))}
                                      {group.jobs.length === 0 ? (
                                        <p className="text-xs text-white/50">No jobs available.</p>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : null}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </PortalShell>
  );
};
