/**
 * B-01 — le client ne reçoit plus le rappel de rendez-vous d'un job ANNULÉ.
 *
 * Annuler un job ne touche pas ses visites (elles restent « prévues » au
 * calendrier) : la vérification ne lisait que la visite, jamais le job.
 */
import { describe, it, expect } from 'vitest';
import { fauxSupabase, type Ligne } from './_faux-supabase';
import { revaliderTache, type TacheARevalider } from '../../../server/lib/sortie-parcours';

const ORG = '11111111-1111-4111-8111-111111111111';
const base = (extra: Partial<TacheARevalider> = {}): TacheARevalider => ({
  orgId: ORG, entityType: 'schedule_event', entityId: 'v1', declencheur: 'appointment.created', metadonnees: {}, reglages: null,
  conditions: {}, actionsDeLaRegle: ['send_sms'], caseParDeclencheur: false, ...extra,
});
const monde = (job: Ligne, visite: Ligne = {}) => fauxSupabase({
  schedule_events: [{ id: 'v1', org_id: ORG, status: 'scheduled', job_id: 'j1', start_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), ...visite }],
  jobs: [{ id: 'j1', org_id: ORG, status: 'scheduled', client_id: 'c1', ...job }],
  clients: [{ id: 'c1', org_id: ORG, deleted_at: null }],
});

describe('[B-01] le job de la visite', () => {
  it('job annulé, visite restée « prévue » → « le job a été annulé »', async () => {
    expect((await revaliderTache(monde({ status: 'cancelled' }).client, base())).arret)
      .toMatchObject({ code: 'condition_plus_valide', changement: 'le job a été annulé' });
  });

  it('job à la corbeille → « le job a été supprimé »', async () => {
    expect((await revaliderTache(monde({ deleted_at: '2026-10-01T00:00:00Z' }).client, base())).arret)
      .toMatchObject({ code: 'entite_supprimee', changement: 'le job a été supprimé' });
  });

  it('job toujours prévu → le rappel part, et le client de la visite est connu pour la suite', async () => {
    const r = await revaliderTache(monde({}).client, base());
    expect(r.arret).toBeUndefined();
    expect(r.clientId).toBe('c1');
  });

  it('« Rendez-vous annulé » + délai : le message d’annulation part même si le job est annulé lui aussi', async () => {
    const r = await revaliderTache(monde({ status: 'cancelled' }, { status: 'cancelled' }).client, base({ declencheur: 'appointment.cancelled' }));
    expect(r.arret).toBeUndefined();
  });

  it('drapeau + case « Arrêter si… » décochée : le job annulé n’arrête pas (c’est le choix de l’utilisateur)', async () => {
    const r = await revaliderTache(monde({ status: 'cancelled' }).client, base({ caseParDeclencheur: true, reglages: { arreter_si_resolu: false } }));
    expect(r.arret).toBeUndefined();
  });

  it('job illisible (panne de lecture) : on ne conclut pas', async () => {
    const sb = fauxSupabase({ schedule_events: [{ id: 'v1', org_id: ORG, status: 'scheduled', job_id: 'j1' }] }, { erreurs: { jobs: 'timeout' } });
    expect((await revaliderTache(sb.client, base())).arret).toBeUndefined();
  });
});
