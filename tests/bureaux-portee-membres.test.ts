/**
 * Bureaux — phase 4 : portée de visibilité d'un membre (2026-09-25). Preuve
 * contre staging avec de vrais jetons : scripts/qa/bureaux-portee-membres.mts (16/16).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { estRestreint, filtrerVisibles } from '../server/lib/portee-recherche';
import { DEFAULT_SCOPE } from '../src/lib/permissions';
import type { UserContext } from '../server/lib/rbac';

const lire = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const MIG = lire('supabase/migrations/20260927230200_portee_visibilite_membres.sql');
const ctx = (role: UserContext['role'], scope: UserContext['scope']): UserContext =>
  ({ userId: 'u', orgId: 'o', role, scope, teamId: null, departmentId: null, managerId: null, permissions: {} });

describe('migration', () => {
  it('aligne tout le monde sur « tout le bureau » (aucun accès perdu au déploiement)', () => {
    expect(MIG).toContain("update public.memberships set scope = 'company' where scope is distinct from 'company';");
    expect(MIG).toContain("alter table public.memberships alter column scope set default 'company';");
  });
  it.each(['clients', 'jobs', 'quotes', 'invoices', 'tasks', 'schedule_events', 'conversations', 'messages'])(
    'policy RESTRICTIVE portee_membre sur %s', (t) => {
      expect(MIG).toContain(`create policy portee_membre on public.${t} as restrictive for all to authenticated`);
    });
  it('les fonctions paramétrées par personne sont fermées à anon et authenticated', () => {
    for (const f of ['_portee_bureaux_complets', '_portee_restreinte', '_portee_equipes', '_portee_personnes', '_portee_jobs', '_portee_clients']) {
      expect(MIG).toContain(`revoke all on function public.${f}(uuid) from public, anon, authenticated;`);
    }
  });
});

describe('défauts', () => {
  it('toutes les portées par défaut = tout le bureau (restreindre est un choix explicite)', () => {
    expect(Object.values(DEFAULT_SCOPE).every((s) => s === 'company')).toBe(true);
    const inv = lire('server/routes/invitations.ts');
    expect(inv).not.toContain("scope || 'self'");
  });
});

describe('recherche globale', () => {
  it('estRestreint : propriétaire/admin et « company » ne sont jamais filtrés', () => {
    expect(estRestreint(ctx('owner', 'self'))).toBe(false);
    expect(estRestreint(ctx('admin', 'team'))).toBe(false);
    expect(estRestreint(ctx('sales_rep', 'company'))).toBe(false);
    expect(estRestreint(ctx('sales_rep', 'self'))).toBe(true);
    expect(estRestreint(ctx('technician', 'team'))).toBe(true);
  });
  it('filtrerVisibles garde ce que la RLS rend, et un type sans table seulement si son client est visible', async () => {
    const visibles: Record<string, string[]> = { clients: ['c1'], jobs: ['j1'] };
    const client = { from: (t: string) => ({ select: () => ({ in: async () => ({ data: (visibles[t] || []).map((id) => ({ id })), error: null }) }) }) };
    const r = await filtrerVisibles(client as never, [
      { type: 'client', id: 'c1' }, { type: 'lead', id: 'c2' }, { type: 'job', id: 'j1' }, { type: 'job', id: 'j2' },
      { type: 'property', id: 'p1', clientId: 'c1' }, { type: 'property', id: 'p2', clientId: 'c2' }, { type: 'team', id: 't1' },
    ]);
    expect(r.map((x) => x.id)).toEqual(['c1', 'j1', 'p1', 't1']);
  });
});
