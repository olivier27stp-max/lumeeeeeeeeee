/**
 * Corrige une passe : relit ce que le runner a observé (evals/lumi-tools/run.mts)
 * et applique les contrôles du jeu (format.mts). Ni base, ni réseau, ni modèle.
 *
 *   npx tsx evals/lumi/corriger.mts --resultats evals/lumi/resultats/proprietaire.json[,evals/lumi/resultats/technicien.json]
 *        [--cas evals/lumi/cas-resolus] [--sortie evals/lumi/resultats/bilan.json]
 *
 * Sort : le taux de réussite global et par catégorie, nature, registre, compte ;
 * le coût (somme et par demande) ; chaque échec avec sa raison ; et la liste des
 * cas « à juger » (ton, clarté) avec leur critère et la réponse de Lumi, pour un
 * juge humain ou LLM — le correcteur ne note pas le ton.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corriger, type CasResolu, type Observation, type Verdict } from './format.mts';

const ICI = dirname(fileURLToPath(import.meta.url));
const arg = (k: string, d: string): string => { const i = process.argv.indexOf(k); const v = i > -1 ? process.argv[i + 1] : undefined; return v && !v.startsWith('--') ? v : d; };

const RESULTATS = arg('--resultats', '').split(',').map((x) => x.trim()).filter(Boolean);
const DOSSIER_CAS = arg('--cas', join(ICI, 'cas-resolus'));
const SORTIE = arg('--sortie', '');
if (!RESULTATS.length) { console.error('--resultats <fichier.json>[,<fichier.json>] requis (sortie de evals/lumi-tools/run.mts).'); process.exit(1); }

/** Ce que le runner écrit pour chaque cas (on n'en lit que ce qui sert). */
interface ResultatRunner extends Observation { id: string; cout_cents?: number; duree_ms?: number }

const cas = new Map<string, CasResolu>();
for (const compte of ['proprietaire', 'technicien']) {
  const f = join(DOSSIER_CAS, compte, 'cas.json');
  if (!existsSync(f)) continue;
  for (const c of JSON.parse(readFileSync(f, 'utf8')) as CasResolu[]) cas.set(c.id, c);
}
if (!cas.size) { console.error(`Aucun cas résolu dans ${DOSSIER_CAS} : lancer preparer.mts d'abord.`); process.exit(1); }

interface Ligne { cas: CasResolu; verdict: Verdict; cout_cents: number; duree_ms: number; reponse: string; outils: string[] }
const lignes: Ligne[] = [];
const inconnus: string[] = [];
for (const fichier of RESULTATS) {
  const lus = JSON.parse(readFileSync(fichier, 'utf8')) as { resultats: ResultatRunner[] };
  for (const r of lus.resultats) {
    const c = cas.get(r.id);
    if (!c) { inconnus.push(r.id); continue; }
    lignes.push({
      cas: c, verdict: corriger(c, r), cout_cents: Number(r.cout_cents) || 0, duree_ms: Number(r.duree_ms) || 0, reponse: r.reponse ?? '',
      outils: [r.proposition, ...(r.groupe ?? []), ...(r.lectures ?? [])].filter((x): x is string => Boolean(x)),
    });
  }
}
const joues = new Set(lignes.map((l) => l.cas.id));
const nonJoues = [...cas.keys()].filter((id) => !joues.has(id));

const pct = (n: number, d: number): number => (d ? Math.round((n / d) * 1000) / 10 : 0);
function bilan(ls: Ligne[]) {
  const cout = ls.reduce((s, l) => s + l.cout_cents, 0);
  return {
    cas: ls.length,
    reussis: ls.filter((l) => l.verdict.reussi).length,
    reussite_pct: pct(ls.filter((l) => l.verdict.reussi).length, ls.length),
    outil_exact_pct: pct(ls.filter((l) => l.verdict.outil === 'exact').length, ls.length),
    erreurs: ls.filter((l) => l.verdict.outil === 'erreur').length,
    cout_cents: Math.round(cout * 100) / 100,
    cout_par_demande_cents: ls.length ? Math.round((cout / ls.length) * 1000) / 1000 : 0,
    duree_mediane_ms: ls.length ? [...ls].sort((a, b) => a.duree_ms - b.duree_ms)[Math.floor(ls.length / 2)].duree_ms : 0,
  };
}
const par = (cle: (l: Ligne) => string): Record<string, ReturnType<typeof bilan>> => {
  const groupes = new Map<string, Ligne[]>();
  for (const l of lignes) groupes.set(cle(l), [...(groupes.get(cle(l)) ?? []), l]);
  return Object.fromEntries([...groupes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, bilan(v)]));
};

