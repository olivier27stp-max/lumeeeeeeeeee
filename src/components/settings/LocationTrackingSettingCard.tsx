import { useEffect, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { getCurrentOrgIdOrThrow } from '../../lib/orgApi';
import { getLocationTrackingEnabled, setLocationTrackingEnabled } from '../../lib/locationConsentApi';

const COPY = {
  fr: {
    title: 'Localisation des employés',
    desc: 'Suivre en temps réel la position des utilisateurs connectés (carte de dispatch et de vente). Chaque utilisateur doit aussi donner son consentement à sa première connexion.',
    label: 'Activer le suivi de localisation',
    saved: 'Réglage enregistré',
    error: 'Échec de l’enregistrement',
  },
  en: {
    title: 'Employee location',
    desc: 'Track signed-in users’ position in real time (dispatch & sales maps). Each user must also consent on their first login.',
    label: 'Enable location tracking',
    saved: 'Setting saved',
    error: 'Failed to save',
  },
} as const;

export default function LocationTrackingSettingCard({ language }: { language: 'en' | 'fr' }) {
  const t = COPY[language];
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const oid = await getCurrentOrgIdOrThrow();
        const e = await getLocationTrackingEnabled(oid);
        if (cancelled) return;
        setUserId(user?.id ?? null);
        setOrgId(oid);
        setEnabled(e);
      } catch {
        // leave defaults
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = async () => {
    if (saving || loading || !orgId) return;
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    try {
      await setLocationTrackingEnabled(orgId, next, userId ?? undefined);
      toast.success(t.saved);
    } catch {
      setEnabled(!next); // revert
      toast.error(t.error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="section-card p-5 space-y-4">
      <h3 className="text-xs font-medium uppercase tracking-wider text-text-tertiary flex items-center gap-2">
        <MapPin size={13} /> {t.title}
      </h3>
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-text-secondary max-w-xl">{t.desc}</p>
        <button
          type="button"
          onClick={toggle}
          disabled={loading || saving}
          aria-pressed={enabled}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
            enabled ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
          {(loading || saving) && (
            <Loader2 size={12} className="absolute -right-5 animate-spin text-text-tertiary" />
          )}
        </button>
      </div>
    </div>
  );
}
