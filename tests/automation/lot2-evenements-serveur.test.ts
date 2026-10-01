/**
 * Audit du 2026-10-01, lot 2 — les points de contact « événement » appelés par
 * le navigateur (server/routes/automation-events.ts).
 *
 * roles-14 : « visite déplacée » annulait puis replanifiait les rappels à
 * CHAQUE appel, même quand la visite n'avait pas bougé — le client recevait
 * une deuxième confirmation « Votre rendez-vous est confirmé » pour rien.
 *
 * La VRAIE route est montée. Supabase et l'authentification sont simulés
 * (lot2-faux-supabase.ts) ; le bus d'événements est remplacé par un témoin
 * qui fait ce que le moteur ferait d'une ré-émission : planifier un rappel
 * calé sur l'heure annoncée.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Ligne } from './lot2-faux-supabase';

const ORG = '11111111-2222-4333-8444-555555555555';
const AUTRE_ORG = '99999999-2222-4333-8444-555555555555';
const VISITE = 'dddddddd-0000-4000-8000-0000000000d1';
const VISITE_AUTRE_BUREAU = 'dddddddd-0000-4000-8000-0000000000d2';
const JOB = 'eeeeeeee-0000-4000-8000-0000000000e1';
const CLIENTE = 'cccccccc-0000-4000-8000-0000000000c1';
const REGLE = 'aaaaaaaa-0000-4000-8000-0000000000a1';

/** La visite, telle qu'elle est en base au moment de l'appel. */
const DEBUT = '2026-10-21T15:00:00+00:00';
const ANCIEN_DEBUT = '2026-10-20T15:00:00+00:00';

const { etat, client: fauxClient } = await vi.hoisted(async () => (await import('./lot2-faux-supabase')).creerFausseBase());
const bus = vi.hoisted(() => ({ emis: [] as Array<{ type: string; donnees: Record<string, unknown> }> }));
const session = vi.hoisted(() => ({ role: 'admin' as string }));

vi.mock('../../server/lib/supabase', () => ({
  requireAuthedClient: async () => ({ client: fauxClient(), orgId: '11111111-2222-4333-8444-555555555555', user: { id: 'u-appelant' } }),
  getServiceClient: () => fauxClient(),
}));
vi.mock('../../server/lib/eventBus', () => ({
  eventBus: {
    emit: async (type: string, donnees: Record<string, unknown>) => {
      bus.emis.push({ type, donnees });
      // Ce que le moteur fait d'un `appointment.created` : un rappel planifié,
      // qui garde l'heure de début annoncée par l'événement.
      if (type === 'appointment.created') {
        const taches = (etat.tables.automation_scheduled_tasks ??= []);
        taches.push({
          id: `t-reemis-${taches.length + 1}`, org_id: donnees.orgId, entity_id: donnees.entityId, automation_rule_id: 'regle',
          status: 'pending', created_at: new Date(Date.UTC(2026, 9, 2, 0, 0, taches.length)).toISOString(),
          action_config: { type: 'send_email', event_metadata: donnees.metadata }, sequence_context: null,
        });
      }
      return true;
    },
  },
}));

const { default: routeur } = await import('../../server/routes/automation-events');

let serveur: Server;
let base = '';
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Ce que le garde RBAC (hors de ce test) pose sur la requête.
  app.use((req, _res, next) => { (req as unknown as { userContext: { role: string } }).userContext = { role: session.role }; next(); });
  app.use('/api', routeur);
  await new Promise<void>((ok) => { serveur = app.listen(0, '127.0.0.1', () => ok()); });
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise((ok) => serveur.close(ok)); });

