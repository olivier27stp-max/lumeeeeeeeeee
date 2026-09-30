/**
 * Launch 2026-09-28 — bloc 2 : le lecteur de `automation_evenements_base`.
 *
 * Les triggers (migration 20261003100000, prouvés contre staging par
 * `npm run qa:evenements-base`, 7/7) écrivent l'événement dans la même
 * transaction que le changement de statut. Ici : ce que le serveur en fait,
 * avec le VRAI moteur derrière.
 *   · devis refusé depuis l'app → l'automatisation « devis refusé » part (M3) ;
 *   · facture envoyée (récurrente / envoyer maintenant) → relance planifiée (M4) ;
 *   · après un arrêt entre l'émission et le marquage : pas de 2e émission ;
 *   · plan de visites → la 2e visite porte suppress_immediate (M6) ;
 *   · l'arriéré d'avant la mise en service n'est pas réémis.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const etat = vi.hoisted(() => ({ client: { current: null as any } }));
vi.mock('../../server/lib/supabase', async (orig) => ({ ...(await orig<any>()), getServiceClient: () => etat.client.current }));
vi.mock('../../server/lib/mailer', async (orig) => ({ ...(await orig<any>()), isMailerConfigured: () => true, adresseInjoignable: async () => false, sendEmail: vi.fn(async () => ({ sent: true, messageId: 't' })) }));
vi.mock('../../server/lib/twilioProvisioning', async (orig) => ({ ...(await orig<any>()), getOrgSmsFromNumber: async () => '+15550000000' }));

import { monde, ORG, IDS } from './filet-regression/_banc';
import { clientEnregistreur, requetes, type Requete } from './filet-regression/_enregistreur';
import { oublierDrapeaux } from '../../server/lib/automations-drapeaux';
import { traiterEvenementsBase, TYPE_REPERE } from '../../server/lib/evenementsBase';
import { PACK_PARCOURS } from '../../server/lib/automationPack.data';

process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'https://app.lume.test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.lume.test';

const REPERE = { id: 1, type: TYPE_REPERE, created_at: '2026-09-28T00:00:00Z' };
const ligne = (o: Record<string, unknown>) => ({ id: 10, org_id: ORG, related_entity_type: null, related_entity_id: null, metadata: {}, attempts: 0, created_at: '2026-09-28T12:00:00Z', ...o });

/** La base simulée : la file, l'outbox, et le monde du banc pour le moteur. */
function base(opts: { file: any[]; regles: any[]; outbox?: any[]; prise?: boolean; visitesAvant?: any[] }) {
  const { client, journal } = clientEnregistreur({
    ...monde({ id: 'x', trigger_event: 'quote.declined' }),
    automation_rules: { data: opts.regles },
    automation_evenements_base: (req: Requete) => {
      if (req.op === 'select' && req.filtres.some(([, c, v]) => c === 'type' && v === TYPE_REPERE)) return { data: [REPERE] };
      if (req.op === 'select') return { data: opts.file };
      if (req.op === 'update' && req.filtres.some(([op, c]) => op === 'eq' && c === 'attempts')) return { data: opts.prise === false ? [] : [{ id: 10 }] };
      return { data: [{ id: 10 }] };
    },
    domain_events: (req: Requete) => (req.op === 'select' ? { data: opts.outbox ?? [] } : { data: [{ id: 99 }] }),
    schedule_events: (req: Requete) => (req.filtres.some(([op, c]) => op === 'neq' && c === 'id')
      ? { data: opts.visitesAvant ?? [] }
      : { data: [{ ...monde({ id: 'x', trigger_event: 'x' }).schedule_events.data[0], created_at: '2026-09-28T12:00:00Z' }] }),
  });
  etat.client.current = client;
  return { client, journal };
}

async function moteurSur(client: any) {
  const { initAutomationEngine } = await import('../../server/lib/automationEngine');
  const { eventBus } = await import('../../server/lib/eventBus');
  eventBus.removeAllListeners();
  eventBus.init(client);
  initAutomationEngine({ supabase: client, twilio: { client: { messages: { create: vi.fn(async () => ({ sid: 'SM' })) } }, phoneNumber: '+15550000000' }, baseUrl: 'https://app.lume.test' } as any);
  return eventBus;
}
const repos = async () => { for (let i = 0; i < 60; i++) await new Promise((r) => setImmediate(r)); };
const regle = (o: Record<string, unknown>) => ({ id: 'r1', org_id: ORG, name: 'R', conditions: {}, delay_seconds: 0, settings: null, steps: null, is_active: true, deleted_at: null, preset_key: null, ...o });

beforeEach(() => { oublierDrapeaux(); });
afterEach(() => { vi.useRealTimers(); });

