
const STORAGE_KEY = 'lume-active-org';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Bureau actif : UNE seule source de vérité, le CompanyContext (sélecteur de bureau). Il la
// publie ici pour le code hors React (clients d'API, wrapper fetch, hooks) ; localStorage n'est
// qu'un repli de lecture au démarrage. Plus jamais de repli vers `current_org_id()` (= premier
// bureau du compte) : c'est ainsi qu'un utilisateur de deux bureaux voyait, dans Vision Lavage,
// les factures et les demandes de Coquin lavage (2026-09-24). Sans bureau connu → null, et la
// page reste vide plutôt que d'afficher un autre bureau.
let bureauActifMemoire: string | null = null;
const abonnes = new Set<(orgId: string | null) => void>();

/** Appelé par CompanyContext à chaque changement du bureau actif (chargement et bascule). */
export function publierBureauActif(orgId: string | null): void {
  const suivant = orgId && UUID.test(orgId) ? orgId : null;
  if (suivant === bureauActifMemoire) return;
  bureauActifMemoire = suivant;
  for (const cb of abonnes) cb(suivant);
}

/** S'abonner aux changements de bureau (hors React) ; retourne la fonction de désabonnement. */
export function abonnerBureauActif(cb: (orgId: string | null) => void): () => void {
  abonnes.add(cb);
  return () => { abonnes.delete(cb); };
}

/** Bureau actif, synchrone : mémoire (contexte) puis localStorage. */
export function bureauActifSync(): string | null {
  if (bureauActifMemoire) return bureauActifMemoire;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved && UUID.test(saved) ? saved : null;
  } catch {
    return null; // stockage indisponible (navigation privée) : rien à journaliser, on reste vide
  }
}

/** Get the current org_id — celui du sélecteur de bureau, ou null. */
export async function getCurrentOrgId(): Promise<string | null> {
  return bureauActifSync();
}

export async function getCurrentOrgIdOrThrow(): Promise<string> {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error('Aucun bureau sélectionné — choisissez un bureau dans le sélecteur.');
  return orgId;
}
