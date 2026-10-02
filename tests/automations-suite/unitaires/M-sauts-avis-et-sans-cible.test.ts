/**
 * Ce qui n'est NI un échec NI une exécution : un saut, avec son code
 * (mission finale, consigne du coordinateur — liste unique des issues dans
 * `src/lib/automationMotifs.ts`).
 *
 *  1. Demande d'avis : « avis désactivés », « aucun lien d'avis », « déjà
 *     demandé il y a moins de 7 jours » étaient des ÉCHECS (ligne rouge en
 *     anglais, notification au propriétaire, parcours arrêté) alors que rien
 *     n'était en panne → sauts `avis_desactives`, `sans_lien_avis`,
 *     `deja_envoye`.
 *  2. Actions qui n'avaient RIEN à modifier (aucune opportunité liée, déjà
 *     dans l'étape, responsable déjà assigné…) : c'étaient des « réussites »
 *     muettes, comptées comme exécutées → saut `sans_cible` avec la phrase
 *     qui dit quoi. Les clés d'avant restent dans `result_data`.
 */
import { describe, it, expect } from 'vitest';
import { fauxSupabase, type Ligne } from './_faux-supabase';
import { executeAssignerResponsable, executeMoveDealStage, executeRequestReview } from '../../../server/lib/actions/index';
import { motifDuCode } from '../../../src/lib/automationMotifs';

const ORG = '11111111-1111-4111-8111-111111111111';
const ctx = (tables: Record<string, Ligne[]>, entityType: string, entityId: string) => {
  const sb = fauxSupabase(tables);
  return { sb, ctx: { supabase: sb.client, orgId: ORG, entityType, entityId, twilio: null, baseUrl: 'http://t' } as never };
};
const VARS = { client_email: 'alice@exemple.test', client_first_name: 'Alice' };
const saut = (r: { success: boolean; error?: string; data?: unknown }) => {
  expect(r.success, r.error).toBe(true);
  expect(r.error).toBeUndefined();
  return r.data as { saute: string; saute_code: string } & Ligne;
};

describe('[avis] la demande d’avis qui ne part pas pour une raison voulue : un saut, pas un échec', () => {
  it('avis désactivés dans les réglages → `avis_desactives`', async () => {
    const { ctx: c, sb } = ctx({ company_settings: [{ org_id: ORG, review_enabled: false, google_review_url: 'https://g.page/r/x' }] }, 'client', 'c1');
    const d = saut(await executeRequestReview({}, VARS, c));
    expect(d).toEqual({ saute: 'Demandes d’avis désactivées (Réglages → Avis clients)', saute_code: 'avis_desactives' });
    // Rien n'a été créé : ni sondage, ni demande.
    expect(sb.tables.satisfaction_surveys ?? []).toEqual([]);
    expect(sb.tables.review_requests ?? []).toEqual([]);
  });

  it('aucun lien Google ni Facebook → `sans_lien_avis`', async () => {
    const { ctx: c } = ctx({ company_settings: [{ org_id: ORG, review_enabled: true, google_review_url: null, facebook_review_url: null }] }, 'client', 'c1');
    expect(saut(await executeRequestReview({}, VARS, c)).saute_code).toBe('sans_lien_avis');
  });

  it('une demande est déjà partie à ce client il y a moins de 7 jours → `deja_envoye`, aucune nouvelle demande', async () => {
    const { ctx: c, sb } = ctx({
      company_settings: [{ org_id: ORG, review_enabled: true, google_review_url: 'https://g.page/r/x' }],
      review_requests: [{ id: 'd1', org_id: ORG, client_id: 'c1', status: 'sent', sent_at: new Date(Date.now() - 86_400_000).toISOString() }],
    }, 'client', 'c1');
    const d = saut(await executeRequestReview({}, VARS, c));
    expect(d).toEqual({ saute: 'Une demande d’avis a déjà été envoyée à ce client dans les 7 derniers jours', saute_code: 'deja_envoye' });
    expect(sb.tables.review_requests).toHaveLength(1);
    expect(sb.tables.satisfaction_surveys ?? []).toEqual([]);
  });

  it('les phrases sont en français, sans le mot anglais d’avant', async () => {
    for (const reglages of [{ review_enabled: false }, { review_enabled: true }]) {
      const { ctx: c } = ctx({ company_settings: [{ org_id: ORG, ...reglages }] }, 'client', 'c1');
      expect(saut(await executeRequestReview({}, VARS, c)).saute).not.toMatch(/\b(review|disabled|configured|already|sent)\b/i);
    }
  });
});

