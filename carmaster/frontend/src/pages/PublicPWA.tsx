import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';

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

const VEHICLE_TYPES = [
  { value: 'JAPANESE', label: 'Japanese' },
  { value: 'EUROPEAN', label: 'European' },
];

const initial = {
  rego: '',
  vehicleBrand: '',
  vehicleModel: '',
  vehicleBrandOther: '',
  vehicleModelOther: '',
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  notes: '',
  jobType: '',
  odometerKm: '',
  vehicleType: 'JAPANESE',
  wofExpiryDate: '',
  regoExpiryDate: '',
  selectionMode: 'single_service',
  selectedServiceId: '',
  selectedServicePackageId: '',
  additionalServiceIds: [] as string[],
};
const initialBooking = {
  rego: '',
  vehicleBrand: '',
  vehicleModel: '',
  vehicleBrandOther: '',
  vehicleModelOther: '',
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  notes: '',
  serviceId: '',
  date: '',
  slotIndex: -1,
};

type ReminderPrefill = {
  hasAny: boolean;
  intent: string;
  service: string;
  rego: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  vehicleBrand: string;
  vehicleModel: string;
  wofExpiryDate: string;
  regoExpiryDate: string;
};

const readReminderPrefill = (): ReminderPrefill => {
  if (typeof window === 'undefined') {
    return {
      hasAny: false,
      intent: '',
      service: '',
      rego: '',
      firstName: '',
      lastName: '',
      phone: '',
      email: '',
      vehicleBrand: '',
      vehicleModel: '',
      wofExpiryDate: '',
      regoExpiryDate: '',
    };
  }
  const params = new URLSearchParams(window.location.search);
  const prefill = {
    intent: params.get('intent')?.trim() || '',
    service: params.get('service')?.trim() || '',
    rego: params.get('rego')?.trim() || '',
    firstName: params.get('firstName')?.trim() || '',
    lastName: params.get('lastName')?.trim() || '',
    phone: params.get('phone')?.trim() || '',
    email: params.get('email')?.trim() || '',
    vehicleBrand: params.get('vehicleBrand')?.trim() || '',
    vehicleModel: params.get('vehicleModel')?.trim() || '',
    wofExpiryDate: toDateInputValue(params.get('wofExpiryDate')),
    regoExpiryDate: toDateInputValue(params.get('regoExpiryDate')),
  };
  return {
    ...prefill,
    hasAny: Object.values(prefill).some(Boolean),
  };
};

const resolveVehicleSelection = (brandRaw: string, modelRaw: string) => {
  const normalizedBrand = (brandRaw || '').trim();
  const normalizedModel = (modelRaw || '').trim();
  const brandKnown = VEHICLE_BRANDS.includes(normalizedBrand);
  const baseModels = normalizedBrand ? (VEHICLE_MODELS[normalizedBrand] || []) : [];
  const modelKnown = Boolean(normalizedModel && baseModels.includes(normalizedModel));
  return {
    vehicleBrand: brandKnown ? normalizedBrand : normalizedBrand ? 'Other' : '',
    vehicleBrandOther: brandKnown ? '' : normalizedBrand,
    vehicleModel: modelKnown ? normalizedModel : normalizedModel ? 'Other' : '',
    vehicleModelOther: modelKnown ? '' : normalizedModel,
  };
};

