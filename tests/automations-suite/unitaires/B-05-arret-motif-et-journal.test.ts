/**
 * B-05 — quand le moteur arrête une tâche différée, il écrit POURQUOI : ce qui
 * a changé, sur la tâche (`last_error`, `action_config.motif_code`) ET dans le
 * journal des exécutions (une ligne « saute », avec son code).
 *
 * Avant : « Annulée : la condition d'arrêt de la règle est remplie. » pour
 * tout, et aucune ligne au journal — les statistiques ne pouvaient pas dire
 * « ignorées, et pourquoi ».
 */
import { describe, it, expect } from 'vitest';
import { fauxSupabase, type Ligne } from './_faux-supabase';
import { revaliderTache, motifArret, phraseArret, type TacheARevalider } from '../../../server/lib/sortie-parcours';

const ORG = '11111111-1111-4111-8111-111111111111';
const base = (extra: Partial<TacheARevalider>): TacheARevalider => ({
  orgId: ORG, entityType: 'invoice', entityId: 'f1', declencheur: 'invoice.overdue', metadonnees: {}, reglages: null,
  conditions: {}, actionsDeLaRegle: ['send_email'], caseParDeclencheur: false, ...extra,
});

describe('[B-05] la revalidation dit CE QUI A CHANGÉ', () => {
  const cas: Array<[string, Partial<TacheARevalider>, Record<string, Ligne[]>, string, string]> = [
    ['facture payée', {}, { invoices: [{ id: 'f1', org_id: ORG, status: 'paid', client_id: 'c1' }] }, 'condition_plus_valide', 'la facture a été payée'],
    ['facture annulée', {}, { invoices: [{ id: 'f1', org_id: ORG, status: 'void', client_id: 'c1' }] }, 'condition_plus_valide', 'la facture a été annulée'],
    ['facture effacée', {}, { invoices: [] }, 'entite_supprimee', 'la facture a été supprimée'],
    ['devis accepté', { entityType: 'quote', entityId: 'd1', declencheur: 'quote.sent' }, { quotes: [{ id: 'd1', org_id: ORG, status: 'approved' }] }, 'condition_plus_valide', 'la soumission a été acceptée'],
    ['devis refusé', { entityType: 'quote', entityId: 'd1', declencheur: 'quote.sent' }, { quotes: [{ id: 'd1', org_id: ORG, status: 'declined' }] }, 'condition_plus_valide', 'la soumission a été refusée'],
    ['devis à la corbeille', { entityType: 'quote', entityId: 'd1', declencheur: 'quote.sent' }, { quotes: [{ id: 'd1', org_id: ORG, status: 'awaiting_response', deleted_at: '2026-10-01T00:00:00Z' }] }, 'entite_supprimee', 'la soumission a été supprimée'],
    ['rendez-vous annulé', { entityType: 'schedule_event', entityId: 'v1', declencheur: 'appointment.created' }, { schedule_events: [{ id: 'v1', org_id: ORG, status: 'cancelled' }] }, 'condition_plus_valide', 'le rendez-vous a été annulé'],
    ['rendez-vous supprimé', { entityType: 'schedule_event', entityId: 'v1', declencheur: 'appointment.created' }, { schedule_events: [{ id: 'v1', org_id: ORG, status: 'scheduled', deleted_at: '2026-10-01T00:00:00Z' }] }, 'entite_supprimee', 'le rendez-vous a été supprimé'],
    ['prospect converti', { entityType: 'lead', entityId: 'p1', declencheur: 'lead.created' }, { clients: [{ id: 'p1', org_id: ORG, status: 'active', lead_status: 'new' }] }, 'condition_plus_valide', 'le prospect a été converti en client'],
    ['prospect perdu', { entityType: 'lead', entityId: 'p1', declencheur: 'lead.created' }, { clients: [{ id: 'p1', org_id: ORG, status: 'lead', lead_status: 'lost' }] }, 'condition_plus_valide', 'le prospect est marqué perdu'],
    ['client supprimé', { entityType: 'client', entityId: 'c1', declencheur: 'note.added' }, { clients: [{ id: 'c1', org_id: ORG, status: 'active', deleted_at: '2026-10-01T00:00:00Z' }] }, 'entite_supprimee', 'le client a été supprimé'],
    ['client de la facture supprimé', {}, { invoices: [{ id: 'f1', org_id: ORG, status: 'sent', client_id: 'c1' }], clients: [{ id: 'c1', org_id: ORG, deleted_at: '2026-10-01T00:00:00Z' }] }, 'entite_supprimee', 'le client a été supprimé'],
  ];
  for (const [titre, tache, tables, code, changement] of cas) {
    it(`${titre} → ${code} : « ${changement} »`, async () => {
      const r = await revaliderTache(fauxSupabase(tables).client, base(tache));
      expect(r.arret).toMatchObject({ code, changement });
    });
  }

  it('la situation tient toujours → rien (la tâche part)', async () => {
    const sb = fauxSupabase({ invoices: [{ id: 'f1', org_id: ORG, status: 'sent', client_id: 'c1' }], clients: [{ id: 'c1', org_id: ORG, deleted_at: null }] });
    const r = await revaliderTache(sb.client, base({}));
    expect(r.arret).toBeUndefined();
    expect(r.clientId).toBe('c1');
  });

  it('une LECTURE en échec ne conclut jamais : la tâche suit son cours', async () => {
    const sb = fauxSupabase({ invoices: [{ id: 'f1', org_id: ORG, status: 'paid' }] }, { erreurs: { invoices: 'statement timeout' } });
    expect((await revaliderTache(sb.client, base({}))).arret).toBeUndefined();
  });

  it('une règle déclenchée PAR la résolution ne s’annule pas elle-même (« Facture payée » + délai, « Devis accepté » + 1 h)', async () => {
    const payee = fauxSupabase({ invoices: [{ id: 'f1', org_id: ORG, status: 'paid', client_id: null }] });
    expect((await revaliderTache(payee.client, base({ declencheur: 'invoice.paid' }))).arret).toBeUndefined();
    const acceptee = fauxSupabase({ quotes: [{ id: 'd1', org_id: ORG, status: 'converted' }] });
    expect((await revaliderTache(acceptee.client, base({ entityType: 'quote', entityId: 'd1', declencheur: 'quote.approved' }))).arret).toBeUndefined();
  });

  it('relance de prospect PERDU : elle ne s’annule pas parce que le prospect est perdu', async () => {
    const sb = fauxSupabase({ clients: [{ id: 'p1', org_id: ORG, status: 'lead', lead_status: 'lost' }] });
    const r = await revaliderTache(sb.client, base({ entityType: 'lead', entityId: 'p1', declencheur: 'lead.status_changed', metadonnees: { new_status: 'lost' } }));
    expect(r.arret).toBeUndefined();
  });

  it('drapeau `auto_sortie_parcours` : la case décochée laisse partir malgré l’état résolu ; la suppression arrête toujours', async () => {
    const payee = () => fauxSupabase({ invoices: [{ id: 'f1', org_id: ORG, status: 'paid', client_id: null }] }).client;
    expect((await revaliderTache(payee(), base({ caseParDeclencheur: true, reglages: { arreter_si_resolu: false } }))).arret).toBeUndefined();
    expect((await revaliderTache(payee(), base({ caseParDeclencheur: true, reglages: { arreter_si_resolu: true } }))).arret?.changement).toBe('la facture a été payée');
    // Sans le drapeau, la case n'est pas écoutée : arrêt, comme avant.
    expect((await revaliderTache(payee(), base({ caseParDeclencheur: false, reglages: { arreter_si_resolu: false } }))).arret?.changement).toBe('la facture a été payée');
    const effacee = fauxSupabase({ invoices: [] }).client;
    expect((await revaliderTache(effacee, base({ caseParDeclencheur: true, reglages: { arreter_si_resolu: false } }))).arret?.code).toBe('entite_supprimee');
  });
});

