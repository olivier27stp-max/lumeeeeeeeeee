/**
 * Launch 2026-09-28 — M5 : jamais deux fois le même message.
 *
 * Trois chemins renvoyaient un message déjà parti :
 *   1. délai dépassé : l'action est abandonnée à 5 s, mais l'appel Twilio
 *      continue et aboutit ; la reprise 5 min plus tard renvoyait ;
 *   2. clôture ratée : l'envoi réussit, la mise à jour du statut échoue, la
 *      tâche reste « running », est récupérée et repart ;
 *   3. rejeu de l'outbox : un événement coupé en plein traitement est
 *      rejoué et ses actions immédiates repartent.
 * Chaque test joue le VRAI moteur avec une base simulée qui garde ce qui est
 * écrit dans `messages` (l'envoi réel laisse cette trace).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const etat = vi.hoisted(() => ({ client: { current: null as any } }));
vi.mock('../../server/lib/supabase', async (orig) => ({
  ...(await orig<any>()),
  getServiceClient: () => etat.client.current,
}));
vi.mock('../../server/lib/twilioProvisioning', async (orig) => ({
  ...(await orig<any>()),
  getOrgSmsFromNumber: async () => '+15550000000',
}));

import { monde, evenementPour, ORG, IDS } from './filet-regression/_banc';
import { clientEnregistreur, requetes, type Requete } from './filet-regression/_enregistreur';
import { oublierDrapeaux } from '../../server/lib/automations-drapeaux';

process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.lume.test';

const TEXTE = 'Rappel : votre rendez-vous est demain.';
const REGLE = { id: 'regle-rappel', trigger_event: 'appointment.created', delay_seconds: 0, actions: [{ type: 'send_sms', config: { body: TEXTE } }] };
const CREEE = '2026-09-13T14:00:00Z';

/** Une base simulée qui GARDE les messages écrits (trace d'un envoi réel). */
function base(opts: { tache?: Record<string, unknown>; clotureEchoue?: boolean; messages: any[] }) {
  const { client, journal } = clientEnregistreur({
    ...monde(REGLE as any),
    messages: (req: Requete) => {
      if (req.op === 'insert') { opts.messages.push(req.valeur); return { data: [req.valeur] }; }
      return { data: opts.messages };
    },
    automation_scheduled_tasks: (req: Requete) => {
      if (req.op === 'select') return { data: opts.tache && req.filtres.some(([, c, v]) => c === 'status' && v === 'pending') ? [opts.tache] : [] };
      if (req.op === 'update' && opts.clotureEchoue && (req.valeur as any)?.status === 'completed') {
        return { data: null, error: { message: 'connexion perdue' } };
      }
      return { data: [{ id: 'x' }] };
    },
  });
  etat.client.current = client;
  return { client, journal };
}

function tache(attempts: number) {
  return {
    id: 'tache-1', org_id: ORG, automation_rule_id: REGLE.id, entity_type: 'schedule_event', entity_id: IDS.visite,
    attempts, status: 'pending', execute_at: '2026-09-13T15:00:00Z', created_at: CREEE, execution_key: 'k',
    action_config: { type: 'send_sms', config: { body: TEXTE }, trigger_event: 'appointment.created' },
    step_id: null, sequence_context: null,
    automation_rules: { name: 'Rappel', actions: REGLE.actions, conditions: {}, steps: null, settings: null, trigger_event: REGLE.trigger_event, delay_seconds: 86400, preset_key: null, is_active: true, deleted_at: null },
  };
}

