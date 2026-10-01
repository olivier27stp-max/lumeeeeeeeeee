/**
 * Le temps dans le fuseau de l'ENTREPRISE (audit des outils de Lumi, 2026-09-30).
 * ─────────────────────────────────────────────────────────────────────────
 * Avant : « aujourd'hui » donné au modèle était la date UTC (après 20 h à
 * Québec, Lumi se croyait au lendemain : « demain » tombait deux jours plus
 * loin), et une heure écrite sans décalage (« 2026-10-01T09:00 ») était lue en
 * UTC par les outils : 9 h devenait 5 h du matin.
 */

/** Décalage du fuseau à cet instant, « -04:00 » (heure avancée incluse). */
export function decalage(fuseau: string, instant: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(instant);
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const commeUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  const minutes = Math.round((commeUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
  const signe = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${signe}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** Jour local AAAA-MM-JJ. */
export function jourDans(fuseau: string, instant: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/** La phrase « aujourd'hui » du prompt : jour, heure locale, décalage à utiliser dans les dates. */
export function maintenantPourLumi(fuseau: string, langue: 'fr' | 'en', instant: Date = new Date()): string {
  const d = decalage(fuseau, instant);
  const jour = jourDans(fuseau, instant);
  const lisible = new Intl.DateTimeFormat(langue === 'fr' ? 'fr-CA' : 'en-CA', {
    timeZone: fuseau, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(instant);
  return langue === 'fr'
    ? `${jour} (${lisible}, heure de l'entreprise, UTC${d}). Écris toute date-heure d'outil avec ce décalage, ex. ${jour}T09:00:00${d}`
    : `${jour} (${lisible}, company time, UTC${d}). Write every tool datetime with this offset, e.g. ${jour}T09:00:00${d}`;
}

/**
 * Le JOUR seulement, pour le bloc système : il ne change qu'à minuit. L'heure à
 * la minute de `maintenantPourLumi` y changeait le préfixe à chaque minute, et
 * tout le cache de la conversation sautait (mesuré en prod le 2026-10-01 :
 * écriture de TOUTE la conversation à chaque tour, sauf quand deux tours
 * tombaient dans la même minute).
 */
export function jourPourLumi(fuseau: string, langue: 'fr' | 'en', instant: Date = new Date()): string {
  const d = decalage(fuseau, instant);
  const jour = jourDans(fuseau, instant);
  const lisible = new Intl.DateTimeFormat(langue === 'fr' ? 'fr-CA' : 'en-CA', {
    timeZone: fuseau, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(instant);
  return langue === 'fr'
    ? `${jour} (${lisible}, heure de l'entreprise, UTC${d}). Écris toute date-heure d'outil avec ce décalage, ex. ${jour}T09:00:00${d}`
    : `${jour} (${lisible}, company time, UTC${d}). Write every tool datetime with this offset, e.g. ${jour}T09:00:00${d}`;
}

/** L'HEURE qu'il est, pour le contexte du tour (placé après le point de cache, jamais sauvegardé). */
export function heurePourLumi(fuseau: string, langue: 'fr' | 'en', instant: Date = new Date()): string {
  const heure = new Intl.DateTimeFormat(langue === 'fr' ? 'fr-CA' : 'en-CA', { timeZone: fuseau, hour: 'numeric', minute: '2-digit' }).format(instant);
  return langue === 'fr' ? `Heure actuelle (heure de l'entreprise) : ${heure}.` : `Current time (company time): ${heure}.`;
}

const DATE_HEURE_NAIVE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/**
 * « 2026-10-01T09:00 » (sans Z ni décalage) = 9 h À L'HEURE DE L'ENTREPRISE →
 * ISO UTC. Une valeur avec décalage, une date seule ou autre chose : inchangée.
 */
export function dateHeureLocaleVersUtc(valeur: string, fuseau: string): string {
  const m = DATE_HEURE_NAIVE.exec(valeur.trim());
  if (!m) return valeur;
  const [, jour, h, min, sec] = m;
  const estime = new Date(`${jour}T${h}:${min}:${sec ?? '00'}Z`);
  // Le décalage du fuseau à cet instant (heure avancée comprise), appliqué deux
  // fois pour les heures proches du changement d'heure.
  let utc = new Date(estime.getTime() - decalageMinutes(fuseau, estime) * 60_000);
  utc = new Date(estime.getTime() - decalageMinutes(fuseau, utc) * 60_000);
  return utc.toISOString();
}

function decalageMinutes(fuseau: string, instant: Date): number {
  const d = decalage(fuseau, instant);
  const s = d.startsWith('-') ? -1 : 1;
  const [h, m] = d.slice(1).split(':').map(Number);
  return s * (h * 60 + m);
}

/** Applique dateHeureLocaleVersUtc à chaque argument de date-heure (récursif, listes comprises). */
export function normaliserDatesHeures<T>(valeur: T, fuseau: string): T {
  if (typeof valeur === 'string') return dateHeureLocaleVersUtc(valeur, fuseau) as unknown as T;
  if (Array.isArray(valeur)) return valeur.map((v) => normaliserDatesHeures(v, fuseau)) as unknown as T;
  if (valeur && typeof valeur === 'object') {
    return Object.fromEntries(Object.entries(valeur as Record<string, unknown>).map(([k, v]) => [k, normaliserDatesHeures(v, fuseau)])) as T;
  }
  return valeur;
}
