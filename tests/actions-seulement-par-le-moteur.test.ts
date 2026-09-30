/**
 * Une action d'automatisation (texto, courriel, tâche, webhook…) ne s'exécute
 * QUE par le moteur (audit automatisations V2, 2026-09-29).
 *
 * `POST /api/workflows/execute-action` exécutait n'importe quelle action, en
 * service_role, avec l'entité fournie par le navigateur : hors de toute règle,
 * de « Tout arrêter », des heures calmes et du forfait. Sur staging, un membre
 * du bureau A y a créé une tâche liée à un client du bureau B. Aucun écran ne
 * l'appelait plus : elle a été retirée.
 *
 * Le moteur, lui, lit l'entité AVEC le filtre org_id (cliquet :
 * isolation-automatisations.test.ts) et applique pause, heures calmes et
 * anti-doublon. Ce test échoue si une route rouvre la porte.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RACINE = join(__dirname, '..', 'server');
/** Seuls le moteur et le module des actions ont le droit d'appeler executeAction. */
const AUTORISES = new Set(['lib/automationEngine.ts', 'lib/actions/index.ts']);

function fichiers(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return nom === 'node_modules' ? [] : fichiers(chemin);
    return /\.ts$/.test(nom) ? [chemin] : [];
  });
}

describe('les actions ne passent que par le moteur', () => {
  it('aucune route n’expose execute-action', () => {
    const index = readFileSync(join(RACINE, 'index.ts'), 'utf8');
    expect(index).not.toMatch(/workflows\/execute-action/);
  });

  it('executeAction n’est appelé que par le moteur', () => {
    const fautifs = fichiers(RACINE)
      .map((f) => relative(RACINE, f).replace(/\\/g, '/'))
      .filter((f) => !AUTORISES.has(f))
      .filter((f) => /\bexecuteAction\s*\(/.test(readFileSync(join(RACINE, f), 'utf8')));
    expect(fautifs).toEqual([]);
  });
});
