/**
 * Outbox des événements (`domain_events`) — ce qui garantit qu'un événement
 * émis juste avant un redémarrage n'est pas perdu.
 *
 * Le faux client Supabase ci-dessous garde les lignes en mémoire et applique
 * les filtres (`eq`, `is`, `lt`) : c'est ce qui permet de prouver la
 * réclamation optimiste et le cochage, pas seulement qu'un appel a eu lieu.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import type { SupabaseClient } from '@supabase/supabase-js';

type Ligne = Record<string, any>;

function fauxSupabase(opts: { insertionOutboxEchoue?: boolean } = {}) {
  const tables: Record<string, Ligne[]> = { activity_log: [], domain_events: [] };
  let prochainId = 1;

  function constructeur(table: string) {
    const filtres: Array<(l: Ligne) => boolean> = [];
    let operation: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let charge: Ligne | null = null;
    let limite = Infinity;

    const executer = () => {
      const lignes = tables[table];
      if (operation === 'insert') {
        if (table === 'domain_events' && opts.insertionOutboxEchoue) {
          return { data: null, error: { message: 'insertion refusée' } };
        }
        const l = { id: prochainId++, processed_at: null, attempts: 0, last_error: null,
          created_at: new Date().toISOString(), ...charge };
        lignes.push(l);
        return { data: [{ ...l }], error: null };
      }
      const visees = lignes.filter((l) => filtres.every((f) => f(l)));
      if (operation === 'update') {
        visees.forEach((l) => Object.assign(l, charge));
        return { data: visees.map((l) => ({ ...l })), error: null };
      }
      if (operation === 'delete') {
        tables[table] = lignes.filter((l) => !visees.includes(l));
        return { data: null, error: null };
      }
      return { data: visees.slice(0, limite).map((l) => ({ ...l })), error: null };
    };

    const b: any = {
      insert(row: Ligne) { operation = 'insert'; charge = row; return b; },
      update(patch: Ligne) { operation = 'update'; charge = patch; return b; },
      delete() { operation = 'delete'; return b; },
      select() { return b; },
      eq(c: string, v: unknown) { filtres.push((l) => l[c] === v); return b; },
      is(c: string, v: unknown) { filtres.push((l) => (l[c] ?? null) === v); return b; },
      lt(c: string, v: string) { filtres.push((l) => l[c] !== null && l[c] < v); return b; },
      order() { return b; },
      limit(n: number) { limite = n; return b; },
      single() {
        const r = executer();
        return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error });
      },
      then(res: (v: unknown) => unknown, rej: (e: unknown) => unknown) {
        return Promise.resolve(executer()).then(res, rej);
      },
    };
    return b;
  }

  return { client: { from: (t: string) => constructeur(t) } as unknown as SupabaseClient, tables };
}

/** Laisse tourner les promesses en arrière-plan (cochage après les écouteurs). */
const vider = () => new Promise((r) => setTimeout(r, 0));

let bus: typeof import('../server/lib/eventBus').eventBus;
let outbox: typeof import('../server/lib/outbox');

beforeEach(async () => {
  vi.resetModules();
  bus = (await import('../server/lib/eventBus')).eventBus;
  outbox = await import('../server/lib/outbox');
});

const EVT = { orgId: 'org-1', entityType: 'quote', entityId: 'q-1', metadata: { a: 1 } };

