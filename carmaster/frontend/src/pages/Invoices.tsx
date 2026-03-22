import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { PortalShell } from '../components/PortalShell';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import { EmptyState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../context/ToastContext';
import { openPdfBlob } from '../utils/openPdfBlob';
import { downloadPdfBlob } from '../utils/downloadPdfBlob';

type Item = { description: string; quantity: number; unitPrice: number };

const EMPTY_ITEM: Item = { description: '', quantity: 1, unitPrice: 0 };

const getTodayDateInputValue = () => {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().slice(0, 10);
};

const formatMoney = (value: any) => {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
};

const formatDateValue = (value: any) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-NZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const getInvoiceNumberLabel = (invoice: any) =>
  invoice?.invoiceNumber ? `INV-${invoice.invoiceNumber}` : `INV-${invoice?.id?.slice(0, 6)?.toUpperCase() ?? ''}`;

const formatJobInvoiceItemLabel = (type?: string) => {
  if (type === 'service') return 'Service';
  if (type === 'additional_service') return 'Additional service';
  if (type === 'service_package') return 'Service package';
  if (type === 'upsell') return 'Upsell';
  return 'Service';
};

const buildJobHeading = (job: any) => {
  const title = job?.title || job?.selectedService?.name || job?.selectedServicePackage?.name || 'Booked job';
  return job?.jobNumber ? `${title} (#${job.jobNumber})` : title;
};

const buildInvoiceItemsFromJob = (job: any): Item[] => {
  const pricingItems = Array.isArray(job?.pricingSnapshot?.items) ? job.pricingSnapshot.items : [];
  const jobHeading = buildJobHeading(job);
  if (pricingItems.length > 0) {
    return pricingItems.map((item: any) => {
      const descriptionParts = [`Job: ${jobHeading}`, `${formatJobInvoiceItemLabel(item?.type)}: ${item?.name || 'Booked service'}`];
      if (item?.vehicleType) {
        descriptionParts.push(`Vehicle type: ${String(item.vehicleType).toLowerCase()}`);
      }
      if (item?.notes) {
        descriptionParts.push(String(item.notes));
      }
      if (item?.priceType === 'QUOTE_REQUIRED') {
        descriptionParts.push('Final price to be confirmed.');
      }
      return {
        description: descriptionParts.join('\n'),
        quantity: 1,
        unitPrice: Number(item?.basePrice ?? 0),
      };
    });
  }

  const fallbackItems = [
    job?.selectedService?.name
      ? {
          description: `Job: ${jobHeading}\nService: ${job.selectedService.name}`,
          quantity: 1,
          unitPrice: Number(job?.selectedService?.basePrice ?? 0),
        }
      : null,
    job?.selectedServicePackage?.name
      ? {
          description: `Job: ${jobHeading}\nService package: ${job.selectedServicePackage.name}`,
          quantity: 1,
          unitPrice: Number(job?.packageBasePriceSnapshot ?? 0),
        }
      : null,
    ...(job?.upsells || []).map((entry: any) => ({
      description: `Job: ${jobHeading}\nUpsell: ${entry?.upsell?.name || 'Additional item'}`,
      quantity: 1,
      unitPrice: Number(entry?.upsell?.price ?? 0),
    })),
  ].filter(Boolean) as Item[];

  return fallbackItems.length > 0 ? fallbackItems : [{ description: `Job: ${jobHeading}`, quantity: 1, unitPrice: 0 }];
};

const buildInvoiceItemsFromJobs = (jobs: any[]): Item[] => jobs.flatMap((job) => buildInvoiceItemsFromJob(job));

const getJobLinkedInvoices = (job: any) => {
  const linked = [
    ...(job?.invoices || []),
    ...(job?.invoiceLinks || []).map((entry: any) => entry?.invoice).filter(Boolean),
  ];
  const seen = new Set<string>();
  return linked.filter((invoice: any) => {
    if (!invoice?.id || seen.has(invoice.id)) {
      return false;
    }
    seen.add(invoice.id);
    return true;
  });
};

const getJobInvoiceStatusLabel = (job: any) => {
  const linkedInvoices = getJobLinkedInvoices(job);
  if (linkedInvoices.length === 0) {
    return 'Not invoiced';
  }
  if (linkedInvoices.length === 1) {
    const status = String(linkedInvoices[0]?.status || 'DRAFT').toLowerCase().replace(/_/g, ' ');
    return `Invoiced (${status})`;
  }
  return `Invoiced x${linkedInvoices.length}`;
};

const getInvoiceJobSummary = (invoice: any) => {
  const linkedJobs = Array.isArray(invoice?.invoiceJobs) && invoice.invoiceJobs.length > 0
    ? invoice.invoiceJobs.map((entry: any) => entry?.job).filter(Boolean)
    : invoice?.job
      ? [invoice.job]
      : [];
  if (linkedJobs.length === 0) {
    return '-';
  }
  if (linkedJobs.length === 1) {
    return linkedJobs[0]?.title || linkedJobs[0]?.selectedService?.name || linkedJobs[0]?.selectedServicePackage?.name || '-';
  }
  const firstLabel = linkedJobs[0]?.title || linkedJobs[0]?.selectedService?.name || linkedJobs[0]?.selectedServicePackage?.name || 'Job';
  return `${firstLabel} + ${linkedJobs.length - 1} more`;
};

export const InvoicesPage = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { showToast } = useToast();

  const { data: invoices, isLoading, error, refetch } = useQuery({
    queryKey: ['invoices'],
    queryFn: async () => (await api.get('/invoices')).data,
  });

  const { data: jobs } = useQuery({
    queryKey: ['jobs-list'],
    queryFn: async () => (await api.get('/jobs')).data,
  });

  const { data: customers } = useQuery({
    queryKey: ['customers-list'],
    queryFn: async () => (await api.get('/customers')).data,
  });

  const { data: approvedQuotes } = useQuery({
    queryKey: ['approved-quotes'],
    queryFn: async () => (await api.get('/quotes')).data.then((quotes: any[]) =>
      quotes.filter(q => q.status === 'APPROVED' && !q.invoice)
    ),
  });

  const [items, setItems] = useState<Item[]>([EMPTY_ITEM]);
  const [form, setForm] = useState(() => ({ customerId: '', dueDate: getTodayDateInputValue(), quoteId: '' }));
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [showJobModal, setShowJobModal] = useState(false);
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<string | null>(null);
  const [sendDialog, setSendDialog] = useState<string | null>(null);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0),
    [items]
  );
  const resetCreateForm = () => {
    setItems([EMPTY_ITEM]);
    setForm({ customerId: '', dueDate: getTodayDateInputValue(), quoteId: '' });
    setSelectedJobIds([]);
    setShowJobModal(false);
    setShowCreate(false);
  };
  const availableJobs = useMemo(() => {
    if (!form.customerId) {
      return [];
    }
    return (jobs || [])
      .filter((job: any) => (job.customerId ?? job.customer?.id) === form.customerId)
      .filter((job: any) => !selectedJobIds.includes(job.id))
      .sort((a: any, b: any) => {
        const aInvoiced = getJobLinkedInvoices(a).length > 0 ? 1 : 0;
        const bInvoiced = getJobLinkedInvoices(b).length > 0 ? 1 : 0;
        if (aInvoiced !== bInvoiced) {
          return aInvoiced - bInvoiced;
        }
        return String(a.title || '').localeCompare(String(b.title || ''));
      });
  }, [form.customerId, jobs, selectedJobIds]);

  const createInvoice = useMutation({
    mutationFn: async () =>
      api.post('/invoices', {
        customerId: form.customerId,
        quoteId: form.quoteId || undefined,
        jobId: selectedJobIds[0] || undefined,
        jobIds: selectedJobIds.length ? selectedJobIds : undefined,
        dueDate: form.dueDate || undefined,
        items: form.quoteId ? undefined : items,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['approved-quotes'] });
      resetCreateForm();
      showToast('Invoice created successfully');
    },
    onError: (error: any) => {
      const message = Array.isArray(error?.response?.data?.message)
        ? error.response.data.message.join(', ')
        : error?.response?.data?.message || 'Failed to create invoice';
      showToast(message, 'error');
    },
  });

  const sendInvoice = useMutation({
    mutationFn: async (id: string) => api.post(`/invoices/${id}/send`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      setSendDialog(null);
      showToast('Invoice sent successfully');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to send invoice';
      showToast(message, 'error');
    },
  });

  const printInvoice = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/invoices/${id}/pdf`, {}, { responseType: 'blob' })).data,
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      const opened = openPdfBlob(data);
      if (!opened) {
        showToast('Invoice PDF not available', 'error');
      }
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to generate invoice PDF';
      showToast(message, 'error');
    },
  });

  const downloadInvoice = useMutation({
    mutationFn: async (invoice: any) =>
      (await api.post(`/invoices/${invoice.id}/pdf`, {}, { responseType: 'blob' })).data,
    onSuccess: (data: any, invoice) => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      const suffix = invoice?.invoiceNumber ? String(invoice.invoiceNumber) : invoice?.id?.slice(0, 6)?.toUpperCase() ?? 'draft';
      const fileName = `invoice-${suffix}.pdf`;
      const downloaded = downloadPdfBlob(data, fileName);
      if (!downloaded) {
        showToast('Invoice PDF not available', 'error');
      }
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to generate invoice PDF';
      showToast(message, 'error');
    },
  });

  const deleteInvoice = useMutation({
    mutationFn: async (id: string) => api.delete(`/invoices/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      setDeleteDialog(null);
      showToast('Invoice deleted successfully');
    },
    onError: (error: any) => {
      const message = Array.isArray(error?.response?.data?.message)
        ? error.response.data.message.join(', ')
        : error?.response?.data?.message || 'Failed to delete invoice';
      showToast(message, 'error');
    },
  });

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
    }
  };

  const handleQuoteSelect = (quoteId: string) => {
    const quote = approvedQuotes?.find((q: any) => q.id === quoteId);
    if (quote) {
      setForm({
        ...form,
        quoteId,
        customerId: quote.customerId,
      });
      setSelectedJobIds(quote.jobId ? [quote.jobId] : []);
      setShowJobModal(false);
      setItems(quote.items.map((item: any) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
      })));
    }
  };

  const handleCustomerChange = (customerId: string) => {
    setForm((current) => ({
      ...current,
      customerId,
      quoteId: '',
    }));
    setSelectedJobIds([]);
    setShowJobModal(false);
    setItems([EMPTY_ITEM]);
  };

  const handleAddJob = (jobId: string) => {
    if (!jobId) return;
    const nextJobIds = selectedJobIds.includes(jobId) ? selectedJobIds : [...selectedJobIds, jobId];
    const jobsById = new Map((jobs || []).map((job: any) => [job.id, job]));
    const nextJobs = nextJobIds.map((id) => jobsById.get(id)).filter(Boolean) as any[];
    setSelectedJobIds(nextJobIds);
    setForm((current) => ({
      ...current,
      quoteId: '',
      customerId: nextJobs[0]?.customerId ?? nextJobs[0]?.customer?.id ?? current.customerId,
    }));
    setItems(nextJobs.length ? buildInvoiceItemsFromJobs(nextJobs) : [EMPTY_ITEM]);
  };

  const handleRemoveJob = (jobId: string) => {
    const nextJobIds = selectedJobIds.filter((id) => id !== jobId);
    const jobsById = new Map((jobs || []).map((job: any) => [job.id, job]));
    const nextJobs = nextJobIds.map((id) => jobsById.get(id)).filter(Boolean) as any[];
    setSelectedJobIds(nextJobIds);
    setItems(nextJobs.length ? buildInvoiceItemsFromJobs(nextJobs) : [EMPTY_ITEM]);
  };

  const formatDate = (value: any) => {
    return formatDateValue(value);
  };

  const getStatusLabel = (invoice: any) => {
    if (invoice.status === 'PAID') return { text: 'PAID', tone: 'bg-green-500/10 text-green-200 border-green-500/30' };
    if (invoice.status === 'CANCELLED') {
      return { text: 'CANCELLED', tone: 'bg-red-500/10 text-red-200 border-red-500/30' };
    }
    const due = invoice.dueDate ? new Date(invoice.dueDate) : null;
    if (due && !Number.isNaN(due.getTime())) {
      const today = new Date();
      const diffDays = Math.ceil((due.getTime() - today.setHours(0, 0, 0, 0)) / 86400000);
      if (diffDays < 0) {
        const overdueDays = Math.abs(diffDays);
        return {
          text: `OVERDUE BY ${overdueDays} DAY${overdueDays === 1 ? '' : 'S'}`,
          tone: 'bg-red-500/10 text-red-200 border-red-500/30',
        };
      }
      if (diffDays === 0) {
        return { text: 'DUE TODAY', tone: 'bg-blue-500/10 text-blue-200 border-blue-500/30' };
      }
      if (diffDays <= 7) {
        return { text: `DUE IN ${diffDays} DAY${diffDays === 1 ? '' : 'S'}`, tone: 'bg-blue-500/10 text-blue-200 border-blue-500/30' };
      }
    }
    return { text: invoice.status || 'DRAFT', tone: 'bg-white/5 text-white border-white/10' };
  };

  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];
    const q = query.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter((invoice: any) => {
      const id = invoice.id?.toLowerCase() || '';
      const number = String(invoice.invoiceNumber ?? '').toLowerCase();
      const customer = `${invoice.customer?.firstName ?? ''} ${invoice.customer?.lastName ?? ''}`.toLowerCase();
      const job = getInvoiceJobSummary(invoice).toLowerCase();
      return id.includes(q) || number.includes(q) || customer.includes(q) || job.includes(q);
    });
  }, [invoices, query]);

  const insights = useMemo(() => {
    const data = invoices || [];
    let overdueTotal = 0;
    let overdueCount = 0;
    let unpaidTotal = 0;
    const today = new Date();
    data.forEach((invoice: any) => {
      if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') return;
      const totalValue = Number(invoice.total) || 0;
      unpaidTotal += totalValue;
      const due = invoice.dueDate ? new Date(invoice.dueDate) : null;
      if (due && !Number.isNaN(due.getTime()) && due < today) {
        overdueTotal += totalValue;
        overdueCount += 1;
      }
    });
    return { overdueTotal, overdueCount, unpaidTotal };
  }, [invoices]);

  if (isLoading) {
    return (
      <PortalShell>
        <LoadingSpinner message="Loading invoices..." />
      </PortalShell>
    );
  }

  if (error) {
    return (
      <PortalShell>
        <ErrorMessage
          message="Failed to load invoices. Please try again."
          onRetry={() => refetch()}
        />
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <ConfirmDialog
        isOpen={!!deleteDialog}
        title="Delete Invoice"
        message="Are you sure you want to delete this invoice? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteInvoice.mutate(deleteDialog!)}
        onCancel={() => setDeleteDialog(null)}
      />
      <ConfirmDialog
        isOpen={!!sendDialog}
        title="Send Invoice via Email"
        message="This will send the invoice PDF to the customer's email address. Continue?"
        confirmLabel="Send Email"
        onConfirm={() => sendInvoice.mutate(sendDialog!)}
        onCancel={() => setSendDialog(null)}
      />
      {showJobModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-[#0b0b0b] shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Select Jobs for Invoice</h3>
                <p className="text-xs text-white/55">
                  {availableJobs.length} jobs for this customer. Dates and invoice status are shown below.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowJobModal(false)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white transition hover:bg-white/10"
              >
                Close
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto p-5">
              {availableJobs.length === 0 ? (
                <p className="text-sm text-white/60">No jobs found for the selected customer.</p>
              ) : (
                <div className="space-y-3">
                  {availableJobs.map((job: any) => {
                    const selected = selectedJobIds.includes(job.id);
                    return (
                      <div key={job.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-white">{job.title}</p>
                            <p className="text-xs text-white/50">
                              {job.customer?.rego || '-'} · {getJobInvoiceStatusLabel(job)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => (selected ? handleRemoveJob(job.id) : handleAddJob(job.id))}
                            className={`rounded-full px-3 py-1.5 text-xs transition ${
                              selected
                                ? 'border border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20'
                                : 'border border-white/10 bg-brand-primary text-black hover:bg-brand-accent'
                            }`}
                          >
                            {selected ? 'Remove' : 'Add Job'}
                          </button>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-white/65 sm:grid-cols-2">
                          <p>Created: {formatDateValue(job.createdAt)}</p>
                          <p>Due: {formatDateValue(job.dueDate)}</p>
                          <p>Status: {String(job.status || '-').replace(/_/g, ' ')}</p>
                          <p>Job number: {job.jobNumber || '-'}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">All invoices</h2>
              <p className="text-xs text-white/60">{filteredInvoices.length} invoices</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <input
                  className="input pl-3 pr-3 w-64"
                  placeholder="Search in invoices"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowCreate((prev) => !prev)}
                className="bg-brand-primary text-black font-semibold rounded-xl px-3 py-2 shadow-soft"
              >
                + New
              </button>
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Invoice insights</p>
                <ul className="text-xs text-white/70 mt-2 space-y-1">
                  <li>Overdue total: NZD{formatMoney(insights.overdueTotal)}</li>
                  <li>Unpaid total: NZD{formatMoney(insights.unpaidTotal)}</li>
                  <li>Overdue invoices: {insights.overdueCount}</li>
                </ul>
              </div>
              <button
                type="button"
                className="text-xs px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white transition"
              >
                View insights
              </button>
            </div>
          </div>
        </div>

        {showCreate && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-semibold">Create invoice</h3>
              {createInvoice.isPending && <span className="text-xs text-brand-primary">saving…</span>}
            </div>
            {approvedQuotes?.length > 0 && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-3">
                <p className="text-xs text-green-200 mb-2">Convert approved quote to invoice:</p>
                <select
                  className="input"
                  value={form.quoteId}
                  onChange={(e) => handleQuoteSelect(e.target.value)}
                >
                  <option value="">Select an approved quote (optional)</option>
                  {approvedQuotes?.map((quote: any) => (
                    <option key={quote.id} value={quote.id}>
                      Quote #{quote.id.slice(0, 8)} - {quote.customer?.firstName} {quote.customer?.lastName} (${formatMoney(quote.total)})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="grid sm:grid-cols-3 gap-3">
              <select
                className="input"
                value={form.customerId}
                onChange={(e) => handleCustomerChange(e.target.value)}
                disabled={!!form.quoteId}
              >
                <option value="">Select Customer</option>
                {customers?.map((customer: any) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.firstName} {customer.lastName} ({customer.rego})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowJobModal(true)}
                disabled={!!form.quoteId || !form.customerId}
                className="input text-left disabled:cursor-not-allowed disabled:opacity-50"
              >
                {form.customerId
                  ? selectedJobIds.length > 0
                    ? `${selectedJobIds.length} job${selectedJobIds.length === 1 ? '' : 's'} linked`
                    : 'Open Job Selector'
                  : 'Select Customer First'}
              </button>
              <input
                className="input"
                type="date"
                placeholder="Due date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
            {!form.quoteId && selectedJobIds.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedJobIds.map((jobId) => {
                  const job = (jobs || []).find((entry: any) => entry.id === jobId);
                  const label = job?.title || job?.selectedService?.name || job?.selectedServicePackage?.name || job?.jobNumber || 'Selected job';
                  return (
                    <button
                      key={jobId}
                      type="button"
                      onClick={() => handleRemoveJob(jobId)}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white transition hover:bg-white/10"
                    >
                      {label} ×
                    </button>
                  );
                })}
              </div>
            )}
            {!form.quoteId && (
              <div className="space-y-2">
                {selectedJobIds.length > 0 && (
                  <p className="text-xs text-white/60">
                    Booked services and job details were loaded into the item descriptions from the selected jobs. Add extra rows only if needed.
                  </p>
                )}
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <textarea
                      className="input col-span-2 sm:col-span-2 min-h-[44px] resize-y"
                      placeholder="Line item description"
                      value={item.description}
                      onInput={(event) => {
                        const target = event.currentTarget;
                        target.style.height = 'auto';
                        target.style.height = `${target.scrollHeight}px`;
                      }}
                      onChange={(e) =>
                        setItems(items.map((it, i) => (i === idx ? { ...it, description: e.target.value } : it)))
                      }
                    />
                    <input
                      className="input"
                      type="number"
                      placeholder="Qty"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        setItems(items.map((it, i) => (i === idx ? { ...it, quantity: Number(e.target.value) } : it)))
                      }
                    />
                    <input
                      className="input"
                      type="number"
                      placeholder="Unit price"
                      min={0}
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(e) =>
                        setItems(items.map((it, i) => (i === idx ? { ...it, unitPrice: Number(e.target.value) } : it)))
                      }
                    />
                    <div className="flex gap-1">
                      <span className="input flex items-center justify-center bg-white/10">
                        ${(item.quantity * item.unitPrice).toFixed(2)}
                      </span>
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="px-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-200 rounded-lg text-xs transition"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    className="text-sm text-brand-primary hover:text-brand-accent transition"
                    onClick={() => setItems([...items, { ...EMPTY_ITEM }])}
                  >
                    + add line
                  </button>
                  <p className="text-lg font-semibold text-brand-primary">
                    Total: ${total.toFixed(2)}
                  </p>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={resetCreateForm}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-white transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => createInvoice.mutate()}
                disabled={!form.customerId || (!form.quoteId && items.some(i => !i.description))}
                className="bg-brand-primary text-black font-semibold rounded-xl px-3 py-2 shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Save invoice
              </button>
            </div>
          </div>
        )}

        {filteredInvoices.length === 0 ? (
          <EmptyState message="No invoices found. Create your first invoice above." />
        ) : (
          <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <div className="overflow-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="text-xs text-white/60 bg-white/5">
                  <tr>
                    <th className="px-4 py-3 text-left w-10">
                      <input type="checkbox" className="h-4 w-4" />
                    </th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-left">Invoice #</th>
                    <th className="px-4 py-3 text-left">Order</th>
                    <th className="px-4 py-3 text-left">Customer</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Due Date</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {filteredInvoices.map((invoice: any) => {
                    const status = getStatusLabel(invoice);
                    return (
                      <tr
                        key={invoice.id}
                        className="hover:bg-white/5 transition"
                        onDoubleClick={() => navigate(`/invoices/${invoice.id}`)}
                      >
                        <td className="px-4 py-3">
                          <input type="checkbox" className="h-4 w-4" />
                        </td>
                        <td className="px-4 py-3 text-white/80">{formatDate(invoice.createdAt)}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => navigate(`/invoices/${invoice.id}`)}
                            className="text-brand-primary hover:text-brand-accent font-semibold"
                          >
                            {getInvoiceNumberLabel(invoice)}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-white/80">{getInvoiceJobSummary(invoice)}</td>
                        <td className="px-4 py-3">
                          {invoice.customer?.firstName} {invoice.customer?.lastName}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-[11px] border ${status.tone}`}>
                            {status.text}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-white/80">{formatDate(invoice.dueDate)}</td>
                        <td className="px-4 py-3 text-right font-semibold">NZD{formatMoney(invoice.total)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => navigate(`/invoices/${invoice.id}`)}
                              className="text-xs px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white transition"
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              onClick={() => printInvoice.mutate(invoice.id)}
                              className="text-xs px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white transition"
                            >
                              Print
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadInvoice.mutate(invoice)}
                              className="text-xs px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white transition"
                            >
                              Download
                            </button>
                            {invoice.status === 'DRAFT' && (
                              <button
                                type="button"
                                onClick={() => setSendDialog(invoice.id)}
                                className="text-xs px-3 py-1.5 rounded-full bg-brand-primary hover:bg-brand-accent text-black transition"
                              >
                                Send
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setDeleteDialog(invoice.id)}
                              className="text-xs px-3 py-1.5 rounded-full bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-200 transition"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </PortalShell>
  );
};
