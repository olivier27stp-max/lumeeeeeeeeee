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
import { toast } from 'sonner';

// Map FieldSales API status → LeadPinData status
const STATUS_MAP: Record<string, PinStatus> = {
  sale: 'closed_won', sold: 'closed_won', closed_won: 'closed_won',
  lead: 'follow_up', follow_up: 'follow_up', callback: 'follow_up',
  no_answer: 'no_answer',
  not_interested: 'rejected', do_not_knock: 'rejected', rejected: 'rejected',
  quote_sent: 'appointment', appointment: 'appointment',
  unknown: 'other', new: 'other', knocked: 'other', note: 'other', revisit: 'other', other: 'other',
};

const REVERSE_STATUS_MAP: Record<PinStatus, string> = {
  closed_won: 'sale',
  follow_up: 'lead',
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
    // Preserve house_id for API operations
    client_id: null,
    job_id: null,
    quote_id: null,
  };
}

export default function D2DMap() {
  const { openJobModal } = useJobModalController();

  // Pins loaded from API
  const [initialPins, setInitialPins] = useState<LeadPinData[]>([]);
  const [pinHouseMap, setPinHouseMap] = useState<Map<string, string>>(new Map()); // pin.id → house_id
  const [loading, setLoading] = useState(true);

  // Live reps on map
  const [liveReps, setLiveReps] = useState<LiveLocation[]>([]);

  // Load live reps + poll every 15 seconds
  useEffect(() => {
    let mounted = true;
    const load = () => {
      getActiveLiveLocations()
        .then((data) => { if (mounted) setLiveReps(data); })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 15_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // Quote modal state
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [quoteLead, setQuoteLead] = useState<Lead | null>(null);
  const [pendingQuotePin, setPendingQuotePin] = useState<LeadPinData | null>(null);

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

  const handlePinDeleted = useCallback(async (pinId: string) => {
    const houseId = pinHouseMap.get(pinId);
    if (!houseId) return; // Pin was never persisted (in-memory only)
    try {
      await deleteHouse(houseId);
    } catch (err: any) {
      console.error('[D2DMap] Failed to delete pin:', err?.message);
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
  // Pin → Job (closed_won)
  // ---------------------------------------------------------------------------
  const handlePinClosedWon = useCallback((pin: LeadPinData) => {
    if (pin.job_id) return;
    openJobModal({
      initialValues: pinToJobDraft(pin),
      sourceContext: { type: 'door-to-door' },
      onCreated: (job) => {
        // Link the pin/house to the created job
        const houseId = pinHouseMap.get(pin.id);
        if (houseId && job?.id) {
          linkHouseToEntity(houseId, { entity_type: 'job', entity_id: job.id }).catch(() => {});
        }
        toast.success('Job créée à partir du pin');
      },
    });
  }, [openJobModal, pinHouseMap]);

  // ---------------------------------------------------------------------------
  // Pin → Quote (appointment)
  // ---------------------------------------------------------------------------
  const handlePinAppointment = useCallback((pin: LeadPinData) => {
    if (pin.quote_id) return;
    setPendingQuotePin(pin);
    setQuoteLead(pinToQuoteLead(pin));
    setShowQuoteModal(true);
  }, []);

  const handleQuoteCreated = useCallback((detail: any) => {
    // Link the pin/house to the created quote
    if (pendingQuotePin && detail?.id) {
      const houseId = pinHouseMap.get(pendingQuotePin.id);
      if (houseId) {
        linkHouseToEntity(houseId, { entity_type: 'quote', entity_id: detail.id }).catch(() => {});
      }
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
        onPinClosedWon={handlePinClosedWon}
        onPinAppointment={handlePinAppointment}
        initialPins={initialPins}
        onPinCreated={handlePinCreated}
        onPinDeleted={handlePinDeleted}
        onPinUpdated={handlePinUpdated}
        liveReps={liveReps}
      />

      <QuoteCreateModal
        isOpen={showQuoteModal}
        onClose={handleQuoteClose}
        onCreated={handleQuoteCreated}
        lead={quoteLead}
        createLeadInline={true}
      />
    </div>
  );
}
