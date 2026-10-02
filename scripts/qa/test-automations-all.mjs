#!/usr/bin/env node
/**
 * npm run test:automations:all — TOUT ce qui prouve les automatisations, en UNE commande.
 *
 * Trois étages, dans cet ordre ; chacun écrit un résultat lisible par machine, et la commande
 * sort ≠ 0 dès qu'un seul test est rouge (c'est ce qui bloque un déploiement) :
 *
 *   1. SANS BASE    · les tests unitaires de la suite (`vitest.automations.config.ts`, projet
 *                     « unitaires ») ;
 *                   · les tests de composant et de logique de la correction finale
 *                     (`tests/automations-finale/**` que la suite du dépôt joue déjà).
 *   2. PILE LOCALE  · le canari d'abord, SEUL : rouge = un envoi réel serait possible, rien
 *                     d'autre ne tourne ;
 *                   · l'intégration et l'interface de la suite (`scripts/qa/test-automatisations.mjs`) ;
 *                   · les preuves par domaine (`tests/automations-finale/<lettre>/vitest.config.ts`).
 *   3. E2E          · les specs Playwright de la section (`e2e/automations/**`, lancées par
 *                     `scripts/qa/automations-e2e/lancer.mjs`), jugées par
 *                     `scripts/qa/automations-e2e/bilan.mjs`.
 *
 * NI STAGING, NI PROD : les étages 2 et 3 tournent contre la pile Docker locale
 * (`bash scripts/qa/automations-e2e/pile.sh`), avec un environnement construit à partir de rien
 * (`envLocal`) — aucune clé de `.env.local` n'entre dans la passe. Sans la pile, la commande
 * s'arrête et dit comment la monter ; elle ne se rabat jamais sur une base distante.
 *
 * Options :
 *   --sans-base           seulement l'étage 1 (aucun Docker : c'est ce que joue chaque PR)
 *   --integration         seulement l'étage 2
 *   --e2e                 seulement l'étage 3 ; `--shard=i/n` est passé à Playwright
 *   --zero-defaut         mode « prêt pour le launch » : un défaut connu encore ouvert (`@defaut`)
 *                         ou un test NON JOUÉ bloque aussi
 *   --avec-modele         laisse passer ANTHROPIC_API_KEY aux preuves qui interrogent le vrai
 *                         modèle (sinon elles sont NON JOUÉES — jamais comptées vertes)
 *   --sortie <dossier>    où écrire les rapports de travail (défaut : dossier temporaire, HORS du
 *                         dépôt : Vite rechargerait en boucle)
 *
 * Sorties : rapports/automatisations-all/resultats.json et RAPPORT.md (écrits à la FIN).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PILE, envLocal } from './automations-e2e/local.mjs';

const args = process.argv.slice(2);
const a = (nom) => args.includes(`--${nom}`);
const valeur = (nom) => { const i = args.indexOf(`--${nom}`); return i >= 0 ? args[i + 1] : undefined; };
const shard = args.find((x) => x.startsWith('--shard='));
const zeroDefaut = a('zero-defaut');
const seulement = ['sans-base', 'integration', 'e2e'].filter(a);
const etages = seulement.length ? seulement : ['sans-base', 'integration', 'e2e'];

const racine = process.cwd();
const sorties = resolve(valeur('sortie') || join(tmpdir(), 'lume-automations-all'));
if (sorties.toLowerCase().startsWith(racine.toLowerCase())) {
  console.error(`--sortie (${sorties}) est DANS le dépôt : Vite rechargerait en boucle pendant les tests d'interface.`);
  process.exit(2);
}
mkdirSync(sorties, { recursive: true });

const VITEST = join(racine, 'node_modules', 'vitest', 'vitest.mjs');
const workers = process.env.CI ? '4' : '2';
/** @type {Array<{cle:string,titre:string,etage:string,statut:'vert'|'rouge'|'non_joue',total:number,verts:number,rouges:number,non_joues:number,duree_s:number,echecs:string[],note?:string,rapport?:string}>} */
const etapes = [];

const titre = (t) => console.log(`\n══ ${t} ${'═'.repeat(Math.max(3, 78 - t.length))}`);