describe('emit — consigner, émettre, cocher', () => {
  it('consigne l\'événement et ne le coche qu\'APRÈS la fin de tous les écouteurs', async () => {
    const { client, tables } = fauxSupabase();
    bus.init(client);
    let liberer!: () => void;
    const enCours = new Promise<void>((r) => { liberer = r; });
    bus.onEvent('quote.sent', async () => { await enCours; });

    await bus.emit('quote.sent', EVT);
    await vider();

    expect(tables.domain_events).toHaveLength(1);
    expect(tables.domain_events[0]).toMatchObject({ type: 'quote.sent', org_id: 'org-1', entity_id: 'q-1' });
    // L'écouteur tourne encore : la ligne ne doit PAS être cochée, sinon un
    // crash maintenant perdrait l'événement sans rejeu possible.
    expect(tables.domain_events[0].processed_at).toBeNull();

    liberer();
    await vider();
    expect(tables.domain_events[0].processed_at).not.toBeNull();
    expect(tables.activity_log).toHaveLength(1);
  });

  it('coche quand même si un écouteur échoue, en gardant l\'erreur (rejouer doublerait les autres)', async () => {
    const { client, tables } = fauxSupabase();
    bus.init(client);
    const autre = vi.fn();
    bus.onEvent('quote.sent', async () => { throw new Error('règle cassée'); });
    bus.onEvent('quote.sent', autre);

    await bus.emit('quote.sent', EVT);
    await vider();

    expect(autre).toHaveBeenCalledOnce();
    expect(tables.domain_events[0].processed_at).not.toBeNull();
    expect(tables.domain_events[0].last_error).toContain('règle cassée');
  });

  it('ne consigne pas les deal.* — ils ont déjà leur file (pipeline_events)', async () => {
    const { client, tables } = fauxSupabase();
    bus.init(client);
    bus.onEvent('deal.stage_entered', vi.fn());
    await bus.emit('deal.stage_entered', { ...EVT, entityType: 'deal' });
    await vider();
    expect(tables.domain_events).toHaveLength(0);
    expect(tables.activity_log).toHaveLength(1);
  });

  it('émet quand même si l\'outbox refuse l\'insertion', async () => {
    const { client } = fauxSupabase({ insertionOutboxEchoue: true });
    bus.init(client);
    const ecouteur = vi.fn();
    bus.onEvent('quote.sent', ecouteur);
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => {});
    await bus.emit('quote.sent', EVT);
    expect(ecouteur).toHaveBeenCalledOnce();
    expect(erreur.mock.calls.some((c) => String(c[0]).includes('non consigné'))).toBe(true);
    erreur.mockRestore();
  });
});

describe('rejeu des orphelins', () => {
  const MIN = 60 * 1000;

  function orphelin(tables: Record<string, Ligne[]>, ageMs: number, attempts = 0): Ligne {
    const l = {
      id: 100 + tables.domain_events.length, org_id: 'org-1', type: 'quote.sent', entity_type: 'quote',
      entity_id: 'q-1', actor_id: null, related_entity_type: null, related_entity_id: null,
      metadata: { a: 1 }, created_at: new Date(Date.now() - ageMs).toISOString(),
      processed_at: null, attempts, last_error: null,
    };
    tables.domain_events.push(l);
    return l;
  }

  it('rejoue un orphelin passé le délai de grâce, et le coche', async () => {
    const { client, tables } = fauxSupabase();
    bus.init(client);
    const ecouteur = vi.fn();
    bus.onEvent('quote.sent', ecouteur);
    const l = orphelin(tables, 10 * MIN);

    expect(await outbox.rejouerEvenementsOrphelins(client)).toBe(1);
    expect(ecouteur).toHaveBeenCalledWith(expect.objectContaining({ type: 'quote.sent', entityId: 'q-1', metadata: { a: 1 } }));
    expect(l.attempts).toBe(1);
    expect(l.processed_at).not.toBeNull();
    // Le journal a été écrit à l'émission d'origine : pas une seconde fois.
    expect(tables.activity_log).toHaveLength(0);
  });

  it('ne touche pas un événement récent — il est peut-être encore en cours ailleurs', async () => {
    const { client, tables } = fauxSupabase();
    bus.init(client);
    const ecouteur = vi.fn();
    bus.onEvent('quote.sent', ecouteur);
    const l = orphelin(tables, 30 * 1000);

    expect(await outbox.rejouerEvenementsOrphelins(client)).toBe(0);
    expect(ecouteur).not.toHaveBeenCalled();
    expect(l.attempts).toBe(0);
  });

  it('ne rejoue pas une ligne qu\'une autre instance vient de réclamer', async () => {
    const { client, tables } = fauxSupabase();
    bus.init(client);
    const ecouteur = vi.fn();
    bus.onEvent('quote.sent', ecouteur);
    const l = orphelin(tables, 10 * MIN);

    // L'autre instance réclame entre la lecture et la réclamation de celle-ci :
    // au moment où CETTE instance construit sa mise à jour, attempts vaut déjà 1.
    const from = client.from.bind(client);
    (client as any).from = (t: string) => {
      const b = from(t);
      const update = b.update;
      b.update = (patch: Ligne) => {
        if ('attempts' in patch) l.attempts = 1;
        return update(patch);
      };
      return b;
    };

    await outbox.rejouerEvenementsOrphelins(client);
    expect(ecouteur).not.toHaveBeenCalled();
  });

  it('abandonne — sans rejouer — un événement trop ancien ou déjà rejoué trop de fois', async () => {
    const { client, tables } = fauxSupabase();
    bus.init(client);
    const ecouteur = vi.fn();
    bus.onEvent('quote.sent', ecouteur);
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => {});
    const vieux = orphelin(tables, outbox.AGE_MAX_MS + MIN);
    const empoisonne = orphelin(tables, 10 * MIN, outbox.MAX_TENTATIVES);

    expect(await outbox.rejouerEvenementsOrphelins(client)).toBe(0);
    expect(ecouteur).not.toHaveBeenCalled();
    expect(vieux.last_error).toMatch(/^ABANDONNÉ/);
    expect(empoisonne.last_error).toMatch(/^ABANDONNÉ/);
    expect(vieux.processed_at).not.toBeNull();
    erreur.mockRestore();
  });

  it('sans écouteur branché, ne coche pas — l\'événement sera retenté', async () => {
    const { client, tables } = fauxSupabase();
    bus.init(client);
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => {});
    const l = orphelin(tables, 10 * MIN);

    expect(await outbox.rejouerEvenementsOrphelins(client)).toBe(0);
    expect(l.processed_at).toBeNull();
    erreur.mockRestore();
  });
});

