/**
 * Un parcours VIDÉ (`steps = []`) n'envoie pas l'ancien message resté dans
 * `actions`.
 *
 * Une règle convertie en parcours porte deux copies de son message : `steps`
 * (l'éditeur) et `actions` (l'ancienne, jamais mise à jour). Le moteur
 * testait « steps non vide » : quand l'utilisateur supprimait la dernière
 * étape, il retombait sur `actions` et envoyait ce qui venait d'être supprimé.
 *
 * La règle, une seule pour tout le moteur (`estParcours`) : `steps` est un
 * tableau, même vide → parcours, `actions` n'est jamais lu.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const etat = vi.hoisted(() => ({ appels: [] as string[] }));
vi.mock('../../../server/lib/url-sortante', async (orig) => ({
  ...(await orig<any>()),
  posterSansSsrf: vi.fn(async (url: string) => { etat.appels.push(url); return new Response('ok', { status: 200 }); }),
}));

import { clientEnregistreur, requetes, journalExecutionsUnique } from '../../quarantaine/automation/_enregistreur';
import { estParcours, regleSansRienAFaire } from '../../../server/lib/automationSequences';
import { couvertureAutomatisations } from '../../../server/routes/reminders-cron';

const ORG = '11111111-1111-4111-8111-111111111111';
const ANCIEN = { type: 'webhook', config: { url: 'https://hooks.example.test/ancien-message' } };
const NOUVEAU = { type: 'webhook', config: { url: 'https://hooks.example.test/nouveau-message' } };
const regle = (extra: Record<string, unknown>) => ({
  id: 'r1', org_id: ORG, name: 'R', trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: true, actions: [ANCIEN], ...extra,
});
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function moteur(reponses: Record<string, any>) {
  const { initAutomationEngine, processScheduledTasks } = await import('../../../server/lib/automationEngine');
  const { eventBus } = await import('../../../server/lib/eventBus');
  const { client, journal } = clientEnregistreur({
    company_settings: { data: { company_name: 'A' } },
    clients: { data: [{ id: 'l1', status: 'lead', lead_status: 'new', deleted_at: null }] },
    automation_execution_logs: journalExecutionsUnique(),
    ...reponses,
  });
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: null as never, baseUrl: 'http://t' });
  return { client, journal, eventBus, processScheduledTasks };
}

beforeEach(() => { etat.appels.length = 0; });

describe('la règle : qu’est-ce qu’une automatisation exécute ?', () => {
  it('`steps` tableau, même vide → parcours ; `steps` null → règle à plat', () => {
    expect(estParcours({ steps: [] })).toBe(true);
    expect(estParcours({ steps: [{ id: 'a' }] })).toBe(true);
    expect(estParcours({ steps: null })).toBe(false);
    expect(estParcours({})).toBe(false);
  });

  it('un parcours vide n’a rien à faire, même si `actions` est plein', () => {
    expect(regleSansRienAFaire({ steps: [], actions: [ANCIEN] })).toBe(true);
    expect(regleSansRienAFaire({ steps: [{ id: 'a' }], actions: [] })).toBe(false);
    expect(regleSansRienAFaire({ steps: null, actions: [ANCIEN] })).toBe(false);
    expect(regleSansRienAFaire({ steps: null, actions: [] })).toBe(true);
  });
});

describe('le moteur n’exécute jamais `actions` quand `steps` est un tableau', () => {
  it('parcours VIDÉ (`steps = []`, `actions` plein) : l’événement n’envoie RIEN, et le journal dit pourquoi', async () => {
    const { journal, eventBus } = await moteur({ automation_rules: { data: [regle({ steps: [] })] } });
    await eventBus.emit('lead.created', { orgId: ORG, entityType: 'lead', entityId: 'l1', metadata: {} });
    await attendre(300);
    expect(etat.appels).toEqual([]);
    expect(requetes(journal, 'automation_scheduled_tasks', 'insert')).toHaveLength(0);
    const lignes = requetes(journal, 'automation_execution_logs', 'insert').map((r) => r.valeur as any);
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({ result_success: true, result_data: { saute_code: 'parcours_vide' } });
  });

  it('témoin, l’autre sens : règle à plat jamais convertie (`steps = null`) → `actions` part', async () => {
    const { eventBus } = await moteur({ automation_rules: { data: [regle({ steps: null })] } });
    await eventBus.emit('lead.created', { orgId: ORG, entityType: 'lead', entityId: 'l1', metadata: {} });
    await attendre(300);
    expect(etat.appels).toEqual([ANCIEN.config.url]);
  });

  it('parcours non vide + ancienne copie `actions` : c’est l’étape du parcours qui est planifiée, jamais `actions`', async () => {
    const { journal, eventBus } = await moteur({
      automation_rules: { data: [regle({ steps: [{ id: 'm1', type: 'action', action: NOUVEAU, suivant: null }] })] },
    });
    await eventBus.emit('lead.created', { orgId: ORG, entityType: 'lead', entityId: 'l1', metadata: {} });
    await attendre(300);
    expect(etat.appels).toEqual([]); // un parcours passe par la file
    const taches = requetes(journal, 'automation_scheduled_tasks', 'insert').map((r) => r.valeur as any);
    expect(taches).toHaveLength(1);
    expect(taches[0]).toMatchObject({ step_id: 'm1', action_config: { config: { url: NOUVEAU.config.url } } });
  });

  it('une tâche « à plat » encore en file quand la règle devient un parcours est ANNULÉE, pas exécutée', async () => {
    const tache = {
      id: 'tache-1', org_id: ORG, automation_rule_id: 'r1', entity_type: 'lead', entity_id: 'l1', attempts: 0, status: 'pending', step_id: null,
      execute_at: new Date().toISOString(), created_at: new Date().toISOString(), execution_key: 'r1:l1:0',
      action_config: { ...ANCIEN, trigger_event: 'lead.created', event_metadata: {} },
      automation_rules: { name: 'R', actions: [ANCIEN], steps: [], conditions: {}, is_active: true, deleted_at: null },
    };
    const { client, journal, processScheduledTasks } = await moteur({
      automation_scheduled_tasks: (req: any) => (req.op === 'select' ? { data: [tache] } : { data: [{ id: tache.id }] }),
    });
    await processScheduledTasks(client);
    expect(etat.appels).toEqual([]);
    const maj = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).find((v) => v.status === 'cancelled');
    expect(maj).toMatchObject({ status: 'cancelled', action_config: { motif_code: 'etape_retiree' } });
    const ligne = requetes(journal, 'automation_execution_logs', 'insert').map((r) => r.valeur as any);
    expect(ligne).toHaveLength(1);
    expect(ligne[0]).toMatchObject({ scheduled_task_id: 'tache-1', action_type: 'webhook', result_success: true, result_data: { saute_code: 'etape_retiree' } });
  });
});

describe('les autres lecteurs de la règle suivent la même loi', () => {
  it('relances de paiement : un parcours « Facture en retard » VIDÉ ne couvre aucune facture (le cron relance)', async () => {
    const facture = { id: 'f1', status: 'sent', balance_cents: 1000, due_date: '2026-10-01' };
    const svc = (regles: unknown[]) => clientEnregistreur({ automation_rules: { data: regles } }).client;
    const vide = await couvertureAutomatisations(svc([{ id: 'r', trigger_event: 'invoice.overdue', preset_key: null, conditions: {}, steps: [], actions: [ANCIEN] }]), ORG, '2026-10-04');
    expect(await vide(facture)).toBe(false);
    const plein = await couvertureAutomatisations(svc([{ id: 'r', trigger_event: 'invoice.overdue', preset_key: null, conditions: {}, steps: null, actions: [ANCIEN] }]), ORG, '2026-10-04');
    expect(await plein(facture)).toBe(true);
  });

  it('« Démarrer une automatisation » : un parcours vidé n’a rien à démarrer', async () => {
    const { executeAction } = await import('../../../server/lib/actions');
    const { client } = clientEnregistreur({
      automation_rules: { data: [{ id: 'cible', name: 'Parcours vidé', is_active: true, deleted_at: null, actions: [ANCIEN], steps: [] }] },
    });
    const r = await executeAction('demarrer_automatisation' as never, { rule_id: 'cible' }, {}, {
      supabase: client, orgId: ORG, entityType: 'lead', entityId: 'l1', twilio: null, baseUrl: 'http://t', ruleId: 'autre',
    } as never);
    expect(r.success).toBe(false);
    expect(String(r.error)).toMatch(/n'a aucune action/);
  });
});
