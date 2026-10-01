/**
 * Valide le jeu de cas d'évaluation de Lumi — SANS base, SANS réseau, SANS modèle.
 *
 *   npx tsx evals/lumi/valider.mts [--tableau]
 *
 * Vérifie : le format de chaque cas, l'unicité des identifiants, que chaque outil
 * cité existe dans le VRAI registre de Lumi (server/lib/agent/tools.ts) avec le bon
 * genre (lecture / écriture), que chaque paramètre attendu est déclaré par l'outil,
 * que chaque référence à fixture.json existe, que les courriels et numéros cités
 * sont fictifs, et la couverture (catégories, langues, types, cas de régression).
 *
 * Le registre se charge avec des variables d'environnement factices : aucun secret
 * n'est lu, aucun client ne se connecte.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, CLES_DATES, NATURES, NATURES_SANS_ECRITURE, REGISTRES, refsDe, textesDe, uniteDe, type CasLumi } from './format.mts';

const ICI = dirname(fileURLToPath(import.meta.url));
const TABLEAU = process.argv.includes('--tableau');

// Valeurs factices, posées AVANT de charger le registre (server/lib/config.ts les exige à l'import).
process.env.VITE_SUPABASE_URL = 'http://127.0.0.1:9';
process.env.VITE_SUPABASE_ANON_KEY = 'validateur-hors-ligne';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'validateur-hors-ligne';

interface OutilRegistre { kind: 'read' | 'write'; declaration: { name: string; parameters?: unknown } }
const { TOOLS_BY_NAME } = (await import('../../server/lib/agent/tools')) as { TOOLS_BY_NAME: Record<string, OutilRegistre> };

const CHAMPS = new Set(['id', 'section', 'categorie', 'registre', 'langue', 'nature', 'type', 'q', 'outil', 'outils', 'equivalents', 'params', 'cible', 'interdits', 'voisins',
  'lectures_interdites', 'aucun_outil', 'reponse_contient', 'reponse_interdit', 'chiffres', 'chiffres_interdits', 'sensible', 'verification', 'critere_juge', 'compte', 'suite', 'regression', 'ecrit', 'note']);
/** Les quatre défauts connus que le jeu doit surveiller (consigne de la mission). */
const REGRESSIONS_EXIGEES = ['faq-a-la-place-du-paiement', 'set_default_email_template', 'duplicate_email_template', 'resend_payment_request'];

function lireChemin(racine: unknown, chemin: string): unknown {
  let o: unknown = racine;
  for (const k of chemin.split('.')) {
    if (o == null || typeof o !== 'object' || !(k in (o as Record<string, unknown>))) return undefined;
    o = (o as Record<string, unknown>)[k];
  }
  return o;
}

/** Toutes les clés de paramètres qu'un outil déclare, sous-objets et éléments de liste compris. */
function clesDe(parametres: unknown): Set<string> {
  const cles = new Set<string>();
  const parcourir = (schema: unknown): void => {
    if (!schema || typeof schema !== 'object') return;
    const s = schema as { properties?: Record<string, unknown>; items?: unknown };
    for (const [k, v] of Object.entries(s.properties ?? {})) { cles.add(k); parcourir(v); }
    parcourir(s.items);
  };
  parcourir(parametres);
  return cles;
}

const fixture = JSON.parse(readFileSync(join(ICI, 'fixture.json'), 'utf8')) as { etat: string; ancre: string };
const fichiers = readdirSync(join(ICI, 'cas')).filter((f) => f.endsWith('.json')).sort();
const erreurs: string[] = [];
const cas: CasLumi[] = [];
for (const f of fichiers) {
  let lus: unknown;
  try { lus = JSON.parse(readFileSync(join(ICI, 'cas', f), 'utf8')); } catch (e) { erreurs.push(`${f} : JSON illisible (${e instanceof Error ? e.message : String(e)})`); continue; }
  if (!Array.isArray(lus)) { erreurs.push(`${f} : une liste de cas est attendue`); continue; }
  cas.push(...(lus as CasLumi[]));
}

