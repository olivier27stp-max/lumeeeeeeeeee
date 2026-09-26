// Bureau sélectionné → en-tête `x-org-id` sur TOUS les appels à l'API Express.
//
// Le serveur (requireAuthedClient) prend le bureau demandé par cet en-tête ; sans lui, il retombe
// sur le premier bureau du compte. Or 40 clients d'API sur 59 ne l'envoyaient pas : un utilisateur
// membre de deux bureaux voyait, dans Vision Lavage, les demandes de Coquin lavage (2026-09-24).
// Plutôt que de corriger 40 fichiers un à un, l'en-tête est injecté ici, une seule fois, sur les
// requêtes same-origin vers /api. Le serveur vérifie toujours l'appartenance au bureau demandé.
import { supabase as _supabase } from './supabase'; // s'assure que l'app est initialisée avant nous
import { bureauActifSync, abonnerBureauActif } from './orgApi';

const bureauActif = (): string | null => bureauActifSync();

/**
 * Attendre que le bureau soit connu, au plus `MS_ATTENTE_BUREAU`.
 *
 * LE PROBLÈME. Au chargement DIRECT d'une route (lien collé, F5), le
 * bureau n'est pas encore publié : `CompanyContext` le fait dans un
 * `useEffect`, donc après le premier rendu. Les requêtes parties avant
 * n'ont pas d'en-tête — et le serveur, pour un compte à PLUSIEURS
 * bureaux, répond 400 `org_required` (il refuse de deviner, et il a
 * raison). L'écran affichait alors « introuvable » ou du vide, ou les
 * données de l'autre bureau selon la route.
 *
 * Constaté au QA du 2026-09-25 (P0-1) : « /automations/apercu → le
 * bureau affiché devient QA Santé B », « F5 → Cette automatisation est
 * introuvable ».
 *
 * On attend donc le bureau au lieu de partir sans lui. Le plafond évite
 * qu'un compte sans bureau (invitation en attente) bloque ses appels
 * pour toujours : passé ce délai, on part sans en-tête et le serveur
 * tranche — c'est lui qui détient la vérité.
 */
const MS_ATTENTE_BUREAU = 5000;

function attendreBureau(): Promise<string | null> {
  const connu = bureauActif();
  if (connu) return Promise.resolve(connu);

  return new Promise((resolve) => {
    let fini = false;
    const terminer = (v: string | null) => {
      if (fini) return;
      fini = true;
      desabonner();
      clearTimeout(minuterie);
      resolve(v);
    };
    const minuterie = setTimeout(() => terminer(bureauActif()), MS_ATTENTE_BUREAU);
    const desabonner = abonnerBureauActif((orgId) => { if (orgId) terminer(orgId); });
  });
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
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!estAppelApi(url, window.location.origin)) return original(input, init);
    // Voir `attendreBureau` : partir sans en-tête fait répondre 400 au
    // serveur pour un compte à plusieurs bureaux.
    const bureau = await attendreBureau();
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
