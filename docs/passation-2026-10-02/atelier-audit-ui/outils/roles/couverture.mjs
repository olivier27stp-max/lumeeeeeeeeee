/**
 * Construit D:/lume-uiaudit/sorties/roles/couverture.md.
 *
 * Sources (aucun appel réseau) :
 *   · sorties/roles/liste-tests.json — la liste des tests ÉCRITS (playwright --list --reporter=json) ;
 *   · sorties/e2e-roles*​/resultats.json — s'il en existe (passes Playwright menées à terme) : le dernier résultat l'emporte ;
 *   · ETATS ci-dessous — le dernier état CONNU des tests exécutés le 2026-10-01 dans des passes interrompues par la panne
 *     de staging (leur resultats.json n'a jamais été écrit ; les preuves sont dans sorties/roles/preuves/) ;
 *   · sorties/roles/constats.jsonl, matrice-api.json, matrice-base.json, libelles.json, non-testables.json.
 *
 *   node D:/lume-uiaudit/outils/roles/couverture.mjs
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SORTIES = 'D:/lume-uiaudit/sorties';
const LOT = join(SORTIES, 'roles');
const pad = (n, l) => String(n).padStart(l, '0');
const lire = (f, d) => (existsSync(join(LOT, f)) ? JSON.parse(readFileSync(join(LOT, f), 'utf8')) : d);

const IDS = [
  ...Array.from({ length: 11 }, (_, i) => `RTE-${pad(i + 1, 2)}`),
  ...Array.from({ length: 28 }, (_, i) => `EXT-${pad(i + 1, 3)}`),
  ...Array.from({ length: 45 }, (_, i) => `API-${pad(i + 1, 2)}`),
  ...Array.from({ length: 6 }, (_, i) => `RLS-${pad(i + 1, 2)}`),
  'MAT-00',
  ...Array.from({ length: 22 }, (_, i) => `S-${pad(i + 1, 2)}`),
  ...Array.from({ length: 5 }, (_, i) => `MOB-${pad(i + 1, 2)}`),
];
const LIBELLES = lire('libelles.json', {});
const NON_TESTABLE = lire('non-testables.json', {});
const constats = existsSync(join(LOT, 'constats.jsonl')) ? readFileSync(join(LOT, 'constats.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : [];
const matriceApi = lire('matrice-api.json', {});

// ── Dernier état connu des tests exécutés le 2026-10-01 (passes interrompues) ─────────────────────────────
const VERT = 'vert (exécuté le 2026-10-01)';
const DEFAUT = 'rouge — défaut produit';
const PANNE = 'rouge — panne ou lenteur de staging, à relancer';
const JAMAIS = 'écrit, jamais exécuté';
/** [fichier, début du titre, état, précision] */
const ETATS = [
  ['50-', '[S-02] événements', DEFAUT, ''],
  ['50-', '[S-02] « Construire avec Lumi »', DEFAUT, ''],
  ['50-', '[S-02] lectures', DEFAUT, ''],
  ['50-', '[S-02] écritures', VERT, ''],
  ['50-', '[S-02] sans jeton', DEFAUT, ''],
  ['50-', '[S-02] ce qui ne contourne PAS', PANNE, '« Fixture bureau timeout » ; réponses conformes reçues par la sonde (403 / 404 / 404)'],
  ['50-', '[S-04] publier directement', DEFAUT, ''],
  ['50-', '[S-04] `is_preset`', DEFAUT, ''],
  ['50-', '[S-04] une automatisation FOURNIE', DEFAUT, ''],
  ['50-', '[S-04][S-13] le texte', PANNE, '« statement timeout » pendant la préparation ; défaut NON observé : à vérifier'],
  ['50-', '[S-04] ce que la base refuse bien', PANNE, 'compte introuvable (auth de staging en erreur) ; refus conformes reçus par la sonde (« row-level security »)'],
  ['50-', '[S-05] `PATCH', PANNE, '« Fixture bureau timeout » ; défaut observé par la sonde (200 + base)'],
  ['50-', '[S-05] dupliquer', PANNE, '« Fixture bureau timeout » ; défaut observé par la sonde (201)'],
  ['50-', '[S-05] « Tester »', PANNE, '« Fixture bureau timeout » ; défaut observé par la sonde (200)'],
  ['50-', '[S-05] ce qui tient', JAMAIS, 'réponses conformes reçues par la sonde (404 restaurer, rule:null)'],
  ['50-', '[S-06] la batterie', JAMAIS, 'défaut observé par la sonde (corps de la réponse)'],
  ['50-', '[S-06] la route reste fermée', JAMAIS, 'réponses conformes reçues par la sonde (API-28 : 403 pour les quatre rôles)'],
  ['50-', '[S-08] le membre « read + update »', JAMAIS, 'réponses conformes reçues par la sonde (API-19 : 403 en français ; mise à jour directe : 0 ligne)'],
  ['50-', '[S-08] un refus de permission', JAMAIS, 'défaut observé par la sonde (corps des 403)'],
  ['50-', '[S-08][S-06] les autres refus', JAMAIS, 'défaut observé par la sonde (« Only admins can run automation tests. »)'],
  ['50-', '[S-17]', JAMAIS, 'réponses conformes reçues par la sonde (« permission denied for table automation_webhooks »)'],
  ['70-', '[S-07][S-19] quand un technicien termine un job', JAMAIS, 'défaut observé en base pendant la sonde'],
  ['70-', '[S-07] « visite déplacée »', JAMAIS, 'comportement observé par la sonde (API-32) ; à arbitrer'],
];