/** Lit un rapport JSON de Vitest : comptes et noms des tests rouges. */
function lireVitest(chemin) {
  if (!existsSync(chemin)) return null;
  const r = JSON.parse(readFileSync(chemin, 'utf8'));
  const echecs = [];
  const fichiersRouges = new Set();
  for (const f of r.testResults ?? []) {
    const fichier = String(f.name ?? '').replace(/\\/g, '/').replace(`${racine.replace(/\\/g, '/')}/`, '');
    const rouges = (f.assertionResults ?? []).filter((t) => t.status === 'failed');
    if (rouges.length || f.status === 'failed') fichiersRouges.add(fichier);
    for (const t of rouges) echecs.push(`${fichier} › ${t.fullName}`);
    // Un fichier qui n'a pas pu se charger n'a aucun test : il compte pour un rouge.
    if (f.status === 'failed' && rouges.length === 0) echecs.push(`${fichier} › (le fichier n'a pas pu être chargé) ${String(f.message ?? '').split('\n')[0]}`);
  }
  return {
    total: r.numTotalTests ?? 0, verts: r.numPassedTests ?? 0,
    rouges: Math.max(r.numFailedTests ?? 0, echecs.length),
    non_joues: (r.numPendingTests ?? 0) + (r.numTodoTests ?? 0), echecs, fichiers_rouges: [...fichiersRouges],
  };
}

/** Joue Vitest et range le résultat. `env` : l'environnement EXACT de la passe. */
function vitest(cle, libelle, etage, argsVitest, env) {
  titre(libelle);
  const rapport = join(sorties, `${cle}.json`);
  const debut = Date.now();
  const p = spawnSync(process.execPath, [VITEST, 'run', `--maxWorkers=${workers}`, '--reporter=default', '--reporter=json', `--outputFile.json=${rapport}`, ...argsVitest], {
    cwd: racine, env, stdio: 'inherit', windowsHide: true,
  });
  const lu = lireVitest(rapport);
  const duree_s = Math.round((Date.now() - debut) / 1000);
  if (!lu) {
    etapes.push({ cle, titre: libelle, etage, statut: 'rouge', total: 0, verts: 0, rouges: 1, non_joues: 0, duree_s, echecs: [`aucun rapport écrit (code ${p.status}) : la passe n'a pas démarré`] });
    return false;
  }
  // Un rouge est REJOUÉ une fois, son fichier seul et sans parallélisme : sur un poste chargé, un test
  // chronométré dépasse son délai sans que le produit y soit pour rien. Vert au rejeu = « instable »,
  // listé à part dans le rapport, jamais passé sous silence ; rouge au rejeu = rouge.
  let instables = [];
  let code = p.status ?? 1;
  if (lu.rouges > 0 && lu.fichiers_rouges.length > 0 && lu.fichiers_rouges.length <= 10) {
    console.log(`\n── rejeu, seuls, de ${lu.fichiers_rouges.length} fichier(s) rouge(s)`);
    const rapportRejeu = join(sorties, `${cle}-rejeu.json`);
    // On garde la configuration et le projet ; le filtre de fichiers d'origine est remplacé par les rouges.
    const sansFiltre = argsVitest.filter((x) => x.startsWith('--') || argsVitest[argsVitest.indexOf(x) - 1]?.startsWith('--'));
    const r = spawnSync(process.execPath, [VITEST, 'run', '--maxWorkers=1', '--reporter=default', '--reporter=json', `--outputFile.json=${rapportRejeu}`, ...sansFiltre, ...lu.fichiers_rouges], {
      cwd: racine, env, stdio: 'inherit', windowsHide: true,
    });
    const rejeu = lireVitest(rapportRejeu);
    if (rejeu && rejeu.total > 0) {
      instables = lu.echecs.filter((e) => !rejeu.echecs.includes(e));
      lu.echecs = rejeu.echecs;
      lu.rouges = rejeu.echecs.length;
      lu.verts = lu.total - lu.rouges - lu.non_joues;
      if (rejeu.echecs.length === 0 && (r.status ?? 1) === 0) code = 0;
    }
  }
  const { fichiers_rouges: _fichiers, ...comptes } = lu;
  const rouge = comptes.rouges > 0 || code !== 0 || comptes.total === 0;
  if (rouge && comptes.echecs.length === 0) comptes.echecs.push(comptes.total === 0 ? 'aucun test trouvé' : `Vitest est sorti en code ${code} sans test rouge (erreur hors test : lire la sortie)`);
  etapes.push({ cle, titre: libelle, etage, statut: rouge ? 'rouge' : 'vert', ...comptes, instables, duree_s: Math.round((Date.now() - debut) / 1000), rapport });
  return !rouge;
}

