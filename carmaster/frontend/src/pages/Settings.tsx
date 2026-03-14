import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import api from '../api/client';
import { PortalShell } from '../components/PortalShell';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { ErrorMessage } from '../components/ErrorMessage';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useToast } from '../context/ToastContext';

const VEHICLE_TYPES = ['JAPANESE', 'EUROPEAN'] as const;
const PRICE_TYPES = ['FIXED', 'FROM', 'QUOTE_REQUIRED'] as const;
const INCLUSION_TYPES = ['INCLUDED_SERVICE', 'INCLUDED_UPSELL', 'CHECK_ITEM', 'NOTE'] as const;

type ActivityLogItem = {
  id: string;
  action: string;
  status: string;
  entity: string;
  entityId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  actorRole: string | null;
  method: string;
  path: string;
  createdAt: string;
};

const createDefaultPackageForm = () => ({
  name: '',
  description: '',
  isActive: true,
  prices: [
    { vehicleType: 'JAPANESE', basePrice: '', priceType: 'FIXED', notes: '' },
    { vehicleType: 'EUROPEAN', basePrice: '', priceType: 'FIXED', notes: '' },
  ],
  inclusions: [{ type: 'INCLUDED_SERVICE', title: '', isRequired: true, sortOrder: 0 }],
});

