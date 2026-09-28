/**
 * CHAMPS PERSONNALISÉS × MOTEUR — le côté serveur de l'étape 6.
 *
 *   · « Date atteinte » sur un champ du DEAL : le balayage émet le deal
 *     (ouvert seulement), plus seulement les fiches clients ;
 *   · {{deal.cle}} depuis un devis, une job ou un client : le deal LIÉ est
 *     cherché (une requête, jamais hors de l'org) ;
 *   · « quand il devient … » : `new_value` est émise NORMALISÉE, et le
 *     moteur compare `field_id` / `new_value` aux métadonnées.
 *
 * Le faux Supabase ci-dessous FILTRE vraiment (eq, is, in, or, limit) : un
 * faux qui répond n'importe quoi à n'importe quelle requête confirme les
 * bugs au lieu de les révéler (leçon des rappels sur `custom_columns`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const emis = vi.hoisted(() => ({ liste: [] as Array<{ type: string; e: any }> }));
vi.mock('../server/lib/eventBus', () => ({
  eventBus: { emit: vi.fn(async (type: string, e: unknown) => { emis.liste.push({ type, e }); }) },
}));

import { balayerRappelsDates, jourDecale } from '../server/lib/rappels-dates';
import { dealLie, resolveEntityVariables, resolveTemplate } from '../server/lib/actions/index';
import { ecrireValeurs } from '../server/lib/champs/service';
import { evaluateConditions } from '../server/lib/automationEngine';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AUTRE_ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CLIENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEVIS = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const JOB = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DEAL_OUVERT = '10000000-0000-4000-8000-000000000001';
const DEAL_GAGNE = '10000000-0000-4000-8000-000000000002';
const DEAL_DU_DEVIS = '10000000-0000-4000-8000-000000000003';
const DEAL_AUTRE_ORG = '10000000-0000-4000-8000-000000000004';
const CHAMP_DATE = '20000000-0000-4000-8000-000000000001';
const CHAMP_TYPE = '20000000-0000-4000-8000-000000000002';

type Ligne = Record<string, any>;

function fauxSupabase(tables: Record<string, Ligne[]>, rpc: Record<string, unknown> = {}) {
  const requetes: Array<{ table: string; filtres: Array<[string, string, unknown]> }> = [];
  const client = {
    from(table: string) {
      let lignes = [...(tables[table] ?? [])];
      const filtres: Array<[string, string, unknown]> = [];
      requetes.push({ table, filtres });
      const b: any = {
        select: () => b, order: () => b, insert: () => b, update: () => b,
        eq: (c: string, v: unknown) => { filtres.push(['eq', c, v]); lignes = lignes.filter((l) => l[c] === v); return b; },
        is: (c: string, v: unknown) => { filtres.push(['is', c, v]); lignes = lignes.filter((l) => (l[c] ?? null) === v); return b; },
        in: (c: string, v: unknown[]) => { filtres.push(['in', c, v]); lignes = lignes.filter((l) => v.includes(l[c])); return b; },
        or: (s: string) => {
          filtres.push(['or', s, null]);
          const conds = s.split(',').map((x) => x.split('.eq.'));
          lignes = lignes.filter((l) => conds.some(([c, v]) => l[c] === v));
          return b;
        },
        limit: (n: number) => { lignes = lignes.slice(0, n); return b; },
        maybeSingle: async () => ({ data: lignes[0] ?? null, error: null }),
        single: async () => ({ data: lignes[0] ?? null, error: null }),
        then: (ok: any, ko: any) => Promise.resolve({ data: lignes, error: null }).then(ok, ko),
      };
      return b;
    },
    rpc: async (nom: string) => ({ data: rpc[nom] ?? null, error: null }),
  };
  return { client: client as any, requetes };
}

beforeEach(() => { emis.liste = []; });

// ─── 5. « Date atteinte » sur un champ du deal ───────────────────

describe('« Date atteinte » sur une date du DEAL', () => {
  const maintenant = new Date('2026-09-28T15:00:00Z');
  const regle = { id: 'r1', org_id: ORG, trigger_event: 'date.reached', is_active: true, deleted_at: null,
    conditions: { champ_id: CHAMP_DATE, jours_avant: 3 } };
  const jourVise = jourDecale(3, maintenant);

  function base(deals: Ligne[]) {
    return fauxSupabase({
      automation_rules: [regle],
      custom_fields: [{ id: CHAMP_DATE, org_id: ORG, object_type: 'deal', field_type: 'date', archived_at: null }],
      custom_field_values: [
        { org_id: ORG, field_id: CHAMP_DATE, value_date: jourVise, client_id: null, deal_id: DEAL_OUVERT },
        { org_id: ORG, field_id: CHAMP_DATE, value_date: jourVise, client_id: null, deal_id: DEAL_GAGNE },
        // Une autre date : pas aujourd'hui.
        { org_id: ORG, field_id: CHAMP_DATE, value_date: '2020-01-01', client_id: null, deal_id: DEAL_DU_DEVIS },
      ],
      deals,
    });
  }

  it('émet le DEAL ouvert, avec le jour du balayage (anti-doublon)', async () => {
    const sb = base([
      { id: DEAL_OUVERT, org_id: ORG, deleted_at: null, pipeline_stages: { kind: 'open' } },
      { id: DEAL_GAGNE, org_id: ORG, deleted_at: null, pipeline_stages: { kind: 'won' } },
    ]);
    const r = await balayerRappelsDates(sb.client, maintenant);
    expect(r).toEqual({ regles: 1, emis: 1, erreurs: 0 });
    expect(emis.liste).toHaveLength(1);
    expect(emis.liste[0]).toMatchObject({
      type: 'date.reached',
      e: { orgId: ORG, entityType: 'deal', entityId: DEAL_OUVERT, metadata: { champ_id: CHAMP_DATE, date: jourVise } },
    });
    expect(emis.liste[0].e.metadata.jour).toBe('2026-09-28');
  });

  it('la RÈGLE qui a balayé part vraiment : ses conditions (champ_id, jours_avant) collent à l’événement', async () => {
    /*
     * Trouvé contre la vraie base (staging) : le moteur compare TOUTES les
     * conditions de la règle aux métadonnées. L'événement ne portait pas
     * `jours_avant` : une règle « 3 jours avant » était balayée, l'événement
     * émis… et le moteur l'écartait. Aucune erreur, aucun envoi.
     */
    const sb = base([{ id: DEAL_OUVERT, org_id: ORG, deleted_at: null, pipeline_stages: { kind: 'open' } }]);
    await balayerRappelsDates(sb.client, maintenant);
    const e = emis.liste[0].e;
    expect(evaluateConditions(regle.conditions, { type: 'date.reached', ...e })).toBe(true);
    // Une règle sur le même champ à un AUTRE délai ne part pas sur cet événement.
    expect(evaluateConditions({ champ_id: CHAMP_DATE, jours_avant: 7 }, { type: 'date.reached', ...e })).toBe(false);
  });

  it('un deal gagné, perdu ou SUPPRIMÉ n’a plus de relance', async () => {
    const sb = base([
      { id: DEAL_OUVERT, org_id: ORG, deleted_at: '2026-09-01T00:00:00Z', pipeline_stages: { kind: 'open' } },
      { id: DEAL_GAGNE, org_id: ORG, deleted_at: null, pipeline_stages: [{ kind: 'lost' }] },
    ]);
    const r = await balayerRappelsDates(sb.client, maintenant);
    expect(r.emis).toBe(0);
    expect(emis.liste).toHaveLength(0);
  });

  it('un deal d’une AUTRE organisation n’est jamais lu', async () => {
    const sb = base([{ id: DEAL_OUVERT, org_id: AUTRE_ORG, deleted_at: null, pipeline_stages: { kind: 'open' } }]);
    await balayerRappelsDates(sb.client, maintenant);
    expect(emis.liste).toHaveLength(0);
    const lectureDeals = sb.requetes.filter((q) => q.table === 'deals');
    expect(lectureDeals.length).toBeGreaterThan(0);
    for (const q of lectureDeals) expect(q.filtres).toContainEqual(['eq', 'org_id', ORG]);
  });

  it('un champ de JOB reste ignoré (ni client ni deal)', async () => {
    const sb = fauxSupabase({
      automation_rules: [regle],
      custom_fields: [{ id: CHAMP_DATE, org_id: ORG, object_type: 'job', field_type: 'date', archived_at: null }],
    });
    const r = await balayerRappelsDates(sb.client, maintenant);
    expect(r.emis).toBe(0);
    expect(sb.requetes.some((q) => q.table === 'custom_field_values')).toBe(false);
  });
});