function nonJouee(cle, libelle, etage, note) {
  etapes.push({ cle, titre: libelle, etage, statut: 'non_joue', total: 0, verts: 0, rouges: 0, non_joues: 0, duree_s: 0, echecs: [], note });
}

const repond = async (url) => {
  try { return (await fetch(url, { signal: AbortSignal.timeout(5000) })).status < 500; } catch { return false; }
};

// ── Étage 1 : sans base ──────────────────────────────────────────────────────
if (etages.includes('sans-base')) {
  vitest('unitaires', 'Unitaires de la suite des automatisations', 'sans-base',
    ['--config', 'vitest.automations.config.ts', '--project', 'unitaires'], process.env);
  vitest('composants', 'Composants et logique de la correction finale', 'sans-base',
    ['tests/automations-finale/'], process.env);
}

// ── Étages 2 et 3 : la pile locale, ou rien ──────────────────────────────────
const besoinPile = etages.includes('integration') || etages.includes('e2e');
let pileLa = false;
if (besoinPile) {
  pileLa = (await repond(`${PILE.authUrl}/health`)) && (await repond(`${PILE.restUrl}/`));
  if (!pileLa) {
    console.error('\nLa pile locale ne répond pas. Monte-la : bash scripts/qa/automations-e2e/pile.sh');
    console.error('(Cette commande ne se rabat jamais sur staging ni sur la prod.)');
  }
}

/** L'environnement d'une passe locale : rien de `.env.local`, sauf la clé du modèle si on la demande. */
function envPasse(dossier, plus = {}) {
  const env = envLocal(join(sorties, dossier));
  // Valeurs VIDES, jamais absentes : le harnais et `server/lib/config.ts` relisent `.env.local`, et
  // dotenv remet toute variable absente. Sans cela, sur un poste de développement, une preuve
  // « locale » pourrait parler à staging par l'API de gestion ou par l'adresse directe de la base.
  for (const k of [
    'SUPABASE_ACCESS_TOKEN', 'SUPABASE_PROJECT_REF', 'SUPABASE_DB_URL', 'DB_URL', 'DATABASE_URL',
    'SUPABASE_URL_PROD', 'SUPABASE_SERVICE_ROLE_KEY_PROD', 'SUPABASE_PROJECT_REF_PROD', 'VITE_SUPABASE_ANON_KEY_PROD',
    'ANTHROPIC_API_KEY',
  ]) env[k] = '';
  if (a('avec-modele') && process.env.ANTHROPIC_API_KEY) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  return Object.assign(env, plus);
}

if (etages.includes('integration')) {
  if (!pileLa) {
    nonJouee('integration', 'Intégration (pile locale)', 'integration', 'pile locale absente');
  } else {
    const env = envPasse('suite');
    // Le canari, seul et d'abord.
    const canariVert = vitest('canari', 'Canari : aucun envoi réel possible', 'integration',
      ['--config', 'vitest.automations.config.ts', '--project', 'integration', 'tests/automations-suite/integration/00-canari.test.ts'], env);
    if (!canariVert) {
      console.error('\n✗ CANARI NON VERT : un envoi réel serait possible, ou le bureau de test n\'a pas pu être préparé. Rien d\'autre ne tourne.');
      nonJouee('suite-integration', 'Suite : intégration', 'integration', 'canari rouge');
      nonJouee('suite-ui', 'Suite : interface', 'integration', 'canari rouge');
    } else {
      vitest('suite-integration', 'Suite : intégration (vrai moteur, bureau de test en bac à sable)', 'integration',
        ['--config', 'vitest.automations.config.ts', '--project', 'integration'], env);
      vitest('suite-ui', 'Suite : interface (Chromium)', 'integration',
        ['--config', 'vitest.automations.config.ts', '--project', 'ui'], env);
      // Les preuves par domaine : un dossier = une lettre = son propre jeu de bureaux de test.
      const dossier = 'tests/automations-finale';
      for (const lettre of readdirSync(dossier).sort()) {
        const config = `${dossier}/${lettre}/vitest.config.ts`;
        if (!existsSync(config)) continue;
        vitest(`finale-${lettre}`, `Preuves de la correction finale — domaine ${lettre.toUpperCase()}`, 'integration',
          ['--config', config], envPasse(`finale-${lettre}`, { QA_AUTO_SUFFIXE: lettre }));
      }
    }
  }
}

