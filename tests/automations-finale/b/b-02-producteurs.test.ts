/**
 * Point 2 — un déclencheur doit partir QUEL QUE SOIT l'endroit où le geste est
 * fait. Les déclencheurs écrits par la base (devis accepté, facture envoyée,
 * job terminé, rendez-vous créé / annulé) partent pour tous les chemins
 * (prouvé : B-027, B-037, tests/automation/launch-evenements-base). Ceux-ci
 * dépendent d'un appel de l'écran ; on fait le même geste par un autre chemin
 * réel du produit (Lumi, l'onglet Notes) et on regarde si l'événement existe.
 *
 * Vrai moteur, vraie garde des outils de Lumi (aucun appel au modèle), pile
 * locale, bureau A « (b) » en bac à sable.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { attendre, marque } from '../../automations-suite/harnais/moteur';
import { sessionDe, COMPTES } from '../../automations-suite/harnais/bureau-test';
import { preparerBureau, ok, creerClient, creerJob, type Bureau } from '../../automations-suite/integration/10-b-outils';
import { regle, texto, emettre, attendreTaches, avancer, tachesDe, envoisAvec } from './outils-b';

let b: Bureau & { fuseau: string };
let client: SupabaseClient;

async function outil(name: string, args: Record<string, unknown>): Promise<Record<string, any>> {
  const { executerOutilGarde } = await import('../../../server/lib/agent/garde');
  const r = await executerOutilGarde({ name, args, userId: b.users.proprioA, orgId: b.orgA, client });
  if ('refus' in r) throw new Error(`refus : ${r.refus}`);
  return r.result as Record<string, any>;
}

/**
 * La boucle de 15 s du serveur (server/lib/evenementsBase.ts), pour NOTRE bureau : c'est elle qui passe au bus
 * les événements écrits par la base. Le harnais ne la démarre pas ; depuis le correctif B-14 (agent M), « Note
 * ajoutée » et « Tâche terminée » viennent d'un trigger (migration proposée M-02), donc de cette file.
 */
async function boucleDeLaBase(attenteMs = 0): Promise<void> {
  const { traiterEvenementsBase } = await import('../../../server/lib/evenementsBase');
  if (attenteMs) await new Promise((r) => setTimeout(r, attenteMs));
  await traiterEvenementsBase(b.admin, { orgId: b.orgA });
}

/** Les événements d'un type consignés pour une fiche depuis `depuis` (on laisse 6 s aux écouteurs). */
async function evenements(type: string, entityId: string, depuis: string) {
  return attendre(
    async () => ok<Array<{ id: number }>>(b.admin.from('domain_events').select('id').eq('org_id', b.orgA).eq('type', type).eq('entity_id', entityId).gte('created_at', depuis), 'outbox'),
    (l) => l.length > 0, 6_000, 500,
  );
}

beforeAll(async () => {
  b = await preparerBureau();
  // File des événements de la base : on part d'une file VIDE pour notre bureau. Les passes de charge y laissent
  // des centaines de « facture envoyée » jamais lues (le harnais ne fait pas tourner la boucle de 15 s), et la
  // boucle lit 100 lignes par passage, dans l'ordre : nos deux événements attendraient derrière.
  await ok(b.admin.from('automation_evenements_base')
    .update({ traite_at: new Date().toISOString(), last_error: 'Arriéré de test : clos avant la passe B-02' })
    .eq('org_id', b.orgA).is('traite_at', null).select('id'), 'arriéré');
  const { jeton } = await sessionDe(b.admin, COMPTES.proprioA.email);
  const { buildSupabaseWithAuth } = await import('../../../server/lib/supabase');
  client = buildSupabaseWithAuth(`Bearer ${jeton}`, b.orgA);
});

describe('point 2 — « Note ajoutée » : la note écrite ailleurs que dans le fil d’activité', () => {
  it('[B2-01] une note ajoutée par Lumi (add_note = l’onglet Notes de la fiche) émet « Note ajoutée »', async () => {
    const m = marque('B2-01');
    const c = await creerClient(b, m);
    const depuis = new Date(Date.now() - 5_000).toISOString();
    const r = await outil('add_note', { entity_type: 'client', entity_id: c.id, note: `Le client veut un rappel ${m}` });
    expect(r.added).toBe(true);
    await boucleDeLaBase();
    const ev = await evenements('note.added', c.id, depuis);
    expect(ev.length, 'aucun événement note.added : une automatisation « Note ajoutée » ne part pas').toBeGreaterThan(0);
  });
});

