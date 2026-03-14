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

const getInvoiceNumberLabel = (invoice: any) =>
  invoice?.invoiceNumber ? `INV-${invoice.invoiceNumber}` : `INV-${invoice?.id?.slice(0, 6)?.toUpperCase() ?? ''}`;

export const InvoiceDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { showToast } = useToast();

  const { data: invoice, isLoading, error, refetch } = useQuery({
    queryKey: ['invoice', id],
    queryFn: async () => (await api.get(`/invoices/${id}`)).data,
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

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });

  const [items, setItems] = useState<Item[]>([]);
  const [form, setForm] = useState({ customerId: '', jobId: '', dueDate: '' });
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('Thank you for your business.');
  const [conditions, setConditions] = useState('');

  const total = useMemo(
    () => items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0),
    [items]
  );
  const taxRate = Number(settings?.taxRate) || 0;
  const taxAmount = (total * taxRate) / 100;
  const grandTotal = total + taxAmount;

  const updateInvoice = useMutation({
    mutationFn: async (payload: any) => api.patch(`/invoices/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      showToast('Invoice updated successfully');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to update invoice';
      showToast(message, 'error');
    },
  });

  const updateInvoiceSilent = async (payload: any) => {
    await api.patch(`/invoices/${id}`, payload);
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: ['invoice', id] });
  };

  const sendInvoice = useMutation({
    mutationFn: async () => api.post(`/invoices/${id}/send`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      showToast('Invoice sent successfully');
      navigate('/invoices');
    },
    onError: () => {
      showToast('Failed to send invoice', 'error');
    },
  });

  const printInvoice = useMutation({
    mutationFn: async (payload: any) =>
      (await api.post(`/invoices/${id}/pdf`, payload, { responseType: 'blob' })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice', id] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to generate invoice PDF';
      showToast(message, 'error');
    },
  });

  const downloadInvoice = useMutation({
    mutationFn: async (payload: any) =>
      (await api.post(`/invoices/${id}/pdf`, payload, { responseType: 'blob' })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice', id] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to generate invoice PDF';
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
    if (!invoice) return;
    setForm({
      customerId: invoice.customerId ?? invoice.customer?.id ?? '',
      jobId: invoice.jobId ?? invoice.job?.id ?? '',
      dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : '',
    });
    setItems(
      (invoice.items ?? []).map((item: any) => ({
        description: item.description ?? '',
        quantity: Number(item.quantity) || 0,
        unitPrice: Number(item.unitPrice) || 0,
      })),
    );
  }, [invoice]);

  if (isLoading) {
    return (
      <PortalShell>
        <LoadingSpinner message="Loading invoice..." />
      </PortalShell>
    );
  }

  if (error) {
    return (
      <PortalShell>
        <ErrorMessage
          message="Failed to load invoice. Please try again."
          onRetry={() => refetch()}
        />
      </PortalShell>
    );
  }

  if (!invoice) {
    return (
      <PortalShell>
        <ErrorMessage message="Invoice not found." onRetry={() => navigate('/invoices')} />
      </PortalShell>
    );
  }

  const canEdit = invoice.status === 'DRAFT';
  const invoiceNumber = getInvoiceNumberLabel(invoice);
  const invoiceDate = invoice.createdAt ? new Date(invoice.createdAt).toISOString().slice(0, 10) : '';

  return (
    <PortalShell>
      <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-white/10">
          <div>
            <Link to="/invoices" className="text-xs text-white/60 hover:text-white">
              ← Back to invoices
            </Link>
            <h1 className="text-2xl font-semibold mt-2">New Invoice</h1>
            <p className="text-white/60 text-sm">Status: {invoice.status}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!canSave()) return;
                try {
                  await updateInvoiceSilent({
                    ...form,
                    dueDate: form.dueDate || undefined,
                    items,
                  });
                  const data = await printInvoice.mutateAsync({
                    notes,
                    terms: conditions,
                    subject,
                    taxRate,
                  });
                  const opened = openPdfBlob(data);
                  if (!opened) {
                    showToast('Invoice PDF not available', 'error');
                    return;
                  }
                } catch (error: any) {
                  const message = error?.response?.data?.message || 'Failed to generate invoice PDF';
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
                  await updateInvoiceSilent({
                    ...form,
                    dueDate: form.dueDate || undefined,
                    items,
                  });
                  const data = await downloadInvoice.mutateAsync({
                    notes,
                    terms: conditions,
                    subject,
                    taxRate,
                  });
                  const suffix = invoice?.invoiceNumber ? String(invoice.invoiceNumber) : id?.slice(0, 6).toUpperCase() ?? 'draft';
                  const fileName = `invoice-${suffix}.pdf`;
                  const downloaded = downloadPdfBlob(data, fileName);
                  if (!downloaded) {
                    showToast('Invoice PDF not available', 'error');
                  }
                } catch (error: any) {
                  const message = error?.response?.data?.message || 'Failed to generate invoice PDF';
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
                    updateInvoice.mutate({
                      ...form,
                      dueDate: form.dueDate || undefined,
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
                    await updateInvoice.mutateAsync({
                      ...form,
                      dueDate: form.dueDate || undefined,
                      items,
                    });
                    await sendInvoice.mutateAsync();
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
                <label className="text-xs text-white/60">Invoice#</label>
                <input className="input mt-1" value={invoiceNumber} readOnly />
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
                <label className="text-xs text-white/60">Invoice Date</label>
                <input className="input mt-1" value={invoiceDate} readOnly />
              </div>
              <div>
                <label className="text-xs text-white/60">Due Date</label>
                <input
                  className="input mt-1"
                  type="date"
                  placeholder="Due date"
                  value={form.dueDate}
                  disabled={!canEdit}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-white/60">Subject</label>
              <input
                className="input mt-1"
                placeholder="Let your customer know what this invoice is for"
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
              <table className="w-full text-sm min-w-[720px]">
                <thead className="text-xs text-white/60">
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-2 text-left">Item Details</th>
                    <th className="px-4 py-2 text-right">Quantity</th>
                    <th className="px-4 py-2 text-right">Rate</th>
                    <th className="px-4 py-2 text-left">Tax</th>
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
                      <td className="px-4 py-3 text-white/70">
                        {taxRate > 0 ? `GST ${taxRate.toFixed(2)}%` : '-'}
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
                <p className="text-xs text-white/50 mt-1">Will be displayed on the invoice</p>
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
                <span className="text-white/70">Tax ({taxRate.toFixed(2)}%)</span>
                <span className="font-semibold">NZD{formatMoney(taxAmount)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/70">Discount</span>
                <span className="text-white/40">0.00</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/70">Shipping Charges</span>
                <span className="text-white/40">0.00</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/70">Adjustment</span>
                <span className="text-white/40">0.00</span>
              </div>
              <div className="border-t border-white/10 pt-3 flex items-center justify-between">
                <span className="text-sm font-semibold">Total (NZD)</span>
                <span className="text-lg font-semibold">NZD{formatMoney(grandTotal)}</span>
              </div>
            </div>
          </div>

          {!canEdit && (
            <p className="text-xs text-white/60">Only draft invoices can be edited.</p>
          )}
        </div>
      </div>
    </PortalShell>
  );
};
