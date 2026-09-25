// Bureau sélectionné → en-tête `x-org-id` sur TOUS les appels à l'API Express.
//
// Le serveur (requireAuthedClient) prend le bureau demandé par cet en-tête ; sans lui, il retombe
// sur le premier bureau du compte. Or 40 clients d'API sur 59 ne l'envoyaient pas : un utilisateur
// membre de deux bureaux voyait, dans Vision Lavage, les demandes de Coquin lavage (2026-09-24).
// Plutôt que de corriger 40 fichiers un à un, l'en-tête est injecté ici, une seule fois, sur les
// requêtes same-origin vers /api. Le serveur vérifie toujours l'appartenance au bureau demandé.
import { supabase as _supabase } from './supabase'; // s'assure que l'app est initialisée avant nous

const CLE = 'lume-active-org';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bureauActif(): string | null {
  try {
    const v = localStorage.getItem(CLE) ?? '';
    return UUID.test(v) ? v : null;
  } catch {
    return null; // lecture seule : un stockage indisponible (navigation privée) n'a rien à journaliser
  }
}

/** Vrai pour un appel à notre API (chemin relatif /api/… ou même origine). */
export function estAppelApi(url: string, origin: string): boolean {
  if (url.startsWith('/api/')) return true;
  return url.startsWith(`${origin}/api/`);
}

/** Pur : renvoie les en-têtes à utiliser (l'existant gagne toujours). */
export function enTetesAvecBureau(existants: HeadersInit | undefined, bureau: string | null): Headers {
  const h = new Headers(existants ?? {});
  if (bureau && !h.has('x-org-id')) h.set('x-org-id', bureau);
  return h;
}

export function installerEnTeteBureau(): void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!estAppelApi(url, window.location.origin)) return original(input, init);
    const bureau = bureauActif();
    if (!bureau) return original(input, init);
    if (input instanceof Request && !init) {
      const h = enTetesAvecBureau(input.headers, bureau);
      return original(new Request(input, { headers: h }));
    }
    const h = enTetesAvecBureau(init?.headers ?? (input instanceof Request ? input.headers : undefined), bureau);
    return original(input, { ...init, headers: h });
  };
}

void _supabase;
installerEnTeteBureau();