async function moteur(client: any, twilioCreate: (p: any) => Promise<any>) {
  const eng = await import('../../server/lib/automationEngine');
  eng.initAutomationEngine({ supabase: client, twilio: { client: { messages: { create: twilioCreate } }, phoneNumber: '+15550000000' }, baseUrl: 'https://app.lume.test' } as any);
  return eng;
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => { oublierDrapeaux(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-13T15:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('M5 — anti-doublon', () => {
  it('délai dépassé : Twilio répond après 5 s, la reprise ne renvoie PAS', async () => {
    const messages: any[] = [];
    const create = vi.fn(async (p: any) => { await attendre(5_500); return { sid: 'SM_lent', to: p.to }; });

    // 1re tentative : abandonnée à 5 s, mais l'envoi aboutit en arrière-plan.
    let b = base({ tache: tache(0), messages });
    let eng = await moteur(b.client, create);
    await eng.processScheduledTasks(b.client);
    const miseEnReprise = requetes(b.journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).find((v) => v?.status === 'pending' && v?.last_error);
    expect(miseEnReprise?.last_error).toMatch(/n'a pas répondu/);
    await attendre(800); // l'appel lent se termine et laisse sa trace
    expect(create).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(1);

    // Reprise 5 min plus tard (attempts = 1).
    vi.setSystemTime(new Date('2026-09-13T15:05:00Z'));
    b = base({ tache: tache(1), messages });
    eng = await moteur(b.client, create);
    await eng.processScheduledTasks(b.client);
    expect(create).toHaveBeenCalledTimes(1); // pas de 2e texto
    const cloture = requetes(b.journal, 'automation_scheduled_tasks', 'update').map((r) => r.valeur as any).find((v) => v?.status && v.status !== 'running' && v.execute_at === undefined);
    expect(cloture?.status).toBe('completed');
    const log = requetes(b.journal, 'automation_execution_logs', 'insert').map((r) => r.valeur as any)[0];
    expect(log.result_data).toMatchObject({ saute_code: 'deja_envoye' });
  }, 20_000);

  it('clôture ratée puis récupération : la reprise ne renvoie PAS', async () => {
    const messages: any[] = [];
    const create = vi.fn(async (p: any) => ({ sid: 'SM1', to: p.to }));
    let b = base({ tache: tache(0), messages, clotureEchoue: true });
    let eng = await moteur(b.client, create);
    await eng.processScheduledTasks(b.client);
    expect(create).toHaveBeenCalledTimes(1);

    // 15 min plus tard, la tâche figée « running » est remise en file (attempts = 1).
    vi.setSystemTime(new Date('2026-09-13T15:20:00Z'));
    b = base({ tache: tache(1), messages });
    eng = await moteur(b.client, create);
    await eng.processScheduledTasks(b.client);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('la vérification cherche LE MÊME texte, au même numéro, depuis la création de la tâche', async () => {
    const messages: any[] = [{ id: 'autre' }];
    const b = base({ tache: tache(1), messages });
    const eng = await moteur(b.client, vi.fn(async () => ({ sid: 'SM' })));
    await eng.processScheduledTasks(b.client);
    // La lecture « déjà envoyé » (d'autres lisent `messages`, ex. l'arrêt sur réponse).
    const lecture = requetes(b.journal, 'messages', 'select').find((r) => r.filtres.some(([, c]) => c === 'message_text'))!;
    expect(lecture.filtres).toEqual(expect.arrayContaining([
      ['eq', 'org_id', ORG], ['eq', 'direction', 'outbound'], ['eq', 'phone_number', '+15145550142'],
      ['eq', 'message_text', TEXTE], ['gte', 'created_at', CREEE],
    ]));
  });

  it('1re tentative (attempts = 0) : aucune lecture de plus, le texto part', async () => {
    const messages: any[] = [];
    const create = vi.fn(async () => ({ sid: 'SM' }));
    const b = base({ tache: tache(0), messages });
    const eng = await moteur(b.client, create);
    await eng.processScheduledTasks(b.client);
    expect(create).toHaveBeenCalledTimes(1);
    expect(requetes(b.journal, 'messages', 'select').filter((r) => r.filtres.some(([, c]) => c === 'message_text'))).toHaveLength(0);
  });

  it('rejeu de l’outbox : l’action immédiate déjà partie ne repart PAS', async () => {
    const messages: any[] = [];
    const create = vi.fn(async (p: any) => ({ sid: 'SM1', to: p.to }));
    const { eventBus } = await import('../../server/lib/eventBus');

    const jouerEvenement = async (extra: Record<string, unknown>) => {
      const b = base({ messages });
      eventBus.removeAllListeners();
      await moteur(b.client, create);
      const enCours: Promise<unknown>[] = [];
      for (const nom of eventBus.eventNames()) for (const l of eventBus.listeners(nom)) {
        eventBus.off(nom, l as any);
        eventBus.on(nom, (d: unknown) => { enCours.push(Promise.resolve((l as any)(d))); });
      }
      await eventBus.emit('appointment.created', { orgId: ORG, actorId: IDS.owner, ...evenementPour('appointment.created'), ...extra } as any);
      while (enCours.length) await enCours.shift();
      for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
    };

    await jouerEvenement({});
    expect(create).toHaveBeenCalledTimes(1);
    // Le processus meurt avant de cocher ; 3 min plus tard, l'outbox rejoue.
    vi.setSystemTime(new Date('2026-09-13T15:04:00Z'));
    await jouerEvenement({ rejoueDepuis: '2026-09-13T15:00:00Z' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
