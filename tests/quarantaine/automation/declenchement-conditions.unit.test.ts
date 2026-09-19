/**
 * T1 (déclenchement) et T2 (conditions) — unitaires, vrais modules.
 *
 * `evaluateConditions` n'est pas exportée : on la traverse par le bus, avec une
 * règle immédiate `log_activity` comme témoin — la règle a matché si et
 * seulement si UN log d'exécution est écrit. Les tests existants de
 * `automation-engine.test.ts` recopiaient la fonction ; ceux-ci ne le font pas.
 *
 * T1.2 (« sauvegardé sans changement ») n'a pas de siège côté serveur : la
 * détection vit dans src/lib/jobsApi.ts:258-296 (navigateur). Elle est couverte
 * indirectement par T4.1/T4.2 et T1.3 (rejeu = doublon), rouges tant que F12
 * n'est pas corrigé. Voir AUTOMATIONS_TEST_PLAN.md, T1 et T2.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../server/lib/mailer', () => ({ sendEmail: vi.fn(async () => ({ sent: true })), isMailerConfigured: () => true }));
vi.mock('../../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'test@lume.test' }) }));
vi.mock('../../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));

import { clientEnregistreur, requetes } from './_enregistreur';
import { AUTOMATION_PRESETS } from '../../../server/lib/automationPresets.data';

const ORG = '11111111-1111-4111-8111-111111111111';
const LEAD = '33333333-3333-4333-8333-333333333333';
const VISITE = '55555555-5555-4555-8555-555555555555';

const base = () => ({
  company_settings: { data: { company_name: 'A inc.', default_language: 'fr' } },
  clients: { data: { first_name: 'Alice', last_name: 'A', email: 'alice@a.test', phone: '+15145550101', status: 'lead', lead_status: 'new' } },
  schedule_events: { data: { id: VISITE, job_id: 'job-a', start_at: '2026-09-25T13:00:00Z', job: { id: 'job-a', title: 'T', property_address: 'x', client_id: 'c', clients: { first_name: 'Alice', last_name: 'A', email: 'alice@a.test', phone: '+15145550101' } } } },
  job_agreements: { data: null }, sms_opt_outs: { data: null }, conversations: { data: { id: 'conv-1', client_id: null } },
  messages: { data: null, count: 0 }, activity_log: { data: null }, automation_execution_logs: { data: null }, automation_scheduled_tasks: { data: null },
});

/** Règle immédiate témoin : `log_activity` seul, avec les conditions données. */
const temoin = (conditions: Record<string, unknown>, trigger = 'lead.status_changed', delay = 0) => ({
  id: `regle-${JSON.stringify(conditions)}`, org_id: ORG, name: 'témoin', trigger_event: trigger, conditions, delay_seconds: delay, is_active: true,
  actions: [{ type: 'log_activity', config: { event_type: 'temoin' } }],
});

let twilio: { messages: { create: ReturnType<typeof vi.fn> } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-15T18:00:00Z')); // 14 h Montréal
  twilio = { messages: { create: vi.fn(async () => ({ sid: 'SM' })) } };
});
afterEach(() => vi.useRealTimers());

async function moteur(reponses: Record<string, any>) {
  const { initAutomationEngine } = await import('../../../server/lib/automationEngine');
  const { eventBus } = await import('../../../server/lib/eventBus');
  const { client, journal } = clientEnregistreur(reponses);
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: { client: twilio, phoneNumber: '+15550000000' }, baseUrl: 'http://test' });
  return { client, journal, eventBus };
}
const laisserTravailler = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

/** Émet et compte les logs d'exécution : 1 = la règle a matché, 0 = non. */
async function aMatche(regle: any, metadata: Record<string, unknown>, trigger = 'lead.status_changed', entityType = 'lead', entityId = LEAD) {
  const { eventBus, journal } = await moteur({ ...base(), automation_rules: { data: [regle] } });
  await eventBus.emit(trigger as any, { orgId: ORG, entityType, entityId, metadata });
  await laisserTravailler();
  return requetes(journal, 'automation_execution_logs', 'insert').length + requetes(journal, 'automation_scheduled_tasks', 'insert').length;
}

/* ═══════════════════ T2 — Conditions ═══════════════════ */

