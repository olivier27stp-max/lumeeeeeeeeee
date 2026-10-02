/**
 * B-04 — les conditions de la règle qui portent sur l'état ACTUEL sont
 * rejugées avant chaque action différée : étiquettes du client, champs
 * personnalisés, l'étiquette de « Étiquette ajoutée », l'étape de
 * « Opportunité qui dort ».
 *
 * Avant : elles n'étaient jugées qu'à l'arrivée de l'événement. Une relance
 * « seulement si le client a l'étiquette VIP » partait trois jours plus tard à
 * un client à qui on avait retiré l'étiquette.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const champs = vi.hoisted(() => ({ valeurs: {} as Record<string, unknown>, leve: false }));
vi.mock('../../../server/lib/champs/service', async (orig) => ({
  ...(await orig<any>()),
  listerChamps: vi.fn(async () => {
    if (champs.leve) throw new Error('lecture des champs impossible');
    return { champs: [{ id: 'champ-type', label: 'Type de client', field_type: 'text', config: {} }], dossiers: [] };
  }),
  lireValeursLot: vi.fn(async (_db: unknown, _org: string, _objet: string, ids: string[]) => ({
    [ids[0]]: 'champ-type' in champs.valeurs ? { 'champ-type': { value: champs.valeurs['champ-type'] } } : {},
  })),
}));

import { fauxSupabase, type Ligne } from './_faux-supabase';
import { revaliderTache, type TacheARevalider } from '../../../server/lib/sortie-parcours';

const ORG = '11111111-1111-4111-8111-111111111111';
const base = (extra: Partial<TacheARevalider>): TacheARevalider => ({
  orgId: ORG, entityType: 'client', entityId: 'c1', declencheur: 'note.added', metadonnees: {}, reglages: null,
  conditions: {}, actionsDeLaRegle: ['send_email'], caseParDeclencheur: false, ...extra,
});
const monde = (etiquettes: string[], extra: Record<string, Ligne[]> = {}) => fauxSupabase({
  clients: [{ id: 'c1', org_id: ORG, status: 'active', deleted_at: null }],
  client_tags: etiquettes.map((tag) => ({ client_id: 'c1', tag })),
  ...extra,
});

beforeEach(() => { champs.valeurs = {}; champs.leve = false; });

describe('[B-04] filtres d’étiquettes de la règle', () => {
  it('« le client a l’étiquette VIP » : retirée pendant le délai → arrêt, avec le nom de l’étiquette', async () => {
    const r = await revaliderTache(monde([]).client, base({ conditions: { client_a_etiquette: 'VIP' } }));
    expect(r.arret).toMatchObject({ code: 'condition_plus_valide', changement: 'le client n’a plus l’étiquette « vip »' });
  });

  it('toujours là (casse indifférente) → la tâche part', async () => {
    expect((await revaliderTache(monde(['Vip']).client, base({ conditions: { client_a_etiquette: 'VIP' } }))).arret).toBeUndefined();
  });

  it('« le client n’a PAS l’étiquette Ne pas relancer » : posée pendant le délai → arrêt', async () => {
    const r = await revaliderTache(monde(['ne pas relancer']).client, base({ conditions: { client_sans_etiquette: 'Ne pas relancer' } }));
    expect(r.arret?.changement).toBe('le client a maintenant l’étiquette « ne pas relancer »');
  });

  it('sur un DEVIS : les étiquettes sont celles du client du devis', async () => {
    const sb = monde([], { quotes: [{ id: 'd1', org_id: ORG, status: 'awaiting_response', client_id: 'c1' }] });
    const r = await revaliderTache(sb.client, base({ entityType: 'quote', entityId: 'd1', declencheur: 'quote.sent', conditions: { client_a_etiquette: 'vip' } }));
    expect(r.arret?.code).toBe('condition_plus_valide');
  });

  it('étiquettes illisibles (panne de lecture) : on ne conclut pas', async () => {
    const sb = fauxSupabase({ clients: [{ id: 'c1', org_id: ORG, status: 'active' }] }, { erreurs: { client_tags: 'timeout' } });
    expect((await revaliderTache(sb.client, base({ conditions: { client_a_etiquette: 'vip' } }))).arret).toBeUndefined();
  });

  it('règle sans filtre d’étiquette : AUCUNE lecture des étiquettes (pas de requête de plus)', async () => {
    const sb = monde(['vip']);
    await revaliderTache(sb.client, base({ conditions: { source: 'site' } }));
    expect(sb.lectures()).toEqual(['clients']);
  });
});

describe('[B-04] « Étiquette ajoutée » / « Étiquette retirée »', () => {
  it('« Étiquette ajoutée » + délai : l’étiquette a été retirée entre-temps → arrêt', async () => {
    const r = await revaliderTache(monde([]).client, base({ declencheur: 'client.tagged', metadonnees: { tag: 'À rappeler' }, conditions: { tag: 'À rappeler' } }));
    expect(r.arret?.changement).toBe('le client n’a plus l’étiquette « à rappeler »');
  });

  it('« Étiquette ajoutée » + délai : l’étiquette est toujours là → le message part', async () => {
    const r = await revaliderTache(monde(['À rappeler']).client, base({ declencheur: 'client.tagged', metadonnees: { tag: 'À rappeler' }, conditions: { tag: 'À rappeler' } }));
    expect(r.arret).toBeUndefined();
  });

  it('une règle qui écoute N’IMPORTE quelle étiquette (aucune choisie) n’est pas rejugée : elle ne dit pas laquelle compte', async () => {
    const sb = monde([]);
    const r = await revaliderTache(sb.client, base({ declencheur: 'client.tagged', metadonnees: { tag: 'À rappeler' }, conditions: {} }));
    expect(r.arret).toBeUndefined();
    expect(sb.lectures()).toEqual(['clients']);
  });

  it('« Étiquette retirée » + délai : elle a été reposée → arrêt', async () => {
    const r = await revaliderTache(monde(['à rappeler']).client, base({ declencheur: 'client.untagged', metadonnees: { tag: 'À rappeler' }, conditions: { tag: 'À rappeler' } }));
    expect(r.arret?.changement).toBe('le client a maintenant l’étiquette « à rappeler »');
  });

  it('un parcours qui retire LUI-MÊME l’étiquette (« étiquette posée → la retirer → attendre → écrire ») ne s’annule pas', async () => {
    const r = await revaliderTache(monde([]).client, base({
      declencheur: 'client.tagged', metadonnees: { tag: 'À rappeler' }, conditions: { tag: 'À rappeler' }, actionsDeLaRegle: ['retirer_etiquette', 'send_sms'],
    }));
    expect(r.arret).toBeUndefined();
  });
});

describe('[B-04] conditions de champs personnalisés', () => {
  const condition = { champs_perso: [{ field_id: 'champ-type', op: 'is', value: 'Commercial' }] };

  it('la valeur ne remplit plus la condition → arrêt, avec le nom du champ', async () => {
    champs.valeurs = { 'champ-type': 'Résidentiel' };
    const r = await revaliderTache(monde([]).client, base({ conditions: condition }));
    expect(r.arret).toMatchObject({ code: 'condition_plus_valide', changement: 'le champ « Type de client » ne remplit plus la condition' });
  });

  it('la valeur tient toujours → la tâche part', async () => {
    champs.valeurs = { 'champ-type': 'Commercial' };
    expect((await revaliderTache(monde([]).client, base({ conditions: condition }))).arret).toBeUndefined();
  });

  it('la règle écrit ELLE-MÊME des champs (update_custom_field) : pas rejugé contre elle', async () => {
    champs.valeurs = { 'champ-type': 'Résidentiel' };
    const r = await revaliderTache(monde([]).client, base({ conditions: condition, actionsDeLaRegle: ['update_custom_field', 'send_email'] }));
    expect(r.arret).toBeUndefined();
  });

  it('champs illisibles : on ne conclut pas', async () => {
    champs.leve = true;
    expect((await revaliderTache(monde([]).client, base({ conditions: condition }))).arret).toBeUndefined();
  });
});

describe('[B-04] « Opportunité qui dort » : elle a bougé pendant le délai', () => {
  const deal = (stage: string) => fauxSupabase({ deals: [{ id: 'o1', org_id: ORG, stage_id: stage, client_id: null }] }).client;
  const tache = (extra: Partial<TacheARevalider> = {}) => base({ entityType: 'deal', entityId: 'o1', declencheur: 'deal.stage_idle', metadonnees: { stage_id: 'e1' }, ...extra });

  it('déplacée dans une autre étape → « l’opportunité a changé d’étape »', async () => {
    expect((await revaliderTache(deal('e2'), tache())).arret).toMatchObject({ code: 'condition_plus_valide', changement: 'l’opportunité a changé d’étape' });
  });

  it('toujours dans l’étape → la relance part', async () => {
    expect((await revaliderTache(deal('e1'), tache())).arret).toBeUndefined();
  });

  it('la règle déplace ELLE-MÊME l’opportunité (move_deal_stage) : la suite du parcours ne s’annule pas', async () => {
    expect((await revaliderTache(deal('e2'), tache({ actionsDeLaRegle: ['move_deal_stage', 'send_email'] }))).arret).toBeUndefined();
  });
});
