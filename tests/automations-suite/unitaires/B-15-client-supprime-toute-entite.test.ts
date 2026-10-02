/**
 * B-15 — le client d'un devis, d'un job, d'une visite ou d'une opportunité a
 * été mis à la corbeille pendant le délai : on ne lui écrit plus.
 *
 * Avant : seul le client d'une tâche « client » (ou d'une facture) était
 * vérifié. Drapeau « désabonnement par canal » allumé, un texto de rappel
 * partait à un client supprimé ; éteint, il était retenu par accident
 * (« destinataire inconnu du carnet de clients »).
 */
import { describe, it, expect } from 'vitest';
import { fauxSupabase, type Ligne } from './_faux-supabase';
import { revaliderTache, MOTIF_CLIENT_SUPPRIME, motifArret, type TacheARevalider } from '../../../server/lib/sortie-parcours';

const ORG = '11111111-1111-4111-8111-111111111111';
const HIER = '2026-10-01T00:00:00Z';
const base = (extra: Partial<TacheARevalider>): TacheARevalider => ({
  orgId: ORG, entityType: 'quote', entityId: 'x1', declencheur: 'quote.sent', metadonnees: {}, reglages: null,
  conditions: {}, actionsDeLaRegle: ['send_sms'], caseParDeclencheur: false, ...extra,
});
const clients = (supprime: boolean): Ligne[] => [{ id: 'c1', org_id: ORG, status: 'active', deleted_at: supprime ? HIER : null }];

const ENTITES: Array<[string, Partial<TacheARevalider>, Record<string, Ligne[]>]> = [
  ['devis', { entityType: 'quote', declencheur: 'quote.sent' }, { quotes: [{ id: 'x1', org_id: ORG, status: 'awaiting_response', client_id: 'c1' }] }],
  ['devis d’un prospect (lead_id)', { entityType: 'quote', declencheur: 'quote.sent' }, { quotes: [{ id: 'x1', org_id: ORG, status: 'awaiting_response', client_id: null, lead_id: 'c1' }] }],
  ['job', { entityType: 'job', declencheur: 'job.completed' }, { jobs: [{ id: 'x1', org_id: ORG, status: 'completed', client_id: 'c1' }] }],
  ['visite (par son job)', { entityType: 'schedule_event', declencheur: 'appointment.created' }, {
    schedule_events: [{ id: 'x1', org_id: ORG, status: 'scheduled', job_id: 'j1' }], jobs: [{ id: 'j1', org_id: ORG, status: 'scheduled', client_id: 'c1' }],
  }],
  ['opportunité', { entityType: 'deal', declencheur: 'deal.stage_entered' }, { deals: [{ id: 'x1', org_id: ORG, stage_id: 'e1', client_id: 'c1' }] }],
  ['facture', { entityType: 'invoice', declencheur: 'invoice.overdue' }, { invoices: [{ id: 'x1', org_id: ORG, status: 'sent', client_id: 'c1' }] }],
];

describe('[B-15] client à la corbeille : rien ne part, quel que soit le type de la fiche', () => {
  for (const [nom, tache, tables] of ENTITES) {
    it(`${nom} : client supprimé → arrêt « le client a été supprimé » (motif historique sur la tâche)`, async () => {
      const r = await revaliderTache(fauxSupabase({ ...tables, clients: clients(true) }).client, base(tache));
      expect(r.arret).toMatchObject({ code: 'entite_supprimee', changement: 'le client a été supprimé' });
      expect(motifArret(r.arret!)).toBe(MOTIF_CLIENT_SUPPRIME);
    });

    it(`${nom} : client toujours au carnet → la tâche part`, async () => {
      const r = await revaliderTache(fauxSupabase({ ...tables, clients: clients(false) }).client, base(tache));
      expect(r.arret).toBeUndefined();
      expect(r.clientId).toBe('c1');
    });
  }

  it('client illisible (panne de lecture) : on ne conclut pas', async () => {
    const sb = fauxSupabase({ quotes: [{ id: 'x1', org_id: ORG, status: 'awaiting_response', client_id: 'c1' }] }, { erreurs: { clients: 'timeout' } });
    expect((await revaliderTache(sb.client, base({}))).arret).toBeUndefined();
  });

  it('fiche sans client (opportunité sans contact) : aucune lecture de plus, la tâche part', async () => {
    const sb = fauxSupabase({ deals: [{ id: 'x1', org_id: ORG, stage_id: 'e1', client_id: null }] });
    const r = await revaliderTache(sb.client, base({ entityType: 'deal', declencheur: 'deal.stage_entered' }));
    expect(r.arret).toBeUndefined();
    expect(sb.lectures()).toEqual(['deals']);
  });
});