describe('[B-05] les deux textes d’un arrêt', () => {
  it('sur la tâche : « Arrêté : … » ; au journal : le motif de la mission, puis ce qui a changé', () => {
    const a = { code: 'condition_plus_valide' as const, changement: 'la facture a été payée' };
    expect(motifArret(a)).toBe('Arrêté : la facture a été payée.');
    expect(phraseArret(a)).toBe('Condition plus valide : la facture a été payée');
    expect(phraseArret({ code: 'entite_supprimee', changement: 'la facture a été supprimée' })).toBe('Fiche supprimée : la facture a été supprimée');
  });

  it('le motif historique « Annulée : le client a été supprimé. » est gardé tel quel sur la tâche', () => {
    expect(motifArret({ code: 'entite_supprimee', changement: 'le client a été supprimé', motif: 'Annulée : le client a été supprimé.' }))
      .toBe('Annulée : le client a été supprimé.');
  });
});

describe('[B-05] le moteur écrit l’arrêt sur la tâche ET au journal', () => {
  const tache = (extra: Ligne = {}): Ligne => ({
    id: 'tache-1', org_id: ORG, automation_rule_id: 'r1', entity_type: 'invoice', entity_id: 'f1', attempts: 0, status: 'pending', step_id: null,
    execute_at: new Date(Date.now() - 1000).toISOString(), created_at: new Date(Date.now() - 86_400_000).toISOString(), execution_key: 'r1:f1:0',
    action_config: { type: 'send_email', config: { subject: 'S', body: 'B' }, trigger_event: 'invoice.overdue', event_metadata: {} },
    automation_rules: { name: 'Relance', actions: [{ type: 'send_email', config: {} }], steps: null, conditions: {}, settings: { fenetre: { debut: 0, fin: 24 } }, is_active: true, deleted_at: null, trigger_event: 'invoice.overdue', delay_seconds: 86_400 },
    ...extra,
  });

  async function passer(tables: Record<string, Ligne[]>) {
    const { initAutomationEngine, processScheduledTasks } = await import('../../../server/lib/automationEngine');
    const { eventBus } = await import('../../../server/lib/eventBus');
    const sb = fauxSupabase({ company_settings: [{ org_id: ORG, timezone: 'America/Toronto', automations_paused: false }], ...tables });
    eventBus.removeAllListeners();
    initAutomationEngine({ supabase: sb.client, twilio: null as never, baseUrl: 'http://t' });
    await processScheduledTasks(sb.client);
    return sb;
  }

  it('facture payée pendant le délai : tâche annulée « Arrêté : la facture a été payée. », code sur la tâche, UNE ligne au journal', async () => {
    const sb = await passer({ automation_scheduled_tasks: [tache()], invoices: [{ id: 'f1', org_id: ORG, status: 'paid', client_id: null }] });
    const t = sb.tables.automation_scheduled_tasks[0];
    expect(t).toMatchObject({ status: 'cancelled', last_error: 'Arrêté : la facture a été payée.', action_config: { motif_code: 'condition_plus_valide' } });
    expect(sb.tables.automation_execution_logs).toHaveLength(1);
    expect(sb.tables.automation_execution_logs[0]).toMatchObject({
      org_id: ORG, automation_rule_id: 'r1', scheduled_task_id: 'tache-1', entity_type: 'invoice', entity_id: 'f1', action_type: 'send_email',
      trigger_event: 'invoice.overdue', result_success: true, result_error: null,
      result_data: { saute: 'Condition plus valide : la facture a été payée', saute_code: 'condition_plus_valide', changement: 'la facture a été payée' },
    });
  });

  it('automatisation repassée en brouillon : `regle_inactive`, avec sa ligne', async () => {
    const t0 = tache();
    t0.automation_rules.is_active = false;
    const sb = await passer({ automation_scheduled_tasks: [t0] });
    expect(sb.tables.automation_scheduled_tasks[0]).toMatchObject({ status: 'cancelled', last_error: 'Automatisation en brouillon : envoi annulé.', action_config: { motif_code: 'regle_inactive' } });
    expect(sb.tables.automation_execution_logs.map((l) => l.result_data.saute_code)).toEqual(['regle_inactive']);
  });

  it('étape retirée du parcours : `etape_retiree`, avec sa ligne', async () => {
    const t0 = tache({ step_id: 'disparue' });
    t0.automation_rules.steps = [{ id: 'm1', type: 'action', action: { type: 'send_email', config: {} }, suivant: null }];
    const sb = await passer({ automation_scheduled_tasks: [t0] });
    expect(sb.tables.automation_scheduled_tasks[0]).toMatchObject({ status: 'cancelled', last_error: 'Étape supprimée du parcours : envoi annulé.', action_config: { motif_code: 'etape_retiree' } });
    expect(sb.tables.automation_execution_logs.map((l) => l.result_data)).toEqual([{ saute: 'Étape retirée du parcours', saute_code: 'etape_retiree' }]);
  });

  it('« Arrêter quand le client répond » : `client_a_repondu`, avec sa ligne', async () => {
    const t0 = tache();
    t0.automation_rules.settings = { fenetre: { debut: 0, fin: 24 }, arret_sur_reponse: true };
    const sb = await passer({
      automation_scheduled_tasks: [t0],
      invoices: [{ id: 'f1', org_id: ORG, status: 'sent', client_id: 'c1' }],
      clients: [{ id: 'c1', org_id: ORG, deleted_at: null }],
      messages: [{ id: 'm1', org_id: ORG, client_id: 'c1', direction: 'inbound', created_at: new Date().toISOString() }],
    });
    expect(sb.tables.automation_scheduled_tasks[0]).toMatchObject({ status: 'cancelled', last_error: 'Annulée : le client a répondu.', action_config: { motif_code: 'client_a_repondu' } });
    expect(sb.tables.automation_execution_logs.map((l) => l.result_data.saute_code)).toEqual(['client_a_repondu']);
  });
});
