/**
 * « Une fois par client tous les N jours » : quand la règle écarte un client
 * déjà passé récemment, le JOURNAL le dit (consigne du coordinateur : toute
 * exécution écartée laisse une ligne, avec son code).
 *
 * Avant : une ligne dans les logs du serveur, rien à l'écran. « Pourquoi ce
 * client n'a rien reçu ? » n'avait aucune réponse.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fauxSupabase, type Ligne } from './_faux-supabase';
import { viderCacheFuseau } from '../../../server/lib/automations-fuseau-org';
import { viderCachePause } from '../../../server/lib/automations-pause-org';
import { motifDuCode } from '../../../src/lib/automationMotifs';

const ORG = '11111111-1111-4111-8111-111111111111';
const JOUR = 86_400_000;

beforeEach(() => { viderCacheFuseau(); viderCachePause(); });

async function emettre(journalAvant: Ligne[], jours: number) {
  const { initAutomationEngine } = await import('../../../server/lib/automationEngine');
  const { eventBus } = await import('../../../server/lib/eventBus');
  const sb = fauxSupabase({
    company_settings: [{ org_id: ORG, timezone: 'America/Toronto', automations_paused: false }],
    automation_rules: [{
      id: 'r1', org_id: ORG, name: 'Réponse automatique', trigger_event: 'client.replied', is_active: true, deleted_at: null,
      conditions: {}, delay_seconds: 0, steps: null, settings: { delai_entre_passages_jours: jours },
      actions: [{ type: 'create_task', config: { title: 'Rappeler le client' } }],
    }],
    clients: [{ id: 'c1', org_id: ORG, first_name: 'Marie', deleted_at: null }],
    automation_execution_logs: journalAvant,
  });
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: sb.client, twilio: null as never, baseUrl: 'http://t' });
  await eventBus.emit('client.replied', { orgId: ORG, entityType: 'client', entityId: 'c1', metadata: {} });
  await new Promise((r) => setTimeout(r, 300));
  return sb;
}

const passageDHier = (): Ligne => ({
  id: 'l0', org_id: ORG, automation_rule_id: 'r1', entity_id: 'c1', entity_type: 'client', action_type: 'create_task',
  result_success: true, result_data: null, created_at: new Date(Date.now() - JOUR).toISOString(),
});

describe('« une fois par client tous les N jours » : l’écart est journalisé', () => {
  it('le client est passé hier, la règle dit « tous les 7 jours » : rien n’est exécuté, une ligne `une_fois_par_client`', async () => {
    const sb = await emettre([passageDHier()], 7);
    expect(sb.tables.tasks ?? []).toHaveLength(0);
    const nouvelles = sb.tables.automation_execution_logs.filter((l) => l.id !== 'l0');
    expect(nouvelles).toHaveLength(1);
    expect(nouvelles[0]).toMatchObject({
      automation_rule_id: 'r1', entity_id: 'c1', trigger_event: 'client.replied', result_success: true, result_error: null,
      result_data: { saute: 'Déjà passé par cette automatisation il y a moins de 7 jours', saute_code: 'une_fois_par_client', delai_entre_passages_jours: 7 },
    });
    // La ligne n'est pas une action : elle ne compte pas elle-même pour un « passage ».
    expect(nouvelles[0].action_type).toBe('conditions');
  });

  it('« tous les 1 jour » : la phrase s’accorde', async () => {
    const sb = await emettre([{ ...passageDHier(), created_at: new Date(Date.now() - 3_600_000).toISOString() }], 1);
    const [ligne] = sb.tables.automation_execution_logs.filter((l) => l.id !== 'l0');
    expect(ligne.result_data.saute).toBe('Déjà passé par cette automatisation il y a moins de 1 jour');
  });

  it('le code est connu de la liste des issues (catégorie « ignorée », groupe « doublon »)', () => {
    expect(motifDuCode('une_fois_par_client')).toMatchObject({ categorie: 'ignoree', groupe: 'doublon' });
  });
});