// ─── 6. Le deal LIÉ, pour {{deal.cle}} depuis d'autres événements ─

describe('le deal lié à un devis, une job ou un client', () => {
  const deals: Ligne[] = [
    // Du plus récent au plus ancien (le faux ne trie pas).
    { id: DEAL_GAGNE, org_id: ORG, deleted_at: null, client_id: CLIENT, quote_id: null, job_id: JOB, pipeline_stages: { kind: 'won' } },
    { id: DEAL_OUVERT, org_id: ORG, deleted_at: null, client_id: CLIENT, quote_id: null, job_id: null, pipeline_stages: { kind: 'open' } },
    { id: DEAL_DU_DEVIS, org_id: ORG, deleted_at: null, client_id: CLIENT, quote_id: DEVIS, job_id: null, pipeline_stages: { kind: 'won' } },
    { id: DEAL_AUTRE_ORG, org_id: AUTRE_ORG, deleted_at: null, client_id: CLIENT, quote_id: DEVIS, job_id: JOB, pipeline_stages: { kind: 'open' } },
  ];

  it('devis : le deal qui le porte, même gagné', async () => {
    const sb = fauxSupabase({ deals });
    expect(await dealLie(sb.client, ORG, 'quote', DEVIS, CLIENT)).toBe(DEAL_DU_DEVIS);
  });

  it('devis sans deal : le deal OUVERT le plus récent de son client', async () => {
    const sb = fauxSupabase({ deals: deals.filter((d) => d.id !== DEAL_DU_DEVIS) });
    expect(await dealLie(sb.client, ORG, 'quote', DEVIS, CLIENT)).toBe(DEAL_OUVERT);
  });

  it('job : le deal qui la porte ; client : son deal ouvert', async () => {
    const sb = fauxSupabase({ deals });
    expect(await dealLie(sb.client, ORG, 'job', JOB, CLIENT)).toBe(DEAL_GAGNE);
    expect(await dealLie(sb.client, ORG, 'client', CLIENT, CLIENT)).toBe(DEAL_OUVERT);
  });

  it('UNE requête, bornée à l’org ; jamais le deal d’une autre org', async () => {
    const sb = fauxSupabase({ deals: deals.filter((d) => d.org_id === AUTRE_ORG) });
    expect(await dealLie(sb.client, ORG, 'quote', DEVIS, CLIENT)).toBeNull();
    const q = sb.requetes.filter((r) => r.table === 'deals');
    expect(q).toHaveLength(1);
    expect(q[0].filtres).toContainEqual(['eq', 'org_id', ORG]);
    expect(q[0].filtres).toContainEqual(['is', 'deleted_at', null]);
  });

  it('un identifiant qui n’est pas un uuid n’entre jamais dans le filtre', async () => {
    const sb = fauxSupabase({ deals });
    expect(await dealLie(sb.client, ORG, 'quote', 'x,org_id.eq.autre', CLIENT)).toBeNull();
    expect(await dealLie(sb.client, ORG, 'invoice', DEVIS, CLIENT)).toBeNull();
    expect(sb.requetes).toHaveLength(0);
  });

  it('depuis un DEVIS, {{deal.type_service}} se résout avec la valeur du deal lié', async () => {
    const sb = fauxSupabase({
      company_settings: [{ org_id: ORG, default_language: 'fr', timezone: 'America/Toronto', company_name: 'Lavage' }],
      quotes: [{ id: DEVIS, org_id: ORG, client_id: CLIENT, lead_id: null, job_id: null }],
      deals,
      custom_fields: [{
        id: CHAMP_TYPE, org_id: ORG, object_type: 'deal', key: 'type_service', label: 'Type de service',
        field_type: 'single_line', config: {}, archived_at: null, position: 0,
      }],
      custom_field_values: [{
        id: 'v1', org_id: ORG, object_type: 'deal', field_id: CHAMP_TYPE, deal_id: DEAL_DU_DEVIS,
        value_text: 'Commercial', version: 1, updated_at: '',
      }],
    });
    const vars = await resolveEntityVariables(sb.client, ORG, 'quote', DEVIS);
    expect(vars.deal_cf_type_service).toBe('Commercial');
    expect(resolveTemplate('Service : {{deal.type_service}}', vars)).toBe('Service : Commercial');
  });
});

