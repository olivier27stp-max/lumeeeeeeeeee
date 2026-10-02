/**
 * B-14 — « Note ajoutée » et « Tâche terminée » écrites PAR LA BASE (trigger,
 * migration proposée M-02) : la boucle de 15 s remonte au client rattaché et
 * n'émet qu'une fois, même quand l'écran des tâches a déjà émis de son côté.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const emis = vi.hoisted(() => ({ liste: [] as Array<{ type: string; entityType: string; entityId: string; metadata: Record<string, unknown> }> }));
vi.mock('../../../server/lib/eventBus', () => ({
  eventBus: { emit: vi.fn(async (type: string, e: { entityType: string; entityId: string; metadata: Record<string, unknown> }) => { emis.liste.push({ type, ...e }); return true; }) },
}));

import { traiterEvenementsBase, DELAI_GRACE_TACHE_MS, TYPE_REPERE } from '../../../server/lib/evenementsBase';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
type Ligne = Record<string, any>;

/** Un faux Supabase en mémoire : filtre, met à jour, insère. */
function fauxSupabase(tables: Record<string, Ligne[]>) {
  const lire = (l: Ligne, c: string) => {
    const m = /^(\w+)->>(\w+)$/.exec(c);
    return m ? l[m[1]]?.[m[2]] : l[c];
  };
  return {
    tables,
    from(table: string) {
      tables[table] ??= [];
      const filtres: Array<(l: Ligne) => boolean> = [];
      let maj: Ligne | null = null;
      let limite = Infinity;
      const lignes = () => tables[table].filter((l) => filtres.every((f) => f(l))).slice(0, limite);
      const resoudre = () => {
        const trouvees = lignes();
        if (maj) for (const l of trouvees) Object.assign(l, maj);
        return { data: trouvees.map((l) => ({ ...l })), error: null };
      };
      const b: Ligne = {
        select: () => b,
        order: () => b,
        limit: (n: number) => { limite = n; return b; },
        eq: (c: string, v: unknown) => { filtres.push((l) => lire(l, c) === v); return b; },
        neq: (c: string, v: unknown) => { filtres.push((l) => lire(l, c) !== v); return b; },
        is: (c: string, v: unknown) => { filtres.push((l) => (lire(l, c) ?? null) === v); return b; },
        lt: (c: string, v: any) => { filtres.push((l) => lire(l, c) < v); return b; },
        gte: (c: string, v: any) => { filtres.push((l) => lire(l, c) >= v); return b; },
        update: (v: Ligne) => { maj = v; return b; },
        insert: (v: Ligne) => { tables[table].push({ ...v }); return Promise.resolve({ data: null, error: null }); },
        maybeSingle: async () => ({ data: resoudre().data[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve(resoudre()).then(res),
      };
      return b;
    },
  };
}

const ilYa = (ms: number) => new Date(Date.now() - ms).toISOString();
const repere = { id: 1, org_id: '0', type: TYPE_REPERE, created_at: ilYa(86_400_000), traite_at: ilYa(86_400_000), attempts: 0 };
const ligne = (id: number, extra: Ligne): Ligne => ({
  id, org_id: ORG, related_entity_type: null, related_entity_id: null, attempts: 0, traite_at: null, last_error: null, created_at: ilYa(60_000), ...extra,
});
const BASE = {
  clients: [{ id: 'client-1', org_id: ORG, first_name: 'Ada', last_name: 'Roy', email: 'ada@lume-qa.test', phone: '+15145550101' }],
  jobs: [{ id: 'job-1', org_id: ORG, client_id: 'client-1' }, { id: 'job-orphelin', org_id: ORG, client_id: null }],
  quotes: [{ id: 'devis-1', org_id: ORG, client_id: null, lead_id: 'client-1' }],
  deals: [{ id: 'deal-1', org_id: ORG, client_id: 'client-1' }],
};

beforeEach(() => { emis.liste.length = 0; });

describe('[B-14] « Note ajoutée » depuis l’onglet Notes (specific_notes)', () => {
  it('une note sur un JOB, un DEVIS ou une OPPORTUNITÉ part pour le CLIENT rattaché', async () => {
    const sb = fauxSupabase({
      ...BASE,
      automation_evenements_base: [
        repere,
        ligne(10, { type: 'note.added', entity_type: 'job', entity_id: 'job-1', metadata: { note_id: 'n1', note_sur: 'job', texte: 'Rappeler mardi' } }),
        ligne(11, { type: 'note.added', entity_type: 'quote', entity_id: 'devis-1', metadata: { note_id: 'n2', note_sur: 'quote', texte: 'Veut un rabais' } }),
        ligne(12, { type: 'note.added', entity_type: 'deal', entity_id: 'deal-1', metadata: { note_id: 'n3', note_sur: 'deal', texte: 'Relance' } }),
      ],
    });
    expect(await traiterEvenementsBase(sb as never)).toBe(3);
    expect(emis.liste.map((e) => [e.type, e.entityType, e.entityId])).toEqual([
      ['note.added', 'client', 'client-1'], ['note.added', 'client', 'client-1'], ['note.added', 'client', 'client-1'],
    ]);
    expect(emis.liste[0].metadata).toMatchObject({ note_sur: 'job', texte: 'Rappeler mardi', evenement_base_id: '10' });
  });

  it('une note sans client rattaché ne déclenche rien, et la ligne est close avec son motif (pas réessayée)', async () => {
    const sb = fauxSupabase({
      ...BASE,
      automation_evenements_base: [repere, ligne(20, { type: 'note.added', entity_type: 'job', entity_id: 'job-orphelin', metadata: {} })],
    });
    expect(await traiterEvenementsBase(sb as never)).toBe(0);
    expect(emis.liste).toHaveLength(0);
    const l = sb.tables.automation_evenements_base.find((x) => x.id === 20)!;
    expect(l.traite_at).toBeTruthy();
    expect(l.last_error).toMatch(/sans client/);
  });
});

describe('[B-14] « Tâche terminée » quel que soit le chemin', () => {
  const tache = (id: number, extra: Ligne = {}) => ligne(id, {
    type: 'task.completed', entity_type: 'task', entity_id: `tache-${id}`,
    metadata: { task_id: `tache-${id}`, task_title: 'Rappeler', linked_entity_type: 'client', linked_entity_id: 'client-1', job_id: null },
    ...extra,
  });

  it('terminée par Lumi (aucun appel du navigateur) : émise pour le client, avec le titre de la tâche', async () => {
    const sb = fauxSupabase({ ...BASE, domain_events: [], automation_evenements_base: [repere, tache(30)] });
    expect(await traiterEvenementsBase(sb as never)).toBe(1);
    expect(emis.liste[0]).toMatchObject({
      type: 'task.completed', entityType: 'client', entityId: 'client-1',
      metadata: { task_id: 'tache-30', task_title: 'Rappeler', client_name: 'Ada Roy', evenement_base_id: '30' },
    });
  });

  it('terminée à l’écran : le navigateur a déjà émis → pas de second événement', async () => {
    const sb = fauxSupabase({
      ...BASE,
      domain_events: [{ id: 1, org_id: ORG, type: 'task.completed', entity_id: 'client-1', metadata: { task_id: 'tache-31' }, created_at: ilYa(58_000) }],
      automation_evenements_base: [repere, tache(31)],
    });
    expect(await traiterEvenementsBase(sb as never)).toBe(0);
    expect(emis.liste).toHaveLength(0);
    expect(sb.tables.automation_evenements_base.find((x) => x.id === 31)!.last_error).toMatch(/Déjà émis/);
  });

  it('délai de grâce : une tâche terminée il y a 2 s attend (l’appel du navigateur est peut-être en route)', async () => {
    const sb = fauxSupabase({ ...BASE, domain_events: [], automation_evenements_base: [repere, tache(32, { created_at: ilYa(2_000) })] });
    expect(DELAI_GRACE_TACHE_MS).toBeGreaterThanOrEqual(5_000);
    expect(await traiterEvenementsBase(sb as never)).toBe(0);
    const l = sb.tables.automation_evenements_base.find((x) => x.id === 32)!;
    expect(l.traite_at).toBeNull();
    expect(l.attempts).toBe(0);
  });

  it('tâche interne (« commander des pièces », aucun client) : rien, ligne close', async () => {
    const sb = fauxSupabase({
      ...BASE, domain_events: [],
      automation_evenements_base: [repere, tache(33, { metadata: { task_id: 'tache-33', task_title: 'Commander', linked_entity_type: null, linked_entity_id: null, job_id: null } })],
    });
    expect(await traiterEvenementsBase(sb as never)).toBe(0);
    expect(sb.tables.automation_evenements_base.find((x) => x.id === 33)!.last_error).toMatch(/sans client/);
  });
});
