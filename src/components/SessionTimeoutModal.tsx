import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import Modal from './ui/Modal';
import { endTrackingAndSignOut } from '../hooks/useLiveLocationTracking';
import { SESSION_ACTIVITY_EVENT, SESSION_WARNING_EVENT } from '../hooks/useSessionTimeout';

interface Props {
  language: 'en' | 'fr';
}

const COPY = {
  fr: {
    title: 'Toujours là ?',
    intro:
      'Par sécurité, on ferme la session après une longue période sans activité. Tu seras déconnecté(e) dans {time}.',
    stay: 'Rester connecté(e)',
    signOut: 'Se déconnecter',
  },
  en: {
    title: 'Still there?',
    intro:
      'For security, we close the session after a long period of inactivity. You will be signed out in {time}.',
    stay: 'Stay signed in',
    signOut: 'Sign out',
  },
} as const;

function formatRemaining(ms: number, language: 'en' | 'fr') {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes > 0) {
    const m = language === 'fr' ? `${minutes} min` : `${minutes} min`;
    return seconds > 0 ? `${m} ${seconds} s` : m;
  }
  return `${seconds} s`;
}

/**
 * Warns the user shortly before {@link useSessionTimeout} signs them out.
 * Any real activity (mouse, key, scroll) already resets the hook's timer and
 * fires SESSION_ACTIVITY_EVENT, which closes this modal on its own.
 */
export default function SessionTimeoutModal({ language }: Props) {
  const t = COPY[language];
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    const onWarn = (e: Event) => {
      const ms = (e as CustomEvent<{ remainingMs: number }>).detail?.remainingMs ?? 0;
      setDeadline(Date.now() + ms);
      setRemaining(ms);
    };
    const onActivity = () => setDeadline(null);

    window.addEventListener(SESSION_WARNING_EVENT, onWarn);
    window.addEventListener(SESSION_ACTIVITY_EVENT, onActivity);
    return () => {
      window.removeEventListener(SESSION_WARNING_EVENT, onWarn);
      window.removeEventListener(SESSION_ACTIVITY_EVENT, onActivity);
    };
  }, []);

  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setRemaining(deadline - Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (deadline === null) return null;

  // Clicking "stay" is itself a mousedown, which resets the hook's timer and
  // fires SESSION_ACTIVITY_EVENT — closing the modal. Closing here too keeps
  // the modal honest if the click is ever synthesized (tests, a11y tooling).
  const stay = () => setDeadline(null);

  return (
    <Modal open onClose={stay} size="sm" title={t.title}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center">
            <Clock size={24} className="text-amber-500" />
          </div>
        </div>
        <p className="text-sm text-text-secondary text-center">
          {t.intro.replace('{time}', formatRemaining(remaining, language))}
        </p>
        <div className="flex gap-2 justify-end pt-2">
          <button
            onClick={() => void endTrackingAndSignOut()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors"
          >
            {t.signOut}
          </button>
          <button
            onClick={stay}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
          >
            {t.stay}
          </button>
        </div>
      </div>
    </Modal>
  );
}