// ─── 1. « Quand il devient … » ─────────────────────────────────────

describe('« Champ modifié » : field_id et new_value comparés par le moteur', () => {
  const evenement = (metadata: Record<string, unknown>) => ({
    type: 'custom_field.changed', orgId: ORG, entityType: 'deal', entityId: DEAL_OUVERT, metadata,
  }) as any;

  it('le bon champ ET la bonne valeur ; sinon rien', () => {
    const conditions = { field_id: { eq: CHAMP_TYPE }, new_value: { eq: 'opt-commercial' } };
    expect(evaluateConditions(conditions, evenement({ field_id: CHAMP_TYPE, new_value: 'opt-commercial' }))).toBe(true);
    expect(evaluateConditions(conditions, evenement({ field_id: CHAMP_TYPE, new_value: 'opt-residentiel' }))).toBe(false);
    expect(evaluateConditions(conditions, evenement({ field_id: CHAMP_DATE, new_value: 'opt-commercial' }))).toBe(false);
    // Liste multiple : « contient ».
    expect(evaluateConditions(conditions, evenement({ field_id: CHAMP_TYPE, new_value: ['x', 'opt-commercial'] }))).toBe(true);
  });

  it('la valeur émise est NORMALISÉE : « oui » d’une case → true, « 12,6 » à 0 décimale → 13', async () => {
    const CASE = '30000000-0000-4000-8000-000000000001';
    const NOMBRE = '30000000-0000-4000-8000-000000000002';
    const sb = fauxSupabase({
      custom_fields: [
        { id: CASE, org_id: ORG, object_type: 'deal', key: 'urgent', label: 'Urgent', field_type: 'checkbox', config: {}, archived_at: null, is_required: false },
        { id: NOMBRE, org_id: ORG, object_type: 'deal', key: 'fenetres', label: 'Fenêtres', field_type: 'number', config: { decimals: 0 }, archived_at: null, is_required: false },
      ],
    }, { cf_ecrire_valeur: { changed: true, conflict: false, version: 2, old: null } });
    await ecrireValeurs(sb.client, ORG, 'deal', DEAL_OUVERT, [
      { field_id: CASE, value: 'oui' },
      { field_id: NOMBRE, value: '12,6' },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    const valeurs = emis.liste.filter((x) => x.type === 'custom_field.changed').map((x) => x.e.metadata.new_value);
    expect(valeurs).toEqual([true, 13]);
    // Et la condition que l'éditeur écrit (booléen) correspond.
    expect(evaluateConditions({ new_value: { eq: true } }, evenement({ new_value: valeurs[0] }))).toBe(true);
    expect(evaluateConditions({ new_value: { eq: 13 } }, evenement({ new_value: valeurs[1] }))).toBe(true);
  });
});

// ─── Enregistrer le parcours n'efface plus les réglages du déclencheur ─

describe('une MODIFICATION partielle ne touche que ce qu’elle envoie', () => {
  it('{ name, steps } ne remet ni les conditions à {} ni la règle en brouillon', async () => {
    /*
     * Trouvé dans un vrai navigateur contre staging : régler « Champ
     * modifié » puis enregistrer une étape effaçait le champ surveillé. Les
     * `.default()` du corps (conditions {}, is_active false) s'appliquaient
     * aussi à une modification — et chaque enregistrement du parcours
     * dépubliait la règle.
     */
    const { automationRuleUpdateSchema } = await import('../server/lib/validation');
    const r = automationRuleUpdateSchema.safeParse({
      name: 'Relance', steps: [{ id: 'm1', type: 'action', action: { type: 'send_sms', config: { body: 'Bonjour' } } }],
    });
    expect(r.success).toBe(true);
    expect(Object.keys(r.data as object).sort()).toEqual(['name', 'steps']);
    // Et ce qui est envoyé reste validé comme avant.
    const c = automationRuleUpdateSchema.safeParse({ conditions: { field_id: { eq: CHAMP_TYPE } } });
    expect(c.success && (c.data as { conditions?: unknown }).conditions).toEqual({ field_id: { eq: CHAMP_TYPE } });
    expect(automationRuleUpdateSchema.safeParse({ conditions: { x: { zz: 1 } } }).success).toBe(false);
    expect(automationRuleUpdateSchema.safeParse({}).success).toBe(false);
  });
});