describe('T2.1 — opérateurs, types et valeurs vides', () => {
  const cas: Array<[string, Record<string, unknown>, Record<string, unknown>, number]> = [
    ['égalité directe, chaîne vs nombre (« 3 » = 3)', { days_overdue: '3' }, { days_overdue: 3 }, 1],
    ['égalité directe, valeur différente', { days_overdue: '3' }, { days_overdue: 5 }, 0],
    ['eq explicite', { new_status: { eq: 'lost' } }, { new_status: 'lost' }, 1],
    ['neq sur une clé absente (undefined) : vrai', { payment_type: { neq: 'deposit' } }, {}, 1],
    ['neq sur la valeur exclue : faux', { payment_type: { neq: 'deposit' } }, { payment_type: 'deposit' }, 0],
    ['« null » (chaîne) vs null : jamais égaux', { a: 'null' }, { a: null }, 0],
    ['in, mélange de types', { a: { in: [1, '2'] } }, { a: 2 }, 1],
    ['in, absent de la liste', { a: { in: [1, '2'] } }, { a: 3 }, 0],
    ['not_in, valeur hors liste : vrai', { a: { not_in: ['x'] } }, { a: 'y' }, 1],
    ['not_in, valeur dans la liste : faux', { a: { not_in: ['x'] } }, { a: 'x' }, 0],
    ['chaîne vide vs zéro : faux', { a: '' }, { a: 0 }, 0],
    ['valeur objet : jamais égale', { a: { eq: 'x' } }, { a: { x: 1 } }, 0],
    ['clé absente avec eq : faux', { a: { eq: 'x' } }, {}, 0],
    ['sans condition : toujours vrai', {}, { n: 'importe' }, 1],
  ];
  for (const [nom, conditions, metadata, attendu] of cas) {
    it(`${nom} → ${attendu ? 'matche' : 'ne matche pas'}`, async () => {
      expect(await aMatche(temoin(conditions), metadata)).toBe(attendu);
    });
  }
});

describe('T2.2 — opérateur inconnu : la règle est refusée, jamais exécutée par défaut', () => {
  it('{ gt: 5 } → 0 exécution et un avertissement explicite', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await aMatche(temoin({ amount_cents: { gt: 5 } }), { amount_cents: 100 })).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/opérateur\(s\) non supporté\(s\).*amount_cents.*gt/));
    warn.mockRestore();
  });

  it('un opérateur connu + un inconnu sur la même clé → refusé aussi', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await aMatche(temoin({ a: { eq: 'x', contains: 'x' } }), { a: 'x' })).toBe(0);
  });
});

describe('T2.3 — plusieurs clés = ET implicite', () => {
  it('deux clés vraies → matche ; une fausse → ne matche pas', async () => {
    expect(await aMatche(temoin({ new_status: 'lost', channel: 'sms' }), { new_status: 'lost', channel: 'sms' })).toBe(1);
    expect(await aMatche(temoin({ new_status: 'lost', channel: 'sms' }), { new_status: 'lost', channel: 'email' })).toBe(0);
  });
});

describe('T2.4 — ancienne / nouvelle valeur, telles que l’émetteur les fournit', () => {
  it('old_status + new_status → transition précise', async () => {
    const r = temoin({ old_status: 'contacted', new_status: 'lost' });
    expect(await aMatche(r, { old_status: 'contacted', new_status: 'lost' })).toBe(1);
    expect(await aMatche(r, { old_status: 'new', new_status: 'lost' })).toBe(0);
  });
});

describe('T2.5 — dates : égalité de chaîne seulement', () => {
  it('même chaîne YYYY-MM-DD → matche ; aucune comparaison temporelle n’existe (limite S3)', async () => {
    expect(await aMatche(temoin({ due_date: '2026-09-01' }), { due_date: '2026-09-01' })).toBe(1);
    // « avant le 2 » n'est pas exprimable : { lt } est inconnu → refusé (T2.2).
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await aMatche(temoin({ due_date: { lt: '2026-09-02' } }), { due_date: '2026-09-01' })).toBe(0);
  });
});

/* ═══════════════════ T1 — Déclenchement ═══════════════════ */

describe('T1.1 — le preset réel « lost_lead_reengagement » ne s’arme que sur un lead perdu', () => {
  const preset = AUTOMATION_PRESETS.find((p) => p.preset_key === 'lost_lead_reengagement')!;
  const regle = { id: 'r-lost', org_id: ORG, name: preset.name, trigger_event: preset.trigger_event, conditions: preset.conditions, delay_seconds: preset.delay_seconds, actions: preset.actions, is_active: true };

  it('new_status = lost → 3 tâches planifiées à +90 jours', async () => {
    const { eventBus, journal } = await moteur({ ...base(), automation_rules: { data: [regle] } });
    await eventBus.emit('lead.status_changed', { orgId: ORG, entityType: 'lead', entityId: LEAD, metadata: { old_status: 'contacted', new_status: 'lost' } });
    await laisserTravailler();
    const taches = requetes(journal, 'automation_scheduled_tasks', 'insert').map((r) => r.valeur as any);
    expect(taches).toHaveLength(preset.actions.length);
    expect(taches[0].execute_at).toBe(new Date(Date.now() + 90 * 86400_000).toISOString());
  });

  it('new_status = won → rien', async () => {
    const { eventBus, journal } = await moteur({ ...base(), automation_rules: { data: [regle] } });
    await eventBus.emit('lead.status_changed', { orgId: ORG, entityType: 'lead', entityId: LEAD, metadata: { old_status: 'contacted', new_status: 'won' } });
    await laisserTravailler();
    expect(requetes(journal, 'automation_scheduled_tasks', 'insert')).toHaveLength(0);
  });
});

