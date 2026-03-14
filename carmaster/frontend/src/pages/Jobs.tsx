import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { PortalShell } from '../components/PortalShell';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import { EmptyState } from '../components/EmptyState';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../context/ToastContext';
import { openPdfBlob } from '../utils/openPdfBlob';

const VEHICLE_BRANDS = [
  'Toyota',
  'Ford',
  'Holden',
  'Mazda',
  'Nissan',
  'Honda',
  'Hyundai',
  'Kia',
  'Mitsubishi',
  'Subaru',
  'Volkswagen',
  'Audi',
  'BMW',
  'Mercedes-Benz',
  'Skoda',
  'Suzuki',
  'Isuzu',
  'Jeep',
  'Land Rover',
  'Volvo',
  'Tesla',
  'Other',
];

const VEHICLE_MODELS: Record<string, string[]> = {
  Toyota: ['Aqua', 'Camry', 'Corolla', 'Hilux', 'Land Cruiser', 'Prius', 'RAV4', 'Yaris'],
  Ford: ['Courier', 'Everest', 'Focus', 'Mustang', 'Ranger', 'Territory'],
  Holden: ['Acadia', 'Colorado', 'Commodore', 'Trax'],
  Mazda: ['Axela', 'CX-3', 'CX-5', 'CX-9', 'Demio', 'Mazda2', 'Mazda3', 'Mazda6'],
  Nissan: ['Juke', 'Navara', 'Note', 'Qashqai', 'X-Trail'],
  Honda: ['Accord', 'CR-V', 'Civic', 'Fit', 'HR-V'],
  Hyundai: ['i30', 'iX35', 'Kona', 'Santa Fe', 'Tucson'],
  Kia: ['Cerato', 'Niro', 'Seltos', 'Sportage', 'Sorento'],
  Mitsubishi: ['ASX', 'Eclipse Cross', 'Lancer', 'Outlander', 'Pajero', 'Triton'],
  Subaru: ['Forester', 'Impreza', 'Legacy', 'Outback', 'XV'],
  Volkswagen: ['Amarok', 'Golf', 'Passat', 'Polo', 'Tiguan'],
  Audi: ['A3', 'A4', 'A6', 'Q3', 'Q5'],
  BMW: ['1 Series', '3 Series', '5 Series', 'X3', 'X5'],
  'Mercedes-Benz': ['A-Class', 'C-Class', 'E-Class', 'GLC', 'GLE'],
  Skoda: ['Fabia', 'Karoq', 'Kodiaq', 'Octavia', 'Superb'],
  Suzuki: ['Baleno', 'Jimny', 'Swift', 'Vitara'],
  Isuzu: ['D-Max', 'MU-X'],
  Jeep: ['Cherokee', 'Compass', 'Grand Cherokee', 'Wrangler'],
  'Land Rover': ['Defender', 'Discovery', 'Range Rover', 'Range Rover Sport'],
  Volvo: ['S60', 'S90', 'XC40', 'XC60', 'XC90'],
  Tesla: ['Model 3', 'Model S', 'Model X', 'Model Y'],
};

const sortWithOtherLast = (values: string[]) => {
  const filtered = values.filter((value) => value && value !== 'Other');
  filtered.sort((a, b) => a.localeCompare(b));
  return values.includes('Other') ? [...filtered, 'Other'] : filtered;
};

const formatPrice = (value: any, priceType?: string) => {
  if (priceType === 'QUOTE_REQUIRED') return 'Quote required';
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return priceType === 'FROM' ? `From $${num.toFixed(2)}` : `$${num.toFixed(2)}`;
};

const VEHICLE_TYPES = [
  { value: 'JAPANESE', label: 'Japanese' },
  { value: 'EUROPEAN', label: 'European' },
];

type CustomerLookupJob = {
  id: string;
  title: string;
  createdAt?: string;
  wofExpiryDate?: string | null;
  regoExpiryDate?: string | null;
};

type CustomerLookupMatch = {
  id: string;
  rego?: string;
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  jobs?: CustomerLookupJob[];
};

type ComplianceSnapshot = {
  wofExpiryDate: string;
  regoExpiryDate: string;
  wofExpired: boolean;
  regoExpired: boolean;
};

const toDateInputValue = (value?: string | null) => {
  if (!value) return '';
  const raw = String(value);
  return raw.length >= 10 ? raw.slice(0, 10) : '';
};

const isExpiredDate = (value?: string) => {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  date.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
};

const formatDateLabel = (value?: string) => {
  if (!value) return 'Not recorded';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
};

const isWofServiceName = (name?: string) => /(?:\bwof\b|warranty of fitness)/i.test(String(name || ''));