const rapport = {
  date: new Date().toISOString(),
  resultats: RESULTATS,
  global: bilan(lignes),
  par_categorie: par((l) => l.cas.categorie),
  par_nature: par((l) => l.cas.nature),
  par_registre: par((l) => l.cas.registre),
  par_compte: par((l) => l.cas.compte ?? 'proprietaire'),
  sensibles: bilan(lignes.filter((l) => l.cas.sensible)),
  regressions: lignes.filter((l) => l.cas.regression).map((l) => ({ id: l.cas.id, regression: l.cas.regression, reussi: l.verdict.reussi, echecs: l.verdict.echecs, outils: l.outils })),
  echecs: lignes.filter((l) => !l.verdict.reussi).map((l) => ({ id: l.cas.id, categorie: l.cas.categorie, nature: l.cas.nature, q: l.cas.q, outil_attendu: l.cas.outil, outils: l.outils, echecs: l.verdict.echecs, reponse: l.reponse.slice(0, 600) })),
  non_verifie: lignes.filter((l) => l.verdict.non_verifie.length).map((l) => ({ id: l.cas.id, non_verifie: l.verdict.non_verifie })),
  a_juger: lignes.filter((l) => l.verdict.a_juger).map((l) => ({ id: l.cas.id, q: l.cas.q, critere: l.cas.critere_juge, controles_par_code: l.verdict.reussi ? 'réussis' : l.verdict.echecs, reponse: l.reponse })),
  non_joues: nonJoues,
  resultats_sans_cas: inconnus,
};

const ligne = (nom: string, b: ReturnType<typeof bilan>): string =>
  `${nom.padEnd(16)} ${String(b.cas).padStart(4)} cas · réussite ${String(b.reussite_pct).padStart(5)} % · bon outil ${String(b.outil_exact_pct).padStart(5)} % · erreurs ${b.erreurs} · ${(b.cout_cents / 100).toFixed(2)} $ (${b.cout_par_demande_cents} ¢/demande) · médiane ${b.duree_mediane_ms} ms`;
console.log(ligne('GLOBAL', rapport.global));
console.log(ligne('sensibles', rapport.sensibles));
for (const [titre, groupe] of [['Par catégorie', rapport.par_categorie], ['Par nature', rapport.par_nature], ['Par registre', rapport.par_registre], ['Par compte', rapport.par_compte]] as const) {
  console.log(`\n${titre}`);
  for (const [k, b] of Object.entries(groupe)) console.log(ligne(k, b));
}
console.log('\nCas de régression');
for (const r of rapport.regressions) console.log(`  ${r.reussi ? 'CORRIGÉ ' : 'PRÉSENT '} ${r.id} — ${r.regression}${r.reussi ? '' : ` — ${r.echecs.join(' ; ')}`}`);
console.log(`\n${rapport.echecs.length} échec(s)`);
for (const e of rapport.echecs) console.log(`  ${e.id} : ${e.echecs.join(' ; ')}`);
console.log(`\n${rapport.a_juger.length} cas à juger (ton, clarté) — non notés ici.`);
if (nonJoues.length) console.log(`${nonJoues.length} cas préparés mais absents des résultats : ${nonJoues.slice(0, 10).join(', ')}${nonJoues.length > 10 ? '…' : ''}`);
if (inconnus.length) console.log(`${inconnus.length} résultat(s) sans cas correspondant (cas modifiés depuis la passe ?) : ${inconnus.slice(0, 10).join(', ')}`);
if (SORTIE) { writeFileSync(SORTIE, `${JSON.stringify(rapport, null, 1)}\n`); console.log(`\nBilan écrit : ${SORTIE}`); }