describe('point 2 — « Tâche terminée » : la tâche terminée ailleurs que dans l’écran des tâches', () => {
  it('[B2-02] une tâche marquée terminée par Lumi (update_task_status) émet « Tâche terminée »', async () => {
    const m = marque('B2-02');
    const c = await creerClient(b, m);
    const t = await ok<{ id: string }>(b.admin.from('tasks').insert({
      org_id: b.orgA, title: `Rappeler ${m}`, status: 'open', created_by: b.users.proprioA,
      linked_entity_type: 'client', linked_entity_id: c.id,
    }).select('id').single(), 'tâche');
    const depuis = new Date(Date.now() - 5_000).toISOString();
    const r = await outil('update_task_status', { task_id: t.id, status: 'done' });
    expect(r.updated).toBe(true);
    // « Tâche terminée » attend 10 s l'appel éventuel du navigateur avant d'émettre (pas de doublon avec l'écran).
    const { DELAI_GRACE_TACHE_MS } = await import('../../../server/lib/evenementsBase');
    await boucleDeLaBase(DELAI_GRACE_TACHE_MS + 1_000);
    const ev = await evenements('task.completed', c.id, depuis);
    expect(ev.length, 'aucun événement task.completed : une automatisation « Tâche terminée » ne part pas').toBeGreaterThan(0);
  });
});

describe('point 13 — rendez-vous DÉPLACÉ sans l’appel du navigateur (écriture en base seule)', () => {
  const UN_JOUR = 86_400;

  it('[B2-03] rappel « 24 h avant » : la visite avancée de 4 jours emmène son rappel avec elle (jamais APRÈS la visite)', async () => {
    const m = marque('B2-03');
    const c = await creerClient(b, m, { phone: '+12045550177' });
    const j = await creerJob(b, m, c.id);
    const debut = new Date(Date.now() + 6 * 86_400_000);
    const v = await ok<{ id: string }>(b.admin.from('schedule_events').insert({
      org_id: b.orgA, job_id: j.id, title: `Visite ${m}`, status: 'scheduled', created_by: b.users.proprioA,
      start_at: debut.toISOString(), end_at: new Date(debut.getTime() + 3600_000).toISOString(),
    }).select('id').single(), 'visite');
    const id = await regle(b, m, { trigger_event: 'appointment.created', delay_seconds: -UN_JOUR, actions: [texto(m, 'Rappel : votre rendez-vous est demain')], settings: { fenetre: { debut: 0, fin: 24 } } });
    await emettre(b, 'appointment.created', 'schedule_event', v.id, { job_id: j.id, client_id: c.id, start_time: debut.toISOString() });
    const [avant] = await attendreTaches(b, id, 1);
    expect(Math.abs(Date.parse(avant.execute_at) - (debut.getTime() - UN_JOUR * 1000))).toBeLessThan(2 * 3600_000);

    // La visite est AVANCÉE à dans 2 jours, par une écriture qui ne passe pas par l'écran
    // (app mobile, import, intégration, onglet fermé avant l'appel « appointment-rescheduled »).
    const nouveau = new Date(Date.now() + 2 * 86_400_000);
    await ok(b.admin.from('schedule_events').update({ start_at: nouveau.toISOString(), end_at: new Date(nouveau.getTime() + 3600_000).toISOString() }).eq('id', v.id), 'déplacement');
    await new Promise((r) => setTimeout(r, 3_000));

    const [apres] = await tachesDe(b, id);
    const rappelPrevu = Date.parse(apres.execute_at);
    expect(apres.status === 'cancelled' || rappelPrevu < nouveau.getTime(),
      `le rappel reste prévu le ${apres.execute_at}, soit ${Math.round((rappelPrevu - nouveau.getTime()) / 86_400_000)} jour(s) APRÈS la visite déplacée`).toBe(true);
  });

  it('[B2-04] à son échéance, un rappel dont la visite est déjà PASSÉE ne part pas', async () => {
    const m = marque('B2-04');
    const c = await creerClient(b, m, { phone: '+12045550178' });
    const j = await creerJob(b, m, c.id);
    const debut = new Date(Date.now() + 6 * 86_400_000);
    const v = await ok<{ id: string }>(b.admin.from('schedule_events').insert({
      org_id: b.orgA, job_id: j.id, title: `Visite ${m}`, status: 'scheduled', created_by: b.users.proprioA,
      start_at: debut.toISOString(), end_at: new Date(debut.getTime() + 3600_000).toISOString(),
    }).select('id').single(), 'visite');
    const id = await regle(b, m, { trigger_event: 'appointment.created', delay_seconds: -UN_JOUR, actions: [texto(m, 'Rappel : votre rendez-vous est demain')], settings: { fenetre: { debut: 0, fin: 24 } } });
    await emettre(b, 'appointment.created', 'schedule_event', v.id, { job_id: j.id, client_id: c.id, start_time: debut.toISOString() });
    await attendreTaches(b, id, 1);
    // La visite a eu lieu HIER (avancée en base) ; le rappel arrive à son échéance d'origine.
    const hier = new Date(Date.now() - 86_400_000);
    await ok(b.admin.from('schedule_events').update({ start_at: hier.toISOString(), end_at: new Date(hier.getTime() + 3600_000).toISOString() }).eq('id', v.id), 'déplacement');
    await avancer(b, id);
    expect((await envoisAvec(b, m)).length, 'le rappel « votre rendez-vous est demain » est parti le lendemain de la visite').toBe(0);
  });
});
