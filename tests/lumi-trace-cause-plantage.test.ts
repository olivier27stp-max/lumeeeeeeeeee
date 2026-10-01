/**
 * Un tour qui plante laisse sa cause dans le journal.
 *
 * Passe d'évaluation du 2026-10-01 : un tour sur 221 a fini en « Lumi failed to
 * respond ». La trace disait « erreur », rien d'autre — la cause n'existait
 * que dans les journaux du serveur, hors de portée.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const route = readFileSync(resolve(__dirname, '..', 'server', 'routes', 'lumi.ts'), 'utf8');

describe('cause du plantage dans la trace', () => {
  it('la route trace la cause, pas seulement « erreur »', () => {
    expect(route).toContain("void tracer('erreur', 0, null, undefined, { stop_reason: null, appels_modele: 0, outils_charges: 0, premier_token_ms: null, ...causeDuPlantage(err) });");
    expect(route).not.toContain("void tracer('erreur', 0);");
  });

  it('le message gardé est court, sans coordonnées ni identifiant', () => {
    const corps = route.slice(route.indexOf('export function causeDuPlantage'), route.indexOf('// ── POST /lumi/chat'));
    expect(corps).toContain('masquerCoordonnees(');
    expect(corps).toContain("'<id>'");
    expect(corps).toContain('.slice(0, 300)');
    expect(corps).toContain('erreur_statut');
  });
});
