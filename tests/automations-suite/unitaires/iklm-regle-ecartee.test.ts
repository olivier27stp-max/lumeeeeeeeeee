/**
 * [L-004] Règle ÉCARTÉE par ses conditions : ce qui mérite une trace, et ce
 * qui n'en mérite pas.
 *
 *  · `separerCiblage` : les réglages qui disent QUELLE occurrence de
 *    l'événement la règle écoute (jalon de retard, étiquette posée, champ
 *    modifié, étape du pipeline…) ne sont pas des filtres — une règle qui ne
 *    vise pas l'événement n'écrit rien ;
 *  · `conditionNonRemplie` : le nom du filtre qui a écarté la fiche, tel qu'il
 *    apparaît dans l'onglet Journaux.
 *
 * Unitaire pur : aucune base, aucun réseau.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { separerCiblage, conditionNonRemplie, evaluateConditions, CLES_DE_CIBLAGE } from '../../../server/lib/automationEngine';
import { ACTION_REGLE_ECARTEE, DECLENCHEURS, ACTIONS } from '../../../src/lib/automationCatalogue';
import { libelleAction, motifSaut } from '../../../src/lib/automationJournauxApi';
import type { CRMEvent, CRMEventType } from '../../../server/lib/eventBus';

vi.mock('../../../src/lib/supabase', () => ({ supabase: {} }));
vi.mock('../../../src/lib/orgApi', () => ({ getCurrentOrgId: async () => null }));

let avertissements: ReturnType<typeof vi.spyOn>;
beforeAll(() => { avertissements = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { avertissements.mockRestore(); });

const evt = (type: CRMEventType, metadata: Record<string, unknown>): CRMEvent => ({
  type, orgId: '11111111-1111-4111-8111-111111111111', entityType: 'client', entityId: '22222222-2222-4222-8222-222222222222', metadata,
});

describe('[L-004] separerCiblage — ce qui cible l’événement n’est pas un filtre', () => {
  it('« Facture en retard » : le jalon (days_overdue) cible ; le reste filtre', () => {
    expect(separerCiblage({ days_overdue: 15, montant__gte: 500 }, 'invoice.overdue')).toEqual({
      ciblage: { days_overdue: 15 }, filtres: { montant__gte: 500 },
    });
  });

  it.each([
    ['date.reached', { champ_id: 'c', jours_avant: 7, client_a_etiquette: 'vip' }, ['champ_id', 'jours_avant']],
    ['client.inactive', { mois: 6, max_par_heure: 25 }, ['mois', 'max_par_heure']],
    ['quote.viewed', { ouverture: 'premiere', montant__gte: 1000 }, ['ouverture']],
    ['invoice.viewed', { ouverture: 'chaque' }, ['ouverture']],
    ['client.tagged', { tag: 'vip', source: 'site_web' }, ['tag']],
    ['client.untagged', { tag: 'vip' }, ['tag']],
    ['custom_field.changed', { field_id: { eq: 'f' }, new_value: { eq: 'Haute' } }, ['field_id']],
    ['webhook.received', { webhook_id: 'w', source: 'facebook' }, ['webhook_id']],
    ['lead.status_changed', { new_status: 'lost', source: 'site_web' }, ['new_status']],
    ['deal.stage_entered', { stage_id: 's', pipeline_id: 'p', source: 'manual' }, ['stage_id', 'pipeline_id']],
    ['deal.stage_exited', { stage_id: 's' }, ['stage_id']],
    ['deal.stage_idle', { stage_id: 's' }, ['stage_id']],
  ])('%s : %j → ciblage = %j', (type, conditions, attendu) => {
    const { ciblage, filtres } = separerCiblage(conditions, type);
    expect(Object.keys(ciblage)).toEqual(attendu);
    expect({ ...ciblage, ...filtres }).toEqual(conditions);
  });

  it('un déclencheur sans réglage de ciblage : tout est filtre (lead.created + source)', () => {
    expect(separerCiblage({ source: { eq: 'site_web' } }, 'lead.created')).toEqual({ ciblage: {}, filtres: { source: { eq: 'site_web' } } });
  });

  it('la même clé sur un AUTRE déclencheur reste un filtre (stage_id sur « Devis ouvert »)', () => {
    expect(separerCiblage({ stage_id: 's' }, 'quote.viewed')).toEqual({ ciblage: {}, filtres: { stage_id: 's' } });
  });

  it.each([[null], [undefined], [{}]])('conditions %j → rien des deux côtés', (conditions) => {
    expect(separerCiblage(conditions as never, 'lead.created')).toEqual({ ciblage: {}, filtres: {} });
  });

  it('séparer ne change pas le verdict : ciblage ET filtres ≡ toutes les conditions', () => {
    const cas: Array<[CRMEventType, Record<string, unknown>, Record<string, unknown>]> = [
      ['invoice.overdue', { days_overdue: 15, source: 'a' }, { days_overdue: 15, source: 'a' }],
      ['invoice.overdue', { days_overdue: 15, source: 'a' }, { days_overdue: 3, source: 'a' }],
      ['invoice.overdue', { days_overdue: 15, source: 'a' }, { days_overdue: 15, source: 'b' }],
      ['client.tagged', { tag: 'vip' }, { tag: 'autre' }],
      ['lead.created', { source: { eq: 'site_web' } }, { source: 'manuel' }],
      ['lead.created', {}, { source: 'manuel' }],
    ];
    for (const [type, conditions, metadata] of cas) {
      const e = evt(type, metadata);
      const { ciblage, filtres } = separerCiblage(conditions, type);
      expect(evaluateConditions(ciblage, e) && evaluateConditions(filtres, e), JSON.stringify([type, conditions, metadata]))
        .toBe(evaluateConditions(conditions, e));
    }
  });

  it('chaque déclencheur de la table existe au catalogue (pas de clé morte)', () => {
    const connus = new Set(DECLENCHEURS.map((d) => d.cle));
    // `deal.stage_exited` est émis par le pipeline sans être offert dans l'éditeur.
    for (const type of Object.keys(CLES_DE_CIBLAGE).filter((t) => t !== 'deal.stage_exited')) {
      expect(connus.has(type), type).toBe(true);
    }
  });
});

describe('[L-004] conditionNonRemplie — le filtre que le journal nomme', () => {
  it('la clé écrite dans la règle quand le catalogue ne la connaît pas', () => {
    expect(conditionNonRemplie({ source: { eq: 'site_web' } }, evt('lead.created', { source: 'manuel' }))).toBe('source');
  });

  it('le libellé du réglage quand le catalogue le connaît', () => {
    expect(conditionNonRemplie({ montant__gte: 5000 }, evt('quote.viewed', { montant: 1200 }))).toBe('Montant minimum ($)');
  });

  it('une borne hors catalogue : la clé sans son suffixe d’opérateur', () => {
    expect(conditionNonRemplie({ amount_cents__gte: 5000 }, evt('invoice.paid', { amount_cents: 100 }))).toBe('amount_cents');
  });

  it('la PREMIÈRE condition non remplie, pas une condition remplie', () => {
    expect(conditionNonRemplie({ source: 'manuel', ville: 'Laval' }, evt('lead.created', { source: 'manuel', ville: 'Québec' }))).toBe('ville');
  });

  it('tout est rempli → null', () => {
    expect(conditionNonRemplie({ source: 'manuel' }, evt('lead.created', { source: 'manuel' }))).toBeNull();
  });
});

describe('[L-004] la ligne « conditions » à l’écran', () => {
  it('son type n’est le nom d’AUCUNE action du catalogue', () => {
    expect(ACTIONS.map((a) => a.cle)).not.toContain(ACTION_REGLE_ECARTEE);
  });

  it('libellé lisible dans l’onglet Journaux, motif lu comme un saut', () => {
    expect(libelleAction(ACTION_REGLE_ECARTEE, true)).toBe('Conditions');
    expect(libelleAction(ACTION_REGLE_ECARTEE, false)).toBe('Conditions');
    expect(motifSaut({ result_success: true, result_data: { saute: 'Conditions non remplies : source', saute_code: 'conditions' } }))
      .toBe('Conditions non remplies : source');
  });
});
