// Un membre retiré (memberships.status = 'suspended') perd réellement
// l'accès (constat du 2026-09-25 : la RLS ne lisait pas le statut). Preuve
// en conditions réelles : e2e PostgREST staging 20/20 (voir la PR) ; ce test
// empêche une future migration de réintroduire une barrière aveugle au statut.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DOSSIER = resolve(__dirname, '..', 'supabase', 'migrations');
const MIGRATION = '20260927180000_rls_respecte_statut_adhesion.sql';
const sql = readFileSync(resolve(DOSSIER, MIGRATION), 'utf8');

/** Corps de la DERNIÈRE définition d'une fonction dans l'ensemble des migrations. */
function derniereDefinition(fonction: string): { fichier: string; corps: string } | null {
  const fichiers = readdirSync(DOSSIER).filter((f) => f.endsWith('.sql')).sort();
  let trouve: { fichier: string; corps: string } | null = null;
  const motif = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fonction}\\s*\\(([\\s\\S]*?)\\$function\\$;`, 'gi');
  for (const f of fichiers) {
    const contenu = readFileSync(resolve(DOSSIER, f), 'utf8');
    for (const m of contenu.matchAll(motif)) trouve = { fichier: f, corps: m[0] };
  }
  return trouve;
}

const BARRIERES = [
  'has_org_membership',
  'has_org_admin_role',
  'has_org_role',
  'verify_org_access',
  'current_org_ids',
  'current_org_id',
  'custom_access_token_hook',
  'enforce_soft_delete_admin',
  'soft_delete_job',
];

describe('la RLS respecte memberships.status', () => {
  it.each(BARRIERES)('%s exige une adhésion active (dernière définition connue)', (fn) => {
    const def = derniereDefinition(fn);
    expect(def, `${fn} introuvable dans les migrations`).not.toBeNull();
    expect(def!.corps, `${fn} redéfinie dans ${def!.fichier} sans filtre de statut`).toMatch(/status,\s*'active'\)\s*=\s*'active'/);
  });

  it('un utilisateur ne voit plus ses propres adhésions non actives', () => {
    const pol = sql.slice(sql.indexOf('create policy memberships_select_own_org'));
    expect(pol).toMatch(/user_id = \(select auth\.uid\(\)\)\) and coalesce\(status, 'active'\) = 'active'/);
  });

  it('le statut est un champ sensible : personne ne change le sien', () => {
    expect(sql).toMatch(/or \(new\.status\s+is distinct from old\.status\)/);
  });

  it('le jeton ne porte que les bureaux actifs et un vieux jeton est re-vérifié en base', () => {
    const hook = derniereDefinition('custom_access_token_hook')!.corps;
    expect(hook).toMatch(/#- '\{app_metadata,org_ids\}'/);
    const ids = derniereDefinition('current_org_ids')!.corps;
    expect(ids).toMatch(/where exists \([\s\S]*m\.org_id = c\.org_id/);
  });
});