describe('T1.5 — visites créées en lot (suppress_immediate)', () => {
  const confirmation = { id: 'r-conf', org_id: ORG, name: 'Confirmation', trigger_event: 'appointment.created', conditions: {}, delay_seconds: 0, is_active: true, actions: [{ type: 'send_sms', config: { body: 'Confirmé' } }] };
  const rappel = { id: 'r-rappel', org_id: ORG, name: 'Rappel J-1', trigger_event: 'appointment.created', conditions: {}, delay_seconds: -86400, is_active: true, actions: [{ type: 'send_sms', config: { body: 'Rappel' } }] };

  it('avec le drapeau : la confirmation immédiate est sautée, le rappel daté est planifié', async () => {
    const { eventBus, journal } = await moteur({ ...base(), automation_rules: { data: [confirmation, rappel] } });
    await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: { suppress_immediate: true } });
    await laisserTravailler();
    expect(twilio.messages.create).not.toHaveBeenCalled();
    expect(requetes(journal, 'automation_execution_logs', 'insert')).toHaveLength(0);
    expect(requetes(journal, 'automation_scheduled_tasks', 'insert').map((r) => (r.valeur as any).automation_rule_id)).toEqual(['r-rappel']);
  });

  it('sans le drapeau : la confirmation part et le rappel est planifié', async () => {
    const { eventBus, journal } = await moteur({ ...base(), automation_rules: { data: [confirmation, rappel] } });
    await eventBus.emit('appointment.created', { orgId: ORG, entityType: 'schedule_event', entityId: VISITE, metadata: {} });
    await laisserTravailler();
    expect(twilio.messages.create).toHaveBeenCalledTimes(1);
    expect(requetes(journal, 'automation_scheduled_tasks', 'insert')).toHaveLength(1);
  });
});

describe('T1.6 — une règle désactivée n’est jamais sélectionnée', () => {
  it('la sélection des règles porte is_active = true, org_id et trigger_event', async () => {
    const { eventBus, journal } = await moteur({ ...base(), automation_rules: { data: [] } });
    await eventBus.emit('lead.created', { orgId: ORG, entityType: 'lead', entityId: LEAD, metadata: {} });
    await laisserTravailler();
    const sel = requetes(journal, 'automation_rules', 'select');
    expect(sel).toHaveLength(1);
    expect(sel[0].filtres).toEqual(expect.arrayContaining([['eq', 'org_id', ORG], ['eq', 'trigger_event', 'lead.created'], ['eq', 'is_active', true]]));
  });
});

describe('T1.7 — un événement que personne n’écoute ne coûte qu’une ligne d’activité', () => {
  it('aucune règle → une lecture des règles, un insert activity_log, rien d’autre', async () => {
    const { eventBus, journal } = await moteur({ ...base(), automation_rules: { data: [] } });
    await eventBus.emit('invoice.overdue', { orgId: ORG, entityType: 'invoice', entityId: 'inv-1', metadata: { days_overdue: 3 } });
    await laisserTravailler();
    const tables = journal.map((r) => `${r.op}:${r.table}`);
    expect(tables).toEqual(['insert:activity_log', 'select:automation_rules']);
  });
});

describe('T1.8 — ordre d’exécution des règles d’un même événement (F17)', () => {
  it('ROUGE ATTENDU : la sélection des règles est ordonnée (created_at, id) pour être déterministe', async () => {
    const { eventBus, journal } = await moteur({ ...base(), automation_rules: { data: [] } });
    await eventBus.emit('lead.created', { orgId: ORG, entityType: 'lead', entityId: LEAD, metadata: {} });
    await laisserTravailler();
    // Le client enregistreur note les filtres, pas l'ordre : on lit la requête source.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('server/lib/automationEngine.ts', 'utf8');
    const bloc = src.slice(src.indexOf(".from('automation_rules')"), src.indexOf(".eq('is_active', true)") + 30);
    expect(bloc, `sélection des règles sans order by : ${bloc.replace(/\s+/g, ' ')}`).toMatch(/\.order\(/);
  });
});
