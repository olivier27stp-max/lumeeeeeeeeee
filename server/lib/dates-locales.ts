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

