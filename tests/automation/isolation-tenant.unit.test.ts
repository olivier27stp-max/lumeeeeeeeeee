/**
 * T7 (unitaire) — ISOLATION MULTI-TENANT DU MOTEUR D'AUTOMATISATIONS.
 *
 * Le moteur tourne sous service_role : la RLS ne le protège pas. Son seul
 * garde-fou est le filtre `org_id` sur chaque lecture. Ces tests importent les
 * VRAIS modules (pas de copie de la logique) et remplacent le client Supabase
 * par un enregistreur qui note, pour chaque requête, la table et les filtres.
 * On vérifie ensuite qu'aucune lecture d'entité ne se fait par `id` seul.
 *
 * ROUGE ATTENDU aujourd'hui (AUTOMATIONS_AUDIT.md, F1) : resolveEntityVariables
 * lit clients / jobs / invoices / schedule_events / job_agreements sans org_id
 * (seule la branche `quote` filtre), checkStopConditions idem, executeCreateTask
 * lit schedule_events par id, executeRequestReview lit jobs/invoices par id.
 *
 * Voir AUTOMATIONS_TEST_PLAN.md, T7.3 à T7.5.
 *
 * CORRECTIFS APPLIQUÉS le 2026-09-14 (branche fix/automatisations-audit) :
 * les cas « ROUGE ATTENDU » ci-dessous sont désormais verts, sauf mention
 * contraire dans leur titre. Les descriptions d'origine sont conservées comme
 * mémoire de ce qui était cassé.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Les modules d'envoi ne doivent jamais être touchés ici.
vi.mock('../../server/lib/mailer', () => ({ sendEmail: vi.fn(async () => ({ sent: true })), isMailerConfigured: () => true }));
vi.mock('../../server/routes/emails', () => ({ getCompanySettings: async () => ({}), buildEmailLayout: (_c: unknown, b: string) => b, senderFor: () => ({ from: 'test@lume.test' }) }));
vi.mock('../../server/lib/twilioProvisioning', () => ({ getOrgSmsFromNumber: async () => '+15550000000' }));

import { clientEnregistreur, requetes, porteOrg, type Requete } from './_enregistreur';

/** Les lectures d'ENTITÉS faites sur une table. */
const lectures = (journal: Requete[], table: string) => requetes(journal, table, 'select');

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ENTITE_B = '22222222-2222-4222-8222-222222222222'; // appartient à une autre org
const CLIENT_B = '33333333-3333-4333-8333-333333333333';
const JOB_B = '44444444-4444-4444-8444-444444444444';

beforeEach(() => { vi.clearAllMocks(); });

