/**
 * Convertit la sortie de la sonde (sorties/roles/sonde-api.txt, réponses réellement reçues le 2026-10-01)
 * en matrice rôle × route (sorties/roles/matrice-api.json), au format qu'écrit 30-api-roles.spec.ts.
 * Aucun appel réseau.   cd D:/lume-uiaudit/wt && node node_modules/tsx/dist/cli.mjs ../outils/roles/matrice-depuis-sonde.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ROUTES } from '../../wt/e2e/automations/roles/_routes';

const LOT = 'D:/lume-uiaudit/sorties/roles';
// La sonde complète a été interrompue avant d'écrire son JSON : on relit sa sortie texte (une ligne par appel).
const sonde: Array<{ route: string; cas: string; status: number; ecrit: boolean | null; fuite: boolean | null; corps: string }> = [];
{
  let route = '';
  const bool = (v: string): boolean | null => (v === 'true' ? true : v === 'false' ? false : null);
  for (const ligne of readFileSync(`${LOT}/sonde-api.txt`, 'utf8').split(/\r?\n/)) {
    const t = ligne.match(/^=== (API-\d+) /);
    if (t) { route = t[1]; continue; }
    const m = ligne.match(/^  (\S+)\s+(\d{3})  écrit=(\w+)  contientSecret=(\w+)  (.*)$/);
    if (m && route) sonde.push({ route, cas: m[1], status: Number(m[2]), ecrit: bool(m[3]), fuite: bool(m[4]), corps: m[5] });
  }
}
const NOM: Record<string, string> = { 'proprioB(orgB)': 'proprioB (son bureau, objet de A)', 'proprioB(x-org=A)': 'proprioB (x-org-id = A)', anonyme: 'sans jeton' };
const sortie: Record<string, unknown> = {};
for (const route of ROUTES) {
  // Les jetons de la sonde (30 minutes sur staging) ont expiré en cours de route : ces appels-là ne prouvent rien et sont écartés.
  const lignes = sonde.filter((l) => l.route === route.id && !/Invalid auth token/.test(l.corps));
  if (!lignes.some((l) => l.cas !== 'anonyme')) continue;
  const cases = lignes.map((l) => {
    const cas = NOM[l.cas] ?? l.cas;
    const panne = /Invalid auth token|statement timeout|Impossible de lire l’automatisation/.test(l.corps);
    // L'effet des routes d'événements était mesuré par une règle témoin peu fiable dans la sonde : non retenu.
    const ecrit = route.famille === 'evenement' ? null : l.ecrit;
    let attendu: string; let conforme: boolean;
    if (route.autorises.includes(l.cas as never)) {
      attendu = route.succes.join('/');
      conforme = route.succes.includes(l.status) && (ecrit === null || ecrit === true);
    } else if (l.cas === 'proprioB(orgB)') {
      const libre = !route.cibleA || route.id === 'API-25' || route.id === 'API-34';
      attendu = libre ? 'aucun effet dans A' : '403/404';
      conforme = (libre || [403, 404].includes(l.status)) && ecrit !== true && l.fuite !== true;
    } else if (l.cas === 'anonyme') {
      attendu = '401'; conforme = l.status === 401 && ecrit !== true && l.fuite !== true;
    } else {
      attendu = '403'; conforme = l.status === 403 && ecrit !== true && l.fuite !== true;
    }
    let erreur = '';
    try { erreur = String((JSON.parse(l.corps) as { error?: string }).error ?? ''); } catch { /* corps non JSON ou tronqué */ }
    if (!erreur) erreur = (l.corps.match(/"error":"([^"]+)"/)?.[1] ?? '');
    return { cas, attendu, code: l.status, ecrit, fuite: l.fuite, erreur, conforme, panne };
  });
  sortie[route.id] = { methode: route.methode, chemin: route.gabarit, cle: route.cle, famille: route.famille, source: 'sonde du 2026-10-01 (outils/roles/sonde-api.mts)', cases };
}
writeFileSync(`${LOT}/matrice-api.json`, JSON.stringify(sortie, null, 1));
const tout = Object.entries(sortie) as Array<[string, { cases: Array<{ cas: string; conforme: boolean; panne: boolean; code: number; attendu: string; erreur: string }> }]>;
console.log('routes', tout.length);
for (const [id, r] of tout) for (const c of r.cases) if (!c.conforme) console.log(`  ${id} ${c.cas} attendu ${c.attendu} observé ${c.code} ${c.panne ? '(PANNE)' : ''} ${c.erreur}`);
