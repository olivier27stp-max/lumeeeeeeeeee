import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Widget Calendly « inline » (calendrier intégré dans la page, pas en popup).
 *
 * Charge le script officiel une seule fois pour toute la page, puis laisse
 * Calendly injecter son iframe dans notre conteneur. Le CSP de prod autorise
 * assets.calendly.com (script/style) et calendly.com (iframe) — voir
 * server/index.ts. Sans ces deux entrées, l'iframe reste blanc.
 *
 * Les infos déjà saisies dans le formulaire sont pré-remplies dans Calendly
 * (prefill) pour que le prospect n'ait pas à les retaper.
 */

const CALENDLY_SCRIPT = 'https://assets.calendly.com/assets/external/widget.js';
const BRAND = '3FAF97'; // vert de marque de la landing, sans le #

let scriptPromise: Promise<void> | null = null;

function loadCalendlyScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).Calendly) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CALENDLY_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('calendly script failed')));
      if ((window as any).Calendly) resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = CALENDLY_SCRIPT;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('calendly script failed'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface CalendlyPrefill {
  name?: string;
  email?: string;
  /** Champs personnalisés côté Calendly (« a1 », « a2 »… ou noms exacts). */
  customAnswers?: Record<string, string>;
}

interface Props {
  /** URL de base, ex. https://calendly.com/willhebert30/30min */
  url: string;
  prefill?: CalendlyPrefill;
  /** Hauteur du calendrier. Calendly recommande >= 630px pour éviter un scroll interne. */
  height?: number;
  /** Rendu de repli si le script ne charge pas (réseau, bloqueur). */
  fallbackHref?: string;
}

function buildUrl(url: string, prefill?: CalendlyPrefill): string {
  const u = new URL(url);
  // Chrome Calendly plus discret + couleur de marque.
  u.searchParams.set('hide_gdpr_banner', '1');
  u.searchParams.set('primary_color', BRAND);
  if (prefill?.name) u.searchParams.set('name', prefill.name);
  if (prefill?.email) u.searchParams.set('email', prefill.email);
  if (prefill?.customAnswers) {
    for (const [k, v] of Object.entries(prefill.customAnswers)) {
      if (v) u.searchParams.set(`a${k.replace(/^a/, '')}`.startsWith('a') ? k : `a${k}`, v);
    }
  }
  return u.toString();
}

export default function CalendlyInline({ url, prefill, height = 660, fallbackHref }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    loadCalendlyScript()
      .then(() => {
        if (cancelled || !ref.current) return;
        const Calendly = (window as any).Calendly;
        if (!Calendly?.initInlineWidget) { setState('error'); return; }
        ref.current.innerHTML = '';
        Calendly.initInlineWidget({ url: buildUrl(url, prefill), parentElement: ref.current });
        setState('ready');
      })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
    // Un seul montage : on ne réinitialise pas le widget si prefill change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'error') {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-text-secondary">
          Le calendrier n'a pas pu se charger.
        </p>
        <a
          href={fallbackHref || url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center justify-center gap-2 bg-[#3FAF97] text-white px-5 py-2.5 rounded-xl text-sm font-bold hover:bg-[#1F5F4F] transition-colors"
        >
          Ouvrir le calendrier
        </a>
      </div>
    );
  }

  return (
    <div className="relative">
      {state === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="animate-spin text-[#3FAF97]" size={28} />
        </div>
      )}
      {/* Calendly injecte son iframe ici. min-width 320 exigé par le widget. */}
      <div ref={ref} style={{ minWidth: 320, height }} />
    </div>
  );
}
