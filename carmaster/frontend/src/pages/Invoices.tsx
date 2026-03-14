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

const formatMoney = (value: any) => {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
};

const getInvoiceNumberLabel = (invoice: any) =>
  invoice?.invoiceNumber ? `INV-${invoice.invoiceNumber}` : `INV-${invoice?.id?.slice(0, 6)?.toUpperCase() ?? ''}`;

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

  const [items, setItems] = useState<Item[]>([{ description: '', quantity: 1, unitPrice: 0 }]);
  const [form, setForm] = useState({ customerId: '', jobId: '', dueDate: '', quoteId: '' });
  const [query, setQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<string | null>(null);
  const [sendDialog, setSendDialog] = useState<string | null>(null);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0),
    [items]
  );

  const createInvoice = useMutation({
    mutationFn: async () =>
      api.post('/invoices', {
        ...form,
        quoteId: form.quoteId || undefined,
        items: form.quoteId ? undefined : items,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['approved-quotes'] });
      setItems([{ description: '', quantity: 1, unitPrice: 0 }]);
      setForm({ customerId: '', jobId: '', dueDate: '', quoteId: '' });
      showToast('Invoice created successfully');
    },
    onError: () => {
      showToast('Failed to create invoice', 'error');
    },
  });

  const sendInvoice = useMutation({
    mutationFn: async (id: string) => api.post(`/invoices/${id}/send`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      setSendDialog(null);
      showToast('Invoice sent successfully');
    },
    onError: () => {
      showToast('Failed to send invoice', 'error');
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
    onError: () => {
      showToast('Failed to delete invoice', 'error');
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
        jobId: quote.jobId,
      });
      setItems(quote.items.map((item: any) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
      })));
    }
  };

  const formatDate = (value: any) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-NZ', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
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
      const job = invoice.job?.title?.toLowerCase() || '';
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
                onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                disabled={!!form.quoteId}
              >
                <option value="">Select Customer</option>
                {customers?.map((customer: any) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.firstName} {customer.lastName} ({customer.rego})
                  </option>
                ))}
              </select>
              <select
                className="input"
                value={form.jobId}
                onChange={(e) => setForm({ ...form, jobId: e.target.value })}
                disabled={!!form.quoteId}
              >
                <option value="">Select Job (optional)</option>
                {jobs?.map((job: any) => (
                  <option key={job.id} value={job.id}>
                    {job.title} - {job.customer?.rego}
                  </option>
                ))}
              </select>
              <input
                className="input"
                type="date"
                placeholder="Due date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
            {!form.quoteId && (
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <input
                      className="input col-span-2 sm:col-span-2"
                      placeholder="Line item description"
                      value={item.description}
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
                    onClick={() => setItems([...items, { description: '', quantity: 1, unitPrice: 0 }])}
                  >
                    + add line
                  </button>
                  <p className="text-lg font-semibold text-brand-primary">
                    Total: ${total.toFixed(2)}
                  </p>
                </div>
              </div>
            )}
            <button
              onClick={() => createInvoice.mutate()}
              disabled={!form.customerId || (!form.quoteId && items.some(i => !i.description))}
              className="bg-brand-primary text-black font-semibold rounded-xl px-3 py-2 shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save invoice
            </button>
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
                        <td className="px-4 py-3 text-white/80">{invoice.job?.title ?? '-'}</td>
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
