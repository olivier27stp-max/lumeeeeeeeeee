/**
 * npm run test:automations — UNE commande :
 *   1. crée/retrouve le bureau de test (staging, bac à sable) ;
 *   2. lance la suite (vitest.automations.config.ts : unitaires + intégration) ;
 *   3. écrit rapports/automatisations/{resultats.json, RAPPORT.md, synthese.json}
 *      (scripts/qa/rapport-automatisations.mjs) ;
 *   4. sort en code ≠ 0 si UN SEUL test échoue — la CI bloque alors le déploiement.
 *
 * Options :
 *   --unitaires      seulement le projet sans réseau (CI sans secrets staging)
 *   --integration    seulement le projet staging
 *   --prod           viser la PRODUCTION (bureau de test en bac à sable créé en
 *                    prod ; rafale de charge réduite). Jamais par défaut : exige
 *                    SUPABASE_URL_PROD, SUPABASE_SERVICE_ROLE_KEY_PROD,
 *                    SUPABASE_PROJECT_REF_PROD et SUPABASE_ACCESS_TOKEN dans .env.local.
 *   <fichiers…>      seulement ces fichiers de tests (après le canari)
 *   --canari         seulement le bureau de test et le canari (premier contact
 *                    avec une nouvelle cible)
 *   --ui             seulement les tests d'interface (Playwright ; le projet
 *                    démarre lui-même une API sans tâche de fond et un Vite,
 *                    puis les arrête — tests/automations-suite/harnais/serveurs-ui.ts)
 */
import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { parse } from 'dotenv';

const args = process.argv.slice(2);
// Des chemins de fichiers en argument = seulement ceux-là (projet « integration »
// par défaut) : revérifier un correctif sans relancer toute la suite.
const fichiers = args.filter((a) => !a.startsWith('--'));
const projets = args.includes('--unitaires') ? ['unitaires']
  : args.includes('--integration') ? ['integration']
  : args.includes('--ui') ? ['ui']
  : fichiers.length ? ['integration']
  : ['unitaires', 'integration', 'ui'];
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const envFichier = existsSync('.env.local') ? ['--env-file=.env.local'] : [];
mkdirSync('rapports/automatisations', { recursive: true });

// ── Cible : staging (défaut) ou PROD (--prod, jamais par accident) ───────────
let envCible = process.env;
if (args.includes('--prod')) {
  const e = existsSync('.env.local') ? parse(readFileSync('.env.local')) : {};
  const lire = (k) => process.env[k] || e[k] || '';
  const url = lire('SUPABASE_URL_PROD');
  const cle = lire('SUPABASE_SERVICE_ROLE_KEY_PROD');
  const ref = lire('SUPABASE_PROJECT_REF_PROD');
  let anon = lire('VITE_SUPABASE_ANON_KEY_PROD');
  if (!url || !cle || !ref) {
    console.error('✗ --prod : SUPABASE_URL_PROD, SUPABASE_SERVICE_ROLE_KEY_PROD et SUPABASE_PROJECT_REF_PROD sont requis (.env.local).');
    process.exit(1);
  }
  if (!anon) {
    // La clé publique se lit par l'API de gestion ; elle n'est jamais affichée.
    const jeton = lire('SUPABASE_ACCESS_TOKEN');
    const r = jeton ? await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, { headers: { Authorization: `Bearer ${jeton}` } }) : null;
    const cles = r && r.ok ? await r.json() : [];
    anon = (Array.isArray(cles) ? cles.find((k) => k.name === 'anon')?.api_key : '') || '';
    if (!anon) {
      console.error('✗ --prod : clé publique (anon) de la prod introuvable — VITE_SUPABASE_ANON_KEY_PROD ou SUPABASE_ACCESS_TOKEN requis.');
      process.exit(1);
    }
  }
  envCible = {
    ...process.env,
    VITE_SUPABASE_URL: url,
    SUPABASE_SERVICE_ROLE_KEY: cle,
    VITE_SUPABASE_ANON_KEY: anon,
    SUPABASE_PROJECT_REF: ref,
    QA_AUTO_PROD: 'je-confirme-la-prod',
  };
  console.warn('');
  console.warn('  ╔════════════════════════════════════════════════════════════╗');
  console.warn('  ║  CIBLE : PRODUCTION — bureaux [TEST] en bac à sable        ║');
  console.warn('  ║  Le canari tourne d’abord ; rouge = tout s’arrête.         ║');
  console.warn('  ╚════════════════════════════════════════════════════════════╝');
  console.warn('');
}

