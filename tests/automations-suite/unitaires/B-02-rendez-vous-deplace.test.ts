/**
 * B-02 — un rendez-vous DÉPLACÉ emmène son rappel avec lui ; le rappel « c'est
 * demain » ne part jamais APRÈS la visite.
 *
 * Avant : l'heure du rappel était calculée une seule fois, à la planification.
 * Seul un appel du navigateur (« tire et oublie ») le replanifiait.
 */
import { describe, it, expect } from 'vitest';
import { fauxSupabase, type Ligne } from './_faux-supabase';
import { revaliderTache, RETARD_TOLERE_RAPPEL_MS, type TacheARevalider } from '../../../server/lib/sortie-parcours';

const ORG = '11111111-1111-4111-8111-111111111111';
const JOUR = 86_400_000;
const T = Date.parse('2026-10-06T15:00:00Z'); // « maintenant »
const iso = (ms: number) => new Date(ms).toISOString();

/** Rappel « 24 h avant » d'une visite planifiée au début `planifie`, dont le début réel est `reel`. */
const jouer = (planifie: number | null, reel: number, extra: Partial<TacheARevalider> = {}) => revaliderTache(
  fauxSupabase({
    schedule_events: [{ id: 'v1', org_id: ORG, status: 'scheduled', job_id: null, start_at: iso(reel) }],
  }).client,
  {
    orgId: ORG, entityType: 'schedule_event', entityId: 'v1', declencheur: 'appointment.created', reglages: null, conditions: {},
    metadonnees: planifie === null ? {} : { start_time: iso(planifie) },
    actionsDeLaRegle: ['send_sms'], caseParDeclencheur: false, rappelAvantSecondes: -86_400, fuseau: 'America/Toronto', maintenant: T, ...extra,
  },
);

describe('[B-02] la visite est déplacée : ses rappels en attente la suivent tout de suite (file des événements de la base)', () => {
  const tache = (id: string, planifie: number, extra: Ligne = {}): Ligne => ({
    id, org_id: ORG, automation_rule_id: 'r1', entity_type: 'schedule_event', entity_id: 'v1', status: 'pending', attempts: 0, step_id: null,
    execute_at: iso(planifie - JOUR),
    action_config: { type: 'send_sms', config: { body: 'Rappel' }, trigger_event: 'appointment.created', event_metadata: { start_time: iso(planifie) } },
    automation_rules: { trigger_event: 'appointment.created', delay_seconds: -86_400, steps: null },
    ...extra,
  });
  const monde = (reel: number, taches: Ligne[]) => fauxSupabase({
    schedule_events: [{ id: 'v1', org_id: ORG, status: 'scheduled', start_at: iso(reel) }],
    company_settings: [{ org_id: ORG, timezone: 'America/Toronto' }],
    automation_scheduled_tasks: taches,
  });

  it('visite AVANCÉE de 6 à 2 jours : le rappel « 24 h avant » passe à la veille de la nouvelle date, la tâche retient le nouveau début, le journal le dit', async () => {
    const { recalerRappelsDeVisite } = await import('../../../server/lib/automationEngine');
    const sb = monde(T + 2 * JOUR, [tache('t1', T + 6 * JOUR)]);
    expect(await recalerRappelsDeVisite(sb.client, ORG, 'v1', T)).toBe(1);
    const t = sb.tables.automation_scheduled_tasks[0];
    expect(t).toMatchObject({ status: 'pending', execute_at: iso(T + JOUR), last_error: 'Rendez-vous déplacé : rappel replanifié.' });
    expect(t.action_config).toMatchObject({ motif_code: 'rendez_vous_deplace', event_metadata: { start_time: iso(T + 2 * JOUR) } });
    expect(sb.tables.automation_execution_logs.map((l) => l.result_data.saute_code)).toEqual(['rendez_vous_deplace']);
  });

  it('visite avancée à HIER : le rappel est annulé « rappel périmé » — il ne partira pas après la visite', async () => {
    const { recalerRappelsDeVisite } = await import('../../../server/lib/automationEngine');
    const sb = monde(T - JOUR, [tache('t1', T + 6 * JOUR)]);
    await recalerRappelsDeVisite(sb.client, ORG, 'v1', T);
    expect(sb.tables.automation_scheduled_tasks[0]).toMatchObject({ status: 'cancelled', last_error: 'rappel périmé : le rendez-vous est déjà passé', action_config: { motif_code: 'rappel_perime' } });
  });

  it('visite restée à sa place, ou tâche qui n’est pas un rappel « avant » : rien ne bouge', async () => {
    const { recalerRappelsDeVisite } = await import('../../../server/lib/automationEngine');
    const apres = tache('t2', T + 6 * JOUR);
    apres.automation_rules.delay_seconds = 3600;
    const sb = monde(T + 6 * JOUR, [tache('t1', T + 6 * JOUR), apres]);
    expect(await recalerRappelsDeVisite(sb.client, ORG, 'v1', T)).toBe(0);
    expect(sb.tables.automation_execution_logs ?? []).toHaveLength(0);
  });

  it('parcours, attente « avant la date » : son échéance avance avec la visite', async () => {
    const { recalerRappelsDeVisite } = await import('../../../server/lib/automationEngine');
    const attente = tache('t3', T + 6 * JOUR, {
      step_id: 'a1', execute_at: iso(T + 5 * JOUR),
      action_config: { type: '__sequence__', etape: 'attendre', mode: 'avant_date', secondes_avant: 86_400, event_metadata: {} },
    });
    const sb = monde(T + 2 * JOUR, [attente]);
    expect(await recalerRappelsDeVisite(sb.client, ORG, 'v1', T)).toBe(1);
    expect(sb.tables.automation_scheduled_tasks[0].execute_at).toBe(iso(T + JOUR));
  });
});

