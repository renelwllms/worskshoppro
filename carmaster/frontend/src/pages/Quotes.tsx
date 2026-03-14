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

export const QuotesPage = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { showToast } = useToast();

  const { data: quotes, isLoading, error, refetch } = useQuery({
    queryKey: ['quotes'],
    queryFn: async () => (await api.get('/quotes')).data,
  });

  const { data: jobs } = useQuery({
    queryKey: ['jobs-list'],
    queryFn: async () => (await api.get('/jobs')).data,
  });

  const { data: customers } = useQuery({
    queryKey: ['customers-list'],
    queryFn: async () => (await api.get('/customers')).data,
  });

  const [items, setItems] = useState<Item[]>([{ description: '', quantity: 1, unitPrice: 0 }]);
  const [form, setForm] = useState({ jobId: '', customerId: '', expiresAt: '' });
  const [query, setQuery] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<string | null>(null);
  const [sendDialog, setSendDialog] = useState<string | null>(null);

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [items]
  );

  const createQuote = useMutation({
    mutationFn: async () =>
      api.post('/quotes', {
        ...form,
        items,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      setForm({ jobId: '', customerId: '', expiresAt: '' });
      setItems([{ description: '', quantity: 1, unitPrice: 0 }]);
      showToast('Quote created successfully');
    },
    onError: () => {
      showToast('Failed to create quote', 'error');
    },
  });

  const sendQuote = useMutation({
    mutationFn: async (id: string) => api.post(`/quotes/${id}/send`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      setSendDialog(null);
      showToast('Quote sent successfully');
    },
    onError: () => {
      showToast('Failed to send quote', 'error');
    },
  });

  const deleteQuote = useMutation({
    mutationFn: async (id: string) => api.delete(`/quotes/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      setDeleteDialog(null);
      showToast('Quote deleted successfully');
    },
    onError: () => {
      showToast('Failed to delete quote', 'error');
    },
  });

  const printQuote = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/quotes/${id}/pdf`, {}, { responseType: 'blob' })).data,
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      const opened = openPdfBlob(data);
      if (!opened) {
        showToast('Quote PDF not available', 'error');
      }
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to generate quote PDF';
      showToast(message, 'error');
    },
  });

  const downloadQuote = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/quotes/${id}/pdf`, {}, { responseType: 'blob' })).data,
    onSuccess: (data: any, id) => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      const fileName = `quote-${id.slice(0, 6).toUpperCase()}.pdf`;
      const downloaded = downloadPdfBlob(data, fileName);
      if (!downloaded) {
        showToast('Quote PDF not available', 'error');
      }
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to generate quote PDF';
      showToast(message, 'error');
    },
  });

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index));
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

  const getStatusLabel = (quote: any) => {
    if (quote.status === 'APPROVED') return { text: 'APPROVED', tone: 'bg-green-500/10 text-green-200 border-green-500/30' };
    if (quote.status === 'DECLINED') return { text: 'DECLINED', tone: 'bg-red-500/10 text-red-200 border-red-500/30' };
    if (quote.status === 'SENT') return { text: 'SENT', tone: 'bg-blue-500/10 text-blue-200 border-blue-500/30' };
    const expires = quote.expiresAt ? new Date(quote.expiresAt) : null;
    if (expires && !Number.isNaN(expires.getTime())) {
      const today = new Date();
      if (expires < today) {
        return { text: 'EXPIRED', tone: 'bg-red-500/10 text-red-200 border-red-500/30' };
      }
    }
    return { text: quote.status || 'DRAFT', tone: 'bg-white/5 text-white border-white/10' };
  };

  const filteredQuotes = useMemo(() => {
    if (!quotes) return [];
    const q = query.trim().toLowerCase();
    if (!q) return quotes;
    return quotes.filter((quote: any) => {
      const id = quote.id?.toLowerCase() || '';
      const customer = `${quote.customer?.firstName ?? ''} ${quote.customer?.lastName ?? ''}`.toLowerCase();
      const job = quote.job?.title?.toLowerCase() || '';
      return id.includes(q) || customer.includes(q) || job.includes(q);
    });
  }, [quotes, query]);

  if (isLoading) {
    return (
      <PortalShell>
        <LoadingSpinner message="Loading quotes..." />
      </PortalShell>
    );
  }

  if (error) {
    return (
      <PortalShell>
        <ErrorMessage
          message="Failed to load quotes. Please try again."
          onRetry={() => refetch()}
        />
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <ConfirmDialog
        isOpen={!!deleteDialog}
        title="Delete Quote"
        message="Are you sure you want to delete this quote? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteQuote.mutate(deleteDialog!)}
        onCancel={() => setDeleteDialog(null)}
      />
      <ConfirmDialog
        isOpen={!!sendDialog}
        title="Send Quote via Email"
        message="This will send the quote to the customer's email address with approve/decline links. Continue?"
        confirmLabel="Send Email"
        onConfirm={() => sendQuote.mutate(sendDialog!)}
        onCancel={() => setSendDialog(null)}
      />
      <div className="flex flex-col gap-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Create quote</h2>
            {createQuote.isPending && <span className="text-xs text-brand-primary">saving…</span>}
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <select
              className="input"
              value={form.jobId}
              onChange={(e) => setForm({ ...form, jobId: e.target.value })}
            >
              <option value="">Select Job</option>
              {jobs?.map((job: any) => (
                <option key={job.id} value={job.id}>
                  {job.title} - {job.customer?.rego}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={form.customerId}
              onChange={(e) => setForm({ ...form, customerId: e.target.value })}
            >
              <option value="">Select Customer</option>
              {customers?.map((customer: any) => (
                <option key={customer.id} value={customer.id}>
                  {customer.firstName} {customer.lastName} ({customer.rego})
                </option>
              ))}
            </select>
            <input
              className="input"
              type="date"
              placeholder="Expires at"
              value={form.expiresAt}
              onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
            />
          </div>
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
          <button
            onClick={() => createQuote.mutate()}
            disabled={!form.jobId || !form.customerId || items.some(i => !i.description)}
            className="bg-brand-primary text-black font-semibold rounded-xl px-3 py-2 shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save quote
          </button>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
          <div className="flex flex-wrap gap-3 items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold">All quotes</h2>
              <p className="text-xs text-white/60">{filteredQuotes.length} quotes</p>
            </div>
            <div className="flex gap-2 items-center">
              <input
                className="input w-60"
                placeholder="Search in quotes"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          {filteredQuotes.length === 0 ? (
            <EmptyState message="No quotes found. Create your first quote above." />
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead className="text-xs text-white/60">
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-left">Quote #</th>
                    <th className="px-4 py-2 text-left">Job</th>
                    <th className="px-4 py-2 text-left">Customer</th>
                    <th className="px-4 py-2 text-left">Status</th>
                    <th className="px-4 py-2 text-left">Expires</th>
                    <th className="px-4 py-2 text-right">Total</th>
                    <th className="px-4 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {filteredQuotes.map((quote: any) => {
                    const status = getStatusLabel(quote);
                    return (
                      <tr
                        key={quote.id}
                        className="hover:bg-white/5"
                        onDoubleClick={() => navigate(`/quotes/${quote.id}`)}
                      >
                        <td className="px-4 py-3 text-white/80">{formatDate(quote.createdAt)}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => navigate(`/quotes/${quote.id}`)}
                            className="text-brand-primary hover:text-brand-accent font-semibold"
                          >
                            QUO-{quote.id.slice(0, 6).toUpperCase()}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-white/80">{quote.job?.title ?? '-'}</td>
                        <td className="px-4 py-3">
                          {quote.customer?.firstName} {quote.customer?.lastName}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-[11px] border ${status.tone}`}>
                            {status.text}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-white/80">{formatDate(quote.expiresAt)}</td>
                        <td className="px-4 py-3 text-right font-semibold">NZD{formatMoney(quote.total)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => navigate(`/quotes/${quote.id}`)}
                              className="text-xs px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white transition"
                            >
                              Open
                            </button>
                            <button
                              type="button"
                              onClick={() => printQuote.mutate(quote.id)}
                              className="text-xs px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white transition"
                            >
                              Print
                            </button>
                            <button
                              type="button"
                              onClick={() => downloadQuote.mutate(quote.id)}
                              className="text-xs px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white transition"
                            >
                              Download
                            </button>
                            {quote.status === 'DRAFT' && (
                              <button
                                type="button"
                                onClick={() => setSendDialog(quote.id)}
                                className="text-xs px-3 py-1.5 rounded-full bg-brand-primary hover:bg-brand-accent text-black transition"
                              >
                                Send
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setDeleteDialog(quote.id)}
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
          )}
        </div>
      </div>
    </PortalShell>
  );
};
