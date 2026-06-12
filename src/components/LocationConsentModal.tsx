import { useState } from 'react';
import { MapPin } from 'lucide-react';
import Modal from './ui/Modal';

interface Props {
  open: boolean;
  language: 'en' | 'fr';
  onAccept: () => Promise<void>;
  onDecline: () => Promise<void>;
}

const COPY = {
  fr: {
    title: 'Partage de votre localisation',
    intro:
      'Pour le suivi des équipes sur le terrain, cette application peut enregistrer votre position GPS pendant que vous êtes connecté(e).',
    points: [
      'Votre position est mise à jour en temps réel et visible par les gestionnaires de votre organisation sur la carte.',
      'Le suivi s’arrête dès que vous vous déconnectez.',
      'Vous pouvez refuser maintenant et continuer à utiliser l’application normalement.',
      'Vous pourrez changer d’avis plus tard dans vos réglages.',
    ],
    accept: 'J’accepte d’être localisé(e)',
    decline: 'Refuser',
    saving: 'Enregistrement…',
  },
  en: {
    title: 'Share your location',
    intro:
      'For field-team tracking, this app can record your GPS position while you are signed in.',
    points: [
      'Your position updates in real time and is visible to your organization’s managers on the map.',
      'Tracking stops as soon as you sign out.',
      'You can decline now and keep using the app normally.',
      'You can change your mind later in your settings.',
    ],
    accept: 'I agree to be located',
    decline: 'Decline',
    saving: 'Saving…',
  },
} as const;

export default function LocationConsentModal({ open, language, onAccept, onDecline }: Props) {
  const t = COPY[language];
  const [busy, setBusy] = useState(false);

  const choose = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={() => void choose(onDecline)} size="md" title={t.title}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center">
            <MapPin size={24} className="text-indigo-500" />
          </div>
        </div>
        <p className="text-sm text-text-secondary">{t.intro}</p>
        <ul className="flex flex-col gap-2 text-sm text-text-secondary">
          {t.points.map((p, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-indigo-500 mt-0.5">•</span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={() => void choose(onDecline)}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
          >
            {t.decline}
          </button>
          <button
            onClick={() => void choose(onAccept)}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 transition-colors disabled:opacity-50"
          >
            {busy ? t.saving : t.accept}
          </button>
        </div>
      </div>
    </Modal>
  );
}
