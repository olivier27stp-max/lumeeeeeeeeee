/**
 * B-13 — une action immédiate RÉSERVÉE (« en cours ») par un processus mort
 * avant de l'exécuter doit PARTIR au rejeu de l'outbox, au lieu d'être tenue
 * pour faite.
 *
 *  · réservation ancienne (> 1 min) : orpheline → reprise, l'action s'exécute
 *    et complète la MÊME ligne de journal ;
 *  · réservation récente : un autre traitement est peut-être en vol → rien ;
 *  · action déjà réussie : jamais refaite (D-15, inchangé).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const etat = vi.hoisted(() => ({ appels: [] as string[] }));
vi.mock('../../../server/lib/url-sortante', async (orig) => ({
  ...(await orig<any>()),
  posterSansSsrf: vi.fn(async (url: string) => { etat.appels.push(url); return new Response('ok', { status: 200 }); }),
}));

import { clientEnregistreur, requetes, type Requete } from '../../quarantaine/automation/_enregistreur';
import { reservationOrpheline, RESERVATION_ORPHELINE_MS } from '../../../server/lib/automationEngine';

const ORG = '11111111-1111-4111-8111-111111111111';
const WEBHOOK = { type: 'webhook', config: { url: 'https://hooks.example.test/lume' } };
const REGLE = { id: 'r1', org_id: ORG, name: 'R', trigger_event: 'lead.created', conditions: {}, delay_seconds: 0, is_active: true, actions: [WEBHOOK] };
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
const a = (req: Requete, col: string, val: unknown) => req.filtres.some(([op, c, v]) => op === 'eq' && c === col && v === val);

/** Le journal tel que le laisse un processus tué : une réservation « en cours », datée de `ageMs`. */
function journalAvecReservation(ageMs: number, dejaReussie = false) {
  const creee = new Date(Date.now() - ageMs).toISOString();
  return (req: Requete) => {
    if (req.op === 'select' && a(req, 'result_success', true)) return { data: dejaReussie ? [{ id: 'faite' }] : null };
    if (req.op === 'select' && a(req, 'result_error', 'en cours')) return { data: [{ id: 'resa-orpheline', created_at: creee }] };
    if (req.op === 'update') return { data: [{ id: 'resa-orpheline' }] };
    if (req.op === 'insert') return { data: [{ id: 'resa-neuve' }] };
    return { data: null };
  };
}

async function rejouer(journalLogs: ReturnType<typeof journalAvecReservation>) {
  const { initAutomationEngine } = await import('../../../server/lib/automationEngine');
  const { eventBus } = await import('../../../server/lib/eventBus');
  const { client, journal } = clientEnregistreur({
    company_settings: { data: { company_name: 'A' } },
    clients: { data: [{ id: 'l1', status: 'lead', lead_status: 'new', deleted_at: null }] },
    automation_rules: { data: [REGLE] },
    automation_execution_logs: journalLogs,
  });
  eventBus.removeAllListeners();
  initAutomationEngine({ supabase: client, twilio: null as never, baseUrl: 'http://t' });
  await eventBus.emit('lead.created', {
    orgId: ORG, entityType: 'lead', entityId: 'l1', metadata: {},
    rejoueDepuis: new Date(Date.now() - 5 * 60_000).toISOString(),
  } as never);
  await attendre(300);
  return journal;
}

beforeEach(() => { etat.appels.length = 0; });

describe('[B-13] réservation « en cours » laissée par un processus mort', () => {
  it('la règle pure : orpheline au-delà d’une minute, vivante en deçà, vivante si la date est illisible', () => {
    const t = Date.parse('2026-10-01T12:00:00Z');
    expect(reservationOrpheline(new Date(t - RESERVATION_ORPHELINE_MS - 1).toISOString(), t)).toBe(true);
    expect(reservationOrpheline(new Date(t - 10_000).toISOString(), t)).toBe(false);
    expect(reservationOrpheline(null, t)).toBe(false);
    expect(reservationOrpheline('pas une date', t)).toBe(false);
  });

  it('réservation vieille de 4 min : le rejeu la reprend et EXÉCUTE l’action, sur la même ligne de journal', async () => {
    const journal = await rejouer(journalAvecReservation(4 * 60_000));
    expect(etat.appels).toHaveLength(1);
    const majs = requetes(journal, 'automation_execution_logs', 'update');
    // 1) la reprise atomique (seulement si la ligne est encore « en cours », à la date lue) ; 2) le résultat.
    expect(majs[0].filtres).toContainEqual(['eq', 'result_error', 'en cours']);
    expect(majs[0].filtres).toContainEqual(['eq', 'id', 'resa-orpheline']);
    expect(majs.at(-1)!.valeur).toMatchObject({ result_success: true, result_error: null });
    expect(majs.at(-1)!.filtres).toContainEqual(['eq', 'id', 'resa-orpheline']);
    // Aucune seconde réservation : la ligne orpheline sert.
    expect(requetes(journal, 'automation_execution_logs', 'insert')).toHaveLength(0);
  });

  it('réservation vieille de 10 s : un autre traitement est peut-être en vol → rien n’est refait', async () => {
    const journal = await rejouer(journalAvecReservation(10_000));
    expect(etat.appels).toHaveLength(0);
    expect(requetes(journal, 'automation_execution_logs', 'update')).toHaveLength(0);
  });

  it('action déjà RÉUSSIE depuis l’heure du rejeu : jamais refaite, même avec une réservation orpheline à côté', async () => {
    await rejouer(journalAvecReservation(4 * 60_000, true));
    expect(etat.appels).toHaveLength(0);
  });
});
