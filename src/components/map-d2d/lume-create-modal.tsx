import { useState } from 'react';
import type { LeadPinData } from './lead-pin';

// Inlined from @/types/lume
interface LumeCreatePayload {
  rep_id: string;
  source_pin_id: string;
  source_status: 'closed_won';
  customer: {
    full_name: string;
    phone: string;
    email: string;
    street_address: string;
    city: string;
    province: string;
    postal_code: string;
  };
  job: {
    service_type: string;
    requested_date: string;
    estimated_value: number | null;
    internal_notes: string;
  };
}

export interface LumeCreateResponse {
  success: true;
  customer_id: string;
  job_id: string;
  customer_created: boolean;
  reused_existing_customer: boolean;
  customer_summary: {
    name: string;
    phone: string;
    address: string;
  };
  job_summary: {
    service_type: string;
    scheduled_date: string;
    status: string;
  };
  lume_url: string;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LumeCreateModalProps {
  pin: LeadPinData;
  onSuccess: (response: LumeCreateResponse) => void;
  onSkip: () => void;
  onClose: () => void;
}

const SERVICE_TYPES = [
  'Nettoyage résidentiel',
  'Nettoyage commercial',
  'Entretien extérieur',
  'Lavage de vitres',
  'Autre',
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LumeCreateModal({ pin, onSuccess, onSkip, onClose }: LumeCreateModalProps) {
  const [form, setForm] = useState({
    full_name: pin.name !== 'Nouveau lead' ? pin.name : '',
    phone: '',
    email: '',
    street_address: pin.address || '',
    city: '',
    province: 'QC',
    postal_code: '',
    service_type: SERVICE_TYPES[0],
    requested_date: new Date().toISOString().split('T')[0],
    estimated_value: '',
    internal_notes: pin.note || '',
  });

  const [step, setStep] = useState<'form' | 'submitting' | 'success' | 'error'>('form');
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState<LumeCreateResponse | null>(null);

  function updateField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.full_name.trim() || !form.phone.trim() || !form.street_address.trim()) return;

    setStep('submitting');
    setErrorMessage('');

    // Build the payload in the exact format Lume expects
    const payload: LumeCreatePayload = {
      rep_id: 'current-rep', // TODO: replace with actual auth rep ID
      source_pin_id: pin.id,
      source_status: 'closed_won',
      customer: {
        full_name: form.full_name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        street_address: form.street_address.trim(),
        city: form.city.trim(),
        province: form.province.trim(),
        postal_code: form.postal_code.trim(),
      },
      job: {
        service_type: form.service_type,
        requested_date: form.requested_date,
        estimated_value: form.estimated_value ? parseFloat(form.estimated_value) : null,
        internal_notes: form.internal_notes.trim(),
      },
    };

    try {
      const res = await fetch('/api/lume/create-customer-and-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Une erreur est survenue');
      }

      const data: LumeCreateResponse = await res.json();
      setResult(data);
      setStep('success');
      onSuccess(data);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Une erreur est survenue');
      setStep('error');
    }
  }

  const inputClass =
    'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[13px] text-white placeholder-white/20 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20';
  const labelClass = 'mb-1 block text-[11px] font-medium uppercase tracking-wider text-white/30';

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-[420px] rounded-2xl border border-white/10 bg-[#0c0c14] shadow-2xl">

        {/* FORM */}
        {step === 'form' && (
          <>
            <div className="border-b border-white/8 px-6 py-4">
              <h3 className="text-[15px] font-bold text-white">Créer le client</h3>
              <p className="mt-0.5 text-[12px] text-white/40">
                Les informations seront enregistrées dans le système.
              </p>
            </div>

            <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-3">
              <div>
                <label className={labelClass}>Nom complet *</label>
                <input type="text" value={form.full_name} onChange={(e) => updateField('full_name', e.target.value)} placeholder="Jean Tremblay" className={inputClass} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Téléphone *</label>
                  <input type="tel" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} placeholder="819-555-0123" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Courriel</label>
                  <input type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} placeholder="jean@email.com" className={inputClass} />
                </div>
              </div>

              <div>
                <label className={labelClass}>Adresse *</label>
                <input type="text" value={form.street_address} onChange={(e) => updateField('street_address', e.target.value)} placeholder="1234 Rue Notre-Dame" className={inputClass} />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>Ville</label>
                  <input type="text" value={form.city} onChange={(e) => updateField('city', e.target.value)} placeholder="Trois-Rivières" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Province</label>
                  <input type="text" value={form.province} onChange={(e) => updateField('province', e.target.value)} placeholder="QC" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Code postal</label>
                  <input type="text" value={form.postal_code} onChange={(e) => updateField('postal_code', e.target.value)} placeholder="G8T 1A1" className={inputClass} />
                </div>
              </div>

              <div className="h-px bg-white/6" />

              <div>
                <label className={labelClass}>Type de service</label>
                <select value={form.service_type} onChange={(e) => updateField('service_type', e.target.value)} className={inputClass}>
                  {SERVICE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Date souhaitée</label>
                  <input type="date" value={form.requested_date} onChange={(e) => updateField('requested_date', e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Valeur estimée</label>
                  <input type="number" value={form.estimated_value} onChange={(e) => updateField('estimated_value', e.target.value)} placeholder="0.00 $" className={inputClass} />
                </div>
              </div>

              <div>
                <label className={labelClass}>Notes internes</label>
                <textarea
                  value={form.internal_notes}
                  onChange={(e) => updateField('internal_notes', e.target.value)}
                  placeholder="Notes pour l'équipe..."
                  rows={2}
                  className={inputClass + ' resize-none'}
                />
              </div>
            </div>

            <div className="flex gap-2 border-t border-white/8 px-6 py-4">
              <button
                onClick={handleSubmit}
                disabled={!form.full_name.trim() || !form.phone.trim() || !form.street_address.trim()}
                className="flex-1 rounded-lg bg-emerald-500 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Créer le client
              </button>
              <button onClick={onSkip} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-[12px] text-white/50 transition-colors hover:text-white/80">
                Plus tard
              </button>
            </div>
          </>
        )}

        {/* SUBMITTING */}
        {step === 'submitting' && (
          <div className="flex flex-col items-center justify-center px-6 py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
            <p className="mt-4 text-[13px] font-medium text-white/60">Création en cours...</p>
          </div>
        )}

        {/* SUCCESS */}
        {step === 'success' && result && (
          <div className="px-6 py-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h3 className="mt-4 text-[15px] font-bold text-white">Client créé</h3>
            <p className="mt-1 text-[12px] text-white/40">
              {result.customer_summary.name} a été enregistré avec succès.
            </p>
            {result.reused_existing_customer && (
              <p className="mt-1 text-[11px] text-amber-400/70">
                Client existant réutilisé.
              </p>
            )}

            <div className="mt-5 flex flex-col gap-2">
              {result.lume_url && (
                <a
                  href={result.lume_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-[12px] font-medium text-indigo-400 transition-colors hover:bg-white/10"
                >
                  Voir les détails
                </a>
              )}
              <button onClick={onClose} className="rounded-lg bg-emerald-500 px-4 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-400">
                Fermer
              </button>
            </div>
          </div>
        )}

        {/* ERROR */}
        {step === 'error' && (
          <div className="px-6 py-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" />
              </svg>
            </div>
            <h3 className="mt-4 text-[15px] font-bold text-white">La création a échoué</h3>
            <p className="mt-1 text-[12px] text-white/40">
              {errorMessage || 'Une erreur est survenue. Vous pouvez réessayer.'}
            </p>

            <div className="mt-5 flex gap-2 justify-center">
              <button onClick={handleSubmit} className="rounded-lg bg-indigo-500 px-5 py-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-indigo-400">
                Réessayer
              </button>
              <button onClick={onSkip} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-[12px] text-white/50 transition-colors hover:text-white/80">
                Plus tard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
