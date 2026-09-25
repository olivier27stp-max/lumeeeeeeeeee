/**
 * Bureaux — phase 0 (2026-09-25). Preuve de bout en bout contre staging :
 * scripts/qa/bureaux-phase0.mts (entreprise fictive à 2 bureaux, 5/5 ; avec
 * l'ancien code, convertir un devis du 2e bureau échouait).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const lire = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('le client serveur porte le bureau actif', () => {
  it('requireAuthedClient rend un client avec x-lume-org = bureau résolu', () => {
    const s = lire('server/lib/supabase.ts');
    expect(s).toMatch(/export function buildSupabaseWithAuth\(authorizationHeader: string, bureau\?: string \| null\)/);
    expect(s).toContain("...(bureau ? { 'x-lume-org': bureau } : {})");
    expect(s).toContain('return { client: buildSupabaseWithAuth(authorizationHeader, orgId), orgId, user };');
  });
});

describe('findOrCreateConversation ne mélange jamais deux organisations', () => {
  it('conversation et client cherchés DANS le bureau', async () => {
    vi.resetModules();
    const filtres: Array<[string, string, unknown]> = [];
    const chaine = (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'in', 'limit', 'or', 'is']) q[m] = () => q;
      q.eq = (col: string, v: unknown) => { filtres.push([table, col, v]); return q; };
      q.maybeSingle = async () => ({ data: null });
      q.insert = () => ({ select: () => ({ single: async () => ({ data: { id: 'c1' }, error: null }) }) });
      return q;
    };
    const client = { from: (t: string) => chaine(t) };
    const { findOrCreateConversation } = await import('../server/lib/helpers');
    await findOrCreateConversation(client as never, 'org-b', '+15145550199');
    expect(filtres).toContainEqual(['conversations', 'org_id', 'org-b']);
    expect(filtres).toContainEqual(['clients', 'org_id', 'org-b']);
  });
});

describe('page Messages', () => {
  it('gardée par messages.read (comme la route), plus par automations.update', () => {
    const s = lire('src/pages/Messages.tsx');
    expect(s).toContain('<PermissionGate permission="messages.read">');
    expect(s).not.toContain('<PermissionGate permission="automations.update">');
  });
});

describe('droit aux SMS', () => {
  it('le forfait est cherché sur tout le groupe de bureaux (comme le paywall)', () => {
    const s = lire('server/lib/twilioProvisioning.ts');
    const f = s.slice(s.indexOf('export async function orgPlanIncludesSms'), s.indexOf('export async function orgPlanIncludesSms') + 1400);
    expect(f).toContain('const bureaux = await companyOrgIds(serviceClient, orgId);');
    expect(f).toContain(".in('org_id', bureaux)");
  });
});
