import { useState, useCallback, useEffect } from 'react';
import { MapContainer } from '../components/map-d2d/map-container';
import type { LeadPinData, PinStatus } from '../components/map-d2d/lead-pin';
import { pinToJobDraft, pinToQuoteLead } from '../components/map-d2d/pin-crm-actions';
import { useJobModalController } from '../contexts/JobModalController';
import QuoteCreateModal from '../components/quotes/QuoteCreateModal';
import type { Lead } from '../types';
import {
  getPins,
  createHouse,
  deleteHouse,
  updateHouse,
  linkHouseToEntity,
  type FieldPinLight,
} from '../lib/fieldSalesApi';
import { getActiveLiveLocations, type LiveLocation } from '../lib/trackingApi';
import { softDeleteClient } from '../lib/clientsApi';
import { toast } from 'sonner';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useTranslation } from '../i18n';

// Map FieldSales API status → LeadPinData status
const STATUS_MAP: Record<string, PinStatus> = {
  sale: 'closed_won', sold: 'closed_won', closed_won: 'closed_won',
  lead: 'lead',
  follow_up: 'follow_up', callback: 'follow_up',
  no_answer: 'no_answer',
  not_interested: 'rejected', do_not_knock: 'rejected', rejected: 'rejected',
  quote_sent: 'appointment', appointment: 'appointment',
  unknown: 'other', new: 'other', knocked: 'other', note: 'other', revisit: 'other', other: 'other',
};

// NOTE: DB 'lead' is now reserved for the Lead pin (client prospects); manual
// "À repasser" pins are stored as 'callback' (migration 20260746000000).
const REVERSE_STATUS_MAP: Record<PinStatus, string> = {
  closed_won: 'sale',
  lead: 'lead',
  follow_up: 'callback',
  appointment: 'quote_sent',
  no_answer: 'no_answer',
  rejected: 'not_interested',
  other: 'unknown',
};

function apiPinToLeadPin(pin: FieldPinLight): LeadPinData {
  return {
    id: pin.id,
    lat: pin.lat,
    lng: pin.lng,
    status: STATUS_MAP[pin.status] || 'other',
    name: pin.customer_name || pin.address || 'Pin',
    phone: '',
    email: '',
    address: pin.address || `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`,
    note: pin.note_preview || '',
    client_id: pin.client_id ?? null,
    lead_id: pin.lead_id ?? null,
    job_id: pin.job_id ?? null,
    quote_id: pin.quote_id ?? null,
    assigned_user_id: pin.assigned_user_id ?? null,
    assigned_user_name: pin.assigned_user_name ?? null,
    assigned_user_avatar: pin.assigned_user_avatar ?? null,
    created_at: pin.created_at ?? null,
  };
}