async function appeler(chemin: string, corps: unknown) {
  const res = await fetch(`${base}${chemin}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
    body: JSON.stringify(corps),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- corps JSON libre, lu par les assertions
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

let numero = 0;
/** Une tâche du moteur pour la visite. `debut` = l'heure pour laquelle elle a été planifiée. */
function tache(sup: Ligne & { debut?: string | null; parcours?: boolean } = {}): Ligne {
  const { debut = DEBUT, parcours = false, ...reste } = sup;
  numero += 1;
  return {
    id: `t${numero}`, org_id: ORG, entity_id: VISITE, entity_type: 'schedule_event', automation_rule_id: REGLE,
    status: 'pending', created_at: new Date(Date.UTC(2026, 9, 1, 12, 0, numero)).toISOString(),
    action_config: parcours
      ? { type: 'send_sms', config: { body: 'Rappel' } }
      : { type: 'send_sms', config: { body: 'Rappel' }, trigger_event: 'appointment.created', event_metadata: debut ? { job_id: JOB, start_time: debut } : { job_id: JOB } },
    sequence_context: parcours ? { job_id: JOB, start_time: debut, franchies: 1 } : null,
    ...reste,
  };
}
const taches = () => etat.tables.automation_scheduled_tasks;
const statuts = () => taches().map((t) => t.status);
const reemissions = () => bus.emis.filter((e) => e.type === 'appointment.created');
const deplacee = () => appeler('/automations/events/appointment-rescheduled', { eventId: VISITE, jobId: JOB, startTime: DEBUT });

beforeEach(() => {
  numero = 0;
  bus.emis.length = 0;
  etat.ecritures.length = 0;
  etat.acces.length = 0;
  session.role = 'admin';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  etat.tables = {
    schedule_events: [
      { id: VISITE, org_id: ORG, job_id: JOB, start_at: DEBUT, job: { client_id: CLIENTE } },
      { id: VISITE_AUTRE_BUREAU, org_id: AUTRE_ORG, job_id: 'job-b', start_at: DEBUT, job: { client_id: 'client-b' } },
    ],
    automation_scheduled_tasks: [],
  };
});

// ─── roles-14 ───────────────────────────────────────────────────

describe('roles-14 — « visite déplacée » annoncée pour une visite qui n’a PAS bougé', () => {
  it('les rappels en attente sont déjà calés sur l’heure actuelle : rien n’est annulé, rien n’est ré-émis', async () => {
    etat.tables.automation_scheduled_tasks = [tache(), tache(), tache()];
    const r = await deplacee();
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, cancelled: 0, inchange: true });
    expect(statuts()).toEqual(['pending', 'pending', 'pending']);
    expect(reemissions()).toHaveLength(0);
    expect(etat.ecritures).toEqual([]);
  });

  it('six appels d’affilée (les six rôles de la sonde) : toujours aucune confirmation de plus', async () => {
    etat.tables.automation_scheduled_tasks = [tache(), tache()];
    for (let i = 0; i < 6; i++) expect((await deplacee()).json.inchange).toBe(true);
    expect(reemissions()).toHaveLength(0);
    expect(statuts()).toEqual(['pending', 'pending']);
  });

  it('la même heure écrite autrement (fuseau, « Z ») reste la même heure', async () => {
    etat.tables.automation_scheduled_tasks = [tache({ debut: '2026-10-21T11:00:00-04:00' }), tache({ debut: '2026-10-21T15:00:00.000Z' })];
    const r = await deplacee();
    expect(r.json.inchange).toBe(true);
    expect(reemissions()).toHaveLength(0);
  });

  it('un PARCOURS garde l’heure dans `sequence_context` : reconnu aussi', async () => {
    etat.tables.automation_scheduled_tasks = [tache({ parcours: true })];
    const r = await deplacee();
    expect(r.json.inchange).toBe(true);
    expect(reemissions()).toHaveLength(0);
  });

  it('tous les rappels sont déjà partis pour cette heure (plus rien en attente) : pas de deuxième confirmation', async () => {
    etat.tables.automation_scheduled_tasks = [tache({ status: 'completed' }), tache({ status: 'completed' })];
    const r = await deplacee();
    expect(r.json.inchange).toBe(true);
    expect(reemissions()).toHaveLength(0);
  });
});

describe('roles-14 — une visite VRAIMENT déplacée est replanifiée, comme avant', () => {
  it('les rappels calés sur l’ancienne heure sont annulés, puis `appointment.created` repart avec la nouvelle', async () => {
    etat.tables.automation_scheduled_tasks = [tache({ debut: ANCIEN_DEBUT }), tache({ debut: ANCIEN_DEBUT })];
    const r = await deplacee();
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true, cancelled: 2 });
    expect(statuts().slice(0, 2)).toEqual(['cancelled', 'cancelled']);
    expect(reemissions()).toHaveLength(1);
    expect(reemissions()[0].donnees).toMatchObject({
      orgId: ORG, entityType: 'schedule_event', entityId: VISITE,
      metadata: { job_id: JOB, client_id: CLIENTE, start_time: DEBUT, rescheduled: true },
    });
  });

  it('le déplacement est annoncé DEUX fois (double clic, nouvel essai) : une seule replanification', async () => {
    etat.tables.automation_scheduled_tasks = [tache({ debut: ANCIEN_DEBUT })];
    const premier = await deplacee();
    const second = await deplacee();
    expect(premier.json).toEqual({ ok: true, cancelled: 1 });
    expect(second.json).toEqual({ ok: true, cancelled: 0, inchange: true });
    expect(reemissions()).toHaveLength(1);
    // Le rappel replanifié par la première annonce est toujours là.
    expect(statuts()).toEqual(['cancelled', 'pending']);
  });

  it('aller-retour (déplacée, puis remise à l’heure d’origine) : replanifiée à chaque VRAI changement', async () => {
    etat.tables.automation_scheduled_tasks = [tache({ debut: ANCIEN_DEBUT })];
    await deplacee();
    etat.tables.schedule_events[0].start_at = ANCIEN_DEBUT;
    const retour = await deplacee();
    expect(retour.json.inchange).toBeUndefined();
    expect(retour.json.cancelled).toBe(1);
    expect(reemissions()).toHaveLength(2);
    expect((reemissions()[1].donnees.metadata as { start_time: string }).start_time).toBe(ANCIEN_DEBUT);
  });

  it('PRUDENCE — un rappel en attente est resté calé sur une autre heure : on replanifie, même si un plus récent est à jour', async () => {
    etat.tables.automation_scheduled_tasks = [tache({ debut: ANCIEN_DEBUT }), tache()];
    const r = await deplacee();
    expect(r.json.inchange).toBeUndefined();
    expect(r.json.cancelled).toBe(2);
    expect(reemissions()).toHaveLength(1);
  });

  it('PRUDENCE — tout ce qui était prévu pour cette heure a été ANNULÉ (règle repassée en brouillon, visite annulée) : on replanifie', async () => {
    etat.tables.automation_scheduled_tasks = [tache({ status: 'cancelled' }), tache({ status: 'cancelled' })];
    const r = await deplacee();
    expect(r.json.inchange).toBeUndefined();
    expect(reemissions()).toHaveLength(1);
  });

  it('PRUDENCE — aucune trace d’une planification pour cette visite : on ne peut rien conclure, on fait comme avant', async () => {
    const r = await deplacee();
    expect(r.json).toEqual({ ok: true, cancelled: 0 });
    expect(reemissions()).toHaveLength(1);
  });

  it('PRUDENCE — des tâches sans heure enregistrée ne prouvent rien : on replanifie', async () => {
    etat.tables.automation_scheduled_tasks = [tache({ debut: null })];
    const r = await deplacee();
    expect(r.json).toEqual({ ok: true, cancelled: 1 });
    expect(reemissions()).toHaveLength(1);
  });

  it('les tâches d’une AUTRE visite ou d’un autre bureau ne comptent pas', async () => {
    etat.tables.automation_scheduled_tasks = [
      tache({ entity_id: 'autre-visite' }),
      tache({ org_id: AUTRE_ORG }),
    ];
    const r = await deplacee();
    expect(r.json).toEqual({ ok: true, cancelled: 0 });
    expect(statuts()).toEqual(['pending', 'pending', 'pending']); // les deux intactes + le rappel replanifié
    expect(reemissions()).toHaveLength(1);
  });

  it('la visite d’un autre bureau : 404, rien n’est lu ni annulé (inchangé)', async () => {
    const r = await appeler('/automations/events/appointment-rescheduled', { eventId: VISITE_AUTRE_BUREAU });
    expect(r.status).toBe(404);
    expect(reemissions()).toHaveLength(0);
    expect(etat.ecritures).toEqual([]);
  });
});
