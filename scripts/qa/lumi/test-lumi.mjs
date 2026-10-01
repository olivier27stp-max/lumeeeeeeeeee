#!/usr/bin/env node
/**
 * npm run test:lumi — LA commande de la mission « Lumi fiable » (phase 8).
 * ────────────────────────────────────────────────────────────────────────
 * Un seul verdict pour Lumi et l'agent de support, en trois étages :
 *
 *   1. DÉTERMINISTE (toujours, sans réseau, sans secret) — les tests statiques et
 *      unitaires de Lumi, du support, du MCP et du jeu d'évals. C'est cet étage
 *      qui tourne en CI et qui BLOQUE un déploiement.
 *   2. CRITIQUES + ROBUSTESSE (avec --prod) — les batteries jouées contre la
 *      production, dans un bureau de test au bac à sable (aucun envoi réel).
 *   3. ÉVALS (avec --prod) — les 220 demandes, jugées par du code.
 *
 *   npm run test:lumi                                  étage 1 seulement
 *   npm run test:lumi -- --prod --bureau eval2         les trois étages, bureau « [TEST] QA Lumi éval 2 »
 *        [--sans-evals] [--sans-critiques] [--sans-robustesse]
 *        [--sortie evals/lumi/resultats/test-lumi-<date>]   base des fichiers .json et .md (pour QA Smoke)
 *
 * Code de sortie : 0 = tout passe ; 1 = un test déterministe ou un test CRITIQUE
 * échoue (déploiement à bloquer) ; 2 = les évals sont sous le seuil ou la passe
 * n'est pas concluante (un autre modèle que prévu a répondu) ; 3 = erreur du lanceur.
 *
 * Un échec critique ne se « tolère » pas dans ce fichier. S'il relève d'une
 * décision du propriétaire, elle s'écrit dans scripts/qa/lumi/echecs-acceptes.json
 * (identifiant du test, justification, qui a décidé, date) et le rapport la montre.
 *
 * Coût de l'étage --prod : ≈ 3,50 $ d'inférence pour les évals, ≈ 0,40 $ pour les
 * critiques, ≈ 2 $ pour la robustesse — et UNE passe d'évals par bureau et par
 * jour (la garde quotidienne du bureau passe ensuite au modèle de repli).
 *
 * UN SEUL FLUX contre la production : les batteries se suivent, les lots d'évals aussi (≈ 50 minutes pour les
 * 221 demandes). Avant chaque batterie et chaque lot, /api/health est relu : si la base met plus de
 * LUMI_SEUIL_BASE_MS (1 500 ms) à répondre, rien n'est envoyé et le verdict est « non concluant ». Le 2026-10-01,
 * cinq lots en parallèle ont couché la base de production pendant 65 minutes.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const a = (k) => args.includes(k);
const v = (k, d) => { const i = args.indexOf(k); const x = i > -1 ? args[i + 1] : undefined; return x && !x.startsWith('--') ? x : d; };

const BUREAUX = {
  zz: { org: '93daa0c7-b749-4200-9755-dbeee62ce32d', cas: 'evals/lumi/cas-resolus', proprios: ['eval.proprio1@lume-qa.test', 'eval.proprio2@lume-qa.test', 'eval.proprio3@lume-qa.test', 'qa.map.owner@lume.test'], tech: 'qa.lumi.tech@lume.test' },
  eval2: { org: '5930d318-b207-40f3-9e14-f8898a02e240', cas: 'evals/lumi/cas-resolus-eval2', proprios: [1, 2, 3, 4].map((n) => `eval2.proprio${n}@lume-qa.test`), tech: 'eval2.tech@lume-qa.test' },
  eval3: { org: '7f859087-0f5e-4604-8a20-315be43be4c3', cas: 'evals/lumi/cas-resolus-eval3', proprios: [1, 2, 3, 4].map((n) => `eval3.proprio${n}@lume-qa.test`), tech: 'eval3.tech@lume-qa.test' },
};
/** Seuil des évals : sous ce taux de réussite, le verdict n'est pas « prêt ». Relevé par la mission après chaque passe propre. */
const SEUIL_EVALS_PCT = Number(process.env.LUMI_SEUIL_EVALS_PCT ?? 90);
const ENV_FILE = process.env.LUMI_ENV_FILE ?? join(RACINE, '.env.local');

