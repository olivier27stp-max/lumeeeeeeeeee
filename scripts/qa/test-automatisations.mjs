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
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const projets = args.includes('--unitaires') ? ['unitaires'] : args.includes('--integration') ? ['integration'] : ['unitaires', 'integration'];
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

const v = spawnSync(npx, ['vitest', 'run', '--config', 'vitest.automations.config.ts', ...projets.flatMap((p) => ['--project', p])], {
  stdio: 'inherit', shell: process.platform === 'win32',
});
const r = spawnSync(process.execPath, ['scripts/qa/rapport-automatisations.mjs'], { stdio: 'inherit' });
if (r.status !== 0) console.error('✗ Rapport non généré.');
process.exit(v.status ?? 1);
