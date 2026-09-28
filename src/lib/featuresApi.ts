/**
 * Lecture des drapeaux de modules (`GET /api/features`), PARTAGÉE.
 *
 * Mesuré en prod le 2026-09-28 sur Automatisations : trois appels identiques
 * au chargement (une instance de `useModuleAccess` par module du menu, plus
 * `useFeatureFlags`), jusqu'à 1,5 s chacun. Tous partaient en même temps et
 * encombraient le serveur, qui répondait plus lentement à TOUT le reste de la
 * page.
 *
 * Ici : un seul appel en vol par bureau, et sa réponse gardée quelques
 * secondes pour les montages qui arrivent juste après. Une activation de
 * module vide le cache (`oublierFlagsModules`).
 */
import { supabase } from './supabase';
import { bureauActifSync } from './orgApi';

export interface LectureFlags {
  /** La lecture a abouti (sinon l'état est INCONNU, jamais « désactivé »). */
  ok: boolean;
  flags: Record<string, unknown>;
}

/** Assez pour absorber une rafale de montages, trop court pour mentir. */
const DUREE_CACHE_MS = 10_000;

let enVol: { bureau: string | null; promesse: Promise<LectureFlags> } | null = null;
let cache: { bureau: string | null; expire: number; lecture: LectureFlags } | null = null;

async function lire(): Promise<LectureFlags> {
  const { data: { session } } = await supabase.auth.getSession();
  // Session pas encore restaurée : inconnu, pas « désactivé ».
  if (!session?.access_token) return { ok: false, flags: {} };
  const res = await fetch('/api/features', {
    headers: { Authorization: `Bearer ${session.access_token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return { ok: false, flags: {} };
  const json = await res.json();
  return { ok: true, flags: (json?.flags ?? {}) as Record<string, unknown> };
}

/** Les drapeaux du bureau actif — un seul appel pour tous les demandeurs. */
export function lireFlagsModules(): Promise<LectureFlags> {
  const bureau = bureauActifSync();
  if (cache && cache.bureau === bureau && cache.expire > Date.now()) return Promise.resolve(cache.lecture);
  if (enVol && enVol.bureau === bureau) return enVol.promesse;

  const promesse = lire().catch(() => ({ ok: false, flags: {} } as LectureFlags));
  enVol = { bureau, promesse };
  void promesse.then((lecture) => {
    if (enVol?.promesse === promesse) enVol = null;
    // Seule une lecture RÉUSSIE est gardée : un échec doit pouvoir être
    // retenté tout de suite.
    if (lecture.ok) cache = { bureau, expire: Date.now() + DUREE_CACHE_MS, lecture };
  });
  return promesse;
}

/** À appeler après avoir activé un module : la prochaine lecture repart du serveur. */
export function oublierFlagsModules(): void {
  cache = null;
  enVol = null;
}
