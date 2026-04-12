import { useState, useCallback } from 'react';
import { MapContainer } from '../components/map-d2d/map-container';
import type { LeadPinData } from '../components/map-d2d/lead-pin';
import { pinToJobDraft, pinToQuoteLead } from '../components/map-d2d/pin-crm-actions';
import { useJobModalController } from '../contexts/JobModalController';
import QuoteCreateModal from '../components/quotes/QuoteCreateModal';
import type { Lead } from '../types';

export default function D2DMap() {
  const { openJobModal } = useJobModalController();

  // Quote modal state
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [quoteLead, setQuoteLead] = useState<Lead | null>(null);
  const [pendingQuotePin, setPendingQuotePin] = useState<LeadPinData | null>(null);

  // ---------------------------------------------------------------------------
  // Pin → Job (green / closed_won)
  // ---------------------------------------------------------------------------
  const handlePinClosedWon = useCallback((pin: LeadPinData) => {
    // If already linked to a job, don't create another
    if (pin.job_id) return;

    openJobModal({
      initialValues: pinToJobDraft(pin),
      sourceContext: { type: 'door-to-door' },
      onCreated: (job) => {
        // Link the pin to the created job
        // Update pin in localStorage cache
        try {
          const raw = localStorage.getItem('d2d-map-pins');
          if (raw) {
            const pins: LeadPinData[] = JSON.parse(raw);
            const updated = pins.map((p) =>
              p.id === pin.id ? { ...p, job_id: job.id } : p
            );
            localStorage.setItem('d2d-map-pins', JSON.stringify(updated));
          }
        } catch {}
      },
      onCancel: () => {
        // Pin stays green but without a linked job — user can re-trigger via edit
      },
    });
  }, [openJobModal]);

  // ---------------------------------------------------------------------------
  // Pin → Quote (purple / appointment)
  // ---------------------------------------------------------------------------
  const handlePinAppointment = useCallback((pin: LeadPinData) => {
    // If already linked to a quote, don't create another
    if (pin.quote_id) return;

    setPendingQuotePin(pin);
    setQuoteLead(pinToQuoteLead(pin));
    setShowQuoteModal(true);
  }, []);

  const handleQuoteCreated = useCallback((detail: any) => {
    // Link pin to created quote in localStorage
    if (pendingQuotePin && detail?.id) {
      try {
        const raw = localStorage.getItem('d2d-map-pins');
        if (raw) {
          const pins: LeadPinData[] = JSON.parse(raw);
          const updated = pins.map((p) =>
            p.id === pendingQuotePin.id ? { ...p, quote_id: detail.id } : p
          );
          localStorage.setItem('d2d-map-pins', JSON.stringify(updated));
        }
      } catch {}
    }
    setShowQuoteModal(false);
    setPendingQuotePin(null);
    setQuoteLead(null);
  }, [pendingQuotePin]);

  const handleQuoteClose = useCallback(() => {
    // Pin stays purple but without a linked quote — user can re-trigger via edit
    setShowQuoteModal(false);
    setPendingQuotePin(null);
    setQuoteLead(null);
  }, []);

  return (
    <div className="h-[calc(100vh-3rem)] relative">
      <MapContainer
        onPinClosedWon={handlePinClosedWon}
        onPinAppointment={handlePinAppointment}
      />

      {/* Quote modal — rendered above the map */}
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
