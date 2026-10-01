/**
 * Une automatisation supprimée DÉFINITIVEMENT n'existe plus pour la publication.
 *
 * Audit du 2026-10-01 (suite du constat roles-09) : `changerPublication` lisait
 * la règle sans écarter `purged_at`. Publier une règle purgée répondait 422
 * « restaurez-la avant de la publier » — or elle n'est plus restaurable — et la
 * DÉPUBLIER répondait 200 en écrivant dessus. La route de publication, la
 * publication en lot et l'outil de Lumi passent tous par cette fonction.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../server/lib/logger', () => ({ logger: { error: () => {}, warn: () => {}, info: () => {} } }));

import { changerPublication } from '../../server/lib/automations-publication';
import { creerFausseBase } from './lot2-faux-supabase';

const ORG = '11111111-1111-4111-8111-111111111111';
const regle = (id: string, extra: Record<string, unknown>) => ({
  id, org_id: ORG, name: `Règle ${id}`, trigger_event: 'lead.created', conditions: {}, is_preset: false, is_active: false,
  steps: null, actions: [{ type: 'log_activity', config: {} }], deleted_at: null, purged_at: null, ...extra,
});

function base() {
  const b = creerFausseBase();
  b.etat.tables.automation_rules = [
    regle('vivante', {}),
    regle('corbeille', { deleted_at: '2026-10-01T12:00:00Z' }),
    regle('purgee', { deleted_at: '2026-10-01T12:00:00Z', purged_at: '2026-10-01T13:00:00Z', is_active: true }),
  ];
  return b;
}
type Client = Parameters<typeof changerPublication>[0];

describe('changerPublication sur une règle purgée', () => {
  it('la publier : 404 « introuvable » — pas « restaurez-la »', async () => {
    const b = base();
    const r = await changerPublication(b.client() as unknown as Client, ORG, 'purgee', true);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ statut: 404, erreur: 'Automatisation introuvable.' });
    expect(b.etat.ecritures).toEqual([]);
  });

  it('la dépublier : 404 aussi, et rien n’est écrit', async () => {
    const b = base();
    const r = await changerPublication(b.client() as unknown as Client, ORG, 'purgee', false);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ statut: 404 });
    expect(b.etat.ecritures).toEqual([]);
  });
});

describe('témoins : le reste ne change pas', () => {
  it('une règle à la corbeille (restaurable) garde son refus « restaurez-la »', async () => {
    const b = base();
    const r = await changerPublication(b.client() as unknown as Client, ORG, 'corbeille', true);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ statut: 422 });
    expect(String((r as { erreur?: string }).erreur)).toContain('restaurez-la');
  });

  it('une règle vivante se dépublie', async () => {
    const b = base();
    const r = await changerPublication(b.client() as unknown as Client, ORG, 'vivante', false);
    expect(r.ok).toBe(true);
  });
});
