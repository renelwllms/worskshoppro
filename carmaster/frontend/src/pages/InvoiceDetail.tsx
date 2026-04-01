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

const buildInvoiceSubjectFromJobs = (jobs: any[]) => {
  if (!jobs.length) {
    return '';
  }
  if (jobs.length === 1) {
    return jobs[0]?.title || jobs[0]?.selectedService?.name || jobs[0]?.selectedServicePackage?.name || '';
  }
  const firstLabel = jobs[0]?.title || jobs[0]?.selectedService?.name || jobs[0]?.selectedServicePackage?.name || 'Selected job';
  return `${firstLabel} + ${jobs.length - 1} more`;
};

const getJobVehicle = (job: any) => job?.vehicle ?? job?.customer ?? {};

const buildJobDetailLines = (job: any) => {
  const jobVehicle = getJobVehicle(job);
  const vehicle = [jobVehicle?.vehicleBrand, jobVehicle?.vehicleModel].filter(Boolean).join(' ');
  return [
    job?.selectedService?.name ? `Service booked: ${job.selectedService.name}` : '',
    job?.selectedServicePackage?.name ? `Package booked: ${job.selectedServicePackage.name}` : '',
    jobVehicle?.rego ? `Rego: ${jobVehicle.rego}` : '',
    vehicle ? `Vehicle: ${vehicle}` : '',
  ].filter(Boolean);
};

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

const getJobInvoiceStatusLabel = (job: any, currentInvoiceId?: string) => {
  const linkedInvoices = getJobLinkedInvoices(job).filter((invoice: any) => invoice.id !== currentInvoiceId);
  if (linkedInvoices.length === 0) {
    return 'Not invoiced';
  }
  if (linkedInvoices.length === 1) {
    const status = String(linkedInvoices[0]?.status || 'DRAFT').toLowerCase().replace(/_/g, ' ');
    return `Invoiced (${status})`;
  }
  return `Invoiced x${linkedInvoices.length}`;
};

