/**
 * Charge le jeu de données de l'audit de l'Agenda dans la base LOCALE.
 *
 *   AGENDA_LOCAL_URL=http://127.0.0.1:58321 AGENDA_LOCAL_SERVICE_KEY=<clé service_role locale> \
 *     node --import tsx scripts/qa/agenda/seed-local.mts
 *
 * Refuse toute URL qui n'est pas 127.0.0.1 / localhost : ce script efface et
 * réécrit l'entreprise de test, il ne doit jamais viser staging ou la prod.
 *
 * Aucun envoi possible : clients en @example.test sans téléphone, et les
 * automatisations de l'entreprise de test sont mises en pause.
 * Comptes : proprio@agenda.test et tech1..5@agenda.test, mot de passe DevLocal1234!
 */
import { createClient } from '@supabase/supabase-js';
import { EQUIPES, FUSEAU, JOB_NON_PLANIFIEE, instantLocal, visites } from './fixture';

const URL_LOCALE = process.env.AGENDA_LOCAL_URL || 'http://127.0.0.1:58321';
const CLE = process.env.AGENDA_LOCAL_SERVICE_KEY || '';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(URL_LOCALE)) throw new Error(`Refusé : ${URL_LOCALE} n'est pas une base locale.`);
if (!CLE) throw new Error('AGENDA_LOCAL_SERVICE_KEY manquante (npx supabase status dans lume-agenda-local).');

const db = createClient(URL_LOCALE, CLE, { auth: { persistSession: false } });
const MOT_DE_PASSE = 'DevLocal1234!';
const NOM_ORG = 'Agenda — entreprise de test';

async function ok<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>, quoi: string): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`${quoi} : ${error.message}`);
  return data;
}

async function compte(email: string, nom: string): Promise<string> {
  const { data } = await db.auth.admin.listUsers({ perPage: 200 });
  const existant = data?.users.find((u) => u.email === email);
  if (existant) return existant.id;
  // (la réponse au partage de position est posée plus bas, une fois le profil créé)
  const cree = await db.auth.admin.createUser({ email, password: MOT_DE_PASSE, email_confirm: true, user_metadata: { full_name: nom } });
  if (cree.error || !cree.data.user) throw new Error(`compte ${email} : ${cree.error?.message}`);
  return cree.data.user.id;
}

// 1. Repartir de zéro : l'ancienne entreprise de test disparaît (local seulement).
const anciennes = await ok(db.from('orgs').select('id').eq('name', NOM_ORG), 'orgs');
for (const o of anciennes as Array<{ id: string }>) {
  for (const t of ['schedule_events', 'jobs', 'properties', 'clients', 'team_assignments', 'teams', 'company_settings', 'memberships', 'automation_rules', 'subscriptions', 'lumi_messages', 'lumi_conversations', 'agent_actions']) {
    await db.from(t).delete().eq('org_id', o.id);
  }
  await db.from('orgs').delete().eq('id', o.id);
}

/** Le compte a déjà répondu à la demande de localisation (refus) : pas de fenêtre en test. */
async function positionRefusee(userId: string) {
  await ok(db.from('profiles').update({ location_consent: false, location_consent_at: new Date().toISOString() }).eq('id', userId), 'profil');
}

// 2. Comptes, entreprise, fuseau, pause des automatisations.
const proprio = await compte('proprio@agenda.test', 'Paule Proprio');
await positionRefusee(proprio);
const org = (await ok(db.from('orgs').insert({ name: NOM_ORG, created_by: proprio }).select('id').single(), 'org')) as { id: string };
await ok(db.from('memberships').insert({ user_id: proprio, org_id: org.id, role: 'owner', status: 'active', language: 'fr', full_name: 'Paule Proprio' }), 'membership proprio');
await ok(db.from('company_settings').upsert({
  org_id: org.id, company_name: NOM_ORG, timezone: FUSEAU, default_language: 'fr', currency: 'CAD',
  street1: '1230 boulevard Saint-Joseph', city: 'Drummondville', province: 'QC', postal_code: 'J2C 2C8', country: 'CA',
  automations_paused: true, automations_paused_at: new Date().toISOString(),
}, { onConflict: 'org_id' }), 'company_settings');