const formatDateValue = (value?: string | Date | null) => {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return date.toLocaleDateString('en-NZ', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatDateTimeValue = (value?: string | Date | null) => {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';
  return date.toLocaleString('en-NZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatPricingItemType = (type?: string) => {
  if (type === 'service') return 'Service';
  if (type === 'additional_service') return 'Additional service';
  if (type === 'service_package') return 'Service package';
  if (type === 'upsell') return 'Upsell';
  return 'Item';
};

const EMPTY_FORM = {
  rego: '',
  vehicleBrand: '',
  vehicleModel: '',
  vehicleBrandOther: '',
  vehicleModelOther: '',
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  title: '',
  description: '',
  serviceType: '',
  selectionMode: 'single_service',
  selectedServiceId: '',
  additionalServiceIds: [] as string[],
  selectedServicePackageId: '',
  vehicleType: 'JAPANESE',
  dueDate: '',
  wofExpiryDate: '',
  regoExpiryDate: '',
};

export const JobsPage = () => {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  const [editingJob, setEditingJob] = useState<any | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [detailModalJob, setDetailModalJob] = useState<any | null>(null);
  const [printingJobId, setPrintingJobId] = useState<string | null>(null);
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'searching' | 'found' | 'not_found' | 'error'>('idle');
  const [wizardStep, setWizardStep] = useState(0);
  const [lastLoadedCompliance, setLastLoadedCompliance] = useState<ComplianceSnapshot | null>(null);
  const [requiresCurrentComplianceUpdate, setRequiresCurrentComplianceUpdate] = useState(false);
  const [complianceWarningOpen, setComplianceWarningOpen] = useState(false);
  const autoPopulatedRef = useRef(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const { data: jobs, isLoading, error, refetch } = useQuery({
    queryKey: ['jobs', search],
    queryFn: async () => (await api.get('/jobs', { params: { search } })).data,
  });

  const { data: jobTypes } = useQuery({
    queryKey: ['job-types'],
    queryFn: async () => (await api.get('/settings/services')).data,
  });
  const { data: servicePackages } = useQuery({
    queryKey: ['service-packages'],
    queryFn: async () => (await api.get('/settings/service-packages')).data,
  });

  useEffect(() => {
    const rego = form.rego.trim();
    if (!rego) {
      setLookupStatus('idle');
      setLastLoadedCompliance(null);
      setRequiresCurrentComplianceUpdate(false);
      setComplianceWarningOpen(false);
      return;
    }
    setLookupStatus('searching');
    const timeout = setTimeout(async () => {
      try {
        const response = await api.get('/customers', { params: { search: rego } });
        const match: CustomerLookupMatch | undefined = response.data?.find(
          (customer: CustomerLookupMatch) => customer.rego?.toLowerCase() === rego.toLowerCase()
        ) || response.data?.[0];
        if (match) {
          autoPopulatedRef.current = true;
          setLookupStatus('found');
          const normalizedBrand = (match.vehicleBrand ?? '').trim();
          const normalizedModel = (match.vehicleModel ?? '').trim();
          const brandKnown = VEHICLE_BRANDS.includes(normalizedBrand);
          const baseModels = normalizedBrand ? (VEHICLE_MODELS[normalizedBrand] || []) : [];
          const modelKnown = normalizedModel && baseModels.includes(normalizedModel);
          const latestJob = Array.isArray(match.jobs) ? match.jobs[0] : undefined;
          const loadedWofExpiryDate = toDateInputValue(latestJob?.wofExpiryDate);
          const loadedRegoExpiryDate = toDateInputValue(latestJob?.regoExpiryDate);
          const hasExpiredLoadedCompliance = isExpiredDate(loadedWofExpiryDate) || isExpiredDate(loadedRegoExpiryDate);
          setLastLoadedCompliance({
            wofExpiryDate: loadedWofExpiryDate,
            regoExpiryDate: loadedRegoExpiryDate,
            wofExpired: isExpiredDate(loadedWofExpiryDate),
            regoExpired: isExpiredDate(loadedRegoExpiryDate),
          });
          setRequiresCurrentComplianceUpdate(hasExpiredLoadedCompliance);
          setComplianceWarningOpen(hasExpiredLoadedCompliance);
          setForm((prev) => ({
            ...prev,
            vehicleBrand: brandKnown ? normalizedBrand : normalizedBrand ? 'Other' : '',
            vehicleBrandOther: brandKnown ? '' : normalizedBrand,
            vehicleModel: modelKnown ? normalizedModel : normalizedModel ? 'Other' : '',
            vehicleModelOther: modelKnown ? '' : normalizedModel,
            firstName: match.firstName ?? '',
            lastName: match.lastName ?? '',
            phone: match.phone ?? '',
            email: match.email ?? '',
            wofExpiryDate: loadedWofExpiryDate,
            regoExpiryDate: loadedRegoExpiryDate,
          }));
          return;
        }
        setLookupStatus('not_found');
        setLastLoadedCompliance(null);
        setRequiresCurrentComplianceUpdate(false);
        setComplianceWarningOpen(false);
        if (autoPopulatedRef.current) {
          setForm((prev) => ({
            ...prev,
            vehicleBrand: '',
            vehicleModel: '',
            vehicleBrandOther: '',
            vehicleModelOther: '',
            firstName: '',
            lastName: '',
            phone: '',
            email: '',
            wofExpiryDate: '',
            regoExpiryDate: '',
            additionalServiceIds: [],
          }));
          autoPopulatedRef.current = false;
        }
      } catch {
        setLookupStatus('error');
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [form.rego]);

  const createJob = useMutation({
    mutationFn: async (payload: any) => {
      const customerSearch = await api.get('/customers', { params: { search: payload.rego } });
      const regoValue = String(payload.rego || '').toLowerCase();
      const match = customerSearch.data?.find(
        (customer: any) => String(customer?.rego || '').toLowerCase() === regoValue
      );
      let customerId = match?.id;
      if (!customerId) {
        const customer = await api.post('/customers', {
          rego: payload.rego,
          vehicleBrand: payload.vehicleBrand,
          vehicleModel: payload.vehicleModel,
          firstName: payload.firstName,
          lastName: payload.lastName,
          phone: payload.phone,
          email: payload.email,
        });
        customerId = customer.data.id;
      } else {
        await api.patch(`/customers/${customerId}`, {
          rego: payload.rego,
          vehicleBrand: payload.vehicleBrand,
          vehicleModel: payload.vehicleModel,
          firstName: payload.firstName,
          lastName: payload.lastName,
          phone: payload.phone,
          email: payload.email,
        });
      }
      return api.post('/jobs', {
        customerId,
        title: payload.title,
        description: payload.description,
        serviceType: payload.serviceType,
        selectedServiceId: payload.selectedServiceId,
        additionalServiceIds: payload.additionalServiceIds,
        selectedServicePackageId: payload.selectedServicePackageId,
        vehicleType: payload.vehicleType,
        dueDate: payload.dueDate,
        wofExpiryDate: payload.wofExpiryDate,
        regoExpiryDate: payload.regoExpiryDate,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      showToast('Job created successfully');
      setShowCreateForm(false);
      resetCreateForm();
    },
    onError: () => {
      showToast('Failed to create job', 'error');
    },
  });

  const updateJob = useMutation({
    mutationFn: async ({ id, ...payload }: any) => api.patch(`/jobs/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      setEditingJob(null);
      showToast('Job updated successfully');
    },
    onError: () => {
      showToast('Failed to update job', 'error');
    },
  });

  const deleteJob = useMutation({
    mutationFn: async (id: string) => api.delete(`/jobs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      setDeleteDialog(null);
      showToast('Job deleted successfully');
    },
    onError: () => {
      showToast('Failed to delete job', 'error');
    },
  });

  const handleCreate = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (requiresCurrentComplianceUpdate && !hasCurrentComplianceDates) {
      showToast('Update both WOF and Rego expiry dates to current valid dates before booking', 'error');
      setWizardStep(1);
      return;
    }
    const hasPrimarySelection = form.selectionMode === 'service_package'
      ? Boolean(form.selectedServicePackageId)
      : Boolean(form.selectedServiceId);
    if (!hasPrimarySelection && !form.description.trim()) {
      showToast('Select a service/package or describe the issue', 'error');
      return;
    }
    const resolvedBrand = form.vehicleBrand === 'Other' ? form.vehicleBrandOther.trim() : form.vehicleBrand.trim();
    const resolvedModel = (form.vehicleBrand === 'Other' || form.vehicleModel === 'Other')
      ? form.vehicleModelOther.trim()
      : form.vehicleModel.trim();
    const selectedServiceLabel = form.selectionMode === 'service_package'
      ? selectedPackage?.name
      : selectedService?.name;
    const primaryServiceId = form.selectionMode === 'single_service' ? form.selectedServiceId : '';
    const cleanedAdditionalServiceIds = (form.additionalServiceIds || [])
      .filter((serviceId: string) => serviceId && serviceId !== primaryServiceId);
    const payload = {
      rego: form.rego.trim(),
      vehicleBrand: resolvedBrand,
      vehicleModel: resolvedModel,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      description: form.description.trim(),
      serviceType: selectedServiceLabel || form.serviceType.trim(),
      selectedServiceId: form.selectionMode === 'single_service' ? form.selectedServiceId || undefined : undefined,
      additionalServiceIds: cleanedAdditionalServiceIds.length ? cleanedAdditionalServiceIds : undefined,
      selectedServicePackageId: form.selectionMode === 'service_package' ? form.selectedServicePackageId || undefined : undefined,
      vehicleType: form.vehicleType || 'JAPANESE',
      title: form.title.trim() || selectedServiceLabel || form.serviceType.trim() || 'Service request',
      dueDate: form.dueDate || undefined,
      wofExpiryDate: form.wofExpiryDate || undefined,
      regoExpiryDate: form.regoExpiryDate || undefined,
    };
    createJob.mutate(payload);
  };

  const resetCreateForm = () => {
    setWizardStep(0);
    setLookupStatus('idle');
    setLastLoadedCompliance(null);
    setRequiresCurrentComplianceUpdate(false);
    setComplianceWarningOpen(false);
    setForm({ ...EMPTY_FORM });
    autoPopulatedRef.current = false;
  };

  const handleUpload = async (jobId: string, files: FileList | null) => {
    if (!files?.length) return;
    setUploading(jobId);
    try {
      const form = new FormData();
      Array.from(files).forEach((file) => form.append('files', file));
      await api.post(`/jobs/${jobId}/images`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      showToast('Images uploaded successfully');
    } catch {
      showToast('Failed to upload images', 'error');
    } finally {
      setUploading(null);
    }
  };

  const handleUpdate = (job: any) => {
    updateJob.mutate({
      id: job.id,
      title: job.title,
      description: job.description,
      serviceType: job.serviceType,
      dueDate: job.dueDate || undefined,
      status: job.status,
    });
  };

  const handlePrintJobCard = async (jobId: string) => {
    setPrintingJobId(jobId);
    try {
      const response = await api.post(`/jobs/${jobId}/job-card/pdf`, {}, { responseType: 'blob' });
      const opened = openPdfBlob(response.data, { printDelayMs: 900 });
      if (!opened) {
        showToast('Could not open job card PDF', 'error');
      }
    } catch {
      showToast('Failed to generate job card PDF', 'error');
    } finally {
      setPrintingJobId(null);
    }
  };

  const brandOptions = sortWithOtherLast(VEHICLE_BRANDS);
  const baseModelOptions = form.vehicleBrand && form.vehicleBrand !== 'Other'
    ? sortWithOtherLast(VEHICLE_MODELS[form.vehicleBrand] || [])
    : [];
  const modelOptions = form.vehicleBrand === 'Other'
    ? ['Other']
    : [
      ...(form.vehicleModel && !baseModelOptions.includes(form.vehicleModel) && form.vehicleModel !== 'Other'
        ? sortWithOtherLast([form.vehicleModel])
        : []),
      ...baseModelOptions,
      'Other',
    ];
  const resolvedBrand = form.vehicleBrand === 'Other' ? form.vehicleBrandOther.trim() : form.vehicleBrand.trim();
  const resolvedModel = (form.vehicleBrand === 'Other' || form.vehicleModel === 'Other')
    ? form.vehicleModelOther.trim()
    : form.vehicleModel.trim();
  const hasCurrentComplianceDates = Boolean(
    form.wofExpiryDate &&
    form.regoExpiryDate &&
    !isExpiredDate(form.wofExpiryDate) &&
    !isExpiredDate(form.regoExpiryDate)
  );
  const today = new Date();
  const minDueDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().split('T')[0];
  const canProceedCustomerStep = Boolean(
    resolvedBrand &&
    resolvedModel &&
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.phone.trim() &&
    form.email.trim() &&
    (!requiresCurrentComplianceUpdate || hasCurrentComplianceDates)
  );
  const selectedService = jobTypes?.find((jobType: any) => jobType.id === form.selectedServiceId)
    || jobTypes?.find((jobType: any) => jobType.name === form.serviceType);
  const selectedAdditionalServices = (jobTypes || []).filter((jobType: any) =>
    (form.additionalServiceIds || []).includes(jobType.id)
  );
  const selectedPackage = servicePackages?.find((pkg: any) => pkg.id === form.selectedServicePackageId);
  const selectedPackagePrice = selectedPackage?.prices?.find((price: any) => price.vehicleType === form.vehicleType)
    || selectedPackage?.prices?.[0];
  const hasPrimarySelection = form.selectionMode === 'service_package'
    ? Boolean(form.selectedServicePackageId)
    : Boolean(form.selectedServiceId);
  const canProceedServiceStep = Boolean(hasPrimarySelection || form.description.trim());
  const selectedJobPrice = form.selectionMode === 'service_package'
    ? formatPrice(selectedPackagePrice?.basePrice, selectedPackagePrice?.priceType)
    : formatPrice(selectedService?.basePrice, selectedService?.priceType);
  const complianceWarningMessage = `Last loaded WOF expiry (${formatDateLabel(lastLoadedCompliance?.wofExpiryDate)}) or Rego expiry (${formatDateLabel(lastLoadedCompliance?.regoExpiryDate)}) is expired. Update both dates before continuing, or book a WOF job now.`;

  const selectWofService = () => {
    const wofService = jobTypes?.find((jobType: any) => isWofServiceName(jobType?.name));
    if (!wofService) {
      showToast('No WOF service found in Settings. Add one, then select it manually.', 'error');
      return;
    }
    setForm((prev) => {
      const hasPrimaryService = prev.selectionMode === 'service_package'
        ? Boolean(prev.selectedServicePackageId)
        : Boolean(prev.selectedServiceId);
      const wofIsPrimary = prev.selectionMode === 'single_service' && prev.selectedServiceId === wofService.id;
      if (!hasPrimaryService || wofIsPrimary) {
        return {
          ...prev,
          selectionMode: 'single_service',
          selectedServiceId: wofService.id,
          selectedServicePackageId: '',
          serviceType: wofService.name || prev.serviceType,
          title: prev.title || wofService.name || 'WOF Service',
          additionalServiceIds: (prev.additionalServiceIds || []).filter((serviceId: string) => serviceId !== wofService.id),
        };
      }
      if ((prev.additionalServiceIds || []).includes(wofService.id)) {
        return prev;
      }
      return {
        ...prev,
        additionalServiceIds: [...(prev.additionalServiceIds || []), wofService.id],
      };
    });
    setWizardStep(2);
    showToast(`WOF added to this booking: ${wofService.name}`);
  };

  if (isLoading) {
    return (
      <PortalShell>
        <LoadingSpinner message="Loading jobs..." />
      </PortalShell>
    );
  }

  if (error) {
    return (
      <PortalShell>
        <ErrorMessage
          message="Failed to load jobs. Please try again."
          onRetry={() => refetch()}
        />
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <ConfirmDialog
        isOpen={!!deleteDialog}
        title="Delete Job"
        message="Are you sure you want to delete this job? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteJob.mutate(deleteDialog!)}
        onCancel={() => setDeleteDialog(null)}
      />
      <ConfirmDialog
        isOpen={complianceWarningOpen}
        title="WOF / Rego Expired"
        message={complianceWarningMessage}
        confirmLabel="Book WOF Job"
        cancelLabel="Update Dates"
        variant="danger"
        onConfirm={() => {
          setComplianceWarningOpen(false);
          selectWofService();
        }}
        onCancel={() => setComplianceWarningOpen(false)}
      />
      {detailModalJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#0d0d0d] border border-white/10 rounded-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden shadow-soft">
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-xs text-white/60">Job Details</p>
                <h3 className="text-lg font-semibold text-white">{detailModalJob.title || 'Untitled Job'}</h3>
                <p className="text-xs text-white/60">
                  {detailModalJob.customer?.firstName} {detailModalJob.customer?.lastName} • {detailModalJob.customer?.rego}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handlePrintJobCard(detailModalJob.id)}
                  disabled={printingJobId === detailModalJob.id}
                  className="px-3 py-1.5 rounded-lg bg-brand-primary text-black text-sm font-semibold disabled:opacity-50"
                >
                  {printingJobId === detailModalJob.id ? 'Preparing...' : 'Print Job Card'}
                </button>
                <button
                  type="button"
                  onClick={() => setDetailModalJob(null)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/10 text-sm text-white"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="overflow-y-auto max-h-[calc(85vh-72px)] px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <p className="text-xs text-white/60">Status</p>
                  <p className="text-sm font-semibold">{detailModalJob.status || 'OPEN'}</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <p className="text-xs text-white/60">Service Type</p>
                  <p className="text-sm">{detailModalJob.serviceType || 'Not set'}</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <p className="text-xs text-white/60">Due Date</p>
                  <p className="text-sm">{formatDateValue(detailModalJob.dueDate)}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-brand-primary">Customer & Vehicle</h4>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-1 text-sm">
                    <p><span className="text-white/60">Name:</span> {detailModalJob.customer?.firstName} {detailModalJob.customer?.lastName}</p>
                    <p><span className="text-white/60">Rego:</span> {detailModalJob.customer?.rego || 'Not set'}</p>
                    <p><span className="text-white/60">Brand:</span> {detailModalJob.customer?.vehicleBrand || 'Not set'}</p>
                    <p><span className="text-white/60">Model:</span> {detailModalJob.customer?.vehicleModel || 'Not set'}</p>
                    <p><span className="text-white/60">Vehicle type:</span> {detailModalJob.vehicleType || 'Not set'}</p>
                    <p><span className="text-white/60">Phone:</span> {detailModalJob.customer?.phone || 'Not set'}</p>
                    <p><span className="text-white/60">Email:</span> {detailModalJob.customer?.email || 'Not set'}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-sm font-semibold text-brand-primary">Booking Details</h4>
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-1 text-sm">
                    <p><span className="text-white/60">Created:</span> {formatDateTimeValue(detailModalJob.createdAt)}</p>
                    <p><span className="text-white/60">WOF expiry:</span> {formatDateValue(detailModalJob.wofExpiryDate)}</p>
                    <p><span className="text-white/60">Rego expiry:</span> {formatDateValue(detailModalJob.regoExpiryDate)}</p>
                    <p><span className="text-white/60">Selected service:</span> {detailModalJob.selectedService?.name || 'Not set'}</p>
                    <p><span className="text-white/60">Selected package:</span> {detailModalJob.selectedServicePackage?.name || 'Not set'}</p>
                    <p><span className="text-white/60">Package pricing:</span> {detailModalJob.packagePriceTypeSnapshot ? formatPrice(detailModalJob.packageBasePriceSnapshot, detailModalJob.packagePriceTypeSnapshot) : 'Not set'}</p>
                    <p><span className="text-white/60">Upsells:</span> {detailModalJob.upsells?.length ? detailModalJob.upsells.map((entry: any) => entry?.upsell?.name).filter(Boolean).join(', ') : 'None'}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-brand-primary">Description / Notes</h4>
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-sm whitespace-pre-wrap">
                  {detailModalJob.description?.trim() || 'No description provided.'}
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-brand-primary">Pricing Snapshot</h4>
                {detailModalJob.pricingSnapshot?.items?.length ? (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3 space-y-2">
                    {detailModalJob.pricingSnapshot.items.map((item: any, index: number) => (
                      <div key={`${item.type || 'item'}-${item.id || index}`} className="flex items-center justify-between text-sm">
                        <span>{formatPricingItemType(item.type)}: {item.name || 'Unnamed item'}</span>
                        <span className="text-white/80">{item.label || formatPrice(item.basePrice, item.priceType) || 'Not set'}</span>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-white/10 text-sm">
                      <p><span className="text-white/60">Estimated total:</span> ${Number(detailModalJob.pricingSnapshot.estimatedTotal || 0).toFixed(2)}</p>
                      {detailModalJob.pricingSnapshot.hasEstimate && (
                        <p className="text-xs text-amber-200">Includes FROM pricing items.</p>
                      )}
                      {detailModalJob.pricingSnapshot.hasQuoteRequired && (
                        <p className="text-xs text-amber-200">Includes quote-required items.</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-sm text-white/70">
                    No pricing snapshot recorded for this job.
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-brand-primary">Photos ({detailModalJob.images?.length || 0})</h4>
                <div className="flex items-center gap-2 flex-wrap">
                  {detailModalJob.images?.length ? (
                    detailModalJob.images.map((img: any) => (
                      <img key={img.id} src={img.url} alt={img.originalName} className="w-24 h-24 object-cover rounded-lg border border-white/10" />
                    ))
                  ) : (
                    <p className="text-sm text-white/60">No photos uploaded.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-4">
        {/* Header Section */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Workshop Jobs</h1>
            <p className="text-sm text-white/60 mt-1">Manage service bookings and repairs</p>
          </div>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="bg-brand-primary text-black font-semibold rounded-xl px-4 py-2 shadow-soft hover:bg-brand-accent transition flex items-center gap-2"
          >
            <span className="text-lg">+</span> Book New Service
          </button>
        </div>

        {/* Create Job Form - Collapsible */}
        {showCreateForm && (
          <div className="bg-gradient-to-br from-brand-primary/10 via-white/5 to-white/5 border-2 border-brand-primary/30 rounded-2xl p-6 shadow-soft">
            <div className="mb-4">
              <h2 className="text-xl font-semibold text-brand-primary">Book a Service</h2>
              <p className="text-sm text-white/70 mt-1">Start with the rego, then capture vehicle, customer, and service details</p>
            </div>

            <form onSubmit={handleCreate} className="space-y-6">
              {/* Mobile Wizard */}
              <div className="sm:hidden space-y-4">
                <div className="flex items-center justify-between text-xs text-white/60">
                  <span>Step {wizardStep + 1} of 3</span>
                  {lookupStatus === 'found' && <span className="text-green-200">Existing customer found</span>}
                  {lookupStatus === 'not_found' && <span className="text-amber-200">New customer</span>}
                </div>

                {wizardStep === 0 && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-2">
                    <h3 className="text-sm font-semibold text-brand-primary">Step 1: Enter Rego</h3>
                    <input
                      name="rego"
                      required
                      placeholder="Vehicle Rego *"
                      className="input"
                      value={form.rego}
                      onChange={(e) => setForm((prev) => ({ ...prev, rego: e.target.value }))}
                    />
                    {lookupStatus === 'searching' && <p className="text-xs text-white/60">Searching for customer...</p>}
                    {lookupStatus === 'found' && <p className="text-xs text-green-200">Customer details loaded</p>}
                    {lookupStatus === 'not_found' && <p className="text-xs text-amber-200">No customer found, please enter details</p>}
                    {lookupStatus === 'error' && <p className="text-xs text-red-200">Customer lookup failed</p>}
                    {lookupStatus === 'found' && lastLoadedCompliance && (
                      <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 space-y-1">
                        <p>Last loaded WOF expiry: {formatDateLabel(lastLoadedCompliance.wofExpiryDate)}</p>
                        <p>Last loaded Rego expiry: {formatDateLabel(lastLoadedCompliance.regoExpiryDate)}</p>
                        {(lastLoadedCompliance.wofExpired || lastLoadedCompliance.regoExpired) && (
                          <p className="text-amber-200">Expired record detected. Enter current WOF and Rego dates to continue.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {wizardStep === 1 && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-brand-primary">Step 2: Vehicle & Customer</h3>
                    <div className="grid grid-cols-1 gap-3">
                      <select
                        name="vehicleBrand"
                        required
                        className="input"
                        value={form.vehicleBrand}
                        onChange={(e) => {
                          autoPopulatedRef.current = false;
                          const nextBrand = e.target.value;
                          setForm((prev) => ({
                            ...prev,
                            vehicleBrand: nextBrand,
                            vehicleBrandOther: nextBrand === 'Other' ? prev.vehicleBrandOther : '',
                            vehicleModel: '',
                            vehicleModelOther: '',
                          }));
                        }}
                      >
                        <option value="">Select vehicle brand *</option>
                        {brandOptions.map((brand) => (
                          <option key={brand} value={brand}>{brand}</option>
                        ))}
                      </select>
                      {form.vehicleBrand === 'Other' && (
                        <input
                          name="vehicleBrandOther"
                          required
                          placeholder="Enter vehicle brand *"
                          className="input"
                          value={form.vehicleBrandOther}
                          onChange={(e) => {
                            autoPopulatedRef.current = false;
                            setForm((prev) => ({ ...prev, vehicleBrandOther: e.target.value }));
                          }}
                        />
                      )}
                      <select
                        name="vehicleModel"
                        required
                        className="input"
                        value={form.vehicleModel}
                        onChange={(e) => {
                          autoPopulatedRef.current = false;
                          setForm((prev) => ({ ...prev, vehicleModel: e.target.value }));
                        }}
                        disabled={!form.vehicleBrand || form.vehicleBrand === 'Other'}
                      >
                        <option value="">Select model *</option>
                        {modelOptions.map((model) => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </select>
                      {(form.vehicleBrand === 'Other' || form.vehicleModel === 'Other') && (
                        <input
                          name="vehicleModelOther"
                          required
                          placeholder="Enter vehicle model *"
                          className="input"
                          value={form.vehicleModelOther}
                          onChange={(e) => {
                            autoPopulatedRef.current = false;
                            setForm((prev) => ({ ...prev, vehicleModelOther: e.target.value }));
                          }}
                        />
                      )}
                      <select
                        name="vehicleType"
                        className="input"
                        value={form.vehicleType}
                        onChange={(e) => setForm((prev) => ({ ...prev, vehicleType: e.target.value }))}
                      >
                        {VEHICLE_TYPES.map((vehicleType) => (
                          <option key={vehicleType.value} value={vehicleType.value}>
                            {vehicleType.label}
                          </option>
                        ))}
                      </select>
                      <input
                        name="firstName"
                        required
                        placeholder="First Name *"
                        className="input"
                        value={form.firstName}
                        onChange={(e) => {
                          autoPopulatedRef.current = false;
                          setForm((prev) => ({ ...prev, firstName: e.target.value }));
                        }}
                      />
                      <input
                        name="lastName"
                        required
                        placeholder="Last Name *"
                        className="input"
                        value={form.lastName}
                        onChange={(e) => {
                          autoPopulatedRef.current = false;
                          setForm((prev) => ({ ...prev, lastName: e.target.value }));
                        }}
                      />
                      <input
                        name="phone"
                        required
                        placeholder="Phone *"
                        className="input"
                        value={form.phone}
                        onChange={(e) => {
                          autoPopulatedRef.current = false;
                          setForm((prev) => ({ ...prev, phone: e.target.value }));
                        }}
                      />
                      <input
                        name="email"
                        required
                        type="email"
                        placeholder="Email *"
                        className="input"
                        value={form.email}
                        onChange={(e) => {
                          autoPopulatedRef.current = false;
                          setForm((prev) => ({ ...prev, email: e.target.value }));
                        }}
                      />
                      <input
                        name="wofExpiryDate"
                        type="date"
                        required={requiresCurrentComplianceUpdate}
                        className="input"
                        value={form.wofExpiryDate}
                        onChange={(e) => setForm((prev) => ({ ...prev, wofExpiryDate: e.target.value }))}
                      />
                      <input
                        name="regoExpiryDate"
                        type="date"
                        required={requiresCurrentComplianceUpdate}
                        className="input"
                        value={form.regoExpiryDate}
                        onChange={(e) => setForm((prev) => ({ ...prev, regoExpiryDate: e.target.value }))}
                      />
                    </div>
                    {requiresCurrentComplianceUpdate ? (
                      <p className="text-xs text-amber-200">Both WOF and Rego dates are mandatory and must be current because the loaded record is expired.</p>
                    ) : (
                      <p className="text-xs text-white/50">WOF/Rego dates are optional unless loaded compliance is expired.</p>
                    )}
                  </div>
                )}

                {wizardStep === 2 && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-brand-primary">Step 3: Service & Issue</h3>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            selectionMode: 'single_service',
                            selectedServicePackageId: '',
                          }))
                        }
                        className={`rounded-xl px-3 py-2 border text-sm font-semibold ${
                          form.selectionMode === 'single_service'
                            ? 'bg-brand-primary text-black border-transparent'
                            : 'bg-white/10 border-white/10 text-white'
                        }`}
                      >
                        Single Service
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            selectionMode: 'service_package',
                            selectedServiceId: '',
                            serviceType: '',
                          }))
                        }
                        className={`rounded-xl px-3 py-2 border text-sm font-semibold ${
                          form.selectionMode === 'service_package'
                            ? 'bg-brand-primary text-black border-transparent'
                            : 'bg-white/10 border-white/10 text-white'
                        }`}
                      >
                        Service Package
                      </button>
                    </div>
                    {form.selectionMode === 'single_service' ? (
                      <select
                        name="selectedServiceId"
                        className="input"
                        value={form.selectedServiceId}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            selectedServiceId: e.target.value,
                            selectedServicePackageId: '',
                            additionalServiceIds: (prev.additionalServiceIds || []).filter((serviceId: string) => serviceId !== e.target.value),
                            serviceType: jobTypes?.find((jobType: any) => jobType.id === e.target.value)?.name || '',
                            title: prev.title || jobTypes?.find((jobType: any) => jobType.id === e.target.value)?.name || '',
                          }))
                        }
                      >
                        <option value="">Select service type</option>
                        {jobTypes?.map((jobType: any) => (
                          <option key={jobType.id} value={jobType.id}>
                            {jobType.name}{jobType.basePrice != null ? ` - ${formatPrice(jobType.basePrice, jobType.priceType)}` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <select
                        name="selectedServicePackageId"
                        className="input"
                        value={form.selectedServicePackageId}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            selectedServicePackageId: e.target.value,
                            selectedServiceId: '',
                            serviceType: servicePackages?.find((pkg: any) => pkg.id === e.target.value)?.name || '',
                            title: prev.title || servicePackages?.find((pkg: any) => pkg.id === e.target.value)?.name || '',
                          }))
                        }
                      >
                        <option value="">Select package</option>
                        {servicePackages?.map((pkg: any) => {
                          const price = pkg.prices?.find((p: any) => p.vehicleType === form.vehicleType) || pkg.prices?.[0];
                          return (
                            <option key={pkg.id} value={pkg.id}>
                              {pkg.name}{price ? ` - ${formatPrice(price.basePrice, price.priceType)}` : ''}
                            </option>
                          );
                        })}
                      </select>
                    )}
                    {selectedJobPrice && (
                      <p className="text-xs text-white/60">Price: {selectedJobPrice}</p>
                    )}
                    {selectedAdditionalServices.length > 0 && (
                      <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                        <p className="text-xs text-white/60">Additional booked services</p>
                        <div className="space-y-1">
                          {selectedAdditionalServices.map((service: any) => (
                            <div key={`mobile-addon-${service.id}`} className="flex items-center justify-between text-xs">
                              <span>
                                {service.name}
                                {service.basePrice != null ? ` (${formatPrice(service.basePrice, service.priceType)})` : ''}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setForm((prev) => ({
                                    ...prev,
                                    additionalServiceIds: (prev.additionalServiceIds || []).filter((serviceId: string) => serviceId !== service.id),
                                  }))
                                }
                                className="px-2 py-1 rounded-lg border border-white/10 bg-white/5"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {form.selectionMode === 'service_package' && selectedPackage?.inclusions?.length > 0 && (
                      <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-1">
                        <p className="text-xs text-white/60">Inclusions</p>
                        <div className="text-xs space-y-1">
                          {selectedPackage.inclusions.slice(0, 5).map((inclusion: any) => (
                            <p key={`${selectedPackage.id}-${inclusion.id || inclusion.sortOrder}`}>{inclusion.title}</p>
                          ))}
                          {selectedPackage.inclusions.length > 5 && (
                            <p className="text-white/60">+{selectedPackage.inclusions.length - 5} more</p>
                          )}
                        </div>
                      </div>
                    )}
                    {form.selectionMode === 'single_service' && jobTypes?.length === 0 && (
                      <p className="text-xs text-white/50">No services available. Add them in Settings.</p>
                    )}
                    {form.selectionMode === 'service_package' && servicePackages?.length === 0 && (
                      <p className="text-xs text-white/50">No service packages available. Add them in Settings.</p>
                    )}
                    <textarea
                      name="description"
                      placeholder="Describe the issue (required if no service type selected)"
                      className="input min-h-[90px]"
                      value={form.description}
                      onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                    />
                    <input
                      name="dueDate"
                      type="date"
                      className="input sm:max-w-[220px]"
                      min={minDueDate}
                      value={form.dueDate}
                      onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                    />
                    {!canProceedServiceStep && (
                      <p className="text-xs text-amber-200">Select a service/package or enter a description.</p>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {wizardStep > 0 && (
                    <button
                      type="button"
                      onClick={() => setWizardStep((step) => Math.max(0, step - 1))}
                      className="flex-1 px-4 py-2 bg-white/5 border border-white/10 text-white rounded-xl font-semibold transition"
                    >
                      Back
                    </button>
                  )}
                  {wizardStep < 2 ? (
                    <button
                      type="button"
                      onClick={() => setWizardStep((step) => Math.min(2, step + 1))}
                      disabled={(wizardStep === 0 && !form.rego.trim()) || (wizardStep === 1 && !canProceedCustomerStep)}
                      className="flex-1 px-4 py-2 bg-brand-primary text-black rounded-xl font-semibold shadow-soft disabled:opacity-50"
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!canProceedServiceStep || createJob.isPending}
                      className="flex-1 px-4 py-2 bg-brand-primary text-black rounded-xl font-semibold shadow-soft disabled:opacity-50"
                    >
                      {createJob.isPending ? 'Submitting...' : 'Submit Job'}
                    </button>
                  )}
                </div>
              </div>

              {/* Desktop Form */}
              <div className="hidden sm:block space-y-6">
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-brand-primary mb-2">STEP 1: Registration</h3>
                  <input
                    name="rego"
                    required
                    placeholder="Vehicle Rego *"
                    className="input"
                    value={form.rego}
                    onChange={(e) => setForm((prev) => ({ ...prev, rego: e.target.value }))}
                  />
                  {lookupStatus === 'searching' && <p className="text-xs text-white/60 mt-2">Searching for customer...</p>}
                  {lookupStatus === 'found' && <p className="text-xs text-green-200 mt-2">Customer details loaded</p>}
                  {lookupStatus === 'not_found' && <p className="text-xs text-amber-200 mt-2">No customer found, please enter details</p>}
                  {lookupStatus === 'error' && <p className="text-xs text-red-200 mt-2">Customer lookup failed</p>}
                  {lookupStatus === 'found' && lastLoadedCompliance && (
                    <div className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 space-y-1">
                      <p>Last loaded WOF expiry: {formatDateLabel(lastLoadedCompliance.wofExpiryDate)}</p>
                      <p>Last loaded Rego expiry: {formatDateLabel(lastLoadedCompliance.regoExpiryDate)}</p>
                      {(lastLoadedCompliance.wofExpired || lastLoadedCompliance.regoExpired) && (
                        <p className="text-amber-200">Expired record detected. Enter current WOF and Rego dates to continue.</p>
                      )}
                    </div>
                  )}
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-brand-primary mb-3">STEP 2: Vehicle & Customer Details</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <select
                      name="vehicleBrand"
                      required
                      className="input"
                      value={form.vehicleBrand}
                      onChange={(e) => {
                        autoPopulatedRef.current = false;
                        const nextBrand = e.target.value;
                        setForm((prev) => ({
                          ...prev,
                          vehicleBrand: nextBrand,
                          vehicleBrandOther: nextBrand === 'Other' ? prev.vehicleBrandOther : '',
                          vehicleModel: '',
                          vehicleModelOther: '',
                        }));
                      }}
                    >
                      <option value="">Select vehicle brand *</option>
                      {brandOptions.map((brand) => (
                        <option key={brand} value={brand}>{brand}</option>
                      ))}
                    </select>
                    {form.vehicleBrand === 'Other' && (
                      <input
                        name="vehicleBrandOther"
                        required
                        placeholder="Enter vehicle brand *"
                        className="input"
                        value={form.vehicleBrandOther}
                        onChange={(e) => {
                          autoPopulatedRef.current = false;
                          setForm((prev) => ({ ...prev, vehicleBrandOther: e.target.value }));
                        }}
                      />
                    )}
                    <select
                      name="vehicleModel"
                      required
                      className="input"
                      value={form.vehicleModel}
                      onChange={(e) => {
                        autoPopulatedRef.current = false;
                        setForm((prev) => ({ ...prev, vehicleModel: e.target.value }));
                      }}
                      disabled={!form.vehicleBrand || form.vehicleBrand === 'Other'}
                    >
                      <option value="">Select model *</option>
                      {modelOptions.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                    {(form.vehicleBrand === 'Other' || form.vehicleModel === 'Other') && (
                      <input
                        name="vehicleModelOther"
                        required
                        placeholder="Enter vehicle model *"
                        className="input"
                        value={form.vehicleModelOther}
                        onChange={(e) => {
                          autoPopulatedRef.current = false;
                          setForm((prev) => ({ ...prev, vehicleModelOther: e.target.value }));
                        }}
                      />
                    )}
                    <select
                      name="vehicleType"
                      className="input"
                      value={form.vehicleType}
                      onChange={(e) => setForm((prev) => ({ ...prev, vehicleType: e.target.value }))}
                    >
                      {VEHICLE_TYPES.map((vehicleType) => (
                        <option key={vehicleType.value} value={vehicleType.value}>
                          {vehicleType.label}
                        </option>
                      ))}
                    </select>
                    <input
                      name="firstName"
                      required
                      placeholder="First Name *"
                      className="input"
                      value={form.firstName}
                      onChange={(e) => {
                        autoPopulatedRef.current = false;
                        setForm((prev) => ({ ...prev, firstName: e.target.value }));
                      }}
                    />
                    <input
                      name="lastName"
                      required
                      placeholder="Last Name *"
                      className="input"
                      value={form.lastName}
                      onChange={(e) => {
                        autoPopulatedRef.current = false;
                        setForm((prev) => ({ ...prev, lastName: e.target.value }));
                      }}
                    />
                    <input
                      name="phone"
                      required
                      placeholder="Phone *"
                      className="input"
                      value={form.phone}
                      onChange={(e) => {
                        autoPopulatedRef.current = false;
                        setForm((prev) => ({ ...prev, phone: e.target.value }));
                      }}
                    />
                    <input
                      name="email"
                      required
                      type="email"
                      placeholder="Email *"
                      className="input"
                      value={form.email}
                      onChange={(e) => {
                        autoPopulatedRef.current = false;
                        setForm((prev) => ({ ...prev, email: e.target.value }));
                      }}
                    />
                    <input
                      name="wofExpiryDate"
                      type="date"
                      required={requiresCurrentComplianceUpdate}
                      className="input"
                      value={form.wofExpiryDate}
                      onChange={(e) => setForm((prev) => ({ ...prev, wofExpiryDate: e.target.value }))}
                    />
                    <input
                      name="regoExpiryDate"
                      type="date"
                      required={requiresCurrentComplianceUpdate}
                      className="input"
                      value={form.regoExpiryDate}
                      onChange={(e) => setForm((prev) => ({ ...prev, regoExpiryDate: e.target.value }))}
                    />
                  </div>
                  {requiresCurrentComplianceUpdate ? (
                    <p className="text-xs text-amber-200 mt-3">Both WOF and Rego dates are mandatory and must be current because the loaded record is expired.</p>
                  ) : (
                    <p className="text-xs text-white/50 mt-3">WOF/Rego dates are optional unless loaded compliance is expired.</p>
                  )}
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-brand-primary mb-3">STEP 3: Service & Issue</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              selectionMode: 'single_service',
                              selectedServicePackageId: '',
                            }))
                          }
                          className={`rounded-xl px-3 py-2 border text-sm font-semibold ${
                            form.selectionMode === 'single_service'
                              ? 'bg-brand-primary text-black border-transparent'
                              : 'bg-white/10 border-white/10 text-white'
                          }`}
                        >
                          Single Service
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setForm((prev) => ({
                              ...prev,
                              selectionMode: 'service_package',
                              selectedServiceId: '',
                              serviceType: '',
                            }))
                          }
                          className={`rounded-xl px-3 py-2 border text-sm font-semibold ${
                            form.selectionMode === 'service_package'
                              ? 'bg-brand-primary text-black border-transparent'
                              : 'bg-white/10 border-white/10 text-white'
                          }`}
                        >
                          Service Package
                        </button>
                      </div>
                      {form.selectionMode === 'single_service' ? (
                        <select
                          name="selectedServiceId"
                          className="input"
                          value={form.selectedServiceId}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              selectedServiceId: e.target.value,
                              selectedServicePackageId: '',
                              additionalServiceIds: (prev.additionalServiceIds || []).filter((serviceId: string) => serviceId !== e.target.value),
                              serviceType: jobTypes?.find((jobType: any) => jobType.id === e.target.value)?.name || '',
                              title: prev.title || jobTypes?.find((jobType: any) => jobType.id === e.target.value)?.name || '',
                            }))
                          }
                        >
                          <option value="">Select service type</option>
                          {jobTypes?.map((jobType: any) => (
                            <option key={jobType.id} value={jobType.id}>
                              {jobType.name}{jobType.basePrice != null ? ` - ${formatPrice(jobType.basePrice, jobType.priceType)}` : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <select
                          name="selectedServicePackageId"
                          className="input"
                          value={form.selectedServicePackageId}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              selectedServicePackageId: e.target.value,
                              selectedServiceId: '',
                              serviceType: servicePackages?.find((pkg: any) => pkg.id === e.target.value)?.name || '',
                              title: prev.title || servicePackages?.find((pkg: any) => pkg.id === e.target.value)?.name || '',
                            }))
                          }
                        >
                          <option value="">Select package</option>
                          {servicePackages?.map((pkg: any) => {
                            const price = pkg.prices?.find((p: any) => p.vehicleType === form.vehicleType) || pkg.prices?.[0];
                            return (
                              <option key={pkg.id} value={pkg.id}>
                                {pkg.name}{price ? ` - ${formatPrice(price.basePrice, price.priceType)}` : ''}
                              </option>
                            );
                          })}
                        </select>
                      )}
                      {selectedJobPrice && (
                        <p className="text-xs text-white/60">Price: {selectedJobPrice}</p>
                      )}
                      {selectedAdditionalServices.length > 0 && (
                        <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                          <p className="text-xs text-white/60">Additional booked services</p>
                          <div className="space-y-1">
                            {selectedAdditionalServices.map((service: any) => (
                              <div key={`desktop-addon-${service.id}`} className="flex items-center justify-between text-xs">
                                <span>
                                  {service.name}
                                  {service.basePrice != null ? ` (${formatPrice(service.basePrice, service.priceType)})` : ''}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setForm((prev) => ({
                                      ...prev,
                                      additionalServiceIds: (prev.additionalServiceIds || []).filter((serviceId: string) => serviceId !== service.id),
                                    }))
                                  }
                                  className="px-2 py-1 rounded-lg border border-white/10 bg-white/5"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {form.selectionMode === 'service_package' && selectedPackage?.inclusions?.length > 0 && (
                        <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-1">
                          <p className="text-xs text-white/60">Inclusions</p>
                          <div className="text-xs space-y-1">
                            {selectedPackage.inclusions.slice(0, 5).map((inclusion: any) => (
                              <p key={`${selectedPackage.id}-${inclusion.id || inclusion.sortOrder}`}>{inclusion.title}</p>
                            ))}
                            {selectedPackage.inclusions.length > 5 && (
                              <p className="text-white/60">+{selectedPackage.inclusions.length - 5} more</p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <input
                      name="dueDate"
                      type="date"
                      className="input sm:max-w-[220px]"
                      min={minDueDate}
                      value={form.dueDate}
                      onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))}
                    />
                  </div>
                  {form.selectionMode === 'single_service' && jobTypes?.length === 0 && (
                    <p className="text-xs text-white/50 mt-2">No services available. Add them in Settings.</p>
                  )}
                  {form.selectionMode === 'service_package' && servicePackages?.length === 0 && (
                    <p className="text-xs text-white/50 mt-2">No service packages available. Add them in Settings.</p>
                  )}
                  <textarea
                    name="description"
                    placeholder="Describe the issue (required if no service type selected)"
                    className="input mt-3 min-h-[90px]"
                    value={form.description}
                    onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  />
                  {!canProceedServiceStep && (
                    <p className="text-xs text-amber-200 mt-2">Select a service/package or enter a description.</p>
                  )}
                </div>

              {/* Actions */}
                <div className="flex gap-3 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateForm(false);
                      resetCreateForm();
                    }}
                    className="px-6 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl font-semibold transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createJob.isPending || !canProceedCustomerStep || !form.rego.trim() || !canProceedServiceStep}
                    className="px-6 py-2.5 bg-brand-primary text-black font-semibold rounded-xl shadow-soft hover:bg-brand-accent transition disabled:opacity-50"
                  >
                    {createJob.isPending ? 'Creating...' : 'Create Job Booking'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

        {/* Search */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">All Jobs ({jobs?.length || 0})</h2>
            <p className="text-xs text-white/50">Double-click any job row to open full booking details.</p>
          </div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by rego, customer, or job..." className="input w-64" />
        </div>

        {/* Jobs Table */}
        {jobs?.length === 0 ? (
          <EmptyState message="No jobs found. Book a new service to get started." action={{ label: 'Book Service', onClick: () => setShowCreateForm(true) }} />
        ) : (
          <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            {/* Table Header */}
            <div className="hidden md:grid md:grid-cols-12 gap-4 bg-white/10 border-b border-white/10 px-4 py-3 text-sm font-semibold text-white/80">
              <div className="col-span-2">Rego</div>
              <div className="col-span-3">Job Title / Customer</div>
              <div className="col-span-2">Service Type</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Due Date</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>

            {/* Table Body */}
            <div className="divide-y divide-white/10">
              {jobs?.map((job: any) => (
                <div key={job.id}>
                  {editingJob?.id === job.id ? (
                    /* Edit Mode */
                    <div className="px-4 py-4 bg-white/5">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                        <input className="input" value={editingJob.title} onChange={(e) => setEditingJob({ ...editingJob, title: e.target.value })} placeholder="Job title" />
                        <select className="input" value={editingJob.status} onChange={(e) => setEditingJob({ ...editingJob, status: e.target.value })}>
                          <option value="OPEN">OPEN</option>
                          <option value="IN_PROGRESS">IN PROGRESS</option>
                          <option value="COMPLETED">COMPLETED</option>
                          <option value="CANCELLED">CANCELLED</option>
                        </select>
                        <input className="input" value={editingJob.serviceType || ''} onChange={(e) => setEditingJob({ ...editingJob, serviceType: e.target.value })} placeholder="Service type" />
                        <input type="date" className="input" value={editingJob.dueDate ? new Date(editingJob.dueDate).toISOString().split('T')[0] : ''} onChange={(e) => setEditingJob({ ...editingJob, dueDate: e.target.value })} />
                      </div>
                      <textarea className="input mb-3" value={editingJob.description || ''} onChange={(e) => setEditingJob({ ...editingJob, description: e.target.value })} placeholder="Description" />
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdate(editingJob)} className="px-3 py-1.5 bg-brand-primary text-black rounded-lg text-xs font-semibold">Save</button>
                        <button onClick={() => setEditingJob(null)} className="px-3 py-1.5 bg-white/5 border border-white/10 text-white rounded-lg text-xs">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    /* Normal Row */
                    <>
                      <div
                        className="grid grid-cols-1 md:grid-cols-12 gap-4 px-4 py-3 hover:bg-white/5 transition cursor-pointer"
                        onClick={() => setExpandedRow(expandedRow === job.id ? null : job.id)}
                        onDoubleClick={() => setDetailModalJob(job)}
                      >
                        {/* Rego */}
                        <div className="md:col-span-2 flex items-center">
                          <span className="px-2 py-1 text-xs font-semibold rounded-md bg-brand-primary/20 text-brand-primary border border-brand-primary/30">
                            {job.customer?.rego}
                          </span>
                        </div>

                        {/* Job Title / Customer */}
                        <div className="md:col-span-3">
                          <p className="font-semibold text-white">{job.title}</p>
                          <p className="text-xs text-white/60">{job.customer?.firstName} {job.customer?.lastName}</p>
                        </div>

                        {/* Service Type */}
                        <div className="md:col-span-2 flex items-center">
                          <span className="px-2 py-1 text-xs rounded-full bg-white/10 border border-white/10">{job.serviceType || 'N/A'}</span>
                        </div>

                        {/* Status */}
                        <div className="md:col-span-2 flex items-center">
                          <span className={`px-2 py-1 text-xs rounded-full border ${
                            job.status === 'COMPLETED' ? 'bg-green-500/10 border-green-500/30 text-green-200' :
                            job.status === 'IN_PROGRESS' ? 'bg-blue-500/10 border-blue-500/30 text-blue-200' :
                            job.status === 'CANCELLED' ? 'bg-red-500/10 border-red-500/30 text-red-200' :
                            'bg-white/5 border-white/10'
                          }`}>
                            {job.status}
                          </span>
                        </div>

                        {/* Due Date */}
                        <div className="md:col-span-2 flex items-center">
                          {job.dueDate ? (
                            <div className="flex flex-col">
                              <span className="text-sm">{new Date(job.dueDate).toLocaleDateString()}</span>
                              {new Date(job.dueDate) < new Date() && (
                                <span className="text-xs text-red-200">Overdue</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-white/40 text-sm">No due date</span>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="md:col-span-1 flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handlePrintJobCard(job.id);
                            }}
                            className="px-2 py-1 text-xs rounded-lg bg-brand-primary/20 hover:bg-brand-primary/30 border border-brand-primary/30 text-brand-primary transition"
                          >
                            {printingJobId === job.id ? 'Printing…' : 'Print'}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); setEditingJob(job); }} className="px-2 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white transition">
                            Edit
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); setDeleteDialog(job.id); }} className="px-2 py-1 text-xs rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-200 transition">
                            Delete
                          </button>
                        </div>
                      </div>

                      {/* Expanded Details */}
                      {expandedRow === job.id && (
                        <div className="px-4 py-3 bg-white/5 border-t border-white/10">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Left Column */}
                            <div className="space-y-2">
                              <div>
                                <p className="text-xs text-white/60">Customer Contact</p>
                                <p className="text-sm">{job.customer?.phone} • {job.customer?.email}</p>
                              </div>
                              {job.description && (
                                <div>
                                  <p className="text-xs text-white/60">Description</p>
                                  <p className="text-sm text-white/80">{job.description}</p>
                                </div>
                              )}
                              <div>
                                <p className="text-xs text-white/60">Created</p>
                                <p className="text-sm">{new Date(job.createdAt).toLocaleDateString()} {new Date(job.createdAt).toLocaleTimeString()}</p>
                              </div>
                            </div>

                            {/* Right Column - Images */}
                            <div>
                              <p className="text-xs text-white/60 mb-2">Photos ({job.images?.length || 0})</p>
                              <div className="flex items-center gap-2 flex-wrap">
                                {job.images?.map((img: any) => (
                                  <img key={img.id} src={img.url} alt={img.originalName} className="w-20 h-20 object-cover rounded-lg border border-white/10" />
                                ))}
                                <label className="text-xs px-3 py-2 rounded-xl bg-white/5 border border-dashed border-white/20 cursor-pointer hover:bg-white/10 transition h-20 flex items-center justify-center">
                                  {uploading === job.id ? 'Uploading…' : '+ Add'}
                                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleUpload(job.id, e.target.files)} />
                                </label>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </PortalShell>
  );
};
