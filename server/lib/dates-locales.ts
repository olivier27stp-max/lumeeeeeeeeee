/**
 * Dates dans le fuseau d'une entreprise, sans dépendance (utilisable par les outils
 * de l'agent comme par Lumi). Le serveur tourne en UTC : un « aujourd'hui » ou un
 * « 1er du mois » calculé avec new Date() bascule au lendemain dès 20 h à Montréal.
 */

/** « 2026-09-12 » dans le fuseau donné, décalé de n jours. */
export function jourLocal(fuseau: string, maintenant: Date, decalageJours = 0): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(maintenant);
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  /* Le décalage se compte en JOURS CIVILS, pas en tranches de 24 h : le jour
     du retour à l'heure normale dure 25 h, et « minuit + 24 h » retombait le
     même jour (la semaine de Lumi montrait le 1er novembre deux fois). */
  return new Date(Date.UTC(v('year'), v('month') - 1, v('day') + decalageJours)).toISOString().slice(0, 10);
}

/** Minuit local d'un jour « YYYY-MM-DD » dans le fuseau, en ISO UTC. */
export function minuitLocal(jour: string, fuseau: string): string {
  const [y, m, d] = jour.split('-').map(Number);
  // Première estimation à minuit UTC, puis correction par le décalage réel du fuseau ce jour-là.
  const estime = Date.UTC(y, m - 1, d, 0, 0, 0);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(estime));
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const localCommeUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'));
  const decalage = localCommeUtc - estime; // ex. Montréal : -4 h
  return new Date(estime - decalage).toISOString();
}


/** « 14:30 » : l'heure LOCALE d'un instant dans le fuseau donné. */
export function heureLocale(instant: string | Date, fuseau: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(instant));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${v('hour')}:${v('minute')}`;
}

/**
 * L'instant (ISO UTC) d'un jour et d'une heure LOCAUX : « 2026-10-15 » à
 * « 09:00 » dans America/Vancouver → 2026-10-15T16:00:00.000Z.
 *
 * Deux passes : le décalage du fuseau se lit à l'instant ESTIMÉ, et peut
 * différer à l'instant réel de part et d'autre d'un changement d'heure.
 */
export function instantLocal(jour: string, heure: string, fuseau: string): string {
  const [y, m, d] = jour.split('-').map(Number);
  const [hh, mm] = heure.split(':').map(Number);
  const vise = Date.UTC(y, m - 1, d, hh || 0, mm || 0, 0);
  const decalage = (instant: number): number => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(instant));
    const v = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
    return Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute')) - instant;
  };
  const premier = vise - decalage(vise);
  return new Date(vise - decalage(premier)).toISOString();
}