const canEmailInvoice = (invoice: any) => invoice?.status !== 'CANCELLED';

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
  const [form, setForm] = useState({ customerId: '', dueDate: '' });
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const [showJobModal, setShowJobModal] = useState(false);
  const [subject, setSubject] = useState('');
  const [subjectTouched, setSubjectTouched] = useState(false);
  const [notes, setNotes] = useState('Thank you for your business.');
  const [conditions, setConditions] = useState('');

  const total = useMemo(
    () => items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0),
    [items]
  );
  const taxRate = Number(settings?.taxRate) || 0;
  const taxAmount = (total * taxRate) / 100;
  const grandTotal = total + taxAmount;
  const selectedJobs = useMemo(() => {
    const jobsById = new Map((jobs || []).map((job: any) => [job.id, job]));
    return selectedJobIds.map((jobId) => jobsById.get(jobId)).filter(Boolean);
  }, [jobs, selectedJobIds]);
  const autoSubject = useMemo(() => buildInvoiceSubjectFromJobs(selectedJobs), [selectedJobs]);
  const availableJobs = useMemo(() => {
    if (!form.customerId) {
      return [];
    }
    return (jobs || [])
      .filter((job: any) => (job.customerId ?? job.customer?.id) === form.customerId)
      .sort((a: any, b: any) => {
        const aInvoiced = getJobLinkedInvoices(a).filter((invoice: any) => invoice.id !== id).length > 0 ? 1 : 0;
        const bInvoiced = getJobLinkedInvoices(b).filter((invoice: any) => invoice.id !== id).length > 0 ? 1 : 0;
        if (aInvoiced !== bInvoiced) {
          return aInvoiced - bInvoiced;
        }
        return String(a.title || '').localeCompare(String(b.title || ''));
      });
  }, [form.customerId, id, jobs]);

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
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to send invoice';
      showToast(message, 'error');
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
    const linkedJobIds = Array.isArray(invoice.invoiceJobs) && invoice.invoiceJobs.length > 0
      ? invoice.invoiceJobs.map((entry: any) => entry.jobId || entry.job?.id).filter(Boolean)
      : invoice.jobId ?? invoice.job?.id
        ? [invoice.jobId ?? invoice.job?.id]
        : [];
    setForm({
      customerId: invoice.customerId ?? invoice.customer?.id ?? '',
      dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString().slice(0, 10) : '',
    });
    setSelectedJobIds(linkedJobIds);
    setShowJobModal(false);
    setItems(
      (invoice.items ?? []).map((item: any) => ({
        description: item.description ?? '',
        quantity: Number(item.quantity) || 0,
        unitPrice: Number(item.unitPrice) || 0,
      })),
    );
    setSubject('');
    setSubjectTouched(false);
  }, [invoice]);

  useEffect(() => {
    if (!subjectTouched) {
      setSubject(autoSubject);
    }
  }, [autoSubject, subjectTouched]);

  const handleCustomerChange = (customerId: string) => {
    setForm((current) => ({
      ...current,
      customerId,
    }));
    setSelectedJobIds([]);
    setShowJobModal(false);
  };

  const handleAddJob = (jobId: string) => {
    if (!jobId) return;
    const nextJobIds = selectedJobIds.includes(jobId) ? selectedJobIds : [...selectedJobIds, jobId];
    const jobsById = new Map((jobs || []).map((job: any) => [job.id, job]));
    const nextJobs = nextJobIds.map((id) => jobsById.get(id)).filter(Boolean) as any[];
    setSelectedJobIds(nextJobIds);
    setForm((current) => ({
      ...current,
      customerId: nextJobs[0]?.customerId ?? nextJobs[0]?.customer?.id ?? current.customerId,
    }));
    if (nextJobs.length > 0) {
      setItems(buildInvoiceItemsFromJobs(nextJobs));
    }
  };

  const handleRemoveJob = (jobId: string) => {
    const nextJobIds = selectedJobIds.filter((id) => id !== jobId);
    const jobsById = new Map((jobs || []).map((job: any) => [job.id, job]));
    const nextJobs = nextJobIds.map((id) => jobsById.get(id)).filter(Boolean) as any[];
    setSelectedJobIds(nextJobIds);
    if (nextJobs.length > 0) {
      setItems(buildInvoiceItemsFromJobs(nextJobs));
    }
  };

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
  const canResend = !canEdit && canEmailInvoice(invoice);
  const invoiceNumber = getInvoiceNumberLabel(invoice);
  const invoiceDate = invoice.createdAt ? new Date(invoice.createdAt).toISOString().slice(0, 10) : '';

  return (
    <PortalShell>
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
                              {getJobVehicle(job).rego || '-'} · {getJobInvoiceStatusLabel(job, id)}
                            </p>
                          </div>
                          {canEdit && (
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
                          )}
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
                    jobId: selectedJobIds[0] || undefined,
                    jobIds: selectedJobIds,
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
                    jobId: selectedJobIds[0] || undefined,
                    jobIds: selectedJobIds,
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
                      jobId: selectedJobIds[0] || undefined,
                      jobIds: selectedJobIds,
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
                      jobId: selectedJobIds[0] || undefined,
                      jobIds: selectedJobIds,
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
            {canResend && (
              <button
                type="button"
                onClick={() => sendInvoice.mutate()}
                className="text-xs px-3 py-1.5 rounded-full bg-brand-primary hover:bg-brand-accent text-black transition"
              >
                Resend email
              </button>
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
                  onChange={(e) => handleCustomerChange(e.target.value)}
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
                <label className="text-xs text-white/60">Jobs</label>
                <button
                  type="button"
                  onClick={() => setShowJobModal(true)}
                  disabled={!canEdit || !form.customerId}
                  className="input mt-1 text-left disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {form.customerId
                    ? selectedJobIds.length > 0
                      ? `${selectedJobIds.length} job${selectedJobIds.length === 1 ? '' : 's'} selected`
                      : 'Open Job Selector'
                    : 'Select Customer First'}
                </button>
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
                onChange={(e) => {
                  setSubject(e.target.value);
                  setSubjectTouched(true);
                }}
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
            {selectedJobs.length > 0 && (
              <div className="border-b border-white/10 px-4 py-3">
                <p className="text-xs font-semibold text-white/80">Job Details</p>
                <div className="mt-3 space-y-3">
                  {selectedJobs.map((job: any) => {
                    const label = job?.title || job?.selectedService?.name || job?.selectedServicePackage?.name || job?.jobNumber || 'Selected job';
                    const detailLines = buildJobDetailLines(job);
                    return (
                      <div key={job.id} className="rounded-xl border border-white/10 bg-black/10 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-white">{label}</p>
                            <div className="mt-2 space-y-1 text-xs text-white/65">
                              {detailLines.map((line) => (
                                <p key={`${job.id}-${line}`}>{line}</p>
                              ))}
                            </div>
                          </div>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => handleRemoveJob(job.id)}
                              className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 transition hover:bg-red-500/20"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {canEdit && selectedJobIds.length > 0 && (
              <div className="border-b border-white/10 px-4 py-3 text-xs text-white/60">
                Booked services and job details were loaded from the selected jobs. Add extra rows only if needed.
              </div>
            )}
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