describe('règles déjà traitées', () => {
  it('l\'émission porte l\'id de sa ligne, et chaque règle notée y est écrite', async () => {
    const { client, tables } = fauxSupabase();
    bus.init(client);
    let vu: any = null;
    bus.onEvent('quote.sent', async (e) => {
      vu = e;
      await outbox.noterRegleTraitee(client, e, 'regle-a');
      await outbox.noterRegleTraitee(client, e, 'regle-a');
    });
    await bus.emit('quote.sent', EVT);
    await vider();
    expect(vu.outboxId).toBe(tables.domain_events[0].id);
    expect(tables.domain_events[0].regles_traitees).toEqual(['regle-a']);
  });

  it('le rejeu recharge les règles déjà notées, pour que le moteur les saute', async () => {
    const { client, tables } = fauxSupabase();
    bus.init(client);
    let vu: any = null;
    bus.onEvent('quote.sent', (e) => { vu = e; });
    tables.domain_events.push({
      id: 7, org_id: 'org-1', type: 'quote.sent', entity_type: 'quote', entity_id: 'q-1',
      metadata: {}, created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      processed_at: null, attempts: 0, regles_traitees: ['regle-a'],
    });
    await outbox.rejouerEvenementsOrphelins(client);
    expect(vu).toMatchObject({ outboxId: 7, reglesTraitees: ['regle-a'] });
  });

  it('sans outbox (deal.*), noter ne fait rien', async () => {
    const { client, tables } = fauxSupabase();
    await outbox.noterRegleTraitee(client, { type: 'deal.stage_entered', ...EVT }, 'regle-a');
    expect(tables.domain_events).toHaveLength(0);
  });
});

describe('diffusion', () => {
  it('rend true quand il y a des écouteurs, comme EventEmitter.emit', async () => {
    const { client } = fauxSupabase();
    bus.init(client);
    expect(await bus.emit('invoice.paid', EVT)).toBe(false);
    bus.onEvent('invoice.paid', vi.fn());
    expect(await bus.emit('invoice.paid', EVT)).toBe(true);
    expect(bus).toBeInstanceOf(EventEmitter);
  });
});