// ── Les tests écrits ──────────────────────────────────────────────────────
const tests = [];
{
  const j = lire('liste-tests.json', { suites: [] });
  const visiter = (s, f) => {
    for (const x of s.suites ?? []) visiter(x, x.file ?? f);
    for (const sp of s.specs ?? []) tests.push({ fichier: String(sp.file ?? f).replace(/\\/g, '/').replace(/^.*roles\//, ''), titre: sp.title });
  };
  visiter(j, '');
}
// Résultats de passes Playwright menées à terme, s'il y en a.
const resultats = new Map();
for (const d of readdirSync(SORTIES).filter((x) => x.startsWith('e2e-roles'))) {
  const f = join(SORTIES, d, 'resultats.json');
  if (!existsSync(f)) continue;
  const j = JSON.parse(readFileSync(f, 'utf8'));
  const quand = String(j.stats?.startTime ?? '').slice(0, 10);
  const debut = Date.parse(j.stats?.startTime ?? 0);
  const visiter = (s, fich) => {
    for (const x of s.suites ?? []) visiter(x, x.file ?? fich);
    for (const sp of s.specs ?? []) for (const t of sp.tests ?? []) {
      if (t.projectName !== 'bureau') continue;
      const dernier = (t.results ?? []).at(-1);
      if (!dernier || dernier.status === 'skipped') continue;
      const cle = `${String(sp.file ?? fich).replace(/\\/g, '/').replace(/^.*roles\//, '')} › ${sp.title}`;
      const prec = resultats.get(cle);
      if (!prec || prec.debut < debut) resultats.set(cle, { ok: dernier.status === 'passed', quand, debut, erreur: String(dernier.error?.message ?? '').split('\n')[0].slice(0, 160) });
    }
  };
  visiter(j, '');
}

const constatsDe = (t) => constats.filter((c) => c.test && c.test.startsWith(`${t.fichier} › ${t.titre}`.slice(0, 80)) ).map((c) => c.id);
function etatDe(t) {
  const c = constatsDe(t);
  const r = resultats.get(`${t.fichier} › ${t.titre}`);
  if (r) {
    if (r.ok) return { etat: `vert (exécuté le ${r.quand})`, c };
    if (/timeout|503|statement|schema cache|session .* :|Fixture/i.test(r.erreur)) return { etat: `${PANNE} (${r.erreur})`, c };
    return { etat: `${DEFAUT} → ${c.length ? c.join(', ') : 'constat à écrire'}`, c };
  }
  const m = ETATS.find(([f, debut]) => t.fichier.startsWith(f) && t.titre.startsWith(debut));
  if (m) {
    const [, , etat, precision] = m;
    if (etat === DEFAUT) return { etat: `${DEFAUT} → ${c.join(', ')} (exécuté le 2026-10-01)`, c };
    return { etat: `${etat}${precision ? ` — ${precision}` : ''}${c.length ? ` → ${c.join(', ')}` : ''}`, c };
  }
  // Routes de l'API : jamais passées sous Playwright, mais appelées par la sonde avec la même table.
  const api = t.titre.match(/^\[(API-\d+)\]/)?.[1];
  if (api && matriceApi[api]) {
    const cases = matriceApi[api].cases ?? [];
    const nc = cases.filter((x) => !x.conforme);
    const quoi = nc.length ? `${nc.length} case(s) non conforme(s)${nc.every((x) => x.panne) ? ' (lecture expirée côté staging)' : ''}` : 'toutes conformes';
    return { etat: `${JAMAIS} sous Playwright — ${cases.length} réponses reçues par la sonde le 2026-10-01 : ${quoi} (matrice ci-dessous)`, c };
  }
  return { etat: `${JAMAIS}${c.length ? ` — défaut observé autrement → ${c.join(', ')}` : ''}`, c };
}

const parId = new Map(IDS.map((id) => [id, []]));
for (const t of tests) for (const m of t.titre.matchAll(/\[([A-Z]+-[0-9]+)\]/g)) (parId.get(m[1]) ?? []).push(t);

const ech = (s) => String(s).replace(/\|/g, '\\|');
const etats = tests.map((t) => etatDe(t).etat);
const compte = (motif) => etats.filter((e) => motif.test(e)).length;
let md = `# Couverture — lot « rôles » (rôles, routes, API, base, points d'entrée)\n\n`;
md += `Généré le ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC par \`outils/roles/couverture.mjs\`.\n\n`;
md += `> **État de la tournée.** Staging est tombé en panne pendant la passe (base saturée, PostgREST en 503, « statement timeout ») : la plupart des specs sont **écrites mais n'ont jamais été exécutées**. Ce qui a été réellement observé le 2026-10-01 : (1) la sonde \`outils/roles/sonde-api.mts\` — chaque route API-01 à API-34 appelée avec chaque rôle, réponses dans \`sorties/roles/sonde-api.txt\` ; (2) la sonde \`outils/roles/sonde-securite.mts\` — S-02, S-04, S-05, S-06, S-17, \`sorties/roles/sonde-securite.txt\` ; (3) une passe Playwright interrompue de \`50-soupcons-securite.spec.ts\` — 8 tests menés à terme (1 vert, 7 rouges sur un défaut du produit) et 6 tombés sur la panne, contextes d'erreur dans \`sorties/roles/preuves/\`. Rien d'autre n'a tourné.\n\n`;
const couverts = IDS.filter((id) => (parId.get(id) ?? []).length > 0);
md += `- ID du lot : **${IDS.length}** — couverts par au moins un test écrit : **${couverts.length}** ; sans test (raison donnée) : **${IDS.length - couverts.length}**.\n`;
md += `- Tests écrits : **${tests.length}** — ${compte(/^vert/)} vert(s) ; ${compte(/^rouge — défaut produit/)} rouge(s) sur un défaut du produit ; ${compte(/^rouge — panne/)} rouge(s) sur la panne de staging (à relancer) ; ${compte(/^écrit, jamais exécuté/)} jamais exécutés (dont ${tests.filter((t) => /^\[API-/.test(t.titre) && /sonde/.test(etatDe(t).etat)).length} routes dont les réponses ont été reçues par la sonde).\n`;
md += `- Constats (défauts du produit réellement observés) : **${constats.length}** — ${['bloquant', 'majeur', 'mineur', 'cosmetique'].map((g) => `${constats.filter((c) => c.gravite === g).length} ${g}`).join(', ')}.\n\n`;
md += `Séries : \`RTE-\` routes du client et gardes (§1) · \`EXT-\` points d'entrée (§2) · \`API-\` routes serveur (§3 ; série propre au lot, la carte ne les numérote pas) · \`RLS-\` tables (§4) · \`MAT-\` comptes de la matrice (§5) · \`S-\` soupçons (§9) · \`MOB-\` téléphone (§1.3).\n\n`;

md += `## Tableau des ID\n\n| ID | Élément | Test (fichier › titre) | Dernier état connu |\n|---|---|---|---|\n`;
for (const id of IDS) {
  const ts = parId.get(id) ?? [];
  if (!ts.length) { md += `| ${id} | ${ech(LIBELLES[id] ?? '')} | — | SANS TEST — ${ech(NON_TESTABLE[id] ?? 'raison à écrire')} |\n`; continue; }
  ts.forEach((t, i) => { md += `| ${i === 0 ? id : ''} | ${i === 0 ? ech(LIBELLES[id] ?? '') : ''} | ${ech(t.fichier)} › ${ech(t.titre)} | ${ech(etatDe(t).etat)} |\n`; });
  if (NON_TESTABLE[id]) md += `|  |  | (partie sans test) | ${ech(NON_TESTABLE[id])} |\n`;
}

// ── Matrice rôle × route ──────────────────────────────────────────────────
{
  const cas = ['proprioA', 'adminA', 'editeurA', 'lecteurA', 'vendeurA', 'techA', 'proprioB (son bureau, objet de A)', 'proprioB (x-org-id = A)', 'sans jeton'];
  const court = ['propriétaire', 'admin', 'membre read+update', 'membre read', 'vendeur', 'technicien', 'autre bureau (objet de A)', 'autre bureau (x-org-id = A)', 'sans jeton'];
  md += `\n## Matrice rôle × route (API directe)\n\n`;
  md += `Source : réponses réellement reçues par la sonde du 2026-10-01 (\`sorties/roles/sonde-api.txt\`), avec la même table de routes que \`30-api-roles.spec.ts\` (\`_routes.ts\`). Chaque case : **code attendu → code observé**, puis l'effet relu en base (\`écrit\` / \`rien\` ; \`—\` = route sans écriture ou effet non mesuré par la sonde, ce qui est le cas des routes d'événements). ⚠ = non conforme ; ⏳ = lecture expirée côté staging. « aucun effet » = le code est libre (aucun objet de A n'est ciblé), seule l'absence d'effet et de donnée de A est exigée. Les routes absentes du tableau (API-35 à API-45, API-43) n'ont reçu aucune réponse exploitable : les jetons de la sonde (30 minutes sur staging) avaient expiré, puis staging est tombé.\n\n`;
  md += `| ID | Route | Clé exigée | ${court.join(' | ')} |\n|---|---|---|${court.map(() => '---').join('|')}|\n`;
  for (const id of Object.keys(matriceApi).sort()) {
    const r = matriceApi[id];
    const cases = cas.map((c) => {
      const x = (r.cases ?? []).find((y) => y.cas === c);
      if (!x) return 'non observé';
      const att = x.attendu === 'aucun effet dans A' ? 'aucun effet' : x.attendu;
      const eff = x.ecrit === null ? '—' : x.ecrit ? 'écrit' : 'rien';
      return `${x.conforme ? '' : x.panne ? '⏳ ' : '⚠ '}${att} → ${x.code} · ${eff}${x.fuite && !['proprioA', 'adminA', 'editeurA', 'lecteurA'].includes(c) ? ' · DONNÉE DE A' : ''}`;
    });
    md += `| ${id} | \`${r.methode} ${ech(r.chemin)}\` | ${ech(r.cle)} | ${cases.join(' | ')} |\n`;
  }
}

// ── Matrice rôle × table ──────────────────────────────────────────────────
md += `\n## Matrice rôle × table (PostgREST, RLS active)\n\n`;
const mBase = lire('matrice-base.json', null);
if (mBase) {
  const roles = ['proprioA', 'adminA', 'editeurA', 'lecteurA', 'vendeurA', 'techA', 'proprioB'];
  const court = ['propriétaire', 'admin', 'membre read+update', 'membre read', 'vendeur', 'technicien', 'autre bureau'];
  md += `Chaque case : **attendu → observé** (\`oui\` = l'opération a eu son effet sur une ligne du bureau A, relu par le service). ⚠ = non conforme.\n\n`;
  md += `| ID | Table | Opération | ${court.join(' | ')} |\n|---|---|---|${court.map(() => '---').join('|')}|\n`;
  for (const id of Object.keys(mBase).sort()) for (const op of ['lecture', 'insertion', 'modification', 'suppression']) {
    const cases = roles.map((ro) => {
      const x = (mBase[id].cases ?? []).find((y) => y.role === ro && y.operation === op);
      if (!x) return '·';
      const o = (b) => (b ? 'oui' : 'non');
      return `${x.attendu === x.observe ? '' : '⚠ '}${o(x.attendu)} → ${o(x.observe)}`;
    });
    md += `| ${op === 'lecture' ? id : ''} | ${op === 'lecture' ? `\`${mBase[id].table}\`` : ''} | ${op} | ${cases.join(' | ')} |\n`;
  }
} else if (existsSync(join(LOT, 'matrice-base-attendue.md'))) {
  md += readFileSync(join(LOT, 'matrice-base-attendue.md'), 'utf8');
}

if (existsSync(join(LOT, 'notes-couverture.md'))) md += `\n${readFileSync(join(LOT, 'notes-couverture.md'), 'utf8')}\n`;
writeFileSync(join(LOT, 'couverture.md'), md);
console.log(`couverture.md : ${IDS.length} ID, ${couverts.length} couverts, ${tests.length} tests écrits.`);
console.log('états :', JSON.stringify({ vert: compte(/^vert/), defaut: compte(/^rouge — défaut produit/), panne: compte(/^rouge — panne/), jamais: compte(/^écrit, jamais exécuté/) }));
const sans = IDS.filter((id) => !(parId.get(id) ?? []).length && !NON_TESTABLE[id]);
if (sans.length) console.log('SANS TEST ET SANS RAISON :', sans.join(', '));
const orphelins = constats.filter((c) => !tests.some((t) => c.test.startsWith(`${t.fichier} › ${t.titre}`.slice(0, 80))));
if (orphelins.length) console.log('CONSTATS SANS TEST RETROUVÉ :', orphelins.map((c) => c.id).join(', '));
