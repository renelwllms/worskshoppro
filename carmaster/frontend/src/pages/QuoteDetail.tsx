import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../api/client';
import { PortalShell } from '../components/PortalShell';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import { useToast } from '../context/ToastContext';
import { openPdfBlob } from '../utils/openPdfBlob';
import { downloadPdfBlob } from '../utils/downloadPdfBlob';

type Item = { description: string; quantity: number; unitPrice: number };

const formatMoney = (value: any) => {
  const num = Number(value);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
};

export const QuoteDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { showToast } = useToast();

  const { data: quote, isLoading, error, refetch } = useQuery({
    queryKey: ['quote', id],
    queryFn: async () => (await api.get(`/quotes/${id}`)).data,
    enabled: Boolean(id),
  });

  const { data: jobs } = useQuery({
    queryKey: ['jobs-list'],
    queryFn: async () => (await api.get('/jobs')).data,
  });

  const { data: customers } = useQuery({
    queryKey: ['customers-list'],
    queryFn: async () => (await api.get('/customers')).data,
  });

  const [form, setForm] = useState({ customerId: '', jobId: '', expiresAt: '' });
  const [items, setItems] = useState<Item[]>([{ description: '', quantity: 1, unitPrice: 0 }]);
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('Thank you for considering Carmaster.');
  const [conditions, setConditions] = useState('Payment due upon acceptance. Quote valid until expiry date.');

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [items]
  );

  const updateQuote = useMutation({
    mutationFn: async (payload: any) => api.patch(`/quotes/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['quote', id] });
      showToast('Quote updated successfully');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to update quote';
      showToast(message, 'error');
    },
  });

  const updateQuoteSilent = async (payload: any) => {
    await api.patch(`/quotes/${id}`, payload);
    qc.invalidateQueries({ queryKey: ['quotes'] });
    qc.invalidateQueries({ queryKey: ['quote', id] });
  };

  const sendQuote = useMutation({
    mutationFn: async () => api.post(`/quotes/${id}/send`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['quote', id] });
      showToast('Quote sent successfully');
      navigate('/quotes');
    },
    onError: () => {
      showToast('Failed to send quote', 'error');
    },
  });

  const printQuote = useMutation({
    mutationFn: async (payload: any) =>
      (await api.post(`/quotes/${id}/pdf`, payload, { responseType: 'blob' })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['quote', id] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to generate quote PDF';
      showToast(message, 'error');
    },
  });

  const downloadQuote = useMutation({
    mutationFn: async (payload: any) =>
      (await api.post(`/quotes/${id}/pdf`, payload, { responseType: 'blob' })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quotes'] });
      qc.invalidateQueries({ queryKey: ['quote', id] });
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

  const canSave = () => {
    if (!form.customerId) {
      showToast('Select a customer before saving', 'error');
      return false;
    }
    if (items.length === 0 || items.some((item) => !item.description)) {
      showToast('Please complete all line items before saving', 'error');
      return false;
    }
    return true;
  };

  useEffect(() => {
    if (!quote) return;
    setForm({
      customerId: quote.customerId ?? quote.customer?.id ?? '',
      jobId: quote.jobId ?? quote.job?.id ?? '',
      expiresAt: quote.expiresAt ? new Date(quote.expiresAt).toISOString().slice(0, 10) : '',
    });
    setItems(
      (quote.items ?? []).map((item: any) => ({
        description: item.description ?? '',
        quantity: Number(item.quantity) || 0,
        unitPrice: Number(item.unitPrice) || 0,
      })),
    );
  }, [quote]);

  if (isLoading) {
    return (
      <PortalShell>
        <LoadingSpinner message="Loading quote..." />
      </PortalShell>
    );
  }

  if (error) {
    return (
      <PortalShell>
        <ErrorMessage
          message="Failed to load quote. Please try again."
          onRetry={() => refetch()}
        />
      </PortalShell>
    );
  }

  if (!quote) {
    return (
      <PortalShell>
        <ErrorMessage
          message="Quote not found."
          onRetry={() => navigate('/quotes')}
        />
      </PortalShell>
    );
  }

  const canEdit = quote.status === 'DRAFT';
  const quoteNumber = `QUO-${quote.id.slice(0, 6).toUpperCase()}`;
  const quoteDate = quote.createdAt ? new Date(quote.createdAt).toISOString().slice(0, 10) : '';

  return (
    <PortalShell>
      <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-white/10">
          <div>
            <Link to="/quotes" className="text-xs text-white/60 hover:text-white">
              ← Back to quotes
            </Link>
            <h1 className="text-2xl font-semibold mt-2">Quote</h1>
            <p className="text-white/60 text-sm">Status: {quote.status}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!canSave()) return;
                try {
                  await updateQuoteSilent({
                    ...form,
                    expiresAt: form.expiresAt || undefined,
                    items,
                  });
                  const data = await printQuote.mutateAsync({
                    notes,
                    terms: conditions,
                    subject,
                  });
                  const opened = openPdfBlob(data);
                  if (!opened) {
                    showToast('Quote PDF not available', 'error');
                  }
                } catch (error: any) {
                  const message = error?.response?.data?.message || 'Failed to generate quote PDF';
                  showToast(message, 'error');
                }
              }}
              className="text-xs px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white transition"
            >
              Print
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!canSave()) return;
                try {
                  await updateQuoteSilent({
                    ...form,
                    expiresAt: form.expiresAt || undefined,
                    items,
                  });
                  const data = await downloadQuote.mutateAsync({
                    notes,
                    terms: conditions,
                    subject,
                  });
                  const fileName = `quote-${id?.slice(0, 6).toUpperCase() ?? 'draft'}.pdf`;
                  const downloaded = downloadPdfBlob(data, fileName);
                  if (!downloaded) {
                    showToast('Quote PDF not available', 'error');
                  }
                } catch (error: any) {
                  const message = error?.response?.data?.message || 'Failed to generate quote PDF';
                  showToast(message, 'error');
                }
              }}
              className="text-xs px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white transition"
            >
              Download
            </button>
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (!canSave()) return;
                    updateQuote.mutate({
                      ...form,
                      expiresAt: form.expiresAt || undefined,
                      items,
                    });
                  }}
                  className="text-xs px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-white transition"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!canSave()) return;
                    await updateQuote.mutateAsync({
                      ...form,
                      expiresAt: form.expiresAt || undefined,
                      items,
                    });
                    await sendQuote.mutateAsync();
                  }}
                  className="text-xs px-3 py-1.5 rounded-full bg-brand-primary hover:bg-brand-accent text-black transition"
                >
                  Save & send
                </button>
              </>
            )}
          </div>
        </div>

        <div className="px-6 py-5 space-y-6">
          <div className="grid gap-4">
            <div>
              <label className="text-xs text-white/60">Customer Name*</label>
              <div className="flex flex-wrap gap-2 mt-1">
                <select
                  className="input flex-1 min-w-[240px]"
                  value={form.customerId}
                  onChange={(e) => setForm({ ...form, customerId: e.target.value })}
                  disabled={!canEdit}
                >
                  <option value="">Select or add a customer</option>
                  {customers?.map((customer: any) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.firstName} {customer.lastName} ({customer.rego})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-white text-xs"
                  disabled
                >
                  Search
                </button>
              </div>
            </div>

            <div className="grid md:grid-cols-4 gap-4">
              <div>
                <label className="text-xs text-white/60">Quote#</label>
                <input className="input mt-1" value={quoteNumber} readOnly />
              </div>
              <div>
                <label className="text-xs text-white/60">Order Number</label>
                <select
                  className="input mt-1"
                  value={form.jobId}
                  onChange={(e) => setForm({ ...form, jobId: e.target.value })}
                  disabled={!canEdit}
                >
                  <option value="">Select job</option>
                  {jobs?.map((job: any) => (
                    <option key={job.id} value={job.id}>
                      {job.title} - {job.customer?.rego}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-white/60">Quote Date</label>
                <input className="input mt-1" value={quoteDate} readOnly />
              </div>
              <div>
                <label className="text-xs text-white/60">Expires</label>
                <input
                  className="input mt-1"
                  type="date"
                  placeholder="Expires at"
                  value={form.expiresAt}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-white/60">Subject</label>
              <input
                className="input mt-1"
                placeholder="Let your customer know what this quote is for"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={!canEdit}
              />
            </div>
          </div>

          <div className="border border-white/10 rounded-2xl overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-white/5">
              <p className="text-sm font-semibold">Item Table</p>
              <div className="flex items-center gap-3 text-xs text-white/60">
                <button type="button" className="hover:text-white" disabled>
                  Scan Item
                </button>
                <button type="button" className="hover:text-white" disabled>
                  Bulk Actions
                </button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="text-xs text-white/60">
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-2 text-left">Item Details</th>
                    <th className="px-4 py-2 text-right">Quantity</th>
                    <th className="px-4 py-2 text-right">Rate</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-right"> </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-3">
                        <textarea
                          className="input no-scrollbar w-full min-h-[44px] resize-none overflow-hidden"
                          placeholder="Type or click to select an item"
                          value={item.description}
                          disabled={!canEdit}
                          onInput={(event) => {
                            const target = event.currentTarget;
                            target.style.height = 'auto';
                            target.style.height = `${target.scrollHeight}px`;
                          }}
                          onChange={(e) =>
                            setItems(items.map((it, i) => (i === idx ? { ...it, description: e.target.value } : it)))
                          }
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          className="input no-spinner w-24 text-right"
                          type="number"
                          min={1}
                          inputMode="numeric"
                          value={item.quantity}
                          disabled={!canEdit}
                          onKeyDown={(event) => event.stopPropagation()}
                          onChange={(e) =>
                            setItems(items.map((it, i) => (i === idx ? { ...it, quantity: Number(e.target.value) } : it)))
                          }
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          className="input no-spinner w-28 text-right"
                          type="number"
                          min={0}
                          step="0.01"
                          inputMode="decimal"
                          value={item.unitPrice}
                          disabled={!canEdit}
                          onKeyDown={(event) => event.stopPropagation()}
                          onChange={(e) =>
                            setItems(items.map((it, i) => (i === idx ? { ...it, unitPrice: Number(e.target.value) } : it)))
                          }
                        />
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        ${formatMoney(item.quantity * item.unitPrice)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canEdit && items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            className="text-red-200 hover:text-red-100"
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-white/10">
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white transition"
                  onClick={() => setItems([...items, { description: '', quantity: 1, unitPrice: 0 }])}
                >
                  Add New Row
                </button>
                <button
                  type="button"
                  className="text-xs px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/50"
                  disabled
                >
                  Add Items in Bulk
                </button>
              </div>
            )}
          </div>

          <div className="grid lg:grid-cols-[1fr_320px] gap-4">
            <div className="space-y-4">
              <div>
                <label className="text-xs text-white/60">Customer Notes</label>
                <textarea
                  className="input mt-1 min-h-[90px]"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={!canEdit}
                />
                <p className="text-xs text-white/50 mt-1">Will be displayed on the quote</p>
              </div>
              <div>
                <label className="text-xs text-white/60">Terms &amp; Conditions</label>
                <textarea
                  className="input mt-1 min-h-[90px]"
                  value={conditions}
                  onChange={(e) => setConditions(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/70">Sub Total</span>
                <span className="font-semibold">NZD{formatMoney(total)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/70">Discount</span>
                <span className="text-white/40">0.00</span>
              </div>
              <div className="border-t border-white/10 pt-3 flex items-center justify-between">
                <span className="text-sm font-semibold">Total (NZD)</span>
                <span className="text-lg font-semibold">NZD{formatMoney(total)}</span>
              </div>
            </div>
          </div>

          {!canEdit && (
            <p className="text-xs text-white/60">Only draft quotes can be edited.</p>
          )}
        </div>
      </div>
    </PortalShell>
  );
};
