// Bug Vision Lavage (2026-09-25) : un bureau créé par un propriétaire restait
// invisible pour l'autre propriétaire de la même entreprise. La règle vit en
// base (trigger) ; ce test fige ses garanties et le formulaire qui en dépend.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const migration = lire('supabase/migrations/20260927160000_bureaux_proprietaires_partout.sql');

describe('propriétaires : accès à tous les bureaux de la compagnie', () => {
  it('le trigger couvre insertion ET changement de rôle/statut', () => {
    expect(migration).toMatch(/after insert or update of role, status on public\.memberships/);
  });

  it('ne touche jamais une adhésion existante (retrait volontaire respecté)', () => {
    const inserts = migration.match(/insert into public\.memberships/g) || [];
    const noConflict = migration.match(/on conflict \(user_id, org_id\) do nothing/g) || [];
    expect(inserts.length).toBe(3);
    expect(noConflict.length).toBe(inserts.length);
    expect(migration).not.toMatch(/do update/);
  });

  it('ne propage que des propriétaires actifs, jamais vers un bureau supprimé', () => {
    expect(migration).toMatch(/new\.role <> 'owner'/);
    expect(migration.match(/deleted_at is null/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it('fonction SECURITY DEFINER non exécutable par les clients', () => {
    expect(migration).toMatch(/security definer/);
    expect(migration).toMatch(/revoke all on function public\.propager_proprietaires_bureaux\(\) from public, anon, authenticated/);
  });

  it('le formulaire ne propose plus que les admins, cochés par défaut', () => {
    const route = lire('server/routes/orgs.ts');
    const bloc = route.slice(route.indexOf("'/orgs/offices/grantable-members'"), route.indexOf("'/orgs/create-office'"));
    expect(bloc).toMatch(/\.eq\('role', 'admin'\)/);
    expect(lire('src/pages/OfficeNew.tsx')).toMatch(/setGrant\(new Set\(m\.map/);
  });
});