const formatPrice = (value: any, priceType?: string) => {
  if (priceType === 'QUOTE_REQUIRED') return 'Quote required';
  const num = Number(value);
  if (!Number.isFinite(num)) return '$0.00';
  return priceType === 'FROM' ? `From $${num.toFixed(2)}` : `$${num.toFixed(2)}`;
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-NZ', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatLabel = (value: string) => {
  return value
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

export const SettingsPage = () => {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const publicUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/q`;
  const qrImageUrl = publicUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(publicUrl)}`
    : '';
  const { data: settings, isLoading: settingsLoading, error: settingsError, refetch: refetchSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data,
  });
  const { data: services, isLoading: servicesLoading, error: servicesError, refetch: refetchServices } = useQuery({
    queryKey: ['services'],
    queryFn: async () => (await api.get('/settings/services')).data,
  });
  const { data: upsells, isLoading: upsellsLoading, error: upsellsError, refetch: refetchUpsells } = useQuery({
    queryKey: ['upsells'],
    queryFn: async () => (await api.get('/settings/upsells')).data,
  });
  const {
    data: servicePackages,
    isLoading: servicePackagesLoading,
    error: servicePackagesError,
    refetch: refetchServicePackages,
  } = useQuery({
    queryKey: ['service-packages'],
    queryFn: async () => (await api.get('/settings/service-packages')).data,
  });

  const [form, setForm] = useState<any>({});
  const [activeTab, setActiveTab] = useState('business');
  const [serviceForm, setServiceForm] = useState({
    name: '',
    description: '',
    checklist: '',
    basePrice: '',
    priceType: 'FIXED',
    durationMinutes: '',
  });
  const [editingService, setEditingService] = useState<any | null>(null);
  const [deleteServiceDialog, setDeleteServiceDialog] = useState<string | null>(null);
  const [upsellForm, setUpsellForm] = useState({
    name: '',
    description: '',
    price: '',
    priceType: 'FIXED',
    applicabilityRules: '',
    isActive: true,
  });
  const [editingUpsell, setEditingUpsell] = useState<any | null>(null);
  const [deleteUpsellDialog, setDeleteUpsellDialog] = useState<string | null>(null);
  const [servicePackageForm, setServicePackageForm] = useState<any>(createDefaultPackageForm());
  const [editingServicePackage, setEditingServicePackage] = useState<any | null>(null);
  const [deleteServicePackageDialog, setDeleteServicePackageDialog] = useState<string | null>(null);
  const [activityFilters, setActivityFilters] = useState({
    action: '',
    status: '',
    entity: '',
    actor: '',
  });

  const {
    data: activityLogs,
    isLoading: activityLogsLoading,
    error: activityLogsError,
    refetch: refetchActivityLogs,
  } = useQuery<ActivityLogItem[]>({
    queryKey: ['activity-logs', activityFilters],
    queryFn: async () =>
      (
        await api.get('/settings/activity-logs', {
          params: {
            ...activityFilters,
            limit: 250,
          },
        })
      ).data as ActivityLogItem[],
    enabled: activeTab === 'activity-logs',
  });

  const activityEntities = useMemo(() => {
    const unique = new Set((activityLogs || []).map((log) => log.entity).filter(Boolean));
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [activityLogs]);

  const saveSettings = useMutation({
    mutationFn: () => api.patch('/settings', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      showToast('Settings saved successfully');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to save settings';
      showToast(message, 'error');
    },
  });

  const testBookings = useMutation({
    mutationFn: () => api.post('/settings/bookings/test'),
    onSuccess: (response) => {
      const count = response?.data?.serviceCount ?? 0;
      showToast(`Bookings connected. ${count} services found.`);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Bookings connection failed';
      showToast(message, 'error');
    },
  });

  const parseRules = (value: string) => {
    if (!value || !value.trim()) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      throw new Error('Invalid JSON in rules');
    }
  };

  const addService = useMutation({
    mutationFn: () =>
      api.post('/settings/services', {
        name: serviceForm.name,
        description: serviceForm.description,
        checklist: serviceForm.checklist.split(',').map((c) => c.trim()).filter(c => c),
        basePrice: serviceForm.basePrice !== '' ? Number(serviceForm.basePrice) : 0,
        priceType: serviceForm.priceType,
        durationMinutes: serviceForm.durationMinutes !== '' ? Number(serviceForm.durationMinutes) : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
      setServiceForm({ name: '', description: '', checklist: '', basePrice: '', priceType: 'FIXED', durationMinutes: '' });
      showToast('Service added successfully');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to add service';
      showToast(message, 'error');
    },
  });

  const updateService = useMutation({
    mutationFn: ({ id, name, description, checklist, basePrice, priceType, durationMinutes }: any) =>
      api.patch(`/settings/services/${id}`, {
        name,
        description,
        checklist: checklist?.split(',').map((c: string) => c.trim()).filter((c: string) => c) ?? [],
        basePrice: basePrice !== '' ? Number(basePrice) : 0,
        priceType,
        durationMinutes: durationMinutes !== '' ? Number(durationMinutes) : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
      setEditingService(null);
      showToast('Service updated successfully');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to update service';
      showToast(message, 'error');
    },
  });

  const addUpsell = useMutation({
    mutationFn: () => {
      const applicabilityRules = parseRules(upsellForm.applicabilityRules);
      return api.post('/settings/upsells', {
        name: upsellForm.name,
        description: upsellForm.description,
        price: upsellForm.price !== '' ? Number(upsellForm.price) : 0,
        priceType: upsellForm.priceType,
        applicabilityRules,
        isActive: upsellForm.isActive,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['upsells'] });
      setUpsellForm({
        name: '',
        description: '',
        price: '',
        priceType: 'FIXED',
        applicabilityRules: '',
        isActive: true,
      });
      showToast('Upsell option added successfully');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Failed to add upsell option';
      showToast(message, 'error');
    },
  });

  const updateUpsell = useMutation({
    mutationFn: ({ id, price, applicabilityRules, ...payload }: any) => {
      const parsedRules = parseRules(applicabilityRules || '');
      return api.patch(`/settings/upsells/${id}`, {
        ...payload,
        price: price !== '' ? Number(price) : 0,
        applicabilityRules: parsedRules,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['upsells'] });
      setEditingUpsell(null);
      showToast('Upsell option updated successfully');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Failed to update upsell option';
      showToast(message, 'error');
    },
  });

  const deleteUpsell = useMutation({
    mutationFn: async (id: string) => api.delete(`/settings/upsells/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['upsells'] });
      setDeleteUpsellDialog(null);
      showToast('Upsell option deleted successfully');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to delete upsell option';
      showToast(message, 'error');
    },
  });

  const deleteService = useMutation({
    mutationFn: async (id: string) => api.delete(`/settings/services/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['services'] });
      setDeleteServiceDialog(null);
      showToast('Service deleted successfully');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to delete service';
      showToast(message, 'error');
    },
  });

  const addServicePackage = useMutation({
    mutationFn: async () => {
      const payload = {
        name: servicePackageForm.name,
        description: servicePackageForm.description,
        isActive: servicePackageForm.isActive,
        prices: servicePackageForm.prices.map((price: any) => ({
          vehicleType: price.vehicleType,
          basePrice: price.basePrice !== '' ? Number(price.basePrice) : 0,
          priceType: price.priceType,
          notes: price.notes || undefined,
        })),
        inclusions: servicePackageForm.inclusions
          .filter((inclusion: any) => inclusion.title?.trim())
          .map((inclusion: any, index: number) => ({
            type: inclusion.type,
            title: inclusion.title.trim(),
            isRequired: inclusion.isRequired,
            sortOrder: index,
          })),
      };
      return api.post('/settings/service-packages', payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-packages'] });
      setServicePackageForm(createDefaultPackageForm());
      showToast('Service package added successfully');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to add service package';
      showToast(message, 'error');
    },
  });

  const updateServicePackage = useMutation({
    mutationFn: async (payload: any) => {
      const data = {
        name: payload.name,
        description: payload.description,
        isActive: payload.isActive,
        prices: payload.prices.map((price: any) => ({
          vehicleType: price.vehicleType,
          basePrice: price.basePrice !== '' ? Number(price.basePrice) : 0,
          priceType: price.priceType,
          notes: price.notes || undefined,
        })),
        inclusions: (payload.inclusions || [])
          .filter((inclusion: any) => inclusion.title?.trim())
          .map((inclusion: any, index: number) => ({
            type: inclusion.type,
            title: inclusion.title.trim(),
            isRequired: inclusion.isRequired,
            sortOrder: index,
          })),
      };
      return api.patch(`/settings/service-packages/${payload.id}`, data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-packages'] });
      setEditingServicePackage(null);
      showToast('Service package updated successfully');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to update service package';
      showToast(message, 'error');
    },
  });

  const deleteServicePackage = useMutation({
    mutationFn: async (id: string) => api.delete(`/settings/service-packages/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service-packages'] });
      setDeleteServicePackageDialog(null);
      showToast('Service package deleted successfully');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || 'Failed to delete service package';
      showToast(message, 'error');
    },
  });

  if (settingsLoading || servicesLoading || upsellsLoading || servicePackagesLoading) {
    return (
      <PortalShell>
        <LoadingSpinner message="Loading settings..." />
      </PortalShell>
    );
  }

  if (settingsError || servicesError || upsellsError || servicePackagesError) {
    return (
      <PortalShell>
        <ErrorMessage
          message="Failed to load settings. Please try again."
          onRetry={() => {
            refetchSettings();
            refetchServices();
            refetchUpsells();
            refetchServicePackages();
          }}
        />
      </PortalShell>
    );
  }

  const tabs = [
    { id: 'business', label: 'Business profile' },
    { id: 'branding', label: 'Branding' },
    { id: 'theme', label: 'Theme' },
    { id: 'activity-logs', label: 'Activity logs' },
    { id: 'services', label: 'Services' },
    { id: 'service-packages', label: 'Service Packages' },
    { id: 'upsells', label: 'Upsells' },
    { id: 'office365', label: 'Office 365 integration' },
    { id: 'templates', label: 'Templates' },
  ];

  return (
    <PortalShell>
      <ConfirmDialog
        isOpen={!!deleteServiceDialog}
        title="Delete service"
        message="Are you sure you want to delete this service? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteService.mutate(deleteServiceDialog!)}
        onCancel={() => setDeleteServiceDialog(null)}
      />
      <ConfirmDialog
        isOpen={!!deleteUpsellDialog}
        title="Delete Upsell Option"
        message="Are you sure you want to delete this upsell option? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteUpsell.mutate(deleteUpsellDialog!)}
        onCancel={() => setDeleteUpsellDialog(null)}
      />
      <ConfirmDialog
        isOpen={!!deleteServicePackageDialog}
        title="Delete Service Package"
        message="Are you sure you want to delete this service package? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => deleteServicePackage.mutate(deleteServicePackageDialog!)}
        onCancel={() => setDeleteServicePackageDialog(null)}
      />
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border transition ${
                activeTab === tab.id
                  ? 'bg-brand-primary text-black border-brand-primary'
                  : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'business' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
            <h2 className="font-semibold">Business profile</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {['businessName', 'phone', 'email', 'address', 'gstNumber'].map((key) => (
                <input
                  key={key}
                  className="input"
                  placeholder={key}
                  defaultValue={settings?.[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                />
              ))}
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                step="0.01"
                placeholder="Tax rate (%)"
                defaultValue={settings?.taxRate ?? ''}
                onChange={(e) =>
                  setForm({
                    ...form,
                    taxRate: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
              <input
                className="input"
                type="number"
                min={1}
                step="1"
                placeholder="Invoice number starts from"
                defaultValue={settings?.invoiceNumberStart ?? 1}
                onChange={(e) =>
                  setForm({
                    ...form,
                    invoiceNumberStart: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
              <select
                className="input"
                defaultValue={settings?.packageInclusionInvoiceMode ?? 'NOTES'}
                onChange={(e) =>
                  setForm({
                    ...form,
                    packageInclusionInvoiceMode: e.target.value,
                  })
                }
              >
                <option value="NOTES">Package inclusions on invoice as notes</option>
                <option value="LINE_ITEMS">Package inclusions on invoice as line items</option>
              </select>
            </div>
            <button
              onClick={() => saveSettings.mutate()}
              className="bg-brand-primary text-black font-semibold rounded-xl px-3 py-2 shadow-soft"
            >
              Save business profile
            </button>
          </div>
        )}

        {activeTab === 'branding' && (
          <div className="space-y-4">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <h2 className="font-semibold">Branding</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  className="input"
                  placeholder="Logo URL"
                  defaultValue={settings?.logoUrl}
                  onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Favicon URL"
                  defaultValue={settings?.faviconUrl}
                  onChange={(e) => setForm({ ...form, faviconUrl: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="PWA name"
                  defaultValue={settings?.pwaName}
                  onChange={(e) => setForm({ ...form, pwaName: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="PWA short name"
                  defaultValue={settings?.pwaShortName}
                  onChange={(e) => setForm({ ...form, pwaShortName: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="PWA icon URL"
                  defaultValue={settings?.pwaIconUrl}
                  onChange={(e) => setForm({ ...form, pwaIconUrl: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="PWA maskable icon URL"
                  defaultValue={settings?.pwaIconMaskableUrl}
                  onChange={(e) => setForm({ ...form, pwaIconMaskableUrl: e.target.value })}
                />
              </div>
              <button
                onClick={() => saveSettings.mutate()}
                className="bg-brand-primary text-black font-semibold rounded-xl px-3 py-2 shadow-soft"
              >
                Save branding
              </button>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">Public QR code</h2>
                  <p className="text-xs text-white/60">Scan to open the public job creation page</p>
                </div>
                <div className="flex gap-2 no-print">
                  <a
                    href={qrImageUrl}
                    download="carmaster-public-qr.png"
                    className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-white text-xs font-semibold"
                  >
                    Download QR
                  </a>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-3 py-2 rounded-xl bg-brand-primary text-black text-xs font-semibold"
                  >
                    Print sheet
                  </button>
                </div>
              </div>
              <div className="printable-qr bg-black/60 border border-white/10 rounded-2xl p-4 sm:p-6">
                <div className="grid gap-6 sm:grid-cols-[220px_1fr] items-center">
                  <div className="bg-white rounded-2xl p-3 shadow-soft">
                    {qrImageUrl ? (
                      <img src={qrImageUrl} alt="Public QR code" className="w-full h-auto" />
                    ) : (
                      <div className="h-[220px] flex items-center justify-center text-xs text-black/50">
                        QR unavailable
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 text-white">
                    <div>
                      <p className="text-lg font-semibold text-brand-primary">Scan to book your service</p>
                      <p className="text-sm text-white/70">Open your camera and scan the QR code to start a new job.</p>
                    </div>
                    <div className="grid gap-2 text-sm">
                      <p>1. Scan the QR with your phone camera.</p>
                      <p>2. Tap the link to open the booking page.</p>
                      <p>3. Enter your rego, details, and submit the job.</p>
                      <p>4. Install the app for faster future bookings.</p>
                    </div>
                    <div className="pt-2 text-xs text-white/60">
                      {publicUrl}
                    </div>
                  </div>
                </div>
                <div className="print-only mt-6 border-t border-white/10 pt-4 text-xs text-white/60">
                  Need help? Call Carmaster on 022 401 3026.
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'theme' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
            <h2 className="font-semibold">Theme</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                className="input"
                placeholder="Primary color"
                defaultValue={settings?.themePrimary}
                onChange={(e) => setForm({ ...form, themePrimary: e.target.value })}
              />
              <input
                className="input"
                placeholder="Secondary color"
                defaultValue={settings?.themeSecondary}
                onChange={(e) => setForm({ ...form, themeSecondary: e.target.value })}
              />
            </div>
            <button
              onClick={() => saveSettings.mutate()}
              className="bg-brand-primary text-black font-semibold rounded-xl px-3 py-2 shadow-soft"
            >
              Save theme
            </button>
          </div>
        )}

        {activeTab === 'office365' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
            <h2 className="font-semibold">Office 365 integration</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                className="input"
                placeholder="Client ID"
                defaultValue={settings?.azureClientId}
                onChange={(e) => setForm({ ...form, azureClientId: e.target.value })}
              />
              <input
                className="input"
                placeholder="Tenant ID"
                defaultValue={settings?.azureTenantId}
                onChange={(e) => setForm({ ...form, azureTenantId: e.target.value })}
              />
              <input
                className="input"
                placeholder="Client Secret"
                defaultValue={settings?.azureClientSecret}
                onChange={(e) => setForm({ ...form, azureClientSecret: e.target.value })}
              />
              <input
                className="input"
                placeholder="Redirect URI"
                defaultValue={settings?.azureRedirectUri}
                onChange={(e) => setForm({ ...form, azureRedirectUri: e.target.value })}
              />
            </div>
            <div className="border-t border-white/10 pt-4 space-y-3">
              <h3 className="font-semibold">Microsoft Bookings</h3>
              <label className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  defaultChecked={settings?.bookingsEnabled}
                  onChange={(e) => setForm({ ...form, bookingsEnabled: e.target.checked })}
                />
                Enable Bookings on the public portal
              </label>
              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  className="input"
                  placeholder="Bookings Page URL"
                  defaultValue={settings?.bookingsPageUrl}
                  onChange={(e) => setForm({ ...form, bookingsPageUrl: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Bookings Business ID (optional)"
                  defaultValue={settings?.bookingsBusinessId}
                  onChange={(e) => setForm({ ...form, bookingsBusinessId: e.target.value })}
                />
              </div>
              <button
                onClick={() => testBookings.mutate()}
                disabled={testBookings.isPending}
                className="bg-white/10 border border-white/10 text-white font-semibold rounded-xl px-3 py-2 disabled:opacity-50"
              >
                {testBookings.isPending ? 'Testing...' : 'Test connection'}
              </button>
            </div>
            <button
              onClick={() => saveSettings.mutate()}
              className="bg-brand-primary text-black font-semibold rounded-xl px-3 py-2 shadow-soft"
            >
              Save integration settings
            </button>
          </div>
        )}

        {activeTab === 'activity-logs' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">Activity logs</h2>
                <p className="text-xs text-white/60">Track who created, edited, or deleted records.</p>
                <p className="text-xs text-white/50 mt-1">
                  Logs are retained for 30 days by default. Older entries are automatically removed.
                </p>
              </div>
              <button
                type="button"
                onClick={() => refetchActivityLogs()}
                className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-xs font-semibold"
              >
                Refresh
              </button>
            </div>

            <div className="grid sm:grid-cols-4 gap-2">
              <select
                className="input text-sm"
                value={activityFilters.action}
                onChange={(e) => setActivityFilters((prev) => ({ ...prev, action: e.target.value }))}
              >
                <option value="">All actions</option>
                <option value="CREATE">Create</option>
                <option value="EDIT">Edit</option>
                <option value="DELETE">Delete</option>
                <option value="LOGIN">Login</option>
              </select>
              <select
                className="input text-sm"
                value={activityFilters.status}
                onChange={(e) => setActivityFilters((prev) => ({ ...prev, status: e.target.value }))}
              >
                <option value="">All statuses</option>
                <option value="SUCCESS">Success</option>
                <option value="FAILED">Failed</option>
              </select>
              <select
                className="input text-sm"
                value={activityFilters.entity}
                onChange={(e) => setActivityFilters((prev) => ({ ...prev, entity: e.target.value }))}
              >
                <option value="">All areas</option>
                {activityEntities.map((entity) => (
                  <option key={entity} value={entity}>
                    {formatLabel(entity)}
                  </option>
                ))}
              </select>
              <input
                className="input text-sm"
                value={activityFilters.actor}
                onChange={(e) => setActivityFilters((prev) => ({ ...prev, actor: e.target.value }))}
                placeholder="Filter by user/email"
              />
            </div>

            {activityLogsLoading ? (
              <div className="py-8">
                <LoadingSpinner message="Loading activity logs..." />
              </div>
            ) : activityLogsError ? (
              <ErrorMessage message="Failed to load activity logs." onRetry={() => refetchActivityLogs()} />
            ) : activityLogs && activityLogs.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead>
                    <tr className="text-left text-white/60 border-b border-white/10">
                      <th className="py-2 pr-3">When</th>
                      <th className="py-2 pr-3">User</th>
                      <th className="py-2 pr-3">Action</th>
                      <th className="py-2 pr-3">Area</th>
                      <th className="py-2 pr-3">Record</th>
                      <th className="py-2 pr-3">Result</th>
                      <th className="py-2">Path</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityLogs.map((log) => (
                      <tr key={log.id} className="border-b border-white/5">
                        <td className="py-2 pr-3">{formatDateTime(log.createdAt)}</td>
                        <td className="py-2 pr-3">
                          <p>{log.actorName || '-'}</p>
                          <p className="text-xs text-white/60">{log.actorEmail || '-'}</p>
                        </td>
                        <td className="py-2 pr-3">
                          <span
                            className={`px-2 py-1 rounded-full text-xs ${
                              log.action === 'DELETE'
                                ? 'bg-red-500/20 text-red-200'
                                : log.action === 'CREATE'
                                  ? 'bg-green-500/20 text-green-200'
                                  : log.action === 'EDIT'
                                    ? 'bg-amber-400/20 text-amber-100'
                                    : 'bg-white/10 text-white'
                            }`}
                          >
                            {formatLabel(log.action)}
                          </span>
                        </td>
                        <td className="py-2 pr-3">{formatLabel(log.entity)}</td>
                        <td className="py-2 pr-3 text-white/70">{log.entityId || '-'}</td>
                        <td className="py-2 pr-3">
                          <span
                            className={`px-2 py-1 rounded-full text-xs ${
                              log.status === 'FAILED'
                                ? 'bg-red-500/20 text-red-200'
                                : 'bg-white/10 text-white/80'
                            }`}
                          >
                            {formatLabel(log.status)}
                          </span>
                        </td>
                        <td className="py-2 text-xs text-white/60 break-all">
                          {log.method} {log.path}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-white/50 text-center py-6">No activities found for current filters.</p>
            )}
          </div>
        )}


        {activeTab === 'services' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Services</h2>
              <p className="text-xs text-white/60">Shared list for portal jobs and public bookings</p>
            </div>
            <div className="grid sm:grid-cols-6 gap-3">
              <input
                className="input sm:col-span-2"
                placeholder="Service name"
                value={serviceForm.name}
                onChange={(e) => setServiceForm({ ...serviceForm, name: e.target.value })}
              />
              <input
                className="input sm:col-span-2"
                placeholder="Description"
                value={serviceForm.description}
                onChange={(e) => setServiceForm({ ...serviceForm, description: e.target.value })}
              />
              <input
                className="input"
                type="number"
                placeholder="Base price ($)"
                value={serviceForm.basePrice}
                onChange={(e) => setServiceForm({ ...serviceForm, basePrice: e.target.value })}
              />
              <select
                className="input"
                value={serviceForm.priceType}
                onChange={(e) => setServiceForm({ ...serviceForm, priceType: e.target.value })}
              >
                <option value="FIXED">Fixed</option>
                <option value="FROM">From</option>
                <option value="QUOTE_REQUIRED">Quote required</option>
              </select>
              <input
                className="input sm:col-span-2"
                placeholder="Checklist items (comma separated)"
                value={serviceForm.checklist}
                onChange={(e) => setServiceForm({ ...serviceForm, checklist: e.target.value })}
              />
              <input
                className="input"
                type="number"
                placeholder="Duration (minutes)"
                value={serviceForm.durationMinutes}
                onChange={(e) => setServiceForm({ ...serviceForm, durationMinutes: e.target.value })}
              />
            </div>
            <button
              onClick={() => addService.mutate()}
              disabled={!serviceForm.name || addService.isPending}
              className="bg-brand-primary text-black font-semibold rounded-xl px-3 py-2 shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {addService.isPending ? 'Adding...' : 'Add service'}
            </button>
            <div className="grid gap-2">
              {services?.map((service: any) => (
                <div key={service.id} className="border border-white/10 rounded-xl px-3 py-2">
                  {editingService?.id === service.id ? (
                    <div className="space-y-2">
                      <input
                        className="input text-sm"
                        value={editingService.name}
                        onChange={(e) => setEditingService({ ...editingService, name: e.target.value })}
                        placeholder="Service name"
                      />
                      <input
                        className="input text-sm"
                        value={editingService.description ?? ''}
                        onChange={(e) => setEditingService({ ...editingService, description: e.target.value })}
                        placeholder="Description"
                      />
                      <input
                        className="input text-sm"
                        value={editingService.checklist ?? ''}
                        onChange={(e) => setEditingService({ ...editingService, checklist: e.target.value })}
                        placeholder="Checklist items (comma separated)"
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          className="input text-sm"
                          type="number"
                          value={editingService.basePrice ?? ''}
                          onChange={(e) => setEditingService({ ...editingService, basePrice: e.target.value })}
                          placeholder="Base price"
                        />
                        <select
                          className="input text-sm"
                          value={editingService.priceType}
                          onChange={(e) => setEditingService({ ...editingService, priceType: e.target.value })}
                        >
                          <option value="FIXED">Fixed</option>
                          <option value="FROM">From</option>
                          <option value="QUOTE_REQUIRED">Quote required</option>
                        </select>
                        <input
                          className="input text-sm"
                          type="number"
                          value={editingService.durationMinutes ?? ''}
                          onChange={(e) => setEditingService({ ...editingService, durationMinutes: e.target.value })}
                          placeholder="Minutes"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => updateService.mutate(editingService)}
                          className="px-2 py-1 text-xs rounded-lg bg-brand-primary text-black font-semibold"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingService(null)}
                          className="px-2 py-1 text-xs rounded-lg bg-white/5 border border-white/10 text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="font-semibold">{service.name}</p>
                        {service.description && <p className="text-xs text-white/60">{service.description}</p>}
                        <p className="text-xs text-white/60 mt-1">
                          {service.priceType === 'QUOTE_REQUIRED'
                            ? 'Quote required'
                            : service.priceType === 'FROM'
                              ? `From $${Number(service.basePrice).toFixed(2)}`
                              : `$${Number(service.basePrice).toFixed(2)}`}
                          {service.durationMinutes ? ` • ${service.durationMinutes} min` : ''}
                        </p>
                        <div className="flex gap-2 flex-wrap mt-1">
                          {service.checklist?.map((item: string) => (
                            <span key={item} className="px-2 py-1 text-xs rounded-full bg-white/5 border border-white/10">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditingService({
                            id: service.id,
                            name: service.name,
                            description: service.description ?? '',
                            checklist: (service.checklist || []).join(', '),
                            basePrice: service.basePrice ?? '',
                            priceType: service.priceType ?? 'FIXED',
                            durationMinutes: service.durationMinutes ?? '',
                          })}
                          className="px-2 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteServiceDialog(service.id)}
                          className="px-2 py-1 text-xs rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-200 transition"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'service-packages' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Service Packages</h2>
                <p className="text-xs text-white/60">Basic, Standard, Premium style bundles for booking flow</p>
              </div>
            </div>

            <div className="border border-white/10 rounded-xl p-3 space-y-3">
              <div className="grid sm:grid-cols-3 gap-3">
                <input
                  className="input"
                  placeholder="Package name"
                  value={servicePackageForm.name}
                  onChange={(e) => setServicePackageForm({ ...servicePackageForm, name: e.target.value })}
                />
                <input
                  className="input sm:col-span-2"
                  placeholder="Description"
                  value={servicePackageForm.description}
                  onChange={(e) => setServicePackageForm({ ...servicePackageForm, description: e.target.value })}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-white/80">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={servicePackageForm.isActive}
                  onChange={(e) => setServicePackageForm({ ...servicePackageForm, isActive: e.target.checked })}
                />
                Active
              </label>

              <div className="grid sm:grid-cols-2 gap-3">
                {VEHICLE_TYPES.map((vehicleType) => {
                  const priceEntry = servicePackageForm.prices.find((price: any) => price.vehicleType === vehicleType);
                  return (
                    <div key={vehicleType} className="border border-white/10 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-semibold">{vehicleType === 'JAPANESE' ? 'Japanese pricing' : 'European pricing'}</p>
                      <input
                        className="input text-sm"
                        type="number"
                        min={0}
                        placeholder="Base price"
                        value={priceEntry?.basePrice ?? ''}
                        onChange={(e) =>
                          setServicePackageForm((prev: any) => ({
                            ...prev,
                            prices: prev.prices.map((price: any) =>
                              price.vehicleType === vehicleType ? { ...price, basePrice: e.target.value } : price,
                            ),
                          }))
                        }
                      />
                      <select
                        className="input text-sm"
                        value={priceEntry?.priceType ?? 'FIXED'}
                        onChange={(e) =>
                          setServicePackageForm((prev: any) => ({
                            ...prev,
                            prices: prev.prices.map((price: any) =>
                              price.vehicleType === vehicleType ? { ...price, priceType: e.target.value } : price,
                            ),
                          }))
                        }
                      >
                        {PRICE_TYPES.map((priceType) => (
                          <option key={priceType} value={priceType}>
                            {priceType}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input text-sm"
                        placeholder="Pricing notes"
                        value={priceEntry?.notes ?? ''}
                        onChange={(e) =>
                          setServicePackageForm((prev: any) => ({
                            ...prev,
                            prices: prev.prices.map((price: any) =>
                              price.vehicleType === vehicleType ? { ...price, notes: e.target.value } : price,
                            ),
                          }))
                        }
                      />
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">Inclusions</p>
                  <button
                    type="button"
                    onClick={() =>
                      setServicePackageForm((prev: any) => ({
                        ...prev,
                        inclusions: [
                          ...prev.inclusions,
                          {
                            type: 'CHECK_ITEM',
                            title: '',
                            isRequired: true,
                            sortOrder: prev.inclusions.length,
                          },
                        ],
                      }))
                    }
                    className="px-2 py-1 text-xs rounded-lg bg-white/5 border border-white/10"
                  >
                    Add item
                  </button>
                </div>
                {servicePackageForm.inclusions.map((inclusion: any, index: number) => (
                  <div key={`${inclusion.sortOrder}-${index}`} className="grid sm:grid-cols-[180px_1fr_auto] gap-2 items-center">
                    <select
                      className="input text-sm"
                      value={inclusion.type}
                      onChange={(e) =>
                        setServicePackageForm((prev: any) => ({
                          ...prev,
                          inclusions: prev.inclusions.map((item: any, itemIndex: number) =>
                            itemIndex === index ? { ...item, type: e.target.value } : item,
                          ),
                        }))
                      }
                    >
                      {INCLUSION_TYPES.map((inclusionType) => (
                        <option key={inclusionType} value={inclusionType}>
                          {inclusionType}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input text-sm"
                      placeholder="Inclusion title"
                      value={inclusion.title}
                      onChange={(e) =>
                        setServicePackageForm((prev: any) => ({
                          ...prev,
                          inclusions: prev.inclusions.map((item: any, itemIndex: number) =>
                            itemIndex === index ? { ...item, title: e.target.value } : item,
                          ),
                        }))
                      }
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() =>
                          setServicePackageForm((prev: any) => {
                            const inclusions = [...prev.inclusions];
                            [inclusions[index - 1], inclusions[index]] = [inclusions[index], inclusions[index - 1]];
                            return { ...prev, inclusions };
                          })
                        }
                        className="px-2 py-1 text-xs rounded-lg bg-white/5 border border-white/10 disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={index === servicePackageForm.inclusions.length - 1}
                        onClick={() =>
                          setServicePackageForm((prev: any) => {
                            const inclusions = [...prev.inclusions];
                            [inclusions[index], inclusions[index + 1]] = [inclusions[index + 1], inclusions[index]];
                            return { ...prev, inclusions };
                          })
                        }
                        className="px-2 py-1 text-xs rounded-lg bg-white/5 border border-white/10 disabled:opacity-40"
                      >
                        ↓
                      </button>
                      <label className="text-xs flex items-center gap-1">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={inclusion.isRequired}
                          onChange={(e) =>
                            setServicePackageForm((prev: any) => ({
                              ...prev,
                              inclusions: prev.inclusions.map((item: any, itemIndex: number) =>
                                itemIndex === index ? { ...item, isRequired: e.target.checked } : item,
                              ),
                            }))
                          }
                        />
                        Required
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setServicePackageForm((prev: any) => ({
                            ...prev,
                            inclusions: prev.inclusions.filter((_: any, itemIndex: number) => itemIndex !== index),
                          }))
                        }
                        className="px-2 py-1 text-xs rounded-lg bg-red-500/10 border border-red-500/30 text-red-200"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={() => addServicePackage.mutate()}
                disabled={!servicePackageForm.name || addServicePackage.isPending}
                className="bg-brand-primary text-black font-semibold rounded-xl px-3 py-2 shadow-soft disabled:opacity-50"
              >
                {addServicePackage.isPending ? 'Adding...' : 'Add service package'}
              </button>
            </div>

            <div className="space-y-2">
              {servicePackages?.map((pkg: any) => {
                const japanese = pkg.prices?.find((price: any) => price.vehicleType === 'JAPANESE');
                const european = pkg.prices?.find((price: any) => price.vehicleType === 'EUROPEAN');
                return (
                  <div key={pkg.id} className="border border-white/10 rounded-xl p-3">
                    {editingServicePackage?.id === pkg.id ? (
                      <div className="space-y-3">
                        <div className="grid sm:grid-cols-3 gap-2">
                          <input
                            className="input text-sm"
                            value={editingServicePackage.name}
                            onChange={(e) => setEditingServicePackage({ ...editingServicePackage, name: e.target.value })}
                            placeholder="Package name"
                          />
                          <input
                            className="input text-sm sm:col-span-2"
                            value={editingServicePackage.description ?? ''}
                            onChange={(e) => setEditingServicePackage({ ...editingServicePackage, description: e.target.value })}
                            placeholder="Description"
                          />
                        </div>
                        <label className="text-xs flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={editingServicePackage.isActive}
                            onChange={(e) => setEditingServicePackage({ ...editingServicePackage, isActive: e.target.checked })}
                          />
                          Active
                        </label>
                        <div className="grid sm:grid-cols-2 gap-2">
                          {editingServicePackage.prices?.map((price: any, index: number) => (
                            <div key={`${price.vehicleType}-${index}`} className="border border-white/10 rounded-xl p-2 space-y-2">
                              <p className="text-xs font-semibold">{price.vehicleType}</p>
                              <input
                                className="input text-sm"
                                type="number"
                                min={0}
                                value={price.basePrice ?? ''}
                                onChange={(e) =>
                                  setEditingServicePackage((prev: any) => ({
                                    ...prev,
                                    prices: prev.prices.map((item: any, itemIndex: number) =>
                                      itemIndex === index ? { ...item, basePrice: e.target.value } : item,
                                    ),
                                  }))
                                }
                              />
                              <select
                                className="input text-sm"
                                value={price.priceType}
                                onChange={(e) =>
                                  setEditingServicePackage((prev: any) => ({
                                    ...prev,
                                    prices: prev.prices.map((item: any, itemIndex: number) =>
                                      itemIndex === index ? { ...item, priceType: e.target.value } : item,
                                    ),
                                  }))
                                }
                              >
                                {PRICE_TYPES.map((priceType) => (
                                  <option key={priceType} value={priceType}>
                                    {priceType}
                                  </option>
                                ))}
                              </select>
                              <input
                                className="input text-sm"
                                placeholder="Notes"
                                value={price.notes ?? ''}
                                onChange={(e) =>
                                  setEditingServicePackage((prev: any) => ({
                                    ...prev,
                                    prices: prev.prices.map((item: any, itemIndex: number) =>
                                      itemIndex === index ? { ...item, notes: e.target.value } : item,
                                    ),
                                  }))
                                }
                              />
                            </div>
                          ))}
                        </div>
                        <div className="space-y-2">
                          {editingServicePackage.inclusions?.map((inclusion: any, index: number) => (
                            <div key={`${inclusion.sortOrder}-${index}`} className="grid sm:grid-cols-[180px_1fr_auto] gap-2 items-center">
                              <select
                                className="input text-sm"
                                value={inclusion.type}
                                onChange={(e) =>
                                  setEditingServicePackage((prev: any) => ({
                                    ...prev,
                                    inclusions: prev.inclusions.map((item: any, itemIndex: number) =>
                                      itemIndex === index ? { ...item, type: e.target.value } : item,
                                    ),
                                  }))
                                }
                              >
                                {INCLUSION_TYPES.map((inclusionType) => (
                                  <option key={inclusionType} value={inclusionType}>
                                    {inclusionType}
                                  </option>
                                ))}
                              </select>
                              <input
                                className="input text-sm"
                                value={inclusion.title}
                                onChange={(e) =>
                                  setEditingServicePackage((prev: any) => ({
                                    ...prev,
                                    inclusions: prev.inclusions.map((item: any, itemIndex: number) =>
                                      itemIndex === index ? { ...item, title: e.target.value } : item,
                                    ),
                                  }))
                                }
                                placeholder="Inclusion title"
                              />
                              <button
                                type="button"
                                disabled={index === 0}
                                onClick={() =>
                                  setEditingServicePackage((prev: any) => {
                                    const inclusions = [...prev.inclusions];
                                    [inclusions[index - 1], inclusions[index]] = [inclusions[index], inclusions[index - 1]];
                                    return { ...prev, inclusions };
                                  })
                                }
                                className="px-2 py-1 text-xs rounded-lg bg-white/5 border border-white/10 disabled:opacity-40"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                disabled={index === editingServicePackage.inclusions.length - 1}
                                onClick={() =>
                                  setEditingServicePackage((prev: any) => {
                                    const inclusions = [...prev.inclusions];
                                    [inclusions[index], inclusions[index + 1]] = [inclusions[index + 1], inclusions[index]];
                                    return { ...prev, inclusions };
                                  })
                                }
                                className="px-2 py-1 text-xs rounded-lg bg-white/5 border border-white/10 disabled:opacity-40"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingServicePackage((prev: any) => ({
                                    ...prev,
                                    inclusions: prev.inclusions.filter((_: any, itemIndex: number) => itemIndex !== index),
                                  }))
                                }
                                className="px-2 py-1 text-xs rounded-lg bg-red-500/10 border border-red-500/30 text-red-200"
                              >
                                Delete
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              setEditingServicePackage((prev: any) => ({
                                ...prev,
                                inclusions: [
                                  ...(prev.inclusions || []),
                                  {
                                    type: 'CHECK_ITEM',
                                    title: '',
                                    isRequired: true,
                                    sortOrder: prev.inclusions?.length || 0,
                                  },
                                ],
                              }))
                            }
                            className="px-2 py-1 text-xs rounded-lg bg-white/5 border border-white/10"
                          >
                            Add inclusion
                          </button>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => updateServicePackage.mutate(editingServicePackage)}
                            className="px-2 py-1 text-xs rounded-lg bg-brand-primary text-black font-semibold"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingServicePackage(null)}
                            className="px-2 py-1 text-xs rounded-lg bg-white/5 border border-white/10 text-white"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <p className="font-semibold">{pkg.name}</p>
                          {pkg.description && <p className="text-xs text-white/60">{pkg.description}</p>}
                          <p className="text-xs text-white/60 mt-1">
                            {pkg.isActive ? 'Active' : 'Inactive'}
                            {japanese ? ` • Jap: ${formatPrice(japanese.basePrice, japanese.priceType)}` : ''}
                            {european ? ` • Euro: ${formatPrice(european.basePrice, european.priceType)}` : ''}
                          </p>
                          {pkg.inclusions?.length > 0 && (
                            <div className="flex gap-2 flex-wrap mt-2">
                              {pkg.inclusions.slice(0, 5).map((inclusion: any) => (
                                <span key={`${pkg.id}-${inclusion.id}`} className="px-2 py-1 text-xs rounded-full bg-white/5 border border-white/10">
                                  {inclusion.title}
                                </span>
                              ))}
                              {pkg.inclusions.length > 5 && (
                                <span className="px-2 py-1 text-xs rounded-full bg-white/5 border border-white/10">
                                  +{pkg.inclusions.length - 5} more
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() =>
                              setEditingServicePackage({
                                ...pkg,
                                prices: VEHICLE_TYPES.map((vehicleType) => {
                                  const price = pkg.prices?.find((item: any) => item.vehicleType === vehicleType);
                                  return {
                                    vehicleType,
                                    basePrice: price?.basePrice ?? '',
                                    priceType: price?.priceType ?? 'FIXED',
                                    notes: price?.notes ?? '',
                                  };
                                }),
                                inclusions: (pkg.inclusions || []).map((inclusion: any, index: number) => ({
                                  type: inclusion.type,
                                  title: inclusion.title,
                                  isRequired: inclusion.isRequired,
                                  sortOrder: inclusion.sortOrder ?? index,
                                })),
                              })
                            }
                            className="px-2 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white transition"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteServicePackageDialog(pkg.id)}
                            className="px-2 py-1 text-xs rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-200 transition"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {servicePackages?.length === 0 && (
                <p className="text-sm text-white/50 text-center py-4">No service packages yet.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'upsells' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Upsells</h2>
                <p className="text-xs text-white/60">Pricing and smart rules for add-ons</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-6 gap-3">
              <input
                className="input sm:col-span-2"
                placeholder="Upsell name"
                value={upsellForm.name}
                onChange={(e) => setUpsellForm({ ...upsellForm, name: e.target.value })}
              />
              <input
                className="input sm:col-span-2"
                placeholder="Description (optional)"
                value={upsellForm.description}
                onChange={(e) => setUpsellForm({ ...upsellForm, description: e.target.value })}
              />
              <input
                className="input"
                type="number"
                placeholder="Price ($)"
                value={upsellForm.price}
                onChange={(e) => setUpsellForm({ ...upsellForm, price: e.target.value })}
              />
              <select
                className="input"
                value={upsellForm.priceType}
                onChange={(e) => setUpsellForm({ ...upsellForm, priceType: e.target.value })}
              >
                <option value="FIXED">Fixed</option>
                <option value="FROM">From</option>
                <option value="QUOTE_REQUIRED">Quote required</option>
              </select>
              <textarea
                className="input sm:col-span-4"
                placeholder='Rules JSON (e.g. {"minKm":60000,"seasons":["Winter"]})'
                value={upsellForm.applicabilityRules}
                onChange={(e) => setUpsellForm({ ...upsellForm, applicabilityRules: e.target.value })}
              />
              <label className="flex items-center gap-2 text-xs text-white/80">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={upsellForm.isActive}
                  onChange={(e) => setUpsellForm({ ...upsellForm, isActive: e.target.checked })}
                />
                Active
              </label>
            </div>
            <button
              onClick={() => addUpsell.mutate()}
              disabled={!upsellForm.name || addUpsell.isPending}
              className="bg-brand-primary text-black font-semibold rounded-xl px-3 py-2 shadow-soft disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {addUpsell.isPending ? 'Adding...' : 'Add upsell'}
            </button>
            <div className="grid sm:grid-cols-2 gap-2">
              {upsells?.map((upsell: any) => (
                <div key={upsell.id} className="bg-white/5 border border-white/10 rounded-xl p-3">
                  {editingUpsell?.id === upsell.id ? (
                    <div className="space-y-2">
                      <input
                        className="input text-sm"
                        value={editingUpsell.name}
                        onChange={(e) => setEditingUpsell({ ...editingUpsell, name: e.target.value })}
                        placeholder="Upsell name"
                      />
                      <input
                        className="input text-sm"
                        value={editingUpsell.description ?? ''}
                        onChange={(e) => setEditingUpsell({ ...editingUpsell, description: e.target.value })}
                        placeholder="Description"
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          className="input text-sm"
                          type="number"
                          value={editingUpsell.price ?? ''}
                          onChange={(e) => setEditingUpsell({ ...editingUpsell, price: e.target.value })}
                          placeholder="Price ($)"
                        />
                        <select
                          className="input text-sm"
                          value={editingUpsell.priceType}
                          onChange={(e) => setEditingUpsell({ ...editingUpsell, priceType: e.target.value })}
                        >
                          <option value="FIXED">Fixed</option>
                          <option value="FROM">From</option>
                          <option value="QUOTE_REQUIRED">Quote required</option>
                        </select>
                        <label className="flex items-center gap-2 text-xs text-white/80">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={editingUpsell.isActive}
                            onChange={(e) => setEditingUpsell({ ...editingUpsell, isActive: e.target.checked })}
                          />
                          Active
                        </label>
                      </div>
                      <textarea
                        className="input text-sm"
                        value={editingUpsell.applicabilityRules ?? ''}
                        onChange={(e) => setEditingUpsell({ ...editingUpsell, applicabilityRules: e.target.value })}
                        placeholder='Rules JSON'
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => updateUpsell.mutate(editingUpsell)}
                          className="px-2 py-1 text-xs rounded-lg bg-brand-primary text-black font-semibold"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingUpsell(null)}
                          className="px-2 py-1 text-xs rounded-lg bg-white/5 border border-white/10 text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="font-semibold text-brand-primary">{upsell.name}</p>
                        {upsell.description && <p className="text-xs text-white/60">{upsell.description}</p>}
                        <p className="text-xs text-white/60 mt-1">
                          {upsell.priceType === 'QUOTE_REQUIRED'
                            ? 'Quote required'
                            : upsell.priceType === 'FROM'
                              ? `From $${Number(upsell.price).toFixed(2)}`
                              : `$${Number(upsell.price).toFixed(2)}`}
                          {!upsell.isActive && ' • Inactive'}
                        </p>
                        {upsell.applicabilityRules && (
                          <p className="text-[11px] text-white/60 mt-1">
                            Rules: {JSON.stringify(upsell.applicabilityRules)}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setEditingUpsell({
                            ...upsell,
                            applicabilityRules: upsell.applicabilityRules ? JSON.stringify(upsell.applicabilityRules) : '',
                          })}
                          className="px-2 py-1 text-xs rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => setDeleteUpsellDialog(upsell.id)}
                          className="px-2 py-1 text-xs rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-200 transition"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {upsells?.length === 0 && (
              <p className="text-sm text-white/50 text-center py-4">
                No upsell options yet. Add your first one above!
              </p>
            )}
          </div>
        )}

        {activeTab === 'templates' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
            <h2 className="font-semibold">Email templates</h2>
            <div className="grid gap-3">
              <textarea
                className="input min-h-[140px]"
                placeholder="Quote email template (HTML allowed)"
                defaultValue={settings?.quoteEmailTemplate ?? ''}
                onChange={(e) => setForm({ ...form, quoteEmailTemplate: e.target.value })}
              />
              <textarea
                className="input min-h-[140px]"
                placeholder="Invoice email template (HTML allowed)"
                defaultValue={settings?.invoiceEmailTemplate ?? ''}
                onChange={(e) => setForm({ ...form, invoiceEmailTemplate: e.target.value })}
              />
            </div>
            <div className="border-t border-white/10 pt-3 space-y-3">
              <h3 className="font-semibold text-sm">Service schedule reminder templates</h3>
              <p className="text-xs text-white/60">
                Available tokens: {'{{customerName}}'}, {'{{rego}}'}, {'{{dueDate}}'}, {'{{daysUntilDue}}'}, {'{{dueStatus}}'}, {'{{businessName}}'}, {'{{typeLabel}}'}, {'{{title}}'}, {'{{actionButton}}'}, {'{{wofBookingUrl}}'}, {'{{regoRenewalUrl}}'}
              </p>
              <div className="grid gap-3">
                <textarea
                  className="input min-h-[120px]"
                  placeholder="Service reminder email template (HTML allowed)"
                  defaultValue={settings?.serviceReminderEmailTemplate ?? ''}
                  onChange={(e) => setForm({ ...form, serviceReminderEmailTemplate: e.target.value })}
                />
                <textarea
                  className="input min-h-[120px]"
                  placeholder="WOF reminder email template (HTML allowed)"
                  defaultValue={settings?.wofReminderEmailTemplate ?? ''}
                  onChange={(e) => setForm({ ...form, wofReminderEmailTemplate: e.target.value })}
                />
                <textarea
                  className="input min-h-[120px]"
                  placeholder="Rego reminder email template (HTML allowed)"
                  defaultValue={settings?.regoReminderEmailTemplate ?? ''}
                  onChange={(e) => setForm({ ...form, regoReminderEmailTemplate: e.target.value })}
                />
                <textarea
                  className="input min-h-[90px]"
                  placeholder="Service reminder SMS template"
                  defaultValue={settings?.serviceReminderSmsTemplate ?? ''}
                  onChange={(e) => setForm({ ...form, serviceReminderSmsTemplate: e.target.value })}
                />
                <textarea
                  className="input min-h-[90px]"
                  placeholder="WOF reminder SMS template"
                  defaultValue={settings?.wofReminderSmsTemplate ?? ''}
                  onChange={(e) => setForm({ ...form, wofReminderSmsTemplate: e.target.value })}
                />
                <textarea
                  className="input min-h-[90px]"
                  placeholder="Rego reminder SMS template"
                  defaultValue={settings?.regoReminderSmsTemplate ?? ''}
                  onChange={(e) => setForm({ ...form, regoReminderSmsTemplate: e.target.value })}
                />
              </div>
            </div>
            <button
              onClick={() => saveSettings.mutate()}
              className="bg-brand-primary text-black font-semibold rounded-xl px-3 py-2 shadow-soft"
            >
              Save templates
            </button>
          </div>
        )}
      </div>
    </PortalShell>
  );
};