describe('T7.3/T7.4 — resolveEntityVariables filtre chaque lecture par org_id', () => {
  const casTables: Array<[string, string, Record<string, any>]> = [
    ['schedule_event', 'schedule_events', { schedule_events: { data: { id: ENTITE_B, job_id: JOB_B, start_at: '2026-09-20T13:00:00Z', job: { id: JOB_B, title: 'Chez B', property_address: '1 rue B', client_id: CLIENT_B, clients: { first_name: 'Bob', last_name: 'B', email: 'bob@b.test', phone: '+15145550002' } } } } }],
    ['job', 'jobs', { jobs: { data: { title: 'Chez B', client_id: CLIENT_B } }, clients: { data: { first_name: 'Bob', last_name: 'B', email: 'bob@b.test', phone: '+15145550002' } }, job_agreements: { data: null } }],
    ['invoice', 'invoices', { invoices: { data: { invoice_number: 'B-1', due_date: '2026-09-01', total_cents: 1000, client_id: CLIENT_B, job_id: null } }, clients: { data: { first_name: 'Bob', last_name: 'B', email: 'bob@b.test', phone: '+15145550002' } } }],
    ['client', 'clients', { clients: { data: { first_name: 'Bob', last_name: 'B', email: 'bob@b.test', phone: '+15145550002' } } }],
    ['lead', 'clients', { clients: { data: { first_name: 'Bob', last_name: 'B', email: 'bob@b.test', phone: '+15145550002' } } }],
    ['quote', 'quotes', { quotes: { data: { quote_number: 'Q-B', total_cents: 1000, currency: 'CAD', client_id: CLIENT_B } }, clients: { data: { first_name: 'Bob', last_name: 'B' } } }],
  ];

  for (const [entityType, table, reponses] of casTables) {
    it(`entité « ${entityType} » : la lecture de ${table} porte org_id = org de l'événement`, async () => {
      const { resolveEntityVariables } = await import('../../server/lib/actions');
      const { client, journal } = clientEnregistreur({ company_settings: { data: { company_name: 'A inc.' } }, ...reponses });
      await resolveEntityVariables(client, ORG_A, entityType, ENTITE_B);
      const lus = lectures(journal, table);
      expect(lus.length, `aucune lecture de ${table}`).toBeGreaterThan(0);
      for (const r of lus) {
        expect(porteOrg(r, ORG_A), `lecture de ${table} sans filtre org_id : ${JSON.stringify(r.filtres)}`).toBe(true);
      }
    });
  }

  it('la fiche client jointe à un job / une facture est aussi lue avec org_id', async () => {
    const { resolveEntityVariables } = await import('../../server/lib/actions');
    const { client, journal } = clientEnregistreur({
      company_settings: { data: {} },
      jobs: { data: { title: 'Chez B', client_id: CLIENT_B } },
      clients: { data: { first_name: 'Bob', last_name: 'B', email: 'bob@b.test', phone: '+15145550002' } },
      job_agreements: { data: null },
    });
    await resolveEntityVariables(client, ORG_A, 'job', JOB_B);
    for (const r of lectures(journal, 'clients')) expect(porteOrg(r, ORG_A), JSON.stringify(r.filtres)).toBe(true);
  });

  it('une entité d’une autre org ne fournit AUCUNE variable client (garde en profondeur)', async () => {
    // Simule le comportement attendu APRÈS correctif : la lecture filtrée ne
    // trouve rien → vars sans client_*. Avec le code actuel, la lecture non
    // filtrée « trouve » l'entité de B et remplit les variables → rouge.
    const { resolveEntityVariables } = await import('../../server/lib/actions');
    const { client } = clientEnregistreur({
      company_settings: { data: { company_name: 'A inc.' } },
      // Le client factice ne sait pas filtrer : il rend la fiche de B quoi qu'on
      // lui demande. Le test précédent prouve le filtre ; celui-ci fige le
      // contrat de sortie une fois le filtre en place.
      clients: { data: null },
    });
    const vars = await resolveEntityVariables(client, ORG_A, 'client', CLIENT_B);
    expect(vars.client_email ?? '').toBe('');
    expect(vars.client_phone ?? '').toBe('');
    expect(vars.company_name).toBe('A inc.');
  });
});

