import { useEffect, useState } from 'react';
import { Navigation, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { getMyLocationConsent, setMyLocationConsent } from '../../lib/locationConsentApi';

const COPY = {
  fr: {
    title: 'Partager ma position',
    desc: 'Afficher votre position en temps réel sur les cartes de dispatch et de vente pendant que vous êtes connecté. Vous pouvez changer d’avis à tout moment.',
    saved: 'Réglage enregistré',
    error: 'Échec de l’enregistrement',
  },
  en: {
    title: 'Share my location',
    desc: 'Show your live position on the dispatch & sales maps while you are signed in. You can change your mind at any time.',
    saved: 'Setting saved',
    error: 'Failed to save',
  },
} as const;

/**
 * Personal counterpart to the org-wide LocationTrackingSettingCard: lets the
 * signed-in user change their own `profiles.location_consent` after the
 * first-login modal (which never re-shows once answered). Saving dispatches
 * the consent event so live tracking starts/stops without a reload.
 */
export default function MyLocationConsentCard({ language }: { language: 'en' | 'fr' }) {
  const t = COPY[language];
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const consent = await getMyLocationConsent(user.id);
        if (cancelled) return;
        setUserId(user.id);
        setEnabled(consent === true);
      } catch {
        // leave defaults
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggle = async () => {
    if (saving || loading || !userId) return;
    const next = !enabled;
    setEnabled(next);
    setSaving(true);
    try {
      await setMyLocationConsent(userId, next);
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
        <Navigation size={13} /> {t.title}
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