describe('[sans_cible] l’action n’avait rien à modifier : un saut avec sa phrase, plus une « réussite » muette', () => {
  const DEAL = { id: 'd1', org_id: ORG, pipeline_id: 'p1', stage_id: 's1', deleted_at: null };
  const ETAPES = [
    { id: 's1', org_id: ORG, pipeline_id: 'p1', kind: 'open', position: 1, role_systeme: null, archived_at: null },
    { id: 's2', org_id: ORG, pipeline_id: 'p1', kind: 'open', position: 2, role_systeme: 'soumission_envoyee', archived_at: null },
  ];

  it('l’opportunité est déjà dans l’étape visée', async () => {
    const { ctx: c, sb } = ctx({ deals: [{ ...DEAL }], pipeline_stages: ETAPES }, 'deal', 'd1');
    const d = saut(await executeMoveDealStage({ stage_id: 's1' }, {}, c));
    expect(d).toEqual({ saute: 'L’opportunité est déjà dans cette étape', saute_code: 'sans_cible', deja_dans_l_etape: true, stage_id: 's1' });
    expect(sb.tables.deals[0].stage_id).toBe('s1');
  });

  it('le pipeline n’a pas d’étape « gagné »', async () => {
    const { ctx: c } = ctx({ deals: [{ ...DEAL }], pipeline_stages: ETAPES }, 'deal', 'd1');
    const d = saut(await executeMoveDealStage({ cible: 'gagne' }, {}, c));
    expect(d).toMatchObject({ saute_code: 'sans_cible', pas_d_etape_cible: true });
    expect(d.saute).toMatch(/pas d’étape « gagné »/);
  });

  it('l’opportunité est déjà plus loin que l’étape visée : elle ne recule pas', async () => {
    const { ctx: c, sb } = ctx({
      deals: [{ ...DEAL, stage_id: 's3' }],
      pipeline_stages: [...ETAPES, { id: 's3', org_id: ORG, pipeline_id: 'p1', kind: 'open', position: 3, role_systeme: null, archived_at: null }],
    }, 'deal', 'd1');
    const d = saut(await executeMoveDealStage({ cible: 'role_envoyee' }, {}, c));
    expect(d).toMatchObject({ saute_code: 'sans_cible', deja_ailleurs: true });
    expect(sb.tables.deals[0].stage_id).toBe('s3');
  });

  it('« assigner un responsable, seulement si vide » : quelqu’un l’était déjà', async () => {
    const { ctx: c, sb } = ctx({ clients: [{ id: 'c1', org_id: ORG, assigned_to: 'u-existant' }] }, 'client', 'c1');
    const d = saut(await executeAssignerResponsable({ seulement_si_vide: 'true' }, {}, c));
    expect(d).toEqual({
      saute: 'Un responsable était déjà assigné : il n’a pas été remplacé',
      saute_code: 'sans_cible',
      ignore: 'un responsable était déjà assigné',
    });
    expect(sb.tables.clients[0].assigned_to).toBe('u-existant');
  });
});

describe('les codes écrits existent dans la liste unique des issues', () => {
  it.each(['avis_desactives', 'sans_lien_avis', 'deja_envoye', 'sans_cible', 'plafond_frequence'])('« %s » est un motif connu, de catégorie « ignorée »', (code) => {
    expect(motifDuCode(code)?.categorie).toBe('ignoree');
  });
});
