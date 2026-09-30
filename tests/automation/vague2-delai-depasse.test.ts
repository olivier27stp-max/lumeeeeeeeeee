/**
 * Une action lente n'est ni journalisée « échec » à tort, ni refaite en
 * double (audit V2, D-08, C24, D-15).
 *
 * Mesuré sur staging : une action au-delà de 5 s continuait et RÉUSSISSAIT,
 * mais le journal disait « échec » (66/150 sous charge) ; dans la file, la
 * tâche partait en reprise et le webhook était POSTÉ DEUX FOIS ; et un rejeu
 * de l'outbox après une coupure recréait tâches et webhooks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const etat = vi.hoisted(() => ({ appels: [] as Array<{ url: string; entetes?: Record<string, string> }>, lenteurMs: 0 }));
vi.mock('../../server/lib/url-sortante', async (orig) => ({
  ...(await orig<any>()),
  posterSansSsrf: vi.fn(async (url: string, _corps: unknown, options: { entetes?: Record<string, string> } = {}) => {
    etat.appels.push({ url, entetes: options.entetes });
    if (etat.lenteurMs) await new Promise((r) => setTimeout(r, etat.lenteurMs));
    return new Response('ok', { status: 200 });
  }),
}));
vi.mock('../../server/lib/mailer', async () => (await import('../quarantaine/_simulations')).mailerSimule(vi.fn(async () => ({ sent: true, messageId: 'x' }))));
vi.mock('../../server/routes/emails', async () => (await import('../quarantaine/_simulations')).emailsSimules());

import { clientEnregistreur, requetes, journalExecutionsUnique } from '../quarantaine/automation/_enregistreur';

const ORG = '11111111-1111-4111-8111-111111111111';
const WEBHOOK = { type: 'webhook', config: { url: 'https://hooks.example.test/lume' } };
const regle = (actions: unknown[]) => ({ id: 'r1', org_id: ORG, name: 'R', trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: true, actions });

async function moteur(reponses: Record<string, any>) {
  const { initAutomationEngine, processScheduledTasks } = await import('../../server/lib/automationEngine');
  const { eventBus } = await import('../../server/lib/eventBus');
  const { client, journal } = clientEnregistreur({
    company_settings: { data: { company_name: 'A' } },
    memberships: { data: [{ user_id: 'u1', role: 'owner', status: 'active' }] },
    // Le prospect existe et n'est ni perdu ni converti : la condition d'arrêt ne coupe pas la tâche.
    clients: { data: [{ id: 'l1', status: 'lead', lead_status: 'new', deleted_at: null }] },
    ...reponses,
  });
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: null as any, baseUrl: 'http://t' });
  return { client, journal, eventBus, processScheduledTasks };
}
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => { etat.appels.length = 0; etat.lenteurMs = 0; });

describe('D-08 — action immédiate lente : le vrai résultat est journalisé', () => {
  it('« en attente » à 5 s, puis la MÊME ligne passe en succès', async () => {
    etat.lenteurMs = 5_600;
    const { journal, eventBus } = await moteur({ automation_rules: { data: [regle([WEBHOOK])] }, automation_execution_logs: journalExecutionsUnique() });
    await eventBus.emit('lead.created', { orgId: ORG, entityType: 'lead', entityId: 'l1', metadata: {} });
    await attendre(7_000);
    const majs = requetes(journal, 'automation_execution_logs', 'update').map((r) => r.valeur as any);
    expect(majs[0].result_error).toMatch(/résultat en attente/);
    expect(majs.at(-1)).toMatchObject({ result_success: true, result_error: null });
    expect(etat.appels).toHaveLength(1);
  }, 15_000);
});

describe('C24 — tâche planifiée lente : un seul envoi, reprise annulée', () => {
  it('le webhook part une fois, avec sa clé d’idempotence ; la tâche est close', async () => {
    etat.lenteurMs = 5_600;
    const tache = {
      id: 'tache-1', org_id: ORG, automation_rule_id: 'r1', entity_type: 'lead', entity_id: 'l1', attempts: 0, status: 'pending',
      execute_at: new Date().toISOString(), created_at: new Date().toISOString(), execution_key: 'r1:l1:0',
      action_config: { ...WEBHOOK, trigger_event: 'lead.created', event_metadata: {} }, automation_rules: { name: 'R', actions: [WEBHOOK], conditions: {} },
    };
    const { client, journal, processScheduledTasks } = await moteur({
      automation_rules: { data: [regle([WEBHOOK])] },
      automation_scheduled_tasks: (req: any) => (req.op === 'select' ? { data: [tache] } : { data: [{ id: tache.id }] }),
    });
    await processScheduledTasks(client);
    await attendre(1_500);
    const majs = requetes(journal, 'automation_scheduled_tasks', 'update').map((r) => ({ v: r.valeur as any, f: r.filtres }));
    // 1) reprise programmée pendant l'attente ; 2) clôture quand le résultat arrive — seulement si encore « pending ».
    expect(majs.some((m) => m.v?.status === 'pending' && /résultat en attente/.test(m.v.last_error))).toBe(true);
    const cloture = majs.find((m) => m.v?.status === 'completed');
    expect(cloture?.f).toContainEqual(['eq', 'status', 'pending']);
    expect(etat.appels).toHaveLength(1);
    expect(etat.appels[0].entetes?.['Idempotency-Key']).toBeTruthy();
  }, 15_000);
});

describe('D-15 — rejeu de l’outbox : une action déjà faite n’est pas refaite', () => {
  it('webhook déjà exécuté depuis l’heure du rejeu → pas de 2e POST', async () => {
    const { eventBus } = await moteur({
      automation_rules: { data: [regle([WEBHOOK])] },
      automation_execution_logs: (req: any) => (req.op === 'select' && req.filtres.some((f: any[]) => f[0] === 'like')
        ? { data: [{ id: 'deja-fait' }] }
        : { data: req.op === 'insert' ? [{ id: 'resa' }] : null }),
    });
    await eventBus.emit('lead.created', { orgId: ORG, entityType: 'lead', entityId: 'l1', metadata: {}, rejoueDepuis: new Date(Date.now() - 300_000).toISOString() } as any);
    await attendre(300);
    expect(etat.appels).toHaveLength(0);
  });

  it('témoin : sans exécution précédente, le rejeu exécute', async () => {
    const { eventBus } = await moteur({
      automation_rules: { data: [regle([WEBHOOK])] },
      automation_execution_logs: (req: any) => ({ data: req.op === 'insert' ? [{ id: 'resa' }] : null }),
    });
    await eventBus.emit('lead.created', { orgId: ORG, entityType: 'lead', entityId: 'l1', metadata: {}, rejoueDepuis: new Date(Date.now() - 300_000).toISOString() } as any);
    await attendre(300);
    expect(etat.appels).toHaveLength(1);
  });
});