export default function D2DMap() {
  const { openJobModal } = useJobModalController();
  const navigate = useNavigate();
  const { language } = useTranslation();
  const fr = language === 'fr';

  // Deep-link focus (?lat=..&lng=..) — e.g. the client mini map in the job
  // form links here to open the map directly on that client's pin.
  const [searchParams] = useSearchParams();
  const focusLat = Number.parseFloat(searchParams.get('lat') ?? '');
  const focusLng = Number.parseFloat(searchParams.get('lng') ?? '');
  const focusCenter: [number, number] | null =
    Number.isFinite(focusLat) && Number.isFinite(focusLng) ? [focusLng, focusLat] : null;

  // Pins loaded from API
  const [initialPins, setInitialPins] = useState<LeadPinData[]>([]);
  const [pinHouseMap, setPinHouseMap] = useState<Map<string, string>>(new Map()); // pin.id → house_id
  const [loading, setLoading] = useState(true);

  // Live reps on map
  const [liveReps, setLiveReps] = useState<LiveLocation[]>([]);

  // Load live reps + poll every 15 seconds.
  // Own position is excluded: the user already has their blue GPS dot — their
  // own rep marker would just sit next to it permanently.
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const myId = sess.session?.user?.id;
        const data = await getActiveLiveLocations();
        if (mounted) setLiveReps(data.filter((r) => r.user_id !== myId));
      } catch {}
    };
    load();
    const interval = setInterval(load, 15_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // Quote modal state
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [quoteLead, setQuoteLead] = useState<Lead | null>(null);
  const [pendingQuotePin, setPendingQuotePin] = useState<LeadPinData | null>(null);

  // Lead pin placed → "agreement / quote / skip" choice modal
  const [leadChoicePin, setLeadChoicePin] = useState<LeadPinData | null>(null);

  // Local link updates pushed into MapContainer (so popup shows "Job liée" right away)
  const [pinLinkUpdates, setPinLinkUpdates] = useState<Record<string, { job_id?: string; quote_id?: string; client_id?: string; lead_id?: string }>>({});

  // Load pins from API on mount
  useEffect(() => {
    async function load() {
      try {
        const pins = await getPins();
        const map = new Map<string, string>();
        const leadPins = pins.map((p) => {
          const lp = apiPinToLeadPin(p);
          map.set(lp.id, p.house_id);
          return lp;
        });
        setPinHouseMap(map);
        setInitialPins(leadPins);
      } catch (err: any) {
        console.error('[D2DMap] Failed to load pins:', err?.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ---------------------------------------------------------------------------
  // Pin CRUD callbacks (called by MapContainer)
  // ---------------------------------------------------------------------------

  const handlePinCreated = useCallback(async (pin: LeadPinData) => {
    try {
      const result = await createHouse({
        address: pin.address,
        lat: pin.lat,
        lng: pin.lng,
        status: REVERSE_STATUS_MAP[pin.status] || 'unknown',
        note_text: pin.note || undefined,
        customer_name: pin.name || undefined,
        customer_phone: pin.phone || undefined,
        customer_email: pin.email || undefined,
      });
      // Map the pin ID to the house ID for future operations
      setPinHouseMap(prev => { const next = new Map(prev); next.set(pin.id, result.id); return next; });
      toast.success('Pin sauvegardé');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur de sauvegarde du pin');
    }
  }, []);

  const handlePinDeleted = useCallback(async (pinId: string, opts?: { deleteClientId?: string | null }) => {
    const houseId = pinHouseMap.get(pinId);
    if (houseId) {
      try {
        await deleteHouse(houseId);
      } catch (err: any) {
        console.error('[D2DMap] Failed to delete pin:', err?.message);
      }
    }
    // User confirmed "also delete the linked client" in the delete dialog
    if (opts?.deleteClientId) {
      try {
        await softDeleteClient(opts.deleteClientId);
        toast.success('Client supprimé');
      } catch (err: any) {
        toast.error(err?.message || 'Erreur lors de la suppression du client');
      }
    }
  }, [pinHouseMap]);

  const handlePinUpdated = useCallback(async (pin: LeadPinData) => {
    const houseId = pinHouseMap.get(pin.id);
    if (!houseId) {
      // Pin was never saved — create it now
      handlePinCreated(pin);
      return;
    }
    try {
      await updateHouse(houseId, {
        current_status: (REVERSE_STATUS_MAP[pin.status] || 'unknown') as any,
        metadata: { customer_name: pin.name, customer_phone: pin.phone, customer_email: pin.email },
      });
    } catch (err: any) {
      console.error('[D2DMap] Failed to update pin:', err?.message);
    }
  }, [pinHouseMap, handlePinCreated]);

  // ---------------------------------------------------------------------------
  // Pin → Job creation form. Shared by the Vendu pin and the Lead pin's
  // "Create an agreement" choice (withAgreement pre-checks the contract box).
  // ---------------------------------------------------------------------------
  const openJobForPin = useCallback((pin: LeadPinData, opts?: { withAgreement?: boolean }) => {
    openJobModal({
      initialValues: { ...pinToJobDraft(pin), ...(opts?.withAgreement ? { create_agreement: true } : {}) },
      sourceContext: { type: 'door-to-door' },
      onCreated: (job) => {
        // Link the pin/house to the created job
        const houseId = pinHouseMap.get(pin.id);
        if (houseId && job?.id) {
          linkHouseToEntity(houseId, { entity_type: 'job', entity_id: job.id }).catch(() => {});
          setPinLinkUpdates((prev) => ({ ...prev, [pin.id]: { ...prev[pin.id], job_id: job.id } }));
        }
        toast.success('Job créée à partir du pin');
      },
    });
  }, [openJobModal, pinHouseMap]);

  // Pin Vendu → Job creation form
  const handlePinClosedWon = useCallback((pin: LeadPinData) => {
    if (pin.job_id) return;
    openJobForPin(pin);
  }, [openJobForPin]);

  // Pin Lead placé → choix "Créer un contrat / Créer un devis / Passer"
  const handlePinLead = useCallback((pin: LeadPinData) => {
    if (pin.job_id) return;
    setLeadChoicePin(pin);
  }, []);

  // Choix "Create a quote" (depuis le pin Lead)
  const openQuoteForPin = useCallback((pin: LeadPinData) => {
    setPendingQuotePin(pin);
    setQuoteLead(pinToQuoteLead(pin));
    setShowQuoteModal(true);
  }, []);

  // Open the existing client from a pin. The id may be on the pin directly,
  // or only on its linked job (client_id ?? lead_id) — resolve both.
  const handleOpenClient = useCallback(async (pin: LeadPinData) => {
    let clientId: string | null = pin.client_id || pin.lead_id || null;
    const jobId = pin.job_id || pin.lume_job_id || null;
    if (!clientId && jobId) {
      const { data } = await supabase
        .from('jobs')
        .select('client_id, lead_id')
        .eq('id', jobId)
        .maybeSingle();
      clientId = (data?.client_id as string) || (data?.lead_id as string) || null;
    }
    if (clientId) navigate(`/clients/${clientId}`);
    else toast.error('Aucune fiche client liée.');
  }, [navigate]);

  const handleQuoteCreated = useCallback((detail: any) => {
    // Link the pin/house to the created quote
    if (pendingQuotePin && detail?.id) {
      const houseId = pinHouseMap.get(pendingQuotePin.id);
      if (houseId) {
        linkHouseToEntity(houseId, { entity_type: 'quote', entity_id: detail.id }).catch(() => {});
      }
      const pinId = pendingQuotePin.id;
      setPinLinkUpdates((prev) => ({ ...prev, [pinId]: { ...prev[pinId], quote_id: detail.id } }));
      toast.success('Devis créé à partir du pin');
    }
    setShowQuoteModal(false);
    setPendingQuotePin(null);
    setQuoteLead(null);
  }, [pendingQuotePin, pinHouseMap]);

  const handleQuoteClose = useCallback(() => {
    setShowQuoteModal(false);
    setPendingQuotePin(null);
    setQuoteLead(null);
  }, []);

  if (loading) {
    return (
      <div className="h-[calc(100vh-3rem)] flex items-center justify-center bg-[#080b10]">
        <div className="text-white/40 text-sm">Chargement de la carte...</div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-3rem)] relative">
      <MapContainer
        focusCenter={focusCenter}
        onPinClosedWon={handlePinClosedWon}
        onPinLead={handlePinLead}
        onOpenClient={handleOpenClient}
        initialPins={initialPins}
        onPinCreated={handlePinCreated}
        onPinDeleted={handlePinDeleted}
        onPinUpdated={handlePinUpdated}
        pinLinkUpdates={pinLinkUpdates}
        liveReps={liveReps.map(r => ({
          user_id: r.user_id,
          user_name: r.user_name ?? '',
          latitude: r.latitude,
          longitude: r.longitude,
          tracking_status: r.tracking_status ?? '',
          speed_mps: r.speed_mps ?? 0,
          team_name: r.team_name ?? '',
          team_color: r.team_color ?? '',
        }))}
      />

      <QuoteCreateModal
        isOpen={showQuoteModal}
        onClose={handleQuoteClose}
        onCreated={handleQuoteCreated}
        lead={quoteLead}
        createLeadInline={true}
      />

      {/* Lead pin → "agreement / quote / skip" choice */}
      {leadChoicePin && (
        <div
          className="absolute inset-0 z-[70] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
          onClick={() => setLeadChoicePin(null)}
        >
          <div
            className="w-[360px] max-w-[92vw] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-[16px] font-bold text-slate-900">
                {fr ? 'Nouveau lead' : 'New lead'}
              </h3>
              <p className="mt-0.5 truncate text-[12px] text-slate-400">{leadChoicePin.address}</p>
            </div>
            <div className="flex flex-col gap-2.5 px-5 py-4">
              <button
                onClick={() => { const pin = leadChoicePin; setLeadChoicePin(null); openJobForPin(pin, { withAgreement: true }); }}
                className="w-full rounded-xl bg-gradient-to-br from-purple-400 to-purple-600 py-3 text-[14px] font-bold text-white shadow-sm transition-all hover:brightness-110 active:scale-[.99]"
              >
                {fr ? 'Créer un contrat' : 'Create an agreement'}
              </button>
              <button
                onClick={() => { const pin = leadChoicePin; setLeadChoicePin(null); openQuoteForPin(pin); }}
                className="w-full rounded-xl bg-gradient-to-br from-purple-300 to-purple-500 py-3 text-[14px] font-bold text-white shadow-sm transition-all hover:brightness-110 active:scale-[.99]"
              >
                {fr ? 'Créer un devis' : 'Create a quote'}
              </button>
              <button
                onClick={() => setLeadChoicePin(null)}
                className="w-full py-2.5 text-[13.5px] font-semibold text-slate-500 transition-colors hover:text-slate-700"
              >
                {fr ? 'Passer pour le moment' : 'Skip for now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
