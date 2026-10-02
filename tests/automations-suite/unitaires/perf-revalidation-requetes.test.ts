/**
 * Garde-fou de la mission finale : la revalidation avant chaque action
 * différée (point 9) ne doit pas multiplier les requêtes. Elle porte sur les
 * tâches DIFFÉRÉES seulement — le chemin immédiat (9 requêtes par événement,
 * 1 000 événements en 22 s) n'appelle pas `revaliderTache`.
 *
 * Lectures de la revalidation par tâche différée, AVANT → APRÈS (une règle
 * sans filtre d'étiquette ni de champ) :
 *
 *   entité             avant (checkStopConditions      après (revaliderTache)
 *                      + clientDeLaTacheSupprime)
 *   facture            2  (facture, client)            2  (facture, client)
 *   devis              1  (devis)                      2  (devis, client)
 *   rendez-vous        1  (visite)                     3  (visite, job, client)
 *   job                0                               2  (job, client)
 *   opportunité        0                               2  (opportunité, client)
 *   client             1  (client)                     1  (client)
 *   prospect           2  (client, client)             1  (client)
 *
 * « Arrêter quand le client répond » relisait l'entité pour trouver le client
 * (1 à 2 lectures) : il reçoit maintenant celui que la revalidation a trouvé.
 * Les filtres de la règle ne coûtent que s'ils existent : +1 (étiquettes).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fauxSupabase, type Ligne } from './_faux-supabase';
import { revaliderTache, type TacheARevalider } from '../../../server/lib/sortie-parcours';

const ORG = '11111111-1111-4111-8111-111111111111';
const MONDE = (): Record<string, Ligne[]> => ({
  invoices: [{ id: 'x', org_id: ORG, status: 'sent', client_id: 'c' }],
  quotes: [{ id: 'x', org_id: ORG, status: 'awaiting_response', client_id: 'c' }],
  schedule_events: [{ id: 'x', org_id: ORG, status: 'scheduled', job_id: 'j', start_at: '2027-01-01T15:00:00Z' }],
  jobs: [{ id: 'x', org_id: ORG, status: 'completed', client_id: 'c' }, { id: 'j', org_id: ORG, status: 'scheduled', client_id: 'c' }],
  deals: [{ id: 'x', org_id: ORG, stage_id: 'e1', client_id: 'c' }],
  clients: [{ id: 'c', org_id: ORG, status: 'active' }, { id: 'x', org_id: ORG, status: 'lead', lead_status: 'new' }],
  client_tags: [{ client_id: 'c', tag: 'vip' }],
});
const tache = (entityType: string, declencheur: string, extra: Partial<TacheARevalider> = {}): TacheARevalider => ({
  orgId: ORG, entityType, entityId: 'x', declencheur, metadonnees: { stage_id: 'e1' }, reglages: null, conditions: {},
  actionsDeLaRegle: ['send_email'], caseParDeclencheur: false, ...extra,
});

describe('[perf] lectures de la revalidation par tâche différée', () => {
  const attendu: Array<[string, string, string[]]> = [
    ['invoice', 'invoice.overdue', ['invoices', 'clients']],
    ['quote', 'quote.sent', ['quotes', 'clients']],
    ['schedule_event', 'appointment.created', ['schedule_events', 'jobs', 'clients']],
    ['job', 'job.completed', ['jobs', 'clients']],
    ['deal', 'deal.stage_entered', ['deals', 'clients']],
    ['client', 'note.added', ['clients']],
    ['lead', 'lead.created', ['clients']],
  ];
  for (const [type, declencheur, lectures] of attendu) {
    it(`${type} : ${lectures.length} lecture(s) — ${lectures.join(', ')}`, async () => {
      const sb = fauxSupabase(MONDE());
      const r = await revaliderTache(sb.client, tache(type, declencheur));
      expect(r.arret).toBeUndefined();
      expect(sb.lectures()).toEqual(lectures);
    });
  }

  it('une règle avec un filtre d’étiquette : une lecture de plus, pas davantage', async () => {
    const sb = fauxSupabase(MONDE());
    await revaliderTache(sb.client, tache('invoice', 'invoice.overdue', { conditions: { client_a_etiquette: 'vip' } }));
    expect(sb.lectures()).toEqual(['invoices', 'clients', 'client_tags']);
  });

  it('un type d’entité sans revalidateur (webhook entrant) : aucune lecture', async () => {
    const sb = fauxSupabase(MONDE());
    await revaliderTache(sb.client, tache('webhook', 'webhook.received'));
    expect(sb.lectures()).toEqual([]);
  });
});

describe('[perf] le chemin IMMÉDIAT ne revalide pas', () => {
  const source = readFileSync(resolve(__dirname, '../../../server/lib/automationEngine.ts'), 'utf8').replace(/\r\n/g, '\n');

  it('`revaliderTache` n’est appelé qu’à UN endroit : la file planifiée', () => {
    const appels = source.split('await revaliderTache(').length - 1;
    expect(appels).toBe(1);
    const file = source.slice(source.indexOf('export async function processScheduledTasks'));
    expect(file).toContain('await revaliderTache(');
    const immediat = source.slice(source.indexOf('async function executeRuleActions'), source.indexOf('async function planifierRepriseImmediate'));
    expect(immediat).not.toContain('revaliderTache');
  });
});
