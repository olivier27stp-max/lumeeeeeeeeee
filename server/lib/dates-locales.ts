/**
 * Dates dans le fuseau d'une entreprise, sans dépendance (utilisable par les outils
 * de l'agent comme par Lumi). Le serveur tourne en UTC : un « aujourd'hui » ou un
 * « 1er du mois » calculé avec new Date() bascule au lendemain dès 20 h à Montréal.
 */

/** « 2026-09-12 » dans le fuseau donné, décalé de n jours. */
export function jourLocal(fuseau: string, maintenant: Date, decalageJours = 0): string {
  const d = new Date(maintenant.getTime() + decalageJours * 86_400_000);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')}`;
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

