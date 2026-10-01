/**
 * Prépare les cas pour le runner : remplace les gabarits {{…}} par les valeurs de
 * la fiche des faits, calcule la section, et écrit un dossier par compte.
 * Ni base, ni réseau, ni modèle.
 *
 *   npx tsx evals/lumi/preparer.mts [--avec-ecritures] [--previsionnel] [--date AAAA-MM-JJ] [--fixture <fichier>] [--sortie <dossier>]
 *
 *   evals/lumi/cas-resolus/proprietaire/cas.json   → run.mts … --compte qa.map.owner@lume.test
 *   evals/lumi/cas-resolus/technicien/cas.json     → run.mts … --compte qa.lumi.tech@lume.test
 *
 * Refuse une fiche des faits prévisionnelle (les numéros de job, de devis et de
 * facture ne sont connus qu'après le seed) sauf avec --previsionnel, qui écarte
 * alors les cas dont une valeur manque et le dit.
 * Écarte les cas « ecrit » (pointage direct, mémoire de Lumi) sauf avec --avec-ecritures.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { datesRelatives, remplir, uniteDe, type CasLumi, type CasResolu, type ChiffreResolu } from './format.mts';

const ICI = dirname(fileURLToPath(import.meta.url));
const drapeau = (k: string): boolean => process.argv.includes(k);
const arg = (k: string, d: string): string => { const i = process.argv.indexOf(k); const v = i > -1 ? process.argv[i + 1] : undefined; return v && !v.startsWith('--') ? v : d; };

const FUSEAU = 'America/Toronto';
const aujourdHui = (): string => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const v = (t: string): string => p.find((x) => x.type === t)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')}`;
};

const FICHIER_FIXTURE = arg('--fixture', join(ICI, 'fixture.json'));
const SORTIE = arg('--sortie', join(ICI, 'cas-resolus'));
const DATE = arg('--date', aujourdHui());
const AVEC_ECRITURES = drapeau('--avec-ecritures');
const PREVISIONNEL = drapeau('--previsionnel');

const fixture = JSON.parse(readFileSync(FICHIER_FIXTURE, 'utf8')) as Record<string, unknown> & { etat: string; ancre: string; valable_jusqu_au: string };
if (fixture.etat !== 'reel' && !PREVISIONNEL) {
  console.error(`La fiche des faits est « ${fixture.etat} » : lance d'abord le seed (--appliquer ou --fixture-seulement). Pour un essai à blanc : --previsionnel.`);
  process.exit(1);
}
const avertissements: string[] = [];
if (fixture.ancre !== DATE) avertissements.push(`La fiche des faits est ancrée au ${fixture.ancre}, on est le ${DATE} : les visites « aujourd'hui / demain » ont glissé. Relancer le seed avec --appliquer.`);
if (DATE > fixture.valable_jusqu_au) avertissements.push(`Le jeu n'est valable que jusqu'au ${fixture.valable_jusqu_au} (factures non échues) : les chiffres « en retard » ne tiennent plus.`);

// Section (sujet du routeur de Lumi) de chaque outil : la liste tenue par l'audit des outils.
const parSection = JSON.parse(readFileSync(join(ICI, '..', 'lumi-tools', 'outils-par-section.json'), 'utf8')) as Record<string, Array<{ nom: string }>>;
const sectionDeLOutil = new Map<string, string>();
for (const [section, outils] of Object.entries(parSection)) for (const o of outils) sectionDeLOutil.set(o.nom, section);
/** Sans outil attendu, la section vient de la catégorie (les deux listes ne se recouvrent pas tout à fait). */
const SECTION_PAR_CATEGORIE: Record<string, string> = { aide: 'memoire', automatisations: 'rapports', transverse: 'memoire' };
const sectionDe = (c: CasLumi): string => (c.outil && sectionDeLOutil.get(c.outil)) || SECTION_PAR_CATEGORIE[c.categorie] || c.categorie;

function lire(racine: unknown, chemin: string): unknown {
  let o: unknown = racine;
  for (const k of chemin.split('.')) {
    if (o == null || typeof o !== 'object') return undefined;
    o = (o as Record<string, unknown>)[k];
  }
  return o;
}

const contexte: Record<string, unknown> = { ...fixture, dates: datesRelatives(DATE) };
const parCompte: Record<'proprietaire' | 'technicien', CasResolu[]> = { proprietaire: [], technicien: [] };
const ecartes: string[] = [];

for (const fichier of readdirSync(join(ICI, 'cas')).filter((f) => f.endsWith('.json')).sort()) {
  for (const c of JSON.parse(readFileSync(join(ICI, 'cas', fichier), 'utf8')) as CasLumi[]) {
    if (c.ecrit && !AVEC_ECRITURES) { ecartes.push(`${c.id} (écrit pour vrai)`); continue; }
    try {
      const r = (t: string): string => remplir(t, contexte, c.langue);
      const chiffres = (refs: string[] | undefined): ChiffreResolu[] | undefined => refs?.map((ref) => {
        const valeur = lire(contexte, ref);
        const unite = uniteDe(ref);
        if (typeof valeur !== 'number' || !unite) throw new Error(`chiffre ${ref} : valeur absente de la fiche des faits`);
        return { ref, valeur, unite };
      });
      const resolu: CasResolu = {
        ...c,
        section: sectionDe(c),
        q: r(c.q),
        ...(c.params ? { params: Object.fromEntries(Object.entries(c.params).map(([k, v]) => [k, typeof v === 'string' ? r(v) : v])) } : {}),
        ...(c.cible ? { cible: c.cible.map(r) } : {}),
        ...(c.reponse_contient ? { reponse_contient: c.reponse_contient.map(r) } : {}),
        ...(c.reponse_interdit ? { reponse_interdit: c.reponse_interdit.map(r) } : {}),
        ...(c.chiffres ? { chiffres_resolus: chiffres(c.chiffres) } : {}),
        ...(c.chiffres_interdits ? { chiffres_interdits_resolus: chiffres(c.chiffres_interdits) } : {}),
      };
      parCompte[c.compte ?? 'proprietaire'].push(resolu);
    } catch (e) {
      if (!PREVISIONNEL) throw new Error(`${c.id} : ${e instanceof Error ? e.message : String(e)}`);
      ecartes.push(`${c.id} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
}

for (const [compte, cas] of Object.entries(parCompte)) {
  const dossier = join(SORTIE, compte);
  mkdirSync(dossier, { recursive: true });
  writeFileSync(join(dossier, 'cas.json'), `${JSON.stringify(cas, null, 1)}\n`);
  console.log(`${String(cas.length).padStart(4)} cas pour le compte ${compte} → ${join(dossier, 'cas.json')}`);
}
if (ecartes.length) console.log(`\n${ecartes.length} cas écartés :\n - ${ecartes.join('\n - ')}`);
if (avertissements.length) console.log(`\nATTENTION :\n - ${avertissements.join('\n - ')}`);
const total = parCompte.proprietaire.length + parCompte.technicien.length;
console.log(`\nCoût estimé d'une passe : ${total} demandes × 1,4 ¢ ≈ ${((total * 1.4) / 100).toFixed(2).replace('.', ',')} $ (mesure du 2026-10-01, cache froid plus cher).`);