// ── Étage 3 : E2E Playwright ─────────────────────────────────────────────────
if (etages.includes('e2e')) {
  if (!pileLa || etapes.some((e) => e.cle === 'canari' && e.statut === 'rouge')) {
    nonJouee('e2e', 'E2E de la section Automatisations', 'e2e', pileLa ? 'canari rouge' : 'pile locale absente');
  } else {
    titre('E2E de la section Automatisations (Playwright)');
    const dossierE2e = join(sorties, 'e2e');
    const env = { ...process.env, E2E_SORTIES: dossierE2e };
    const debut = Date.now();
    const jeu = spawnSync(process.execPath, ['scripts/qa/automations-e2e/preparer-jeu-roles.mjs'], { cwd: racine, env, stdio: 'inherit', windowsHide: true });
    if ((jeu.status ?? 1) !== 0) {
      etapes.push({ cle: 'e2e', titre: 'E2E de la section Automatisations', etage: 'e2e', statut: 'rouge', total: 0, verts: 0, rouges: 1, non_joues: 0, duree_s: 0, echecs: ['le jeu de données des rôles n\'a pas pu être préparé'] });
    } else {
      // Le code de sortie de Playwright ne juge rien tant qu'il reste des `@defaut` : c'est le bilan qui juge.
      spawnSync(process.execPath, ['scripts/qa/automations-e2e/lancer.mjs', ...(shard ? [shard] : [])], { cwd: racine, env, stdio: 'inherit', windowsHide: true });
      const b = spawnSync(process.execPath, ['scripts/qa/automations-e2e/bilan.mjs', join(dossierE2e, 'resultats.json'), ...(zeroDefaut ? ['--zero-defaut'] : []), '--sortie', dossierE2e], { cwd: racine, env, stdio: 'inherit', windowsHide: true });
      const cheminBilan = join(dossierE2e, 'bilan.json');
      const bilan = existsSync(cheminBilan) ? JSON.parse(readFileSync(cheminBilan, 'utf8')) : null;
      const duree_s = Math.round((Date.now() - debut) / 1000);
      if (!bilan) {
        etapes.push({ cle: 'e2e', titre: 'E2E de la section Automatisations', etage: 'e2e', statut: 'rouge', total: 0, verts: 0, rouges: 1, non_joues: 0, duree_s, echecs: [`aucun bilan (code ${b.status}) : la passe n'a rien écrit`] });
      } else {
        etapes.push({
          cle: 'e2e', titre: `E2E de la section Automatisations${shard ? ` (${shard.slice(2)})` : ''}`, etage: 'e2e',
          statut: bilan.verdict === 'VERT' ? 'vert' : 'rouge',
          total: bilan.total, verts: bilan.verts, rouges: bilan.rouges_sans_marque + bilan.defaut_verts, non_joues: bilan.non_joues, duree_s,
          echecs: [
            ...bilan.listes.rouges_sans_marque.map((t) => `${t.fichier}:${t.ligne} › ${t.titre}`),
            ...bilan.listes.defaut_verts.map((t) => `${t.fichier}:${t.ligne} › @defaut VERT, marque à retirer › ${t.titre}`),
            ...(zeroDefaut ? bilan.listes.rouges_defaut.map((t) => `${t.fichier}:${t.ligne} › défaut connu encore ouvert › ${t.titre}`) : []),
          ],
          note: `${bilan.rouges_defaut} défaut(s) connu(s) encore ouvert(s) (@defaut)${bilan.raisons?.length ? ` — ${bilan.raisons.join(' ; ')}` : ''}`,
          rapport: cheminBilan,
        });
      }
    }
  }
}

