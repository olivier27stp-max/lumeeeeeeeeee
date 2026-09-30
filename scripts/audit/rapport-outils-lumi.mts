/**
 * Génère LUMI_TOOLS_AUDIT.md : la matrice des outils de Lumi (depuis le code),
 * les constats de l'audit avec leur statut, et les résultats d'évaluation.
 *
 *   npx tsx scripts/audit/inventaire-outils-lumi.mts --json evals/lumi-tools/inventaire.json
 *   npx tsx scripts/audit/rapport-outils-lumi.mts [--avant evals/lumi-tools/resultats/avant.json] [--apres evals/lumi-tools/resultats/apres.json]
 *
 * Sources : TOOLS_BY_NAME, garde (permissions, financiers), registre des
 * écritures, topics, préréglages de rôle, source des handlers (inventaire),
 * docs/audits/outils-lumi/*.md (constats) + statuts.json, résultats d'éval.
 * Les parties rédigées à la main vivent dans docs/audits/outils-lumi/rapport-*.md
 * et sont insérées telles quelles.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { JAMAIS_D_OFFICE, REGISTRE_ECRITURES } from '../../server/lib/agent/registre';
import { lireConstats } from './constats-outils-lumi.mts';

const RACINE = resolve(import.meta.dirname, '../..');
const arg = (k: string, d: string) => { const i = process.argv.indexOf(k); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const lire = (p: string) => (existsSync(resolve(RACINE, p)) ? readFileSync(resolve(RACINE, p), 'utf8') : '');

// 1. Inventaire : à régénérer juste avant (npx tsx scripts/audit/inventaire-outils-lumi.mts --json evals/lumi-tools/inventaire.json).
const cheminInv = resolve(RACINE, 'evals/lumi-tools/inventaire.json');
const inventaire = JSON.parse(readFileSync(cheminInv, 'utf8')) as any[];

// 2. Constats + statuts.
const statuts = JSON.parse(lire('docs/audits/outils-lumi/statuts.json') || '{}') as Record<string, { statut: string; vague: string; note: string }>;
const constats = lireConstats().map((c) => ({ ...c, st: statuts[`${c.fichier}:${c.ligne}`] ?? { statut: 'ouvert', vague: '', note: '' } }));
const ICONE: Record<string, string> = { corrigé: '✅', partiel: '🟡', ouvert: '❌', décision: '❓' };
const parOutil = new Map<string, typeof constats>();
for (const c of constats) for (const o of c.outils) { if (!parOutil.has(o)) parOutil.set(o, []); parOutil.get(o)!.push(c); }

// 3. Évaluation.
const evalDe = (p: string) => { const t = lire(p); return t ? JSON.parse(t) : null; };
const avant = evalDe(arg('--avant', 'evals/lumi-tools/resultats/avant.json'));
const apres = evalDe(arg('--apres', 'evals/lumi-tools/resultats/apres.json'));

const md: string[] = [];
const p = (s = '') => md.push(s);
const cell = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

p('# Audit final des outils de Lumi');
p();
p(`Généré le ${new Date().toISOString().slice(0, 10)} par \`scripts/audit/rapport-outils-lumi.mts\` depuis le code de la branche \`feat/audit-outils-lumi\`. Les parties rédigées viennent de \`docs/audits/outils-lumi/rapport-*.md\`.`);
p();
const n = (f: (x: any) => boolean) => inventaire.filter(f).length;
const actions = inventaire.filter((x) => x.genre === 'action');
p(`**${inventaire.length} outils** : ${actions.length} actions (dont ${n((x) => x.genre === 'action' && x.sensible)} sensibles) et ${n((x) => x.genre === 'lecture')} lectures. **${constats.length} constats** : ${['critique', 'élevé', 'moyen', 'bas'].map((s) => `${constats.filter((c) => c.severite === s).length} ${s}`).join(', ')}. Statut : ${Object.entries(ICONE).map(([k, i]) => `${i} ${constats.filter((c) => c.st.statut === k).length} ${k}`).join(' · ')}.`);
p();
p(lire('docs/audits/outils-lumi/rapport-resume.md'));

// ── Livrable 1 : la matrice ──
p('## 1. Matrice des outils');
p();
p('Légende. **Carte** : `toujours` = jamais exécutée sans carte, quel que soit le mode (argent, envoi au client, irréversible, droits) ; `mode` = carte en mode « demander » et « argent » pour une action sensible, d\'office en mode « tout » ; `d\'office` = exécutée sans carte (mémoire de Lumi seulement). **Garde** : clé de la page Rôles vérifiée par le serveur (`garde.ts`) avant tout handler ; `$` = outil financier (masqué à qui ne voit pas les montants). **Service** : route de l\'app, RPC, ou écriture directe à l\'identité de l\'utilisateur (RLS). **Constats** : ✅ corrigé · 🟡 partiel · ❌ ouvert · ❓ décision.');
p();
p('| Outil | Section | Genre | Sensible | Garde (préréglages) | Carte | Réversible | Idempotent | Service | Tests | Constats |');
p('|---|---|---|---|---|---|---|---|---|---|---|');
const ordre = [...inventaire].sort((a, b) => a.topic.localeCompare(b.topic) || a.genre.localeCompare(b.genre) || a.nom.localeCompare(b.nom));
for (const x of ordre) {
  const reg = REGISTRE_ECRITURES[x.nom];
  const carte = x.genre === 'lecture' ? '—' : reg?.anodine ? 'd\'office' : JAMAIS_D_OFFICE.has(x.nom) ? 'toujours' : 'mode';
  const roles = x.presets ? Object.entries(x.presets).filter(([, v]) => v).map(([r]) => ({ owner: 'P', admin: 'A', sales_rep: 'V', technician: 'T' } as Record<string, string>)[r]).join('') : '';
  const garde = x.permission ? `\`${x.permission}\`${x.financier ? ' $' : ''} (${roles})` : (x.financier ? '$' : '—');
  const service = x.routes_app.length ? `route ${x.routes_app.slice(0, 2).join(', ')}` : x.rpc.length ? `RPC ${x.rpc.slice(0, 2).join(', ')}` : x.tables_ecrites.length ? `direct ${x.tables_ecrites.slice(0, 2).join(', ')}` : (x.genre === 'lecture' ? 'lecture' : '—');
  const cs = parOutil.get(x.nom) ?? [];
  const resume = cs.length ? cs.map((c) => `${ICONE[c.st.statut] ?? '❌'}${c.severite[0].toUpperCase()}`).join(' ') : '';
  p(`| \`${x.nom}\` | ${x.topic} | ${x.genre} | ${x.genre === 'action' ? (x.sensible ? `oui${x.categorie ? ` (${x.categorie})` : ''}` : 'non') : '—'} | ${cell(garde)} | ${carte} | ${x.genre === 'action' ? (reg?.reversible === false ? 'non' : 'oui') : '—'} | ${x.genre === 'action' ? (x.idempotent ? 'oui' : 'non') : '—'} | ${cell(service)} | ${x.tests.length} | ${resume} |`);
}
p();
p('Préréglages : P propriétaire · A admin · V vendeur · T technicien (lettre présente = la clé est accordée par défaut). Les écarts entre la garde de Lumi et l\'écran sont listés en section 3.');
p();

// ── Livrable 2 : bugs par sévérité ──
p('## 2. Bugs par sévérité, et leur correction');
p();
for (const sev of ['critique', 'élevé', 'moyen', 'bas']) {
  const liste = constats.filter((c) => c.severite === sev);
  if (!liste.length) continue;
  p(`### ${sev[0].toUpperCase()}${sev.slice(1)} (${liste.length})`);
  p();
  p('| Statut | Outils | Constat | Correction apportée | Vague |');
  p('|---|---|---|---|---|');
  for (const c of liste) p(`| ${ICONE[c.st.statut] ?? '❌'} ${c.st.statut} | ${cell(c.outils.join(', ') || '(transversal)')} | ${cell(c.constat)} | ${cell(c.st.note)} | ${c.st.vague} |`);
  p();
}
p(lire('docs/audits/outils-lumi/rapport-bugs-hors-tableaux.md'));

// ── Livrables 3 à 7 : parties rédigées + éval ──
p(lire('docs/audits/outils-lumi/rapport-permissions.md'));

p('## 4. Évaluation avant / après');
p();
p('Jeu : `evals/lumi-tools/cas/` (456 cas : 3 par action sensible — français, anglais, désambiguïsation ou clarification —, 1 par autre action, 1 par lecture). Runner : `evals/lumi-tools/run.mts` (mode « demander » : aucune écriture ne s\'exécute ; serveurs d\'éval sans aucun identifiant d\'envoi). « Avant » = `origin/main` au moment de l\'audit ; « après » = cette branche.');
p();
const ligneEval = (nom: string, a: any, b: any) => {
  const f = (x: any, k: string, suf = '') => (x && x[k] != null ? `${x[k]}${suf}` : '—');
  return `| ${nom} | ${f(a, 'cas')} | ${f(a, 'exactitude_outil_pct', ' %')} → **${f(b, 'exactitude_outil_pct', ' %')}** | ${f(a, 'exactitude_params_pct', ' %')} → **${f(b, 'exactitude_params_pct', ' %')}** | ${f(a, 'clarification_pct', ' %')} → **${f(b, 'clarification_pct', ' %')}** | ${f(a, 'faux_fait')} → **${f(b, 'faux_fait')}** | ${f(a, 'interdits_proposes')} → **${f(b, 'interdits_proposes')}** |`;
};
if (avant || apres) {
  p('| Portée | Cas | Outil exact | Paramètres + cible sur la carte | Clarification | Faux « c\'est fait » | Outil interdit proposé |');
  p('|---|---|---|---|---|---|---|');
  p(ligneEval('**Global**', avant?.bilan.global, apres?.bilan.global));
  p(ligneEval('**Sensibles**', avant?.bilan.sensibles, apres?.bilan.sensibles));
  for (const t of ['action', 'lecture', 'clarification']) p(ligneEval(t, avant?.bilan.par_type[t], apres?.bilan.par_type[t]));
  const sections = [...new Set([...Object.keys(avant?.bilan.par_section ?? {}), ...Object.keys(apres?.bilan.par_section ?? {})])].sort();
  for (const s of sections) p(ligneEval(s, avant?.bilan.par_section[s], apres?.bilan.par_section[s]));
  p();
} else {
  p('_Résultats absents : lancer le runner (voir en-tête de run.mts)._');
  p();
}
p(lire('docs/audits/outils-lumi/rapport-eval.md'));

p('## 5. Coûts API');
p();
if (avant || apres) {
  p('| Portée | Avant ($ / 1000 demandes) | Après ($ / 1000 demandes) |');
  p('|---|---|---|');
  const c = (x: any) => (x ? `${x.cout_par_1000_dollars} $` : '—');
  p(`| **Global** | ${c(avant?.bilan.global)} | **${c(apres?.bilan.global)}** |`);
  for (const t of ['action', 'lecture', 'clarification']) p(`| ${t} | ${c(avant?.bilan.par_type[t])} | ${c(apres?.bilan.par_type[t])} |`);
  const sections = [...new Set([...Object.keys(avant?.bilan.par_section ?? {}), ...Object.keys(apres?.bilan.par_section ?? {})])].sort();
  for (const s of sections) p(`| ${s} | ${c(avant?.bilan.par_section[s])} | ${c(apres?.bilan.par_section[s])} |`);
  p();
}
p(lire('docs/audits/outils-lumi/rapport-couts.md'));
p(lire('docs/audits/outils-lumi/rapport-migrations.md'));
p(lire('docs/audits/outils-lumi/rapport-non-garanti.md'));

writeFileSync(resolve(RACINE, 'LUMI_TOOLS_AUDIT.md'), md.join('\n'));
console.log(`LUMI_TOOLS_AUDIT.md : ${inventaire.length} outils, ${constats.length} constats, éval ${avant ? 'avant ' : ''}${apres ? 'après' : ''}`);