const ids = new Set<string>();
const outilsCites = new Set<string>();
for (const c of cas) {
  const ou = c.id || '(sans id)';
  const faute = (m: string): void => { erreurs.push(`${ou} : ${m}`); };
  const existe = (nom: string, role: string, genre?: 'read' | 'write'): void => {
    const t = TOOLS_BY_NAME[nom];
    if (!t) { faute(`${role} : outil inconnu du registre « ${nom} »`); return; }
    if (genre && t.kind !== genre) faute(`${role} : « ${nom} » est une ${t.kind === 'read' ? 'lecture' : 'écriture'}, pas une ${genre === 'read' ? 'lecture' : 'écriture'}`);
  };

  for (const k of Object.keys(c)) if (!CHAMPS.has(k)) faute(`champ inconnu « ${k} »`);
  if (!c.id || !/^[a-z0-9-]+$/.test(c.id)) faute('id manquant ou mal formé (minuscules, chiffres, tirets)');
  if (ids.has(c.id)) faute('id en double');
  ids.add(c.id);
  if (!(CATEGORIES as readonly string[]).includes(c.categorie)) faute(`catégorie inconnue « ${c.categorie} »`);
  if (!(REGISTRES as readonly string[]).includes(c.registre)) faute(`registre inconnu « ${c.registre} »`);
  if (!(NATURES as readonly string[]).includes(c.nature)) faute(`nature inconnue « ${c.nature} »`);
  if (!['action', 'lecture', 'clarification'].includes(c.type)) faute(`type inconnu « ${c.type} »`);
  if (!['fr', 'en'].includes(c.langue)) faute(`langue inconnue « ${c.langue} »`);
  if ((c.registre === 'anglais') !== (c.langue === 'en') && c.registre !== 'vocal') faute('registre « anglais » et langue « en » vont ensemble');
  if (!['code', 'juge'].includes(c.verification)) faute('verification : « code » ou « juge »');
  if (c.verification === 'juge' && !c.critere_juge) faute('verification « juge » sans critere_juge');
  if (c.verification === 'code' && c.critere_juge) faute('critere_juge sans verification « juge »');
  if (c.compte && !['proprietaire', 'technicien'].includes(c.compte)) faute(`compte inconnu « ${c.compte} »`);
  if (!c.q || c.q.trim().length < 8) faute('demande vide ou trop courte');
  if (c.section) faute('section : calculée par preparer.mts, ne pas l’écrire');

  // Outils : existence et genre
  if (c.outil === undefined) faute('outil manquant (null si aucun outil n’est attendu)');
  if (c.type === 'action') { if (!c.outil) faute('une action attend un outil'); else existe(c.outil, 'outil', 'write'); }
  if (c.type === 'lecture') { if (!c.outil) faute('une lecture attend un outil'); else existe(c.outil, 'outil', 'read'); }
  if (c.type === 'clarification' && c.outil) faute('une clarification n’attend aucun outil (outil: null)');
  if (NATURES_SANS_ECRITURE.includes(c.nature) && c.type === 'action') faute(`nature « ${c.nature} » : aucune écriture ne peut être attendue`);
  if ((c.nature === 'simple' || c.nature === 'multi') && c.type === 'clarification') faute(`nature « ${c.nature} » : un outil est attendu`);
  for (const o of c.outils ?? []) existe(o, 'outils');
  for (const o of c.equivalents ?? []) existe(o, 'equivalents');
  for (const o of c.voisins ?? []) existe(o, 'voisins');
  for (const o of c.interdits ?? []) existe(o, 'interdits', 'write');
  for (const o of c.lectures_interdites ?? []) existe(o, 'lectures_interdites', 'read');
  if ((c.outils?.length || c.equivalents?.length || c.params) && !c.outil) faute('outils, equivalents et params demandent un outil principal');
  if (c.aucun_outil && (c.outil || c.voisins?.length || c.equivalents?.length)) faute('aucun_outil ne se combine pas avec un outil attendu ou voisin');
  for (const o of [c.outil, ...(c.outils ?? []), ...(c.equivalents ?? [])]) if (o) outilsCites.add(o);
  const attendus = new Set([c.outil, ...(c.outils ?? []), ...(c.equivalents ?? [])].filter(Boolean));
  for (const o of [...(c.interdits ?? []), ...(c.lectures_interdites ?? [])]) if (attendus.has(o)) faute(`« ${o} » est à la fois attendu et interdit`);

  // Paramètres déclarés par l'outil
  if (c.params && c.outil && TOOLS_BY_NAME[c.outil]) {
    const cles = clesDe(TOOLS_BY_NAME[c.outil].declaration.parameters);
    for (const k of Object.keys(c.params)) if (!cles.has(k)) faute(`paramètre « ${k} » non déclaré par ${c.outil}`);
  }

  // Références à la fiche des faits
  for (const ref of refsDe(c)) {
    if (ref.startsWith('dates.')) { if (!CLES_DATES.includes(ref.slice(6))) faute(`date relative inconnue {{${ref}}}`); continue; }
    const v = lireChemin(fixture, ref);
    if (v === undefined) faute(`référence absente de fixture.json : ${ref}`);
    else if (v === null && fixture.etat === 'reel') faute(`référence nulle dans la fiche réelle : ${ref}`);
  }
  for (const ref of [...(c.chiffres ?? []), ...(c.chiffres_interdits ?? [])]) {
    if (!uniteDe(ref)) faute(`chiffre « ${ref} » : unité illisible (la clé doit finir par _cents, _heures, _pct ou nombre)`);
    const v = lireChemin(fixture, ref);
    if (v !== undefined && v !== null && typeof v !== 'number') faute(`chiffre « ${ref} » : la fiche des faits n’y a pas un nombre`);
  }

  // Un cas doit avoir quelque chose à vérifier
  const controles = Boolean(c.outil || c.interdits?.length || c.lectures_interdites?.length || c.aucun_outil || c.reponse_contient?.length || c.reponse_interdit?.length || c.chiffres?.length || c.chiffres_interdits?.length);
  if (!controles && c.nature !== 'ambigu' && c.verification === 'code') faute('aucun contrôle par code : ajouter un texte attendu ou interdit, ou passer en verification « juge »');

  // Rien de réel dans les demandes : courriels fictifs, numéros de la plage fictive
  for (const t of textesDe(c)) {
    for (const m of t.matchAll(/[a-z0-9._-]+@([a-z0-9.-]+\.[a-z]{2,})/gi)) if (m[1].toLowerCase() !== 'lume-qa.test') faute(`courriel hors @lume-qa.test : ${m[0]}`);
    for (const m of t.matchAll(/\b(\d{3})[ .-]?(\d{3})[ .-]?(\d{4})\b/g)) if (!(m[1] === '514' && m[2] === '555' && /^01\d\d$/.test(m[3]))) faute(`numéro hors de la plage fictive 514 555-01xx : ${m[0]}`);
  }
}