const PROD = a('--prod');
const date = new Date().toISOString().slice(0, 10);
const SORTIE = resolve(RACINE, v('--sortie', `evals/lumi/resultats/test-lumi-${date}`));
mkdirSync(dirname(SORTIE), { recursive: true });

const lireJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const acceptes = lireJson(join(RACINE, 'scripts/qa/lumi/echecs-acceptes.json')) ?? [];
const estAccepte = (id) => acceptes.find((e) => e.id === id && e.justification && e.decide_par && e.date);

const rapport = { date: new Date().toISOString(), commit: null, prod: PROD, bureau: null, deterministe: null, critiques: null, robustesse: null, evals: null, verdict: 'PASS', raisons: [] };
try { rapport.commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: RACINE, encoding: 'utf8' }).stdout.trim() || null; } catch { /* hors dépôt */ }
const echec = (code, raison) => { rapport.raisons.push(raison); if (rapport.verdict === 'PASS' || code === 1) rapport.verdict = code === 1 ? 'FAIL' : 'NON CONCLUANT'; };

/**
 * La base de production répond-elle vite ? Relu avant CHAQUE batterie et chaque lot : au-dessus du seuil, rien
 * n'est envoyé et le verdict est « non concluant » (code 3) — jamais une batterie lancée sur une prod qui peine.
 */
const SEUIL_BASE_MS = Number(process.env.LUMI_SEUIL_BASE_MS ?? 1500);
async function prodRepond(etape) {
  const lire = async () => { try { const r = await fetch('https://lumecrm.net/api/health', { signal: AbortSignal.timeout(10_000) }); const j = await r.json(); return Number.isFinite(j.db_ms) ? Math.round(j.db_ms) : Infinity; } catch { return Infinity; } };
  let ms = await lire();
  if (ms > SEUIL_BASE_MS) { await new Promise((r) => setTimeout(r, 20_000)); ms = await lire(); }
  if (ms <= SEUIL_BASE_MS) return true;
  rapport.raisons.push(`arrêt avant « ${etape} » : la base de production répond en ${ms === Infinity ? 'plus de 10 s' : `${ms} ms`} (seuil ${SEUIL_BASE_MS} ms) — rien n'a été envoyé`);
  rapport.verdict = rapport.verdict === 'FAIL' ? 'FAIL' : 'NON CONCLUANT';
  rapport.prod_lente = true;
  return false;
}

