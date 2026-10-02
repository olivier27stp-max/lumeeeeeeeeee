/**
 * Agent E — quelles variables ont RÉELLEMENT une valeur, selon la fiche que le déclencheur
 * fait arriver ? On appelle le vrai `resolveEntityVariables` du moteur sur les fiches semées
 * dans mon bureau A (scripts/qa/finale/e/semer-bureau.mts) et on relève les clés remplies.
 *
 *   QA_AUTO_SUFFIXE=e PUBLIC_URL=http://127.0.0.1:5495 npx tsx --env-file=.env.local scripts/qa/finale/e/releve-variables-par-entite.mts
 *
 * Sortie : D:/lume-final/sorties/e/variables-par-entite.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { assurerBureauTest } from '../../../../tests/automations-suite/harnais/bureau-test';
import { resolveEntityVariables } from '../../../../server/lib/actions/index';
import { ENTITE_PAR_DECLENCHEUR } from '../../../../src/lib/automationCatalogue';
import { VARIABLES_CONNUES, VARIABLES_POINTEES_CONNUES } from '../../../../src/lib/emailBodyText';

if (!/localhost|127\.0\.0\.1/.test(process.env.VITE_SUPABASE_URL ?? '')) throw new Error('REFUS : pile LOCALE seulement.');
const b = await assurerBureauTest();
const seme = JSON.parse(readFileSync('D:/lume-final/sorties/e/semer-bureau.json', 'utf8')) as { fiches: Record<string, string> };

const FICHES: Array<[string, string]> = [
  ['client', seme.fiches.client], ['lead', seme.fiches.prospect], ['quote', seme.fiches.devis],
  ['invoice', seme.fiches.facture], ['job', seme.fiches.job], ['schedule_event', seme.fiches.visite],
];
const parEntite: Record<string, { remplies: string[]; vides: string[] }> = {};
for (const [type, id] of FICHES) {
  const vars = await resolveEntityVariables(b.admin, b.orgA, type, id);
  const remplies = Object.keys(vars).filter((k) => String(vars[k] ?? '').trim() !== '').sort();
  const vides = Object.keys(vars).filter((k) => String(vars[k] ?? '').trim() === '').sort();
  parEntite[type] = { remplies, vides };
}
const toutes = [...new Set(Object.values(parEntite).flatMap((e) => [...e.remplies, ...e.vides]))].sort();
const classiques = toutes.filter((k) => !k.includes('_cf_') && !k.includes('.'));
const declencheurs = Object.fromEntries(Object.entries(ENTITE_PAR_DECLENCHEUR).map(([d, e]) => [d, e]));

const sortie = {
  quand: new Date().toISOString(),
  par_entite: Object.fromEntries(Object.entries(parEntite).map(([t, e]) => [t, {
    nb_remplies: e.remplies.length,
    classiques_remplies: e.remplies.filter((k) => !k.includes('_cf_') && !k.includes('.')),
    pointees_remplies: e.remplies.filter((k) => k.includes('.')),
    champs_fiche_remplis: e.remplies.filter((k) => k.includes('_cf_')).length,
    presentes_mais_vides: e.vides.filter((k) => !k.includes('_cf_')),
  }])),
  entite_par_declencheur: declencheurs,
  connues_de_l_editeur_jamais_produites_ici: VARIABLES_CONNUES.filter((v) => !classiques.includes(v)),
  pointees_connues: VARIABLES_POINTEES_CONNUES,
};
writeFileSync('D:/lume-final/sorties/e/variables-par-entite.json', JSON.stringify(sortie, null, 2));
for (const [t, e] of Object.entries(sortie.par_entite)) {
  console.log(`\n== ${t} : ${e.classiques_remplies.join(', ')}`);
  if (e.pointees_remplies.length) console.log(`   pointées : ${e.pointees_remplies.join(', ')}`);
  console.log(`   champs de fiche remplis : ${e.champs_fiche_remplis} ; présentes mais vides : ${e.presentes_mais_vides.join(', ') || '—'}`);
}
console.log('\nconnues de l’éditeur, jamais produites pour ces fiches :', sortie.connues_de_l_editeur_jamais_produites_ici.join(', '));
console.log('\nentité par déclencheur :', JSON.stringify(declencheurs));