// ── Verdict ──────────────────────────────────────────────────────────────────
const somme = (cle) => etapes.reduce((n, e) => n + e[cle], 0);
const raisons = [];
const rouges = etapes.filter((e) => e.statut === 'rouge');
const sautees = etapes.filter((e) => e.statut === 'non_joue');
if (etapes.length === 0) raisons.push('rien n\'a été joué');
if (rouges.length) raisons.push(`${rouges.length} étape(s) rouge(s) : ${rouges.map((e) => e.cle).join(', ')}`);
if (sautees.length) raisons.push(`${sautees.length} étape(s) non jouée(s) : ${sautees.map((e) => `${e.cle} (${e.note})`).join(', ')}`);
if (zeroDefaut && somme('non_joues') > 0) raisons.push(`${somme('non_joues')} test(s) non joué(s) (--zero-defaut)`);
const verdict = raisons.length ? 'ROUGE' : 'VERT';

let commit = '';
try { commit = String(spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: racine }).stdout).trim(); } catch { /* hors dépôt git */ }
const resultat = {
  verdict, raisons, date: new Date().toISOString(), commit,
  mode: zeroDefaut ? 'zero-defaut' : 'ordinaire',
  portee: etages.length === 3 ? 'complete' : `partielle (${etages.join(', ')})`,
  tranche: shard ? shard.slice('--shard='.length) : null,
  total: somme('total'), verts: somme('verts'), rouges: somme('rouges'), non_joues: somme('non_joues'),
  instables: etapes.reduce((n, e) => n + (e.instables?.length ?? 0), 0),
  etapes,
};

const md = [
  `# Automatisations — toutes les preuves : ${verdict}`,
  '',
  `${resultat.date} · commit ${commit || '?'} · portée ${resultat.portee}${resultat.tranche ? ` · tranche ${resultat.tranche}` : ''} · mode ${resultat.mode}.`,
  '',
  raisons.length ? `**Pourquoi** : ${raisons.join(' ; ')}.` : 'Aucun test rouge, aucune étape sautée.',
  '',
  `**${resultat.total} tests** — ${resultat.verts} verts, ${resultat.rouges} rouges, ${resultat.non_joues} non joués (jamais comptés verts).`,
  '',
  '| Étape | Résultat | Tests | Verts | Rouges | Non joués | Durée | Note |',
  '|---|---|---|---|---|---|---|---|',
  ...etapes.map((e) => `| ${e.titre} | ${e.statut === 'vert' ? 'VERT' : e.statut === 'rouge' ? 'ROUGE' : 'NON JOUÉE'} | ${e.total} | ${e.verts} | ${e.rouges} | ${e.non_joues} | ${e.duree_s} s | ${e.note ?? ''} |`),
  '',
];
const instables = etapes.flatMap((e) => (e.instables ?? []).map((x) => `${e.titre} — ${x}`));
if (instables.length) {
  md.push(`## Instables — rouges à la passe, verts rejoués seuls (${instables.length})`, '',
    'Des tests sensibles à la charge du poste. Ils ne bloquent pas, mais ils sont à rendre robustes.', '',
    ...instables.map((x) => `- ${x}`), '');
}
for (const e of rouges) {
  md.push(`## Rouges — ${e.titre} (${e.echecs.length})`, '', ...e.echecs.slice(0, 200).map((x) => `- ${x}`), '');
  if (e.echecs.length > 200) md.push(`… et ${e.echecs.length - 200} autres (rapport : ${e.rapport ?? '—'}).`, '');
}

const dossierRapport = join(racine, 'rapports', 'automatisations-all');
mkdirSync(dossierRapport, { recursive: true });
writeFileSync(join(dossierRapport, 'resultats.json'), JSON.stringify(resultat, null, 2));
writeFileSync(join(dossierRapport, 'RAPPORT.md'), md.join('\n'));

titre(`VERDICT : ${verdict}`);
for (const e of etapes) console.log(`  ${e.statut === 'vert' ? '✓' : e.statut === 'rouge' ? '✗' : '–'} ${e.titre} — ${e.verts}/${e.total}${e.rouges ? `, ${e.rouges} rouge(s)` : ''}${e.non_joues ? `, ${e.non_joues} non joué(s)` : ''}${e.instables?.length ? `, ${e.instables.length} instable(s)` : ''}${e.note ? ` (${e.note})` : ''}`);
for (const r of raisons) console.log(`  · ${r}`);
console.log(`  rapport : ${join(dossierRapport, 'RAPPORT.md')}`);
process.exit(verdict === 'VERT' ? 0 : 1);
