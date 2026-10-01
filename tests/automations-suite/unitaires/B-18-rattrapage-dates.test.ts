/**
 * B-18 — « Date atteinte » : un balayage manqué est rattrapé, une seule fois,
 * et seulement pour les jours où la règle était déjà active (point 10).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const emis = vi.hoisted(() => ({ liste: [] as Array<{ entityId: string; metadata: Record<string, unknown> }> }));
vi.mock('../../../server/lib/eventBus', () => ({
  eventBus: { emit: vi.fn(async (_type: string, e: { entityId: string; metadata: Record<string, unknown> }) => { emis.liste.push(e); return true; }) },
}));

import { balayerRappelsDates, retardsABalayer, JOURS_DE_RATTRAPAGE } from '../../../server/lib/rappels-dates';
import { viderCachePause } from '../../../server/lib/automations-pause-org';
import { viderCacheFuseau } from '../../../server/lib/automations-fuseau-org';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CHAMP = '20000000-0000-4000-8000-000000000001';
const MIDI = new Date('2026-10-05T16:00:00Z'); // lundi 5 octobre, midi à Toronto
const TZ = 'America/Toronto';

type Ligne = Record<string, unknown>;

/** Un faux Supabase qui FILTRE (eq / is / in) : le rattrapage se juge sur les lignes rendues. */
function fauxSupabase(tables: Record<string, Ligne[]>) {
  const lire = (l: Ligne, c: string) => {
    const m = /^(\w+)->>(\w+)$/.exec(c);
    return m ? (l[m[1]] as Ligne | undefined)?.[m[2]] : l[c];
  };
  return {
    from(table: string) {
      let lignes = [...(tables[table] ?? [])];
      const b: Record<string, unknown> = {
        select: () => b, order: () => b, limit: () => b,
        eq: (c: string, v: unknown) => { lignes = lignes.filter((l) => lire(l, c) === v); return b; },
        is: (c: string, v: unknown) => { lignes = lignes.filter((l) => (lire(l, c) ?? null) === v); return b; },
        maybeSingle: async () => ({ data: lignes[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: lignes, error: null }).then(res),
      };
      return b;
    },
  } as never;
}

const regle = (extra: Ligne = {}) => ({
  id: 'r1', org_id: ORG, trigger_event: 'date.reached', is_active: true, deleted_at: null,
  conditions: { champ_id: CHAMP, jours_avant: 0 }, ...extra,
});
const valeur = (clientId: string, date: string) => ({ org_id: ORG, field_id: CHAMP, client_id: clientId, deal_id: null, value_date: date });
const base = (r: Ligne, valeurs: Ligne[], journal: Ligne[] = []) => fauxSupabase({
  automation_rules: [r],
  custom_fields: [{ id: CHAMP, org_id: ORG, object_type: 'client', field_type: 'date', archived_at: null }],
  custom_field_values: valeurs,
  clients: ['c-jour', 'c-hier', 'c-avant-hier', 'c-vieux'].map((id) => ({ id, org_id: ORG, deleted_at: null })),
  company_settings: [{ org_id: ORG, timezone: TZ, automations_paused: false }],
  activity_log: journal,
});

beforeEach(() => { emis.liste.length = 0; viderCachePause(); viderCacheFuseau(); });

describe('[B-18] les jours à balayer', () => {
  it('date d’activation inconnue : aujourd’hui seulement (comportement d’avant)', () => {
    expect(retardsABalayer({}, MIDI, TZ)).toEqual([0]);
  });

  it('règle active depuis longtemps : aujourd’hui + les jours de rattrapage', () => {
    expect(retardsABalayer({ activee_le: '2026-09-01T12:00:00Z' }, MIDI, TZ)).toEqual([0, 1, 2]);
    expect(JOURS_DE_RATTRAPAGE).toBe(2);
  });

  it('règle activée HIER : elle rattrape hier, pas avant-hier ; activée aujourd’hui : rien à rattraper', () => {
    expect(retardsABalayer({ activee_le: '2026-10-04T15:00:00Z' }, MIDI, TZ)).toEqual([0, 1]);
    expect(retardsABalayer({ activee_le: '2026-10-05T13:00:00Z' }, MIDI, TZ)).toEqual([0]);
  });

  it('sans `activee_le` (migration pas encore appliquée), `updated_at` sert de repli', () => {
    expect(retardsABalayer({ updated_at: '2026-10-04T15:00:00Z' }, MIDI, TZ)).toEqual([0, 1]);
  });
});

describe('[B-18] le balayage rattrape, une seule fois', () => {
  const VALEURS = [valeur('c-jour', '2026-10-05'), valeur('c-hier', '2026-10-04'), valeur('c-avant-hier', '2026-10-03'), valeur('c-vieux', '2026-10-01')];

  it('règle active depuis un mois : aujourd’hui, hier et avant-hier partent ; plus vieux, non', async () => {
    const r = await balayerRappelsDates(base(regle({ activee_le: '2026-09-01T12:00:00Z' }), VALEURS), MIDI);
    expect(emis.liste.map((e) => e.entityId).sort()).toEqual(['c-avant-hier', 'c-hier', 'c-jour']);
    expect(r).toMatchObject({ emis: 3, rattrapes: 2, erreurs: 0 });
    expect(emis.liste.find((e) => e.entityId === 'c-hier')?.metadata).toMatchObject({ date: '2026-10-04', rattrapage_jours: 1, jours_avant: 0 });
    expect(emis.liste.find((e) => e.entityId === 'c-jour')?.metadata.rattrapage_jours).toBeUndefined();
  });

  it('règle activée ce matin : seule la date du jour part (aucun effet rétroactif)', async () => {
    await balayerRappelsDates(base(regle({ activee_le: '2026-10-05T13:00:00Z' }), VALEURS), MIDI);
    expect(emis.liste.map((e) => e.entityId)).toEqual(['c-jour']);
  });

  it('ce qui est déjà au journal (activity_log) pour cette règle et cette date ne repart pas', async () => {
    const journal = [
      { org_id: ORG, event_type: 'date_reached', entity_id: 'c-jour', metadata: { rule_id: 'r1', date: '2026-10-05' } },
      // Une AUTRE règle a émis pour c-hier : ce n'est pas la nôtre, on émet.
      { org_id: ORG, event_type: 'date_reached', entity_id: 'c-hier', metadata: { rule_id: 'autre', date: '2026-10-04' } },
    ];
    await balayerRappelsDates(base(regle({ activee_le: '2026-09-01T12:00:00Z' }), VALEURS, journal), MIDI);
    expect(emis.liste.map((e) => e.entityId).sort()).toEqual(['c-avant-hier', 'c-hier']);
  });

  it('passage du tick (`enJournee`) : rien à 3 h du matin, heure de l’entreprise', async () => {
    const nuit = new Date('2026-10-05T07:00:00Z'); // 3 h à Toronto
    const r = await balayerRappelsDates(base(regle({ activee_le: '2026-09-01T12:00:00Z' }), VALEURS), nuit, { enJournee: true });
    expect(r.emis).toBe(0);
    expect(emis.liste).toHaveLength(0);
  });

  it('bureau en pause : rien n’est émis (la date sera rattrapée à la reprise)', async () => {
    const sb = fauxSupabase({
      automation_rules: [regle({ activee_le: '2026-09-01T12:00:00Z' })],
      custom_fields: [{ id: CHAMP, org_id: ORG, object_type: 'client', field_type: 'date', archived_at: null }],
      custom_field_values: VALEURS,
      clients: [{ id: 'c-jour', org_id: ORG, deleted_at: null }],
      company_settings: [{ org_id: ORG, timezone: TZ, automations_paused: true }],
    });
    const r = await balayerRappelsDates(sb, MIDI);
    expect(r.emis).toBe(0);
  });
});
