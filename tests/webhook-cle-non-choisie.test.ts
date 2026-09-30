/**
 * Vague 3 (audit V2, S8, Faible) — la clé d'une adresse d'appel ne peut plus
 * être choisie par un client.
 *
 * Preuve sous vraie session (staging, 2026-09-30, `membre-maj`,
 * automations.update), avant / après la migration 20261004100100 :
 *   création AVEC clé choisie   201 → 403 (42501)
 *   modification de la clé      200 → 403 (42501)
 *   création sans clé           201 → 201 (inchangé)
 *   modification du nom         200 → 200 (inchangé)
 * Lignes « [QA-V3] » supprimées, ménage vérifié (0 restante).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const MIG = lire('supabase/migrations/20261004100100_cle_webhook_non_choisie.sql');
const SQL = MIG.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('migration 20261004100100 — api_key hors des droits d’écriture', () => {
  it('retire INSERT / UPDATE de table (sinon un revoke de colonne ne retire rien)', () => {
    expect(SQL).toContain('revoke insert, update on table public.automation_webhooks from anon, authenticated;');
  });
  it('rend INSERT et UPDATE colonne par colonne, SANS api_key', () => {
    const grants = [...SQL.matchAll(/grant (insert|update) \(([^)]*)\)\s+on table public\.automation_webhooks to authenticated;/g)];
    expect(grants.map((g) => g[1]).sort()).toEqual(['insert', 'update']);
    for (const g of grants) expect(g[2]).not.toContain('api_key');
    // Les colonnes dont l'app a besoin restent écrivables.
    const upd = grants.find((g) => g[1] === 'update')![2];
    for (const c of ['name', 'enabled', 'deleted_at', 'updated_at']) expect(upd).toContain(c);
  });
  it('un bloc DOWN est fourni', () => expect(MIG).toContain('-- DOWN'));
});

describe('la régénération écrit la clé avec le client service, après contrôle du droit', () => {
  const route = lire('server/routes/automation-rules.ts');
  const bloc = route.slice(route.indexOf("router.post('/automations/webhooks/:id/regenerer'"), route.indexOf("router.patch('/automations/webhooks/:id'"));
  it('le client de l’utilisateur n’écrit plus api_key', () => {
    expect(bloc).toContain('await auth.client');
    expect(bloc).not.toMatch(/auth\.client[\s\S]{0,80}\.update\(\{ api_key/);
  });
  it('la clé passe par getServiceClient, bornée au bureau et à l’id vérifiés', () => {
    expect(bloc).toMatch(/getServiceClient\(\)\s*\.from\('automation_webhooks'\)\s*\.update\(\{ api_key: nouvelle \}\)/);
    expect(bloc).toContain(".eq('org_id', auth.orgId)");
  });
  it('la création ne fournit jamais de clé', () => {
    const creation = route.slice(route.indexOf("router.post('/automations/webhooks'"), route.indexOf("router.post('/automations/webhooks/:id/regenerer'"));
    expect(creation).toContain('.insert({ org_id: auth.orgId, created_by: auth.user.id, name: nom })');
  });
});
