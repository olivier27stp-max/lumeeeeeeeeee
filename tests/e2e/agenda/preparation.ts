/**
 * Avant la suite : recharger le jeu de données local et s'assurer que le faux
 * OSRM tourne (aucun appel réel à un service de routes).
 */
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('../../../', import.meta.url));

async function osrmRepond(): Promise<boolean> {
  try { return (await fetch('http://127.0.0.1:5899/_compteurs')).ok; } catch { return false; }
}

export default async function preparation(): Promise<void> {
  if (!process.env.AGENDA_LOCAL_SERVICE_KEY) throw new Error('AGENDA_LOCAL_SERVICE_KEY manquante (environnement de l’audit).');
  execFileSync(process.execPath, ['--import', 'tsx', 'scripts/qa/agenda/seed-local.mts'], { cwd: RACINE, stdio: 'inherit', env: process.env });
  if (!(await osrmRepond())) {
    const p = spawn(process.execPath, ['--import', 'tsx', 'scripts/qa/agenda/osrm-simule.mts'], { cwd: RACINE, detached: true, stdio: 'ignore' });
    p.unref();
    for (let i = 0; i < 30 && !(await osrmRepond()); i++) await new Promise((r) => setTimeout(r, 500));
  }
  await fetch('http://127.0.0.1:5899/_zero');
}