export const PublicPWA = () => {
  const reminderPrefill = useMemo(() => readReminderPrefill(), []);
  const [form, setForm] = useState(initial);
  const [message, setMessage] = useState('');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [bookingForm, setBookingForm] = useState(initialBooking);
  const [bookingSlots, setBookingSlots] = useState<{ startDateTime: string; endDateTime: string }[]>([]);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'searching' | 'found' | 'not_found' | 'error'>('idle');
  const [wizardStep, setWizardStep] = useState(0);
  const [jobNumber, setJobNumber] = useState('');
  const [bookingLookupStatus, setBookingLookupStatus] = useState<'idle' | 'searching' | 'found' | 'not_found' | 'error'>('idle');
  const [lastLoadedCompliance, setLastLoadedCompliance] = useState<{
    wofExpiryDate: string;
    regoExpiryDate: string;
    wofExpired: boolean;
    regoExpired: boolean;
  } | null>(null);
  const [requiresCurrentComplianceUpdate, setRequiresCurrentComplianceUpdate] = useState(false);
  const [complianceWarningOpen, setComplianceWarningOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installReady, setInstallReady] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [upsellSelections, setUpsellSelections] = useState<string[]>([]);
  const [prefillApplied, setPrefillApplied] = useState(false);
  const [prefillServiceApplied, setPrefillServiceApplied] = useState(false);
  const { data: services } = useQuery({
    queryKey: ['public-services'],
    queryFn: async () => (await api.get('/public/services')).data,
  });
  const { data: servicePackages } = useQuery({
    queryKey: ['public-service-packages'],
    queryFn: async () => (await api.get('/public/service-packages')).data,
  });
  const { data: publicConfig } = useQuery({
    queryKey: ['public-config'],
    queryFn: async () => (await api.get('/public/config')).data,
  });
  const businessName = publicConfig?.businessName || 'Carmaster';
  const brandName = businessName;
  const logoUrl = publicConfig?.logoUrl;
  const phoneNumber = publicConfig?.phone || '0224013026';
  const phoneHref = phoneNumber ? `tel:${phoneNumber.replace(/[^\d+]/g, '')}` : '';
  const { data: upsells } = useQuery({
    queryKey: ['public-upsells'],
    queryFn: async () => (await api.get('/public/upsells')).data,
  });
  const bookingsUseGraph = Boolean(publicConfig?.bookingsEnabled && publicConfig?.bookingsBusinessId);
  const bookingsPageUrl = publicConfig?.bookingsPageUrl;
  const { data: bookingServices } = useQuery({
    queryKey: ['booking-services'],
    enabled: bookingsUseGraph,
    queryFn: async () => (await api.get('/public/bookings/services')).data,
  });
  const isWofReminderIntent = reminderPrefill.intent.toLowerCase() === 'wof-renewal' || reminderPrefill.service.toLowerCase() === 'wof';
  const showInlineWizard = !bookingsUseGraph && (!bookingsPageUrl || isWofReminderIntent);
  const showExternalCalendar = !bookingsUseGraph && bookingsPageUrl && !isWofReminderIntent;
  const prefilledVehicle = useMemo(
    () => resolveVehicleSelection(reminderPrefill.vehicleBrand, reminderPrefill.vehicleModel),
    [reminderPrefill.vehicleBrand, reminderPrefill.vehicleModel],
  );
  const nzMonth = Number(
    new Intl.DateTimeFormat('en-NZ', { timeZone: 'Pacific/Auckland', month: 'numeric' }).format(new Date()),
  );
  const season = useMemo(() => {
    if ([12, 1, 2].includes(nzMonth)) return 'Summer';
    if ([3, 4, 5].includes(nzMonth)) return 'Autumn';
    if ([6, 7, 8].includes(nzMonth)) return 'Winter';
    return 'Spring';
  }, [nzMonth]);

  const selectedService = useMemo(
    () => (services ?? []).find((service: any) => service.id === form.selectedServiceId),
    [form.selectedServiceId, services],
  );
  const selectedServicePackage = useMemo(
    () => (servicePackages ?? []).find((pkg: any) => pkg.id === form.selectedServicePackageId),
    [form.selectedServicePackageId, servicePackages],
  );
  const selectedServicePackagePrice = useMemo(
    () =>
      selectedServicePackage?.prices?.find((price: any) => price.vehicleType === form.vehicleType) ||
      selectedServicePackage?.prices?.[0] ||
      null,
    [selectedServicePackage, form.vehicleType],
  );
  const selectedUpsells = useMemo(
    () => (upsells ?? []).filter((upsell: any) => upsellSelections.includes(upsell.id)),
    [upsellSelections, upsells],
  );
  const selectedAdditionalServices = useMemo(
    () => (services ?? []).filter((service: any) => (form.additionalServiceIds || []).includes(service.id)),
    [services, form.additionalServiceIds],
  );
  const selectedPackageHasWof = useMemo(
    () =>
      Boolean(
        selectedServicePackage
        && (
          isWofServiceName(selectedServicePackage.name)
          || (selectedServicePackage.inclusions || []).some((inclusion: any) => isWofServiceName(inclusion?.title))
        ),
      ),
    [selectedServicePackage],
  );
  const hasWofSelection = useMemo(
    () =>
      Boolean(
        (selectedService && isWofServiceName(selectedService.name))
        || selectedAdditionalServices.some((service: any) => isWofServiceName(service?.name))
        || selectedPackageHasWof,
      ),
    [selectedService, selectedAdditionalServices, selectedPackageHasWof],
  );
  const wofBookingGateActive = requiresCurrentComplianceUpdate && form.jobType === 'MAINTENANCE';
  const isComplianceOnlySubmission = wofBookingGateActive && !hasWofSelection;

  const pricingSummary = useMemo(() => {
    let total = 0;
    let hasEstimate = false;
    let hasQuoteRequired = false;
    const addItem = (price: any, priceType?: string) => {
      if (priceType === 'QUOTE_REQUIRED') {
        hasQuoteRequired = true;
        return;
      }
      const value = Number(price);
      if (!Number.isFinite(value)) return;
      if (priceType === 'FROM') {
        hasEstimate = true;
        total += value;
        return;
      }
      total += value;
    };
    if (form.selectionMode === 'single_service' && selectedService) {
      addItem(selectedService.basePrice, selectedService.priceType);
    }
    if (form.selectionMode === 'service_package' && selectedServicePackagePrice) {
      addItem(selectedServicePackagePrice.basePrice, selectedServicePackagePrice.priceType);
    }
    selectedAdditionalServices.forEach((service: any) => addItem(service.basePrice, service.priceType));
    selectedUpsells.forEach((upsell: any) => addItem(upsell.price, upsell.priceType));
    return { total, hasEstimate, hasQuoteRequired };
  }, [form.selectionMode, selectedService, selectedServicePackagePrice, selectedAdditionalServices, selectedUpsells]);

  const doesUpsellMatch = (upsell: any) => {
    const rules = upsell.applicabilityRules || {};
    const odometerValue = Number(form.odometerKm);
    if (rules.minKm != null && (!Number.isFinite(odometerValue) || odometerValue < rules.minKm)) {
      return false;
    }
    if (rules.maxKm != null && (!Number.isFinite(odometerValue) || odometerValue > rules.maxKm)) {
      return false;
    }
    if (Array.isArray(rules.seasons) && rules.seasons.length > 0 && !rules.seasons.includes(season)) {
      return false;
    }
    if (rules.serviceNameContains) {
      const serviceName =
        (form.selectionMode === 'service_package'
          ? (selectedServicePackage?.name || '')
          : (selectedService?.name || '')).toLowerCase();
      const tokens = Array.isArray(rules.serviceNameContains)
        ? rules.serviceNameContains
        : [rules.serviceNameContains];
      const hasMatch = tokens.some((token: string) => serviceName.includes(String(token).toLowerCase()));
      if (!hasMatch) {
        return false;
      }
    }
    return true;
  };

  const recommendedUpsells = useMemo(
    () => (upsells ?? []).filter((upsell: any) => upsell.isActive && doesUpsellMatch(upsell)),
    [upsells, form.odometerKm, season, selectedService, selectedServicePackage, form.selectionMode],
  );
  const otherUpsells = useMemo(
    () => (upsells ?? []).filter((upsell: any) => upsell.isActive && !doesUpsellMatch(upsell)),
    [upsells, form.odometerKm, season, selectedService, selectedServicePackage, form.selectionMode],
  );

  useEffect(() => {
    const handler = (event: any) => {
      event.preventDefault();
      setInstallPrompt(event);
      setInstallReady(true);
    };
    const onInstalled = () => {
      setInstallReady(false);
      setInstallPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    setIsIOS(ios);
    setIsStandalone(Boolean(standalone));
  }, []);

  useEffect(() => {
    if (prefillApplied || !reminderPrefill.hasAny || publicConfig === undefined) {
      return;
    }

    if (bookingsUseGraph) {
      setBookingForm((prev) => ({
        ...prev,
        rego: reminderPrefill.rego || prev.rego,
        firstName: reminderPrefill.firstName || prev.firstName,
        lastName: reminderPrefill.lastName || prev.lastName,
        phone: reminderPrefill.phone || prev.phone,
        email: reminderPrefill.email || prev.email,
        ...prefilledVehicle,
      }));
    } else if (showInlineWizard) {
      setMessage('');
      setIsWizardOpen(true);
      setWizardStep(0);
      setJobNumber('');
      setUpsellSelections([]);
      setLookupStatus('idle');
      setLastLoadedCompliance(null);
      setRequiresCurrentComplianceUpdate(false);
      setComplianceWarningOpen(false);
      setForm((prev) => ({
        ...initial,
        ...prev,
        rego: reminderPrefill.rego || prev.rego,
        firstName: reminderPrefill.firstName || prev.firstName,
        lastName: reminderPrefill.lastName || prev.lastName,
        phone: reminderPrefill.phone || prev.phone,
        email: reminderPrefill.email || prev.email,
        wofExpiryDate: reminderPrefill.wofExpiryDate || prev.wofExpiryDate,
        regoExpiryDate: reminderPrefill.regoExpiryDate || prev.regoExpiryDate,
        jobType: 'MAINTENANCE',
        selectionMode: 'single_service',
        ...prefilledVehicle,
      }));
    }

    setPrefillApplied(true);
  }, [
    prefillApplied,
    reminderPrefill,
    publicConfig,
    bookingsUseGraph,
    showInlineWizard,
    prefilledVehicle,
  ]);

  useEffect(() => {
    if (!prefillApplied || prefillServiceApplied || !isWofReminderIntent) {
      return;
    }

    if (bookingsUseGraph) {
      if (!bookingServices?.length) return;
      const wofBookingService = bookingServices.find((service: any) =>
        isWofServiceName(service?.displayName || service?.name),
      );
      if (wofBookingService?.id) {
        setBookingForm((prev) => ({ ...prev, serviceId: wofBookingService.id }));
      }
      setPrefillServiceApplied(true);
      return;
    }

    if (!services?.length) return;
    const wofService = services.find((service: any) => isWofServiceName(service?.name));
    if (wofService?.id) {
      setForm((prev) => ({
        ...prev,
        selectionMode: 'single_service',
        selectedServiceId: wofService.id,
        selectedServicePackageId: '',
        additionalServiceIds: (prev.additionalServiceIds || []).filter((serviceId: string) => serviceId !== wofService.id),
      }));
      setWizardStep(3);
    }
    setPrefillServiceApplied(true);
  }, [
    prefillApplied,
    prefillServiceApplied,
    isWofReminderIntent,
    bookingsUseGraph,
    bookingServices,
    services,
  ]);

  const toggleUpsellSelection = (id: string) => {
    setUpsellSelections((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const startWizard = () => {
    setMessage('');
    setIsWizardOpen(true);
    setWizardStep(0);
    setJobNumber('');
    setUpsellSelections([]);
    setForm(initial);
    setLookupStatus('idle');
    setLastLoadedCompliance(null);
    setRequiresCurrentComplianceUpdate(false);
    setComplianceWarningOpen(false);
  };

  useEffect(() => {
    const loadSlots = async () => {
      if (!bookingsUseGraph || !bookingForm.serviceId || !bookingForm.date) {
        setBookingSlots([]);
        return;
      }
      setBookingError('');
      setBookingLoading(true);
      try {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Pacific/Auckland';
        const response = await api.post('/public/bookings/availability', {
          serviceId: bookingForm.serviceId,
          date: bookingForm.date,
          timeZone,
        });
        setBookingSlots(response.data?.slots || []);
      } catch (err: any) {
        const msg = err?.response?.data?.message || 'Unable to load availability';
        setBookingError(msg);
      } finally {
        setBookingLoading(false);
      }
    };
    loadSlots();
  }, [bookingsUseGraph, bookingForm.serviceId, bookingForm.date]);

  useEffect(() => {
    const rego = form.rego.trim();
    if (!rego || !isWizardOpen) {
      setLookupStatus('idle');
      setLastLoadedCompliance(null);
      setRequiresCurrentComplianceUpdate(false);
      setComplianceWarningOpen(false);
      return;
    }
    setLookupStatus('searching');
    const timeout = setTimeout(async () => {
      try {
        const response = await api.get('/public/customers', { params: { rego, _t: Date.now() } });
        const match = response.data;
        if (match?.rego) {
          const normalizedBrand = (match.vehicleBrand ?? '').trim();
          const normalizedModel = (match.vehicleModel ?? '').trim();
          const brandKnown = VEHICLE_BRANDS.includes(normalizedBrand);
          const baseModels = normalizedBrand ? (VEHICLE_MODELS[normalizedBrand] || []) : [];
          const modelKnown = normalizedModel && baseModels.includes(normalizedModel);
          const loadedWofExpiryDate = toDateInputValue(match.wofExpiryDate);
          const loadedRegoExpiryDate = toDateInputValue(match.regoExpiryDate);
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
          setLookupStatus('found');
          return;
        }
        setLookupStatus('not_found');
        setLastLoadedCompliance(null);
        setRequiresCurrentComplianceUpdate(false);
        setComplianceWarningOpen(false);
      } catch {
        setLookupStatus('error');
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [form.rego, isWizardOpen]);

  useEffect(() => {
    const rego = bookingForm.rego.trim();
    if (!rego) {
      setBookingLookupStatus('idle');
      return;
    }
    setBookingLookupStatus('searching');
    const timeout = setTimeout(async () => {
      try {
        const response = await api.get('/public/customers', { params: { rego, _t: Date.now() } });
        const match = response.data;
        if (match?.rego) {
          const normalizedBrand = (match.vehicleBrand ?? '').trim();
          const normalizedModel = (match.vehicleModel ?? '').trim();
          const brandKnown = VEHICLE_BRANDS.includes(normalizedBrand);
          const baseModels = normalizedBrand ? (VEHICLE_MODELS[normalizedBrand] || []) : [];
          const modelKnown = normalizedModel && baseModels.includes(normalizedModel);
          setBookingForm((prev) => ({
            ...prev,
            vehicleBrand: brandKnown ? normalizedBrand : normalizedBrand ? 'Other' : '',
            vehicleBrandOther: brandKnown ? '' : normalizedBrand,
            vehicleModel: modelKnown ? normalizedModel : normalizedModel ? 'Other' : '',
            vehicleModelOther: modelKnown ? '' : normalizedModel,
            firstName: match.firstName ?? '',
            lastName: match.lastName ?? '',
            phone: match.phone ?? '',
            email: match.email ?? '',
          }));
          setBookingLookupStatus('found');
          return;
        }
        setBookingLookupStatus('not_found');
      } catch {
        setBookingLookupStatus('error');
      }
    }, 400);
    return () => clearTimeout(timeout);
  }, [bookingForm.rego]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage('');
    if (requiresCurrentComplianceUpdate && !hasCurrentComplianceDates) {
      setWizardStep(2);
      return;
    }
    const resolvedBrand = form.vehicleBrand === 'Other' ? form.vehicleBrandOther.trim() : form.vehicleBrand.trim();
    const resolvedModel = (form.vehicleBrand === 'Other' || form.vehicleModel === 'Other')
      ? form.vehicleModelOther.trim()
      : form.vehicleModel.trim();
    const primaryServiceId = form.selectionMode === 'single_service' ? form.selectedServiceId : '';
    const additionalServiceIds = (form.additionalServiceIds || [])
      .filter((serviceId: string) => serviceId && serviceId !== primaryServiceId);
    const complianceOnly = wofBookingGateActive && !hasWofSelection;
    const endpoint = form.jobType === 'REPAIR' ? 'repair' : 'service';
    const response = await api.post(`/public/${endpoint}`, {
      rego: form.rego.trim(),
      vehicleBrand: resolvedBrand,
      vehicleModel: resolvedModel,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      notes: form.notes.trim(),
      jobType: form.jobType,
      selectedServiceId: complianceOnly ? undefined : (form.selectionMode === 'single_service' ? form.selectedServiceId : undefined),
      additionalServiceIds: complianceOnly ? undefined : (additionalServiceIds.length ? additionalServiceIds : undefined),
      selectedServicePackageId: complianceOnly ? undefined : (form.selectionMode === 'service_package' ? form.selectedServicePackageId : undefined),
      vehicleType: form.vehicleType || 'JAPANESE',
      selectedUpsellIds: complianceOnly ? [] : upsellSelections,
      odometerKm: form.odometerKm ? Number(form.odometerKm) : undefined,
      wofExpiryDate: form.wofExpiryDate || undefined,
      regoExpiryDate: form.regoExpiryDate || undefined,
      jobNumber,
      requireWofForServiceBooking: wofBookingGateActive || undefined,
    });
    if (response.data?.complianceOnly) {
      setMessage('WOF/Rego dates were updated. No booking was created because WOF was not selected.');
    } else {
      setMessage(form.jobType === 'REPAIR' ? 'Repair request received!' : 'Service booking saved!');
    }
    setIsWizardOpen(false);
    setForm(initial);
    setUpsellSelections([]);
    setWizardStep(0);
    setLookupStatus('idle');
    setLastLoadedCompliance(null);
    setRequiresCurrentComplianceUpdate(false);
    setComplianceWarningOpen(false);
    setJobNumber('');
    e.currentTarget.reset();
  };

  const submitBooking = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage('');
    setBookingError('');
    const slot = bookingSlots[bookingForm.slotIndex];
    if (!slot) {
      setBookingError('Please choose a time slot.');
      return;
    }
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Pacific/Auckland';
    const resolvedBrand = bookingForm.vehicleBrand === 'Other' ? bookingForm.vehicleBrandOther.trim() : bookingForm.vehicleBrand.trim();
    const resolvedModel = (bookingForm.vehicleBrand === 'Other' || bookingForm.vehicleModel === 'Other')
      ? bookingForm.vehicleModelOther.trim()
      : bookingForm.vehicleModel.trim();
    await api.post('/public/bookings/appointments', {
      rego: bookingForm.rego.trim(),
      vehicleBrand: resolvedBrand,
      vehicleModel: resolvedModel,
      firstName: bookingForm.firstName.trim(),
      lastName: bookingForm.lastName.trim(),
      phone: bookingForm.phone.trim(),
      email: bookingForm.email.trim(),
      notes: bookingForm.notes.trim(),
      serviceId: bookingForm.serviceId,
      startDateTime: slot.startDateTime,
      endDateTime: slot.endDateTime,
      timeZone,
    });
    setMessage('Booking confirmed!');
    setBookingForm(initialBooking);
    setBookingSlots([]);
    e.currentTarget.reset();
  };

  useEffect(() => {
    if (wizardStep !== 5 || jobNumber || !isWizardOpen) return;
    const loadJobNumber = async () => {
      try {
        const response = await api.get('/public/job-number');
        setJobNumber(response.data?.jobNumber || '');
      } catch {
        setJobNumber('');
      }
    };
    loadJobNumber();
  }, [wizardStep, jobNumber, isWizardOpen]);

  const renderUpsellOptions = () => {
    if (!upsells || upsells.length === 0) {
      return <p className="text-xs text-white/60">No upsells available right now.</p>;
    }
    return (
      <div className="space-y-3 pt-2">
        {recommendedUpsells.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Recommended for you</p>
            <div className="grid gap-2">
              {recommendedUpsells.map((upsell: any) => (
                <label key={upsell.id} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={upsellSelections.includes(upsell.id)}
                    onChange={() => toggleUpsellSelection(upsell.id)}
                  />
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{upsell.name}</span>
                      <span className="text-xs text-white/60">{formatPrice(upsell.price, upsell.priceType)}</span>
                    </div>
                    {upsell.description && <p className="text-xs text-white/60">{upsell.description}</p>}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
        {otherUpsells.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">Other options</p>
            <div className="grid gap-2">
              {otherUpsells.map((upsell: any) => (
                <label key={upsell.id} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={upsellSelections.includes(upsell.id)}
                    onChange={() => toggleUpsellSelection(upsell.id)}
                  />
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{upsell.name}</span>
                      <span className="text-xs text-white/60">{formatPrice(upsell.price, upsell.priceType)}</span>
                    </div>
                    {upsell.description && <p className="text-xs text-white/60">{upsell.description}</p>}
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const brandOptions = sortWithOtherLast(VEHICLE_BRANDS);
  const formBaseModels = form.vehicleBrand && form.vehicleBrand !== 'Other'
    ? sortWithOtherLast(VEHICLE_MODELS[form.vehicleBrand] || [])
    : [];
  const formModelOptions = form.vehicleBrand === 'Other'
    ? ['Other']
    : [...formBaseModels, 'Other'];
  const formResolvedBrand = form.vehicleBrand === 'Other' ? form.vehicleBrandOther.trim() : form.vehicleBrand.trim();
  const formResolvedModel = (form.vehicleBrand === 'Other' || form.vehicleModel === 'Other')
    ? form.vehicleModelOther.trim()
    : form.vehicleModel.trim();
  const hasCurrentComplianceDates = Boolean(
    form.wofExpiryDate &&
    form.regoExpiryDate &&
    !isExpiredDate(form.wofExpiryDate) &&
    !isExpiredDate(form.regoExpiryDate)
  );
  const canProceedCustomerStep = Boolean(
    form.rego.trim() &&
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.phone.trim() &&
    form.email.trim()
  );
  const canProceedJobTypeStep = Boolean(form.jobType);
  const canProceedVehicleStep = Boolean(
    formResolvedBrand &&
    formResolvedModel &&
    form.odometerKm.trim() &&
    (!requiresCurrentComplianceUpdate || hasCurrentComplianceDates)
  );
  const canProceedServiceStep = form.selectionMode === 'service_package'
    ? (wofBookingGateActive ? true : Boolean(form.selectedServicePackageId))
    : (wofBookingGateActive ? true : Boolean(form.selectedServiceId));
  const selectedServicePrice = formatPrice(selectedService?.basePrice, selectedService?.priceType);
  const selectedPackagePrice = formatPrice(selectedServicePackagePrice?.basePrice, selectedServicePackagePrice?.priceType);
  const complianceWarningMessage = `Last loaded WOF expiry (${formatDateLabel(lastLoadedCompliance?.wofExpiryDate)}) or Rego expiry (${formatDateLabel(lastLoadedCompliance?.regoExpiryDate)}) is expired. Update both current dates, or book for WOF.`;

  const selectWofService = () => {
    const wofService = (services || []).find((service: any) => isWofServiceName(service?.name));
    if (!wofService) return;
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
    setWizardStep(3);
  };

  const bookingBaseModels = bookingForm.vehicleBrand && bookingForm.vehicleBrand !== 'Other'
    ? sortWithOtherLast(VEHICLE_MODELS[bookingForm.vehicleBrand] || [])
    : [];
  const bookingModelOptions = bookingForm.vehicleBrand === 'Other'
    ? ['Other']
    : [...bookingBaseModels, 'Other'];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0d0d0d] to-black text-white px-4 py-6">
      {complianceWarningOpen && isWizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-[#0d0d0d] border border-white/10 rounded-2xl p-5 max-w-md w-full shadow-soft">
            <h3 className="text-lg font-semibold mb-2">WOF / Rego Expired</h3>
            <p className="text-sm text-white/70 mb-4">{complianceWarningMessage}</p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setComplianceWarningOpen(false)}
                className="px-3 py-2 rounded-xl bg-white/10 border border-white/10 text-sm font-semibold"
              >
                Update dates
              </button>
              <button
                type="button"
                onClick={() => {
                  setComplianceWarningOpen(false);
                  selectWofService();
                }}
                className="px-3 py-2 rounded-xl bg-brand-primary text-black text-sm font-semibold"
              >
                Book for WOF
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-xl mx-auto space-y-6">
        <div className="text-center">
          {logoUrl ? (
            <div className="w-16 h-16 rounded-2xl bg-white/10 border border-white/10 grid place-items-center mx-auto shadow-soft overflow-hidden p-2">
              <img src={logoUrl} alt={`${businessName} logo`} className="w-full h-full object-contain" />
            </div>
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-brand-primary text-black font-bold grid place-items-center mx-auto shadow-soft">
              CM
            </div>
          )}
          <h1 className="text-3xl font-semibold mt-3">{brandName}</h1>
          <p className="text-xs text-white/60 mt-1">powered by Workshop Pro</p>
          <p className="text-white/70 mt-2">Book fast. Upload pics. Install to home screen.</p>
          {!isStandalone && (
            <div className="mt-4 space-y-2">
              {installReady && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!installPrompt) return;
                    installPrompt.prompt();
                    await installPrompt.userChoice;
                    setInstallReady(false);
                    setInstallPrompt(null);
                  }}
                  className="px-4 py-2 rounded-full bg-brand-primary text-black font-semibold shadow-soft"
                >
                  Install App
                </button>
              )}
              {isIOS && (
                <div className="text-xs text-white/70">
                  On iPhone/iPad: tap Share and select “Add to Home Screen”.
                </div>
              )}
            </div>
          )}
        </div>

        {message && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-brand-primary text-black font-bold grid place-items-center mx-auto">
              ✓
            </div>
            <div>
              <p className="text-xl font-semibold">We&apos;ve got it</p>
              <p className="text-white/70 text-sm mt-1">{message}</p>
            </div>
            <div className="space-y-2">
              <a
                href={phoneHref}
                className="block text-center bg-brand-primary text-black rounded-2xl py-2 font-semibold"
              >
                Call Us
              </a>
              <button
                type="button"
                onClick={() => {
                  setMessage('');
                }}
                className="w-full text-center bg-white/10 border border-white/10 rounded-2xl py-2 font-semibold text-white"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {!message && (
          <div className="space-y-3">
            {showInlineWizard && (
              <button
                type="button"
                onClick={() => (isWizardOpen ? setIsWizardOpen(false) : startWizard())}
                className="w-full text-center border rounded-2xl py-3 font-semibold bg-white/10 border-white/10 text-white"
              >
                {isWizardOpen ? 'Hide booking form' : 'Start booking'}
              </button>
            )}
            <a
              href={phoneHref}
              className="block text-center bg-brand-primary text-black rounded-2xl py-3 font-semibold"
            >
              Call Us
            </a>
          </div>
        )}

        {bookingsUseGraph && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
            <p className="text-lg font-semibold">Choose a date and time</p>
            <form onSubmit={submitBooking} className="space-y-2">
              <select
                className="input"
                required
                value={bookingForm.serviceId}
                onChange={(e) => setBookingForm({ ...bookingForm, serviceId: e.target.value, slotIndex: -1 })}
              >
                <option value="" disabled>
                  Choose service
                </option>
                {(bookingServices || []).map((service: any) => (
                  <option key={service.id} value={service.id}>
                    {service.displayName || service.name}
                  </option>
                ))}
              </select>
              <input
                className="input"
                type="date"
                required
                value={bookingForm.date}
                onChange={(e) => setBookingForm({ ...bookingForm, date: e.target.value, slotIndex: -1 })}
              />
              <input
                className="input"
                placeholder="Rego"
                required
                value={bookingForm.rego}
                onChange={(e) => setBookingForm({ ...bookingForm, rego: e.target.value })}
              />
              {bookingLookupStatus === 'searching' && <p className="text-sm text-white/60">Searching for customer...</p>}
              {bookingLookupStatus === 'found' && <p className="text-sm text-green-200">Customer details loaded</p>}
              {bookingLookupStatus === 'not_found' && <p className="text-sm text-amber-200">No customer found</p>}
              {bookingLookupStatus === 'error' && <p className="text-sm text-red-200">Lookup failed</p>}
              {bookingLoading && <p className="text-sm text-white/60">Loading available times...</p>}
              {bookingError && <p className="text-sm text-red-300">{bookingError}</p>}
              {!bookingLoading && bookingForm.date && bookingForm.serviceId && bookingSlots.length === 0 && (
                <p className="text-sm text-white/60">No available slots for this date.</p>
              )}
              {bookingSlots.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {bookingSlots.map((slot, index) => {
                    const label = new Date(slot.startDateTime).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    });
                    const isSelected = bookingForm.slotIndex === index;
                    return (
                      <button
                        key={`${slot.startDateTime}-${slot.endDateTime}`}
                        type="button"
                        onClick={() => setBookingForm({ ...bookingForm, slotIndex: index })}
                        className={`rounded-xl py-2 text-sm border ${
                          isSelected ? 'bg-brand-primary text-black border-transparent' : 'bg-white/10 border-white/10 text-white'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
              <select
                className="input"
                required
                value={bookingForm.vehicleBrand}
                onChange={(e) => setBookingForm({
                  ...bookingForm,
                  vehicleBrand: e.target.value,
                  vehicleBrandOther: e.target.value === 'Other' ? bookingForm.vehicleBrandOther : '',
                  vehicleModel: '',
                  vehicleModelOther: '',
                })}
              >
                <option value="">Select vehicle brand *</option>
                {brandOptions.map((brand) => (
                  <option key={brand} value={brand}>{brand}</option>
                ))}
              </select>
              {bookingForm.vehicleBrand === 'Other' && (
                <input
                  className="input"
                  placeholder="Enter vehicle brand *"
                  required
                  value={bookingForm.vehicleBrandOther}
                  onChange={(e) => setBookingForm({ ...bookingForm, vehicleBrandOther: e.target.value })}
                />
              )}
              <select
                className="input"
                required
                value={bookingForm.vehicleModel}
                onChange={(e) => setBookingForm({ ...bookingForm, vehicleModel: e.target.value })}
                disabled={!bookingForm.vehicleBrand || bookingForm.vehicleBrand === 'Other'}
              >
                <option value="">Select model *</option>
                {bookingModelOptions.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
              {(bookingForm.vehicleBrand === 'Other' || bookingForm.vehicleModel === 'Other') && (
                <input
                  className="input"
                  placeholder="Enter vehicle model *"
                  required
                  value={bookingForm.vehicleModelOther}
                  onChange={(e) => setBookingForm({ ...bookingForm, vehicleModelOther: e.target.value })}
                />
              )}
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="input"
                  placeholder="First name"
                  required
                  value={bookingForm.firstName}
                  onChange={(e) => setBookingForm({ ...bookingForm, firstName: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Last name"
                  required
                  value={bookingForm.lastName}
                  onChange={(e) => setBookingForm({ ...bookingForm, lastName: e.target.value })}
                />
              </div>
              <input
                className="input"
                placeholder="Phone"
                required
                value={bookingForm.phone}
                onChange={(e) => setBookingForm({ ...bookingForm, phone: e.target.value })}
              />
              <input
                className="input"
                type="email"
                placeholder="Email"
                required
                value={bookingForm.email}
                onChange={(e) => setBookingForm({ ...bookingForm, email: e.target.value })}
              />
              <textarea
                className="input"
                placeholder="Extra notes"
                value={bookingForm.notes}
                onChange={(e) => setBookingForm({ ...bookingForm, notes: e.target.value })}
              />
              <button className="w-full bg-brand-primary text-black font-semibold py-2 rounded-xl">Confirm booking</button>
            </form>
          </div>
        )}

        {showExternalCalendar && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
            <p className="text-lg font-semibold">Choose a date and time</p>
            <p className="text-sm text-white/70">Powered by Microsoft Bookings.</p>
            <a
              href={bookingsPageUrl}
              target="_blank"
              rel="noreferrer"
              className="block text-center bg-brand-primary text-black rounded-2xl py-2 font-semibold"
            >
              Open booking calendar
            </a>
            <div className="pt-2">
              <iframe
                title="Microsoft Bookings"
                src={bookingsPageUrl}
                className="w-full h-[520px] rounded-xl border border-white/10 bg-white"
              />
            </div>
          </div>
        )}

        {showInlineWizard && (
          <div
            className={`overflow-hidden transition-all duration-300 ${
              isWizardOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
            }`}
            aria-hidden={!isWizardOpen}
          >
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3">
              <p className="text-lg font-semibold">Book a service or repair</p>
              <form onSubmit={submit} className="space-y-4">
                <div className="flex items-center justify-between text-xs text-white/60">
                  <span>Step {wizardStep + 1} of 6</span>
                  {lookupStatus === 'found' && <span className="text-green-200">Customer found</span>}
                  {lookupStatus === 'not_found' && <span className="text-amber-200">New customer</span>}
                </div>

                {wizardStep === 0 && (
                  <div className="space-y-2">
                    <input
                      className="input"
                      placeholder="Rego"
                      required
                      value={form.rego}
                      onChange={(e) => setForm({ ...form, rego: e.target.value })}
                    />
                    {lookupStatus === 'searching' && <p className="text-xs text-white/60">Searching for customer...</p>}
                    {lookupStatus === 'found' && <p className="text-xs text-green-200">Details loaded</p>}
                    {lookupStatus === 'not_found' && <p className="text-xs text-amber-200">No customer found</p>}
                    {lookupStatus === 'error' && <p className="text-xs text-red-200">Lookup failed</p>}
                    {lookupStatus === 'found' && lastLoadedCompliance && (
                      <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 space-y-1">
                        <p>Last loaded WOF expiry: {formatDateLabel(lastLoadedCompliance.wofExpiryDate)}</p>
                        <p>Last loaded Rego expiry: {formatDateLabel(lastLoadedCompliance.regoExpiryDate)}</p>
                        {(lastLoadedCompliance.wofExpired || lastLoadedCompliance.regoExpired) && (
                          <p className="text-amber-200">Expired record detected. Current WOF and Rego dates are required.</p>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <input className="input" placeholder="First name" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                      <input className="input" placeholder="Last name" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                    </div>
                    <input className="input" placeholder="Phone" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    <input className="input" type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                )}

                {wizardStep === 1 && (
                  <div className="grid gap-2">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, jobType: 'MAINTENANCE' })}
                      className={`w-full text-left border rounded-xl px-3 py-3 font-semibold ${
                        form.jobType === 'MAINTENANCE' ? 'bg-brand-primary text-black border-transparent' : 'bg-white/10 border-white/10 text-white'
                      }`}
                    >
                      Regular Maintenance
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, jobType: 'REPAIR' })}
                      className={`w-full text-left border rounded-xl px-3 py-3 font-semibold ${
                        form.jobType === 'REPAIR' ? 'bg-brand-primary text-black border-transparent' : 'bg-white/10 border-white/10 text-white'
                      }`}
                    >
                      Repair Job
                    </button>
                  </div>
                )}

                {wizardStep === 2 && (
                  <div className="grid grid-cols-1 gap-2">
                    <select
                      className="input"
                      required
                      value={form.vehicleBrand}
                      onChange={(e) => setForm({
                        ...form,
                        vehicleBrand: e.target.value,
                        vehicleBrandOther: e.target.value === 'Other' ? form.vehicleBrandOther : '',
                        vehicleModel: '',
                        vehicleModelOther: '',
                      })}
                    >
                      <option value="">Select vehicle brand *</option>
                      {brandOptions.map((brand) => (
                        <option key={brand} value={brand}>{brand}</option>
                      ))}
                    </select>
                    {form.vehicleBrand === 'Other' && (
                      <input
                        className="input"
                        placeholder="Enter vehicle brand *"
                        required
                        value={form.vehicleBrandOther}
                        onChange={(e) => setForm({ ...form, vehicleBrandOther: e.target.value })}
                      />
                    )}
                    <select
                      className="input"
                      required
                      value={form.vehicleModel}
                      onChange={(e) => setForm({ ...form, vehicleModel: e.target.value })}
                      disabled={!form.vehicleBrand || form.vehicleBrand === 'Other'}
                    >
                      <option value="">Select model *</option>
                      {formModelOptions.map((model) => (
                        <option key={model} value={model}>{model}</option>
                      ))}
                    </select>
                    {(form.vehicleBrand === 'Other' || form.vehicleModel === 'Other') && (
                      <input
                        className="input"
                        placeholder="Enter vehicle model *"
                        required
                        value={form.vehicleModelOther}
                        onChange={(e) => setForm({ ...form, vehicleModelOther: e.target.value })}
                      />
                    )}
                    <input
                      className="input"
                      type="number"
                      placeholder="Current odometer (km)"
                      required
                      value={form.odometerKm}
                      onChange={(e) => setForm({ ...form, odometerKm: e.target.value })}
                    />
                    <select
                      className="input"
                      value={form.vehicleType}
                      onChange={(e) => setForm({ ...form, vehicleType: e.target.value })}
                    >
                      {VEHICLE_TYPES.map((vehicleType) => (
                        <option key={vehicleType.value} value={vehicleType.value}>
                          {vehicleType.label}
                        </option>
                      ))}
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <input
                          className="input"
                          type="date"
                          placeholder="WOF expiry date"
                          required={requiresCurrentComplianceUpdate}
                          value={form.wofExpiryDate}
                          onChange={(e) => setForm({ ...form, wofExpiryDate: e.target.value })}
                        />
                        <p className="text-xs text-white/60">
                          {requiresCurrentComplianceUpdate ? 'WOF expiry (required).' : 'WOF expiry (optional).'}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <input
                          className="input"
                          type="date"
                          placeholder="Rego expiry date"
                          required={requiresCurrentComplianceUpdate}
                          value={form.regoExpiryDate}
                          onChange={(e) => setForm({ ...form, regoExpiryDate: e.target.value })}
                        />
                        <p className="text-xs text-white/60">
                          {requiresCurrentComplianceUpdate ? 'Rego expiry (required).' : 'Rego expiry (optional).'}
                        </p>
                      </div>
                    </div>
                    {requiresCurrentComplianceUpdate && (
                      <p className="text-xs text-amber-200">You must enter current valid WOF and Rego dates before continuing.</p>
                    )}
                  </div>
                )}

                {wizardStep === 3 && (
                  <div className="space-y-2">
                    {wofBookingGateActive && (
                      <p className="text-xs text-amber-200">
                        Include a WOF service to create a booking. If WOF is not selected, submit will only update WOF/Rego dates.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setForm({
                            ...form,
                            selectionMode: 'single_service',
                            selectedServicePackageId: '',
                          })
                        }
                        className={`border rounded-xl px-3 py-2 text-sm font-semibold ${
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
                          setForm({
                            ...form,
                            selectionMode: 'service_package',
                            selectedServiceId: '',
                          })
                        }
                        className={`border rounded-xl px-3 py-2 text-sm font-semibold ${
                          form.selectionMode === 'service_package'
                            ? 'bg-brand-primary text-black border-transparent'
                            : 'bg-white/10 border-white/10 text-white'
                        }`}
                      >
                        Service Package
                      </button>
                    </div>

                    {form.selectionMode === 'single_service' ? (
                      <>
                        <select
                          className="input"
                          value={form.selectedServiceId}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              selectedServiceId: e.target.value,
                              selectedServicePackageId: '',
                              additionalServiceIds: (form.additionalServiceIds || []).filter((serviceId: string) => serviceId !== e.target.value),
                            })
                          }
                        >
                          <option value="">Choose service</option>
                          {services?.map((service: any) => (
                            <option key={service.id} value={service.id}>
                              {service.name} - {formatPrice(service.basePrice, service.priceType)}
                            </option>
                          ))}
                        </select>
                        {selectedServicePrice && (
                          <p className="text-xs text-white/60">Price: {selectedServicePrice}</p>
                        )}
                        {selectedAdditionalServices.length > 0 && (
                          <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                            <p className="text-xs text-white/60">Additional booked services</p>
                            <div className="space-y-1">
                              {selectedAdditionalServices.map((service: any) => (
                                <div key={`pwa-addon-single-${service.id}`} className="flex items-center justify-between text-xs">
                                  <span>
                                    {service.name}
                                    {service.basePrice != null ? ` (${formatPrice(service.basePrice, service.priceType)})` : ''}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setForm({
                                        ...form,
                                        additionalServiceIds: (form.additionalServiceIds || []).filter((serviceId: string) => serviceId !== service.id),
                                      })
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
                      </>
                    ) : (
                      <>
                        <select
                          className="input"
                          value={form.selectedServicePackageId}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              selectedServicePackageId: e.target.value,
                              selectedServiceId: '',
                            })
                          }
                        >
                          <option value="">Choose package</option>
                          {servicePackages?.map((pkg: any) => {
                            const price = pkg.prices?.find((p: any) => p.vehicleType === form.vehicleType) || pkg.prices?.[0];
                            return (
                              <option key={pkg.id} value={pkg.id}>
                                {pkg.name} - {formatPrice(price?.basePrice, price?.priceType)}
                              </option>
                            );
                          })}
                        </select>
                        {selectedPackagePrice && (
                          <p className="text-xs text-white/60">
                            {form.vehicleType === 'EUROPEAN' ? 'European' : 'Japanese'} price: {selectedPackagePrice}
                          </p>
                        )}
                        {selectedAdditionalServices.length > 0 && (
                          <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                            <p className="text-xs text-white/60">Additional booked services</p>
                            <div className="space-y-1">
                              {selectedAdditionalServices.map((service: any) => (
                                <div key={`pwa-addon-package-${service.id}`} className="flex items-center justify-between text-xs">
                                  <span>
                                    {service.name}
                                    {service.basePrice != null ? ` (${formatPrice(service.basePrice, service.priceType)})` : ''}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setForm({
                                        ...form,
                                        additionalServiceIds: (form.additionalServiceIds || []).filter((serviceId: string) => serviceId !== service.id),
                                      })
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
                        {selectedServicePackage?.inclusions?.length > 0 && (
                          <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-1">
                            <p className="text-xs text-white/60">Package inclusions</p>
                            <ul className="text-xs space-y-1">
                              {selectedServicePackage.inclusions.slice(0, 5).map((inclusion: any) => (
                                <li key={`${selectedServicePackage.id}-${inclusion.id || inclusion.sortOrder}`}>
                                  {inclusion.title}
                                </li>
                              ))}
                            </ul>
                            {selectedServicePackage.inclusions.length > 5 && (
                              <p className="text-xs text-white/60">+{selectedServicePackage.inclusions.length - 5} more</p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {wizardStep === 4 && (
                  <div className="space-y-2">
                    <textarea
                      className="input"
                      placeholder="Additional notes (optional)"
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                    {renderUpsellOptions()}
                  </div>
                )}

                {wizardStep === 5 && (
                  <div className="space-y-3 text-sm">
                    <p className="text-sm font-semibold">Review &amp; confirm</p>
                    {isComplianceOnlySubmission && (
                      <p className="text-xs text-amber-200">
                        WOF is not selected. This submission will only update WOF/Rego dates and will not create a booking.
                      </p>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-white/60">Job number</span>
                      <span className="font-semibold">{jobNumber || 'Generating...'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/60">Rego</span>
                      <span>{form.rego}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/60">Job type</span>
                      <span>{form.jobType === 'MAINTENANCE' ? 'Regular Maintenance' : 'Repair Job'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/60">Odometer</span>
                      <span>{form.odometerKm} km</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/60">Vehicle type</span>
                      <span>{form.vehicleType === 'EUROPEAN' ? 'European' : 'Japanese'}</span>
                    </div>
                    {form.wofExpiryDate && (
                      <div className="flex items-center justify-between">
                        <span className="text-white/60">WOF expiry</span>
                        <span>{form.wofExpiryDate}</span>
                      </div>
                    )}
                    {form.regoExpiryDate && (
                      <div className="flex items-center justify-between">
                        <span className="text-white/60">Rego expiry</span>
                        <span>{form.regoExpiryDate}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-white/60">
                        {form.selectionMode === 'service_package' ? 'Selected package' : 'Selected service'}
                      </span>
                      <span>{form.selectionMode === 'service_package' ? (selectedServicePackage?.name || 'None') : (selectedService?.name || 'None')}</span>
                    </div>
                    {selectedAdditionalServices.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-white/60">Additional services</p>
                        <div className="space-y-1">
                          {selectedAdditionalServices.map((service: any) => (
                            <p key={`review-addon-${service.id}`}>{service.name}</p>
                          ))}
                        </div>
                      </div>
                    )}
                    {form.selectionMode === 'service_package' && selectedServicePackage?.inclusions?.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-white/60">Package inclusions</p>
                        <div className="space-y-1">
                          {selectedServicePackage.inclusions.slice(0, 8).map((inclusion: any) => (
                            <p key={`${selectedServicePackage.id}-${inclusion.id || inclusion.sortOrder}`}>{inclusion.title}</p>
                          ))}
                          {selectedServicePackage.inclusions.length > 8 && (
                            <p className="text-white/70">+{selectedServicePackage.inclusions.length - 8} more</p>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="space-y-1">
                      <p className="text-white/60">Selected upsells</p>
                      {selectedUpsells.length ? (
                        <div className="space-y-1">
                          {selectedUpsells.map((upsell: any) => (
                            <p key={upsell.id}>{upsell.name}</p>
                          ))}
                        </div>
                      ) : (
                        <p className="text-white/70">None selected</p>
                      )}
                    </div>
                    {form.notes && (
                      <div className="space-y-1">
                        <p className="text-white/60">Notes</p>
                        <p>{form.notes}</p>
                      </div>
                    )}
                    {!isComplianceOnlySubmission && (
                      <div className="border-t border-white/10 pt-3 space-y-1">
                        <p className="text-lg font-semibold">
                          {pricingSummary.hasEstimate ? 'Estimated total' : 'Total'}: ${pricingSummary.total.toFixed(2)}
                        </p>
                        {pricingSummary.hasEstimate && (
                          <p className="text-xs text-amber-200">Includes FROM pricing. Final total may vary.</p>
                        )}
                        {pricingSummary.hasQuoteRequired && (
                          <p className="text-xs text-amber-200">Quote required items will be confirmed by staff.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  {wizardStep > 0 && (
                    <button
                      type="button"
                      onClick={() => setWizardStep((step) => Math.max(0, step - 1))}
                      className="flex-1 bg-white/10 border border-white/10 text-white font-semibold py-2 rounded-xl"
                    >
                      Back
                    </button>
                  )}
                  {wizardStep < 5 ? (
                    <button
                      type="button"
                      onClick={() => setWizardStep((step) => Math.min(5, step + 1))}
                      disabled={
                        (wizardStep === 0 && !canProceedCustomerStep)
                        || (wizardStep === 1 && !canProceedJobTypeStep)
                        || (wizardStep === 2 && !canProceedVehicleStep)
                        || (wizardStep === 3 && !canProceedServiceStep)
                      }
                      className="flex-1 bg-brand-primary text-black font-semibold py-2 rounded-xl disabled:opacity-50"
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      className="flex-1 bg-brand-primary text-black font-semibold py-2 rounded-xl disabled:opacity-50"
                      disabled={!jobNumber}
                    >
                      Confirm booking
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        )}

        <p className="text-center text-xs text-white/60">
          Powered by Workshop Pro, created by{' '}
          <a href="https://edgepoint.co.nz" className="underline text-white/80">
            Edgepoint
          </a>
        </p>
      </div>
    </div>
  );
};