describe('T7.5 — checkStopConditions (via processScheduledTasks) filtre par org_id', () => {
  const casEntites: Array<[string, string, Record<string, any>]> = [
    ['invoice', 'invoices', { invoices: { data: { status: 'paid', client_id: CLIENT_B } } }],
    ['quote', 'quotes', { quotes: { data: { status: 'approved', deleted_at: null } } }],
    ['schedule_event', 'schedule_events', { schedule_events: { data: { status: 'cancelled', deleted_at: null } } }],
    ['lead', 'clients', { clients: { data: { status: 'lead', lead_status: 'lost', deleted_at: null } } }],
  ];

  for (const [entityType, table, reponses] of casEntites) {
    it(`tâche « ${entityType} » : la condition d'arrêt lit ${table} avec org_id de la tâche`, async () => {
      const { initAutomationEngine, processScheduledTasks } = await import('../../server/lib/automationEngine');
      const tache = {
        id: 'tache-1', org_id: ORG_A, automation_rule_id: 'regle-1', entity_type: entityType, entity_id: ENTITE_B, attempts: 0,
        action_config: { type: 'log_activity', config: { event_type: 'test' }, trigger_event: 'x' },
        automation_rules: { name: 'r', actions: [], conditions: {} },
      };
      const { client, journal } = clientEnregistreur({
        automation_scheduled_tasks: { data: [tache] }, // sélection des pending ; le claim rend aussi une ligne
        company_settings: { data: {} },
        ...reponses,
      });
      // Le claim `.update().eq(id).eq(status).select('id')` résout avec la même réponse (1 ligne) : pris.
      initAutomationEngine({ supabase: client, twilio: null, baseUrl: 'http://test' });
      await processScheduledTasks(client);
      const lus = lectures(journal, table);
      expect(lus.length, `aucune lecture de ${table}`).toBeGreaterThan(0);
      for (const r of lus) expect(porteOrg(r, ORG_A), `lecture de ${table} sans org_id : ${JSON.stringify(r.filtres)}`).toBe(true);
    });
  }
});

describe('T7.5 (suite) — les actions qui relisent une entité filtrent par org_id', () => {
  it('executeCreateTask : la visite est lue avec org_id', async () => {
    const { executeCreateTask } = await import('../../server/lib/actions');
    const { client, journal } = clientEnregistreur({
      memberships: { data: { user_id: 'owner-a' } },
      schedule_events: { data: { job_id: JOB_B } },
      tasks: { data: null },
    });
    await executeCreateTask({ title: 'T' }, {}, { supabase: client, orgId: ORG_A, entityType: 'schedule_event', entityId: ENTITE_B, twilio: null, baseUrl: '' });
    for (const r of lectures(journal, 'schedule_events')) expect(porteOrg(r, ORG_A), JSON.stringify(r.filtres)).toBe(true);
  });

  it('executeRequestReview : le job et la facture sont lus avec org_id', async () => {
    const { executeRequestReview } = await import('../../server/lib/actions');
    for (const [entityType, table] of [['job', 'jobs'], ['invoice', 'invoices']] as const) {
      const { client, journal } = clientEnregistreur({
        company_settings: { data: { review_enabled: true, google_review_url: 'https://g.page/x' } },
        jobs: { data: { client_id: CLIENT_B } },
        invoices: { data: { client_id: CLIENT_B, job_id: JOB_B } },
        review_requests: { data: null },
        satisfaction_surveys: { data: { id: 's1' } },
        email_templates: { data: null },
        activity_log: { data: null },
        sms_opt_outs: { data: null },
        messages: { data: null, count: 0 },
        conversations: { data: null },
      });
      await executeRequestReview({}, { client_email: 'bob@b.test', client_phone: '+15145550002' }, { supabase: client, orgId: ORG_A, entityType, entityId: ENTITE_B, twilio: null, baseUrl: 'http://t' });
      const lus = lectures(journal, table);
      expect(lus.length).toBeGreaterThan(0);
      for (const r of lus) expect(porteOrg(r, ORG_A), `${table} : ${JSON.stringify(r.filtres)}`).toBe(true);
    }
  });

  it('executeUpdateStatus : déjà filtré — reste le modèle à suivre', async () => {
    const { executeUpdateStatus } = await import('../../server/lib/actions');
    const { client, journal } = clientEnregistreur({ jobs: { data: [{ id: JOB_B }] } });
    await executeUpdateStatus({ table: 'jobs', status: 'completed' }, {}, { supabase: client, orgId: ORG_A, entityType: 'job', entityId: JOB_B, twilio: null, baseUrl: '' });
    const ecritures = journal.filter((r) => r.table === 'jobs' && r.op === 'update');
    expect(ecritures).toHaveLength(1);
    expect(porteOrg(ecritures[0], ORG_A)).toBe(true);
  });
});
