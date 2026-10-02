/**
 * B-03 — facture, job ou opportunité mis à la CORBEILLE pendant le délai : le
 * message prévu ne part plus. Et un devis revenu en brouillon n'est plus relancé.
 *
 * Avant : la facture était relue sans `deleted_at`, le job et l'opportunité
 * n'étaient relus par rien, et « brouillon » n'arrêtait pas une relance de devis.
 */
import { describe, it, expect } from 'vitest';
import { fauxSupabase } from './_faux-supabase';
import { revaliderTache, type TacheARevalider } from '../../../server/lib/sortie-parcours';

const ORG = '11111111-1111-4111-8111-111111111111';
const HIER = '2026-10-01T00:00:00Z';
const base = (extra: Partial<TacheARevalider>): TacheARevalider => ({
  orgId: ORG, entityType: 'invoice', entityId: 'x1', declencheur: 'invoice.overdue', metadonnees: {}, reglages: null,
  conditions: {}, actionsDeLaRegle: ['send_email'], caseParDeclencheur: false, ...extra,
});

describe('[B-03] l’entité de la tâche est à la corbeille', () => {
  it('facture supprimée (corbeille) → « la facture a été supprimée »', async () => {
    const sb = fauxSupabase({ invoices: [{ id: 'x1', org_id: ORG, status: 'sent', client_id: null, deleted_at: HIER }] });
    expect((await revaliderTache(sb.client, base({}))).arret).toMatchObject({ code: 'entite_supprimee', changement: 'la facture a été supprimée' });
  });

  it('job supprimé avant le message « après le job » → « le job a été supprimé »', async () => {
    const sb = fauxSupabase({ jobs: [{ id: 'x1', org_id: ORG, status: 'completed', client_id: 'c1', deleted_at: HIER }] });
    const r = await revaliderTache(sb.client, base({ entityType: 'job', declencheur: 'job.completed' }));
    expect(r.arret).toMatchObject({ code: 'entite_supprimee', changement: 'le job a été supprimé' });
  });

  it('job ANNULÉ après coup → « le job a été annulé » ; job terminé, toujours là → la tâche part', async () => {
    const annule = fauxSupabase({ jobs: [{ id: 'x1', org_id: ORG, status: 'cancelled', client_id: null }] });
    expect((await revaliderTache(annule.client, base({ entityType: 'job', declencheur: 'job.completed' }))).arret)
      .toMatchObject({ code: 'condition_plus_valide', changement: 'le job a été annulé' });
    const termine = fauxSupabase({ jobs: [{ id: 'x1', org_id: ORG, status: 'completed', client_id: null }] });
    expect((await revaliderTache(termine.client, base({ entityType: 'job', declencheur: 'job.completed' }))).arret).toBeUndefined();
  });

  it('opportunité supprimée → « l’opportunité a été supprimée », quel que soit le déclencheur, drapeau ou pas', async () => {
    for (const declencheur of ['deal.stage_entered', 'deal.stage_idle', 'date.reached']) {
      const sb = fauxSupabase({ deals: [{ id: 'x1', org_id: ORG, stage_id: 'e1', client_id: null, deleted_at: HIER }] });
      const r = await revaliderTache(sb.client, base({ entityType: 'deal', declencheur, metadonnees: { stage_id: 'e1' } }));
      expect(r.arret, declencheur).toMatchObject({ code: 'entite_supprimee', changement: 'l’opportunité a été supprimée' });
    }
  });

  it('opportunité toujours là, « Entrée dans une étape » sans la case : rien ne change (elle part, même déplacée)', async () => {
    const sb = fauxSupabase({ deals: [{ id: 'x1', org_id: ORG, stage_id: 'autre', client_id: null }] });
    const r = await revaliderTache(sb.client, base({ entityType: 'deal', declencheur: 'deal.stage_entered', metadonnees: { stage_id: 'e1' } }));
    expect(r.arret).toBeUndefined();
  });
});

describe('[B-03] devis revenu en brouillon', () => {
  const devis = () => fauxSupabase({ quotes: [{ id: 'x1', org_id: ORG, status: 'draft', client_id: null, lead_id: null }] }).client;

  it('relance de « Devis envoyé » ou « Devis ouvert » → « la soumission est revenue en brouillon »', async () => {
    for (const declencheur of ['quote.sent', 'quote.viewed']) {
      expect((await revaliderTache(devis(), base({ entityType: 'quote', declencheur }))).arret, declencheur)
        .toMatchObject({ code: 'condition_plus_valide', changement: 'la soumission est revenue en brouillon' });
    }
  });

  it('un autre déclencheur sur un devis en brouillon (champ modifié) n’est pas arrêté', async () => {
    expect((await revaliderTache(devis(), base({ entityType: 'quote', declencheur: 'custom_field.changed' }))).arret).toBeUndefined();
  });
});