/* ── Couverture ────────────────────────────────────────────────────────── */

const compter = <K extends string>(cle: (c: CasLumi) => K): Map<K, number> => {
  const m = new Map<K, number>();
  for (const c of cas) m.set(cle(c), (m.get(cle(c)) ?? 0) + 1);
  return m;
};
const total = cas.length;
const parCategorie = compter((c) => c.categorie);
const parRegistre = compter((c) => c.registre);
const parNature = compter((c) => c.nature);
const pct = (n: number): number => Math.round((n / (total || 1)) * 100);

if (total < 150) erreurs.push(`couverture : ${total} cas, il en faut au moins 150`);
for (const k of CATEGORIES) if (k !== 'transverse' && (parCategorie.get(k) ?? 0) < 5) erreurs.push(`couverture : catégorie « ${k} » — ${parCategorie.get(k) ?? 0} cas, il en faut au moins 5`);
for (const n of NATURES) if (!parNature.get(n)) erreurs.push(`couverture : aucune demande de nature « ${n} »`);
const bornes: Record<string, [number, number]> = { quebecois: [45, 65], anglais: [15, 25], vocal: [10, 20], neutre: [5, 15] };
for (const [r, [min, max]] of Object.entries(bornes)) {
  const p = pct(parRegistre.get(r as CasLumi['registre']) ?? 0);
  if (p < min || p > max) erreurs.push(`couverture : registre « ${r} » à ${p} %, visé ${min}–${max} %`);
}
for (const r of REGRESSIONS_EXIGEES) if (!cas.some((c) => (c.regression ?? '').includes(r))) erreurs.push(`couverture : aucun cas de régression « ${r} »`);
if (!cas.some((c) => c.compte === 'technicien')) erreurs.push('couverture : aucun cas joué par le technicien');

const ligne = (titre: string, m: Map<string, number>, ordre: readonly string[]): string =>
  `${titre.padEnd(12)} ${ordre.filter((k) => m.has(k)).map((k) => `${k} ${m.get(k)} (${pct(m.get(k) ?? 0)} %)`).join(' · ')}`;

console.log(`${total} cas dans ${fichiers.length} fichiers — fiche des faits « ${fixture.etat} » (ancre ${fixture.ancre})`);
console.log(ligne('catégories', parCategorie, CATEGORIES));
console.log(ligne('registres', parRegistre, REGISTRES));
console.log(ligne('natures', parNature, NATURES));
console.log(ligne('langues', compter((c) => c.langue), ['fr', 'en']));
console.log(ligne('types', compter((c) => c.type), ['lecture', 'action', 'clarification']));
console.log(ligne('correction', compter((c) => c.verification), ['code', 'juge']));
console.log(ligne('comptes', compter((c) => c.compte ?? 'proprietaire'), ['proprietaire', 'technicien']));
console.log(`outils attendus distincts : ${outilsCites.size} sur ${Object.keys(TOOLS_BY_NAME).length} · cas qui écrivent pour vrai (écartés par défaut) : ${cas.filter((c) => c.ecrit).length} · cas sensibles : ${cas.filter((c) => c.sensible).length}`);

if (TABLEAU) {
  console.log('\n| Catégorie | Cas | ' + NATURES.join(' | ') + ' |');
  console.log('|---|---:|' + NATURES.map(() => '---:').join('|') + '|');
  for (const k of CATEGORIES) {
    const dans = cas.filter((c) => c.categorie === k);
    console.log(`| ${k} | ${dans.length} | ${NATURES.map((n) => dans.filter((c) => c.nature === n).length || '').join(' | ')} |`);
  }
  console.log(`| **total** | **${total}** | ${NATURES.map((n) => `**${parNature.get(n) ?? 0}**`).join(' | ')} |`);
  console.log('\n| Registre | Cas | Part |\n|---|---:|---:|');
  for (const r of REGISTRES) console.log(`| ${r} | ${parRegistre.get(r) ?? 0} | ${pct(parRegistre.get(r) ?? 0)} % |`);
}

if (erreurs.length) {
  console.log(`\n${erreurs.length} ERREUR(S) :\n - ${erreurs.join('\n - ')}`);
  process.exit(1);
}
console.log('\nOK — format, identifiants, outils du registre, paramètres, références à la fiche des faits, couverture.');
process.exit(0);