function lancer(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { cwd: RACINE, encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status ?? 1, sortie: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// ── 1. Déterministe ───────────────────────────────────────────────────────
{
  const fichier = `${SORTIE}.deterministe.json`;
  // Les fichiers sont énumérés ici : passé tel quel, un motif à étoile n'est pas développé par l'interpréteur de commandes de Windows.
  const motifs = [...readdirSync(join(RACINE, 'tests')).filter((f) => /^(lumi-|mcp-refs-|evals-lumi-).*[.]test[.]tsx?$/.test(f)).sort().map((f) => `tests/${f}`), 'tests/support'];
  const r = lancer('npx', ['vitest', 'run', ...motifs, '--maxWorkers=4', '--passWithNoTests', '--reporter=json', `--outputFile=${fichier}`]);
  const j = lireJson(fichier);
  rapport.deterministe = j
    ? { fichiers: j.numTotalTestSuites, tests: j.numTotalTests, reussis: j.numPassedTests, echecs: j.numFailedTests, en_attente: j.numTodoTests + j.numPendingTests,
        echoues: (j.testResults ?? []).flatMap((f) => (f.assertionResults ?? []).filter((t) => t.status === 'failed').map((t) => `${f.name.split(/[\\/]tests[\\/]/).pop()} › ${t.fullName}`)).slice(0, 50) }
    : { erreur: r.sortie.slice(-2000) };
  if (!j || j.numFailedTests > 0 || r.code !== 0) echec(1, `tests déterministes : ${j ? j.numFailedTests : '?'} échec(s)`);
}

// ── 2 et 3. Contre la production ──────────────────────────────────────────
if (PROD) {
  const nom = v('--bureau', 'eval2');
  const bureau = BUREAUX[nom];
  if (!bureau) { console.error(`--bureau inconnu : ${nom} (zz, eval2, eval3)`); process.exit(3); }
  if (!existsSync(ENV_FILE)) { console.error(`fichier d'environnement absent : ${ENV_FILE} (LUMI_ENV_FILE)`); process.exit(3); }
  rapport.bureau = nom;
  const node = (script, argv) => lancer('node', [`--env-file=${ENV_FILE}`, '--import', 'tsx', script, ...argv]);

  if (!a('--sans-critiques') && await prodRepond('tests critiques')) {
    const base = `${SORTIE}.critiques`;
    // La batterie se joue famille par famille, un compte propriétaire par groupe, pour tenir sous 60 tours par heure et par personne.
    // Cette batterie est liée au banc « ZZ QA Champs » (bureau A) et à « Grok Audit (TEST) » (bureau B, lecture
    // seule) : elle y joue toujours, avec les comptes du banc, quel que soit --bureau.
    const groupes = [['isolation,roles', 0], ['memoire,idempotence,injection', 1], ['actions,exactitude', 2], ['credits,loi25', 3]];
    for (const [familles, i] of groupes) node('scripts/qa/lumi/critiques/run.mts', ['--famille', familles, '--proprietaire', BUREAUX.zz.proprios[i], '--malgre-activite', '--sortie', base]);
    const j = lireJson(`${base}.json`);
    const res = j?.resultats ?? [];
    const fails = res.filter((t) => t.verdict === 'FAIL');
    rapport.critiques = j ? { tests: res.length, pass: res.filter((t) => t.verdict === 'PASS').length, fail: fails.length, non_couvert: res.filter((t) => t.verdict === 'NON COUVERT').length, a_relire: res.filter((t) => t.verdict === 'A RELIRE').length, echecs: fails.map((t) => ({ id: t.id, accepte: estAccepte(t.id)?.justification ?? null })) } : { erreur: 'aucun résultat' };
    const bloquants = fails.filter((t) => !estAccepte(t.id));
    if (!j) echec(1, 'tests critiques : aucun résultat');
    else if (bloquants.length) echec(1, `tests critiques : ${bloquants.map((t) => t.id).join(', ')}`);
  }

  if (!a('--sans-robustesse') && !rapport.prod_lente && existsSync(join(RACINE, 'scripts/qa/lumi/robustesse/run.mts')) && await prodRepond('robustesse')) {
    const base = `${SORTIE}.robustesse`;
    node('scripts/qa/lumi/robustesse/run.mts', ['--org', bureau.org, '--sortie', base]);
    const j = lireJson(`${base}.json`);
    const res = j?.resultats ?? [];
    const fails = res.filter((t) => t.verdict === 'FAIL');
    rapport.robustesse = j ? { tests: res.length, pass: res.filter((t) => t.verdict === 'PASS').length, fail: fails.length, non_couvert: res.filter((t) => t.verdict === 'NON COUVERT').length, a_relire: res.filter((t) => t.verdict === 'A RELIRE').length, echecs: fails.map((t) => ({ id: t.id, accepte: estAccepte(t.id)?.justification ?? null })) } : { erreur: 'aucun résultat' };
    const bloquants = fails.filter((t) => !estAccepte(t.id));
    if (!j) echec(1, 'robustesse : aucun résultat');
    else if (bloquants.length) echec(1, `robustesse : ${bloquants.map((t) => t.id).join(', ')}`);
  }

  if (!a('--sans-evals') && !rapport.prod_lente) {
    const dossier = `${SORTIE}.evals`;
    mkdirSync(dossier, { recursive: true });
    // UN lot à la fois. Le 2026-10-01, cinq lots en parallèle (avec deux autres batteries) ont couché la base de
    // production pendant 65 minutes : elle tourne sur une petite machine. La passe prend ≈ 50 minutes au lieu de 13.
    const lots = [...bureau.proprios.map((compte, i) => ({ compte, cas: `${bureau.cas}/proprietaire-lot${i + 1}`, sortie: `${dossier}/lot${i + 1}.json` })), { compte: bureau.tech, cas: `${bureau.cas}/technicien`, sortie: `${dossier}/technicien.json` }];
    for (const l of lots) {
      if (!(await prodRepond(`évals, ${l.compte}`))) break;
      node('evals/lumi-tools/run.mts', ['--prod', '--org', bureau.org, '--compte', l.compte, '--cas', l.cas, '--sortie', l.sortie]);
    }
    const bilan = `${dossier}/bilan.json`;
    lancer('npx', ['tsx', 'evals/lumi/corriger.mts', '--cas', bureau.cas, '--resultats', lots.map((l) => l.sortie).join(','), '--sortie', bilan]);
    const j = lireJson(bilan);
    rapport.evals = j ? { cas: j.global?.cas, reussite_pct: j.global?.reussite_pct, outil_exact_pct: j.global?.outil_exact_pct, sensibles_pct: j.sensibles?.reussite_pct, erreurs: j.global?.erreurs, cout_cents: j.global?.cout_cents, concluante: j.conditions?.concluante ?? null, par_moteur: j.conditions?.par_moteur ?? j.par_moteur ?? null, seuil_pct: SEUIL_EVALS_PCT, echecs: (j.echecs ?? []).map((e) => e.id) } : { erreur: 'aucun bilan' };
    if (!j) echec(2, 'évals : aucun bilan');
    else if (j.conditions && j.conditions.concluante === false) echec(2, 'évals : passe non concluante (un autre modèle que prévu a répondu)');
    else if ((j.global?.reussite_pct ?? 0) < SEUIL_EVALS_PCT) echec(2, `évals : ${j.global?.reussite_pct} % de réussite, sous le seuil de ${SEUIL_EVALS_PCT} %`);
  }
}

// ── Sorties ────────────────────────────────────────────────────────────────
writeFileSync(`${SORTIE}.json`, JSON.stringify(rapport, null, 2));
const l = [];
l.push(`# test:lumi — ${rapport.verdict}`, '', `${rapport.date} · commit ${rapport.commit ?? '?'}${PROD ? ` · production, bureau ${rapport.bureau}` : ' · hors réseau'}`, '');
if (rapport.raisons.length) l.push('## Pourquoi', '', ...rapport.raisons.map((r) => `- ${r}`), '');
l.push('| Étage | Résultat |', '|---|---|');
const d = rapport.deterministe;
l.push(`| Déterministe | ${d?.erreur ? 'erreur du lanceur' : `${d.reussis}/${d.tests} tests, ${d.echecs} échec(s), ${d.en_attente} en attente`} |`);
for (const [nom, b] of [['Critiques', rapport.critiques], ['Robustesse', rapport.robustesse]]) {
  if (b) l.push(`| ${nom} | ${b.erreur ?? `${b.pass} PASS, ${b.fail} FAIL, ${b.non_couvert} NON COUVERT, ${b.a_relire} À RELIRE sur ${b.tests}`} |`);
  else if (PROD) l.push(`| ${nom} | non joué |`);
}
if (rapport.evals) l.push(`| Évals | ${rapport.evals.erreur ?? `${rapport.evals.reussite_pct} % de réussite sur ${rapport.evals.cas} (seuil ${SEUIL_EVALS_PCT} %), bon outil ${rapport.evals.outil_exact_pct} %, actions sensibles ${rapport.evals.sensibles_pct} %, ${rapport.evals.erreurs} erreur(s)`} |`);
if (!PROD) l.push('', 'Étages contre la production non joués : `npm run test:lumi -- --prod --bureau eval2`.');
if (d?.echoues?.length) l.push('', '## Tests déterministes en échec', '', ...d.echoues.map((t) => `- ${t}`));
for (const [nom, b] of [['critiques', rapport.critiques], ['de robustesse', rapport.robustesse]]) if (b?.echecs?.length) l.push('', `## Tests ${nom} en échec`, '', ...b.echecs.map((e) => `- ${e.id}${e.accepte ? ` — accepté : ${e.accepte}` : ''}`));
if (rapport.evals?.echecs?.length) l.push('', '## Cas d’éval en échec', '', rapport.evals.echecs.join(', '));
writeFileSync(`${SORTIE}.md`, `${l.join('\n')}\n`);
console.log(l.join('\n'));
console.log(`\nRapports : ${SORTIE}.json · ${SORTIE}.md`);
process.exit(rapport.verdict === 'PASS' ? 0 : rapport.verdict === 'FAIL' ? 1 : 2);