// 2 bis. Un forfait avec Lumi (la base locale n'a pas les forfaits de la prod) et un abonnement actif.
const { data: forfaitExistant } = await db.from('plans').select('id').eq('slug', 'test-agenda-local').maybeSingle();
const forfait = forfaitExistant ?? (await ok(db.from('plans').insert({ slug: 'test-agenda-local', name: 'Test agenda (local)', name_fr: 'Test agenda (local)', includes_ai: true, ai_monthly_budget_cents: 5000, is_active: false }).select('id').single(), 'forfait')) as { id: string };
await ok(db.from('subscriptions').insert({ org_id: org.id, user_id: proprio, plan_id: (forfait as { id: string }).id, status: 'active', interval: 'monthly', currency: 'CAD', amount_cents: 0 }), 'abonnement');

// 3. Équipes et techniciens (un par équipe).
const equipes: string[] = [];
for (let i = 0; i < EQUIPES.length; i++) {
  const e = EQUIPES[i];
  const t = (await ok(db.from('teams').insert({ org_id: org.id, name: e.nom, color_hex: e.couleur, is_active: true, display_order: i }).select('id').single(), 'team')) as { id: string };
  equipes.push(t.id);
  const tech = await compte(`tech${i + 1}@agenda.test`, `Tech ${i + 1}`);
  await positionRefusee(tech);
  await ok(db.from('memberships').insert({ user_id: tech, org_id: org.id, role: 'technician', status: 'active', language: 'fr', full_name: `Tech ${i + 1}`, team_id: t.id }), 'membership tech');
  await ok(db.from('team_assignments').insert({ org_id: org.id, user_id: tech, team_id: t.id, is_primary: true }), 'team_assignment');
}

// 4. Un client par adresse (la propriété porte l'adresse du travail ; le client
//    a une adresse de FACTURATION différente, pour vérifier que la carte ne la prend pas).
const clientParAdresse = new Map<string, { client: string; propriete: string }>();
async function clientPour(adresse: string, lat: number | null, lng: number | null) {
  const deja = clientParAdresse.get(adresse);
  if (deja) return deja;
  const n = clientParAdresse.size + 1;
  const c = (await ok(db.from('clients').insert({
    org_id: org.id, created_by: proprio, first_name: `Client`, last_name: `${n}`, email: `client${n}@example.test`,
    address: '999 rue de la Facturation, Montréal, QC H2X 1Y4', billing_address: '999 rue de la Facturation, Montréal, QC H2X 1Y4',
    latitude: 45.5088, longitude: -73.5617, status: 'active',
  }).select('id').single(), 'client')) as { id: string };
  const p = (await ok(db.from('properties').insert({
    org_id: org.id, created_by: proprio, client_id: c.id, name: 'Propriété', address: adresse, latitude: lat, longitude: lng, is_primary: false,
  }).select('id').single(), 'property')) as { id: string };
  const v = { client: c.id, propriete: p.id };
  clientParAdresse.set(adresse, v);
  return v;
}

// 5. Jobs et visites.
const jobs = new Map<string, string>();
let nbVisites = 0;
for (const v of visites()) {
  const { client, propriete } = await clientPour(v.lieu.adresse, v.lieu.lat, v.lieu.lng);
  const debut = instantLocal(v.jour, v.debut);
  const fin = new Date(debut.getTime() + v.dureeMin * 60_000);
  let jobId = v.jobCle ? jobs.get(v.jobCle) : undefined;
  if (!jobId) {
    const j = (await ok(db.from('jobs').insert({
      org_id: org.id, created_by: proprio, title: `Lavage — ${v.cle}`, client_id: client, client_name: `Client`, property_id: propriete,
      property_address: v.lieu.adresse, address: v.lieu.adresse, latitude: v.lieu.lat, longitude: v.lieu.lng,
      geocode_status: v.lieu.lat == null ? 'failed' : 'ok', team_id: equipes[v.equipe],
      status: v.statut === 'completed' ? 'completed' : 'scheduled', scheduled_at: debut.toISOString(), end_at: fin.toISOString(),
      total_cents: 25000, subtotal_cents: 25000, tax_cents: 0,
    }).select('id').single(), `job ${v.cle}`)) as { id: string };
    jobId = j.id;
    if (v.jobCle) jobs.set(v.jobCle, jobId);
  }
  await ok(db.from('schedule_events').insert({
    org_id: org.id, created_by: proprio, job_id: jobId, title: `Lavage — ${v.cle}`, team_id: equipes[v.equipe],
    start_at: debut.toISOString(), end_at: fin.toISOString(), start_time: debut.toISOString(), end_time: fin.toISOString(),
    status: v.statut, timezone: FUSEAU, notes: v.piege ? `piege:${v.piege}` : null,
  }), `visite ${v.cle}`);
  nbVisites++;
}

