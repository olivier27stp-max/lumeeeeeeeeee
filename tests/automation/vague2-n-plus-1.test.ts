/**
 * T6.2 / F24 — un événement ne relit pas les réglages de l'entreprise pour
 * CHAQUE règle (audit V2).
 *
 * Mesuré en quarantaine : 6 lectures de company_settings pour 2 règles du même
 * événement (variables relues par règle + langue sans cache) ; un lead.created
 * à 4 actions coûtait 30 requêtes, 22 maintenant. Variables résolues une fois
 * par événement (copie par règle), langue gardée 5 minutes. Cliquet : AJOUTER
 * UNE RÈGLE n'ajoute aucune lecture des réglages ni de la fiche.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../server/lib/mailer', async () => (await import('../quarantaine/_simulations')).mailerSimule(vi.fn(async () => ({ sent: true, messageId: 'x' }))));
vi.mock('../../server/routes/emails', async () => (await import('../quarantaine/_simulations')).emailsSimules());

import { clientEnregistreur, requetes } from '../quarantaine/automation/_enregistreur';

async function lectures(orgId: string, nbRegles: number) {
  const { initAutomationEngine } = await import('../../server/lib/automationEngine');
  const { eventBus } = await import('../../server/lib/eventBus');
  const regle = (id: string) => ({ id, org_id: orgId, name: id, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: true, actions: [{ type: 'log_activity', config: { event_type: id } }] });
  const { client, journal } = clientEnregistreur({
    automation_rules: { data: Array.from({ length: nbRegles }, (_, i) => regle(`r${i}`)) },
    company_settings: { data: { company_name: 'A', default_language: 'fr' } },
    clients: { data: [{ id: 'l1', first_name: 'Marie', status: 'lead' }] },
  });
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: null as any, baseUrl: 'http://t' });
  await eventBus.emit('lead.created', { orgId, entityType: 'lead', entityId: 'l1', metadata: {} });
  for (let t = 0; t < 3; t++) { for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r)); await new Promise((r) => setTimeout(r, 100)); }
  return {
    reglages: requetes(journal, 'company_settings', 'select').length,
    fiches: requetes(journal, 'clients', 'select').length,
    executees: requetes(journal, 'automation_execution_logs', 'insert').length,
  };
}

describe('T6.2 — pas de N+1 sur les réglages', () => {
  it('3 règles au lieu d’1 sur le même événement : pas une lecture de plus des réglages ni de la fiche', async () => {
    // Deux bureaux distincts : les caches (fuseau, pause, langue) sont froids dans les deux cas.
    const une = await lectures('33333333-3333-4333-8333-333333333331', 1);
    const trois = await lectures('33333333-3333-4333-8333-333333333333', 3);
    expect(trois.executees).toBeGreaterThanOrEqual(3); // les trois règles ont bien tourné
    expect(trois.reglages).toBe(une.reglages);
    expect(trois.fiches).toBe(une.fiches);
  });

  it('chaque règle reçoit une COPIE des variables (une variable ajoutée ne déborde pas)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'server', 'lib', 'automationEngine.ts'), 'utf8');
    expect(src).toMatch(/return \{ \.\.\.\(await promesse\) \};/);
  });
});
