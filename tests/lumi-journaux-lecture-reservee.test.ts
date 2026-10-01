/**
 * Journaux de Lumi : `lumi_traces` est réservée au serveur, `agent_actions`
 * ne montre à un membre que SES actions (tout le bureau pour qui gère les
 * réglages). Fuite prouvée en prod le 2026-10-01 : un technicien lisait les
 * questions du propriétaire, leur coût en dollars et ses actions.
 *
 * Garde statique : le client (web et mobile) ne doit jamais lire ces tables —
 * `lumi_traces` n'a plus aucun droit de lecture pour `authenticated`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const RACINE = resolve(__dirname, '..');
const MIGRATION = readFileSync(resolve(RACINE, 'supabase/migrations/20261007100000_lumi_journaux_lecture_reservee.sql'), 'utf8');

function fichiers(dossier: string): string[] {
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier).flatMap((n) => {
    const p = join(dossier, n);
    if (n === 'node_modules') return [];
    return statSync(p).isDirectory() ? fichiers(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe('journaux de Lumi — lecture réservée', () => {
  it('lumi_traces : plus de policy de lecture ni de droit pour le client', () => {
    expect(MIGRATION).toMatch(/drop policy if exists lumi_traces_select_membre on public\.lumi_traces/);
    expect(MIGRATION).toMatch(/revoke all on public\.lumi_traces from anon, authenticated/);
  });

  it('agent_actions : ses propres actions, ou settings.update', () => {
    expect(MIGRATION).toMatch(/drop policy if exists agent_actions_select_membre on public\.agent_actions/);
    expect(MIGRATION).toMatch(/user_id = \(select auth\.uid\(\)\)\s+or public\.member_has_permission\(\(select auth\.uid\(\)\), org_id, 'settings\.update'\)/);
    expect(MIGRATION).toMatch(/revoke all on public\.agent_actions from anon/);
  });

  it('aucun code client ne lit ces tables', () => {
    const fautifs = [...fichiers(resolve(RACINE, 'src')), ...fichiers(resolve(RACINE, 'mobile/src'))]
      .filter((f) => /from\(['"](lumi_traces|agent_actions)['"]\)/.test(readFileSync(f, 'utf8')));
    expect(fautifs).toEqual([]);
  });
});