describe('[B-02] rappel « X avant le rendez-vous » d’une règle à plat', () => {
  it('visite à sa place (rappel dû maintenant) : il part', async () => {
    const r = await jouer(T + JOUR, T + JOUR);
    expect(r.arret).toBeUndefined();
    expect(r.report).toBeUndefined();
  });

  it('visite déjà PASSÉE (avancée à hier) : « rappel périmé — le rendez-vous est déjà passé »', async () => {
    const r = await jouer(T + JOUR, T - JOUR);
    expect(r.arret).toMatchObject({ code: 'rappel_perime', changement: 'le rendez-vous est déjà passé' });
  });

  it('visite déplacée PLUS TARD (dans 4 jours) : le rappel est REPORTÉ à la veille de la nouvelle date, pas annulé', async () => {
    const r = await jouer(T + JOUR, T + 4 * JOUR);
    expect(r.arret).toBeUndefined();
    expect(r.report).toMatchObject({ executeAt: T + 3 * JOUR, debut: T + 4 * JOUR, changement: 'le rendez-vous a été déplacé' });
  });

  it('visite déplacée PLUS TÔT (dans 3 h au lieu de demain) : le moment du rappel est passé → annulé, on ne dit pas « c’est demain »', async () => {
    const r = await jouer(T + JOUR, T + 3 * 3_600_000);
    expect(r.arret).toMatchObject({ code: 'rappel_perime', changement: 'le rendez-vous a été déplacé, le moment du rappel est passé' });
  });

  it('rappel seulement RETARDÉ (heures calmes, reprise), visite à sa place : il part encore, même une heure après son créneau', async () => {
    // Visite dans 23 h : le rappel « 24 h avant » aurait dû partir il y a une heure.
    const r = await jouer(T + 23 * 3_600_000, T + 23 * 3_600_000);
    expect(RETARD_TOLERE_RAPPEL_MS).toBe(30 * 60_000);
    expect(r.arret).toBeUndefined();
    expect(r.report).toBeUndefined();
  });

  it('début d’origine inconnu de la tâche : on ne sait pas si la visite a bougé → ni report ni annulation', async () => {
    const r = await jouer(null, T + 4 * JOUR);
    expect(r.arret).toBeUndefined();
    expect(r.report).toBeUndefined();
  });

  it('une tâche qui n’est PAS un rappel « avant » (délai positif, étape de parcours) n’est pas concernée', async () => {
    const r = await jouer(T + JOUR, T - JOUR, { rappelAvantSecondes: 86_400 });
    expect(r.arret).toBeUndefined();
    const etape = await jouer(T + JOUR, T - JOUR, { rappelAvantSecondes: null });
    expect(etape.arret).toBeUndefined();
  });

  it('changement d’heure du 1er novembre 2026 : le rappel reporté garde l’HEURE LOCALE de la visite', async () => {
    // Visite déplacée au mardi 3 novembre à 10 h (heure normale, 15:00 UTC) ; rappel « 7 jours avant ».
    const debut = Date.parse('2026-11-03T15:00:00Z');
    const r = await revaliderTache(
      fauxSupabase({ schedule_events: [{ id: 'v1', org_id: ORG, status: 'scheduled', job_id: null, start_at: iso(debut) }] }).client,
      {
        orgId: ORG, entityType: 'schedule_event', entityId: 'v1', declencheur: 'appointment.created', reglages: null, conditions: {},
        metadonnees: { start_time: '2026-10-20T14:00:00Z' }, actionsDeLaRegle: ['send_sms'], caseParDeclencheur: false,
        rappelAvantSecondes: -7 * 86_400, fuseau: 'America/Toronto', maintenant: Date.parse('2026-10-13T14:00:00Z'),
      },
    );
    // 27 octobre à 10 h, heure avancée = 14:00 UTC (pas 15:00 UTC, qui serait 11 h).
    expect(new Date(r.report!.executeAt).toISOString()).toBe('2026-10-27T14:00:00.000Z');
  });
});