// 6. Une job sans visite : ni carte ni agenda.
const np = await clientPour(JOB_NON_PLANIFIEE.lieu.adresse, JOB_NON_PLANIFIEE.lieu.lat, JOB_NON_PLANIFIEE.lieu.lng);
await ok(db.from('jobs').insert({
  org_id: org.id, created_by: proprio, title: JOB_NON_PLANIFIEE.titre, client_id: np.client, property_id: np.propriete, property_address: JOB_NON_PLANIFIEE.lieu.adresse,
  latitude: JOB_NON_PLANIFIEE.lieu.lat, longitude: JOB_NON_PLANIFIEE.lieu.lng, status: 'draft', total_cents: 0, subtotal_cents: 0, tax_cents: 0,
}), 'job non planifiée');

// 7. Portée restreinte : Tech 5 ne voit que son équipe (page Équipe → « Son équipe »).
const tech5 = await compte('tech5@agenda.test', 'Tech 5');
await ok(db.from('memberships').update({ scope: 'team' }).eq('user_id', tech5).eq('org_id', org.id), 'portée tech5');

// 8. Une AUTRE entreprise, mêmes jours : rien d'elle ne doit apparaître chez la première.
const autresAnc = await ok(db.from('orgs').select('id').eq('name', 'Agenda — autre entreprise'), 'autres orgs');
for (const o of autresAnc as Array<{ id: string }>) {
  for (const t of ['schedule_events', 'jobs', 'properties', 'clients', 'teams', 'company_settings', 'memberships', 'automation_rules']) await db.from(t).delete().eq('org_id', o.id);
  await db.from('orgs').delete().eq('id', o.id);
}
const autreProprio = await compte('autre@agenda.test', 'Autre Proprio');
await positionRefusee(autreProprio);
const autre = (await ok(db.from('orgs').insert({ name: 'Agenda — autre entreprise', created_by: autreProprio }).select('id').single(), 'autre org')) as { id: string };
await ok(db.from('memberships').insert({ user_id: autreProprio, org_id: autre.id, role: 'owner', status: 'active', language: 'fr', full_name: 'Autre Proprio' }), 'membership autre');
await ok(db.from('company_settings').upsert({ org_id: autre.id, company_name: 'Agenda — autre entreprise', timezone: FUSEAU, automations_paused: true }, { onConflict: 'org_id' }), 'réglages autre');
const autreEquipe = (await ok(db.from('teams').insert({ org_id: autre.id, name: 'Équipe Étrangère', color_hex: '#0EA5E9', is_active: true }).select('id').single(), 'équipe autre')) as { id: string };
const autreClient = (await ok(db.from('clients').insert({ org_id: autre.id, created_by: autreProprio, first_name: 'Secret', last_name: 'Concurrent', email: 'secret@example.test', status: 'active' }).select('id').single(), 'client autre')) as { id: string };
for (const jour of ['2026-10-05', '2026-10-06']) {
  const debut = instantLocal(jour, '09:00');
  const fin = new Date(debut.getTime() + 60 * 60_000);
  const j = (await ok(db.from('jobs').insert({ org_id: autre.id, created_by: autreProprio, title: 'JOB ÉTRANGÈRE', client_id: autreClient.id, property_address: '1 rue Secrète, Drummondville', latitude: 45.88, longitude: -72.48, geocode_status: 'ok', team_id: autreEquipe.id, status: 'scheduled', scheduled_at: debut.toISOString(), end_at: fin.toISOString(), total_cents: 0, subtotal_cents: 0, tax_cents: 0 }).select('id').single(), 'job autre')) as { id: string };
  // Visite NON ASSIGNÉE : c'est elle que le compte des chevauchements voyait (E8).
  await ok(db.from('schedule_events').insert({ org_id: autre.id, created_by: autreProprio, job_id: j.id, team_id: null, title: 'JOB ÉTRANGÈRE', start_at: debut.toISOString(), end_at: fin.toISOString(), start_time: debut.toISOString(), end_time: fin.toISOString(), status: 'scheduled', timezone: FUSEAU }), 'visite autre');
}

console.log(JSON.stringify({ org: org.id, autre: autre.id, equipes: equipes.length, visites: nbVisites, clients: clientParAdresse.size }));
