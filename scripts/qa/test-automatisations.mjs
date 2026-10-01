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
 *   --ui             seulement les tests d'interface (Playwright ; le projet
 *                    démarre lui-même une API sans tâche de fond et un Vite,
 *                    puis les arrête — tests/automations-suite/harnais/serveurs-ui.ts)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';

const args = process.argv.slice(2);
const projets = args.includes('--unitaires') ? ['unitaires']
  : args.includes('--integration') ? ['integration']
  : args.includes('--ui') ? ['ui']
  : ['unitaires', 'integration', 'ui'];
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const envFichier = existsSync('.env.local') ? ['--env-file=.env.local'] : [];
mkdirSync('rapports/automatisations', { recursive: true });

if (projets.includes('integration')) {
  const b = spawnSync(npx, ['tsx', ...envFichier, 'scripts/qa/bureau-test-automatisations.mts'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (b.status !== 0) {
    console.error('✗ Bureau de test impossible à préparer : la suite ne tourne pas.');
    process.exit(b.status || 1);
  }
}

if (projets.includes('ui')) {
  // Le navigateur des tests d'interface : installé s'il manque (CI neuve).
  const { chromium } = await import('@playwright/test');
  if (!existsSync(chromium.executablePath())) {
    const i = spawnSync(npx, ['playwright', 'install', ...(process.env.CI ? ['--with-deps'] : []), 'chromium'], { stdio: 'inherit', shell: process.platform === 'win32' });
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
    stdio: 'inherit', shell: process.platform === 'win32',
  });
  if (c.status !== 0) {
    console.error('✗ CANARI ROUGE : un envoi réel serait possible. Suite arrêtée : rien d’autre n’a tourné.');
    process.exit(c.status || 1);
  }
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
  const v = spawnSync(npx, ['vitest', 'run', '--config', 'vitest.automations.config.ts', '--project', p, `--outputFile.json=rapports/automatisations/resultats-${p}.json`], {
    stdio: 'inherit', shell: process.platform === 'win32',
  });
  if ((v.status ?? 1) !== 0) code = v.status ?? 1;
}
const r = spawnSync(process.execPath, ['scripts/qa/rapport-automatisations.mjs'], { stdio: 'inherit' });
if (r.status !== 0) console.error('✗ Rapport non généré.');
process.exit(code);