if (projets.includes('integration')) {
  const b = spawnSync(npx, ['tsx', ...envFichier, 'scripts/qa/bureau-test-automatisations.mts'], { stdio: 'inherit', shell: process.platform === 'win32', env: envCible });
  if (b.status !== 0) {
    console.error('✗ Bureau de test impossible à préparer : la suite ne tourne pas.');
    process.exit(b.status || 1);
  }
}

// Une exécution à la fois par base : on prend le verrou de la suite, ou on
// attend son tour (scripts/qa/verrou-suite-automatisations.mts). Rendu à la
// sortie, quelle qu'elle soit.
if (projets.includes('integration') || projets.includes('ui')) {
  let titulaire = `${process.env.GITHUB_RUN_ID ? `ci-${process.env.GITHUB_RUN_ID}` : `local-${hostname()}`}-${Date.now().toString(36)}`;
  const verrou = (action) => spawnSync(npx, ['tsx', ...envFichier, 'scripts/qa/verrou-suite-automatisations.mts', action, titulaire], {
    stdio: 'inherit', shell: process.platform === 'win32', env: envCible,
  });
  if (verrou('prendre').status !== 0) {
    console.error('✗ Verrou de la suite non obtenu : la suite ne tourne pas.');
    process.exit(1);
  }
  process.on('exit', () => { if (titulaire) { verrou('rendre'); titulaire = ''; } });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));
}

if (projets.includes('ui')) {
  // Le navigateur des tests d'interface : installé s'il manque (CI neuve).
  const { chromium } = await import('@playwright/test');
  if (!existsSync(chromium.executablePath())) {
    const i = spawnSync(npx, ['playwright', 'install', ...(process.env.CI ? ['--with-deps'] : []), 'chromium'], { stdio: 'inherit', shell: process.platform === 'win32', env: envCible });
    if (i.status !== 0) {
      console.error('✗ Chromium introuvable et impossible à installer : les tests d’interface ne tournent pas.');
      process.exit(i.status || 1);
    }
  }
}

// Le CANARI d'abord, seul : s'il est rouge, un envoi réel serait possible —
// on n'exécute rien d'autre (ni intégration, ni interface).
if (projets.includes('integration') || projets.includes('ui')) {
  const c = spawnSync(npx, ['vitest', 'run', '--config', 'vitest.automations.config.ts', '--project', 'integration', '--outputFile.json=rapports/automatisations/canari.json', 'tests/automations-suite/integration/00-canari.test.ts'], {
    stdio: 'inherit', shell: process.platform === 'win32', env: envCible,
  });
  if (c.status !== 0) {
    console.error('✗ CANARI NON VERT : soit un piège a été touché (un envoi réel serait possible), soit le bureau de test n’a pas pu être préparé (base indisponible ou trop lente). Lire l’échec ci-dessus. Suite arrêtée : rien d’autre n’a tourné.');
    process.exit(c.status || 1);
  }
}

if (args.includes('--canari')) {
  console.log('✓ Canari vert — option --canari : rien d’autre ne tourne.');
  process.exit(0);
}

// Un projet À LA FOIS, dans cet ordre : les lancer ensemble (défaut de vitest)
// faisait courir l'intégration et l'interface en même temps contre la même
// base — sur un staging partagé, des requêtes simples dépassaient le délai
// (statement timeout) et la CI s'arrêtait à sa limite. Chaque projet écrit son
// JSON ; le rapport les fusionne.
for (const f of readdirSync('rapports/automatisations')) {
  if (/^resultats.*\.json$/.test(f)) rmSync(`rapports/automatisations/${f}`);
}
let code = 0;
for (const p of projets) {
  const v = spawnSync(npx, ['vitest', 'run', '--config', 'vitest.automations.config.ts', '--project', p, `--outputFile.json=rapports/automatisations/resultats-${p}.json`, ...fichiers], {
    stdio: 'inherit', shell: process.platform === 'win32', env: envCible,
  });
  if ((v.status ?? 1) !== 0) code = v.status ?? 1;
}
const r = spawnSync(process.execPath, ['scripts/qa/rapport-automatisations.mjs'], { stdio: 'inherit', env: envCible });
if (r.status !== 0) console.error('✗ Rapport non généré.');
process.exit(code);