describe('bloc 2 — lecteur de la file', () => {
  it('M3 — devis refusé depuis l’app : l’automatisation « devis refusé » s’exécute', async () => {
    const { client, journal } = base({
      file: [ligne({ type: 'quote.declined', entity_type: 'quote', entity_id: IDS.devis, metadata: { quote_number: 'Q-2026-042', client_id: IDS.client } })],
      regles: [regle({ trigger_event: 'quote.declined', actions: [{ type: 'create_task', config: { title: 'Rappeler le client' } }] })],
    });
    await moteurSur(client);
    expect(await traiterEvenementsBase(client)).toBe(1);
    await repos();
    expect(requetes(journal, 'tasks', 'insert')).toHaveLength(1);
    // Marquée traitée, avec l'identifiant de la ligne dans l'outbox (anti-double émission).
    const consigne = requetes(journal, 'domain_events', 'insert').map((r) => r.valeur as any)[0];
    expect(consigne?.metadata?.evenement_base_id).toBe('10');
    expect(requetes(journal, 'automation_evenements_base', 'update').some((r) => (r.valeur as any)?.traite_at)).toBe(true);
  });

  it('M4 — facture envoyée (récurrente ou « envoyer maintenant ») : la relance du pack est planifiée', async () => {
    const pack = PACK_PARCOURS.find((p) => p.preset_key === 'pack_relance_facture')!;
    const { client, journal } = base({
      file: [ligne({ type: 'invoice.sent', entity_type: 'invoice', entity_id: IDS.facture, metadata: { invoice_number: 'INV-000042', client_id: IDS.client } })],
      regles: [regle({ id: 'pack', trigger_event: 'invoice.sent', actions: pack.actions, steps: pack.steps, preset_key: 'pack_relance_facture' })],
    });
    await moteurSur(client);
    await traiterEvenementsBase(client);
    await repos();
    const taches = requetes(journal, 'automation_scheduled_tasks', 'insert').flatMap((r) => (Array.isArray(r.valeur) ? r.valeur : [r.valeur])) as any[];
    expect(taches.some((t) => t.automation_rule_id === 'pack')).toBe(true);
  });

  it('après un arrêt entre l’émission et le marquage : l’outbox l’a déjà → pas de 2e émission', async () => {
    const { client, journal } = base({
      file: [ligne({ type: 'quote.declined', entity_type: 'quote', entity_id: IDS.devis, attempts: 1 })],
      regles: [regle({ trigger_event: 'quote.declined', actions: [{ type: 'create_task', config: { title: 'X' } }] })],
      outbox: [{ id: 99 }],
    });
    await moteurSur(client);
    expect(await traiterEvenementsBase(client)).toBe(0);
    await repos();
    expect(requetes(journal, 'tasks', 'insert')).toHaveLength(0);
    expect(requetes(journal, 'automation_evenements_base', 'update').some((r) => (r.valeur as any)?.traite_at)).toBe(true);
  });

  it('prise perdue (une autre instance l’a) : rien n’est émis', async () => {
    const { client, journal } = base({ file: [ligne({ type: 'quote.declined', entity_type: 'quote', entity_id: IDS.devis })], regles: [], prise: false });
    await moteurSur(client);
    expect(await traiterEvenementsBase(client)).toBe(0);
    expect(requetes(journal, 'domain_events', 'insert')).toHaveLength(0);
  });

  it('M6 — 2e visite d’un même job créée juste après la 1re : suppress_immediate', async () => {
    for (const [visitesAvant, attendu] of [[[{ id: 'v0' }], true], [[], undefined]] as const) {
      const { client, journal } = base({
        file: [ligne({ type: 'appointment.created', entity_type: 'schedule_event', entity_id: IDS.visite, metadata: { job_id: IDS.job } })],
        regles: [], visitesAvant: [...visitesAvant] as any[],
      });
      await moteurSur(client);
      await traiterEvenementsBase(client);
      const consigne = requetes(journal, 'domain_events', 'insert').map((r) => r.valeur as any)[0];
      expect(consigne?.metadata?.suppress_immediate).toBe(attendu);
    }
  });

  it('l’arriéré d’avant la mise en service est marqué, pas réémis', async () => {
    const { client, journal } = base({ file: [], regles: [] });
    await moteurSur(client);
    await traiterEvenementsBase(client);
    const arriere = requetes(journal, 'automation_evenements_base', 'update').find((r) => r.filtres.some(([op, c, v]) => op === 'lt' && c === 'created_at' && v === REPERE.created_at));
    expect((arriere?.valeur as any)?.last_error).toMatch(/Antérieur à la mise en service/);
  });
});
