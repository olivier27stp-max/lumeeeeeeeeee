/**
 * « Optimiser la journée » — la proposition et son application (audit Agenda, 2026-09-30).
 *
 * Proposer ne change RIEN. La proposition porte une empreinte : l'état exact
 * des visites du jour + les changements proposés. Appliquer recalcule cette
 * empreinte : si l'horaire a bougé entre-temps (quelqu'un a déplacé une
 * visite), la proposition est périmée et refusée — on recalcule. Ce qui est
 * appliqué est donc exactement ce qui a été montré et confirmé.
 *
 * Coût : zéro LLM ; la matrice de route est celle de l'Agenda (en cache).
 */
import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { matriceTrajets, pointValide, type Point, type Trajet } from './matrice';
import { jourDans } from './journee';
import { optimiserEquipe, type EntreeEquipe, type RaisonFixe, type ResultatEquipe, type VisiteOpt } from './optimisation';

/** Sous ce gain total, « Ta journée est déjà optimisée ». */
export const SEUIL_GAIN_SECONDES = 10 * 60;
const FUSEAU_PAR_DEFAUT = 'America/Toronto';

export interface ChangementPropose { visit_id: string; job_id: string | null; titre: string; team_id: string | null; avant_debut: string; avant_fin: string; apres_debut: string; apres_fin: string }

export interface PropositionJournee {
  date: string;
  fuseau: string;
  empreinte: string;
  deja_optimisee: boolean;
  gain_total_minutes: number;
  equipes: Array<{
    team_id: string | null;
    nom: string;
    avant: { ordre: string[]; km: number; minutes_route: number };
    apres: { ordre: string[]; km: number; minutes_route: number };
    gain_minutes: number;
    fixes: Array<{ visit_id: string; titre: string; raison: RaisonFixe }>;
    impossibles: string[];
    exact: boolean;
  }>;
  changements: ChangementPropose[];
  sans_adresse: Array<{ visit_id: string; titre: string }>;
  /** Ce que la replanification déclenche chez les clients (dit sur la carte AVANT d'accepter). */
  clients: { rappels_replanifies: boolean; automatisations_avis: number };
  hypotheses: string[];
}

interface VisiteBrute { id: string; job_id: string | null; team_id: string | null; start_at: string; end_at: string; status: string | null; title: string | null }

/** Bornes UTC d'un jour civil au fuseau de l'entreprise. */
export function bornesJour(date: string, fuseau: string): { debut: Date; fin: Date } {
  const minuit = (d: string) => {
    const [a, m, j] = d.split('-').map(Number);
    let t = Date.UTC(a, m - 1, j);
    for (let k = 0; k < 2; k++) {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date(t)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
      t += Date.UTC(a, m - 1, j) - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    }
    return new Date(t);
  };
  const [a, m, j] = date.split('-').map(Number);
  const lendemain = new Date(Date.UTC(a, m - 1, j + 1)).toISOString().slice(0, 10);
  return { debut: minuit(date), fin: minuit(lendemain) };
}

/** L'état exact des visites du jour, dans un ordre stable : la base de l'empreinte. */
function etatCanonique(visites: VisiteBrute[]): string {
  return JSON.stringify([...visites].sort((a, b) => a.id.localeCompare(b.id)).map((v) => [v.id, new Date(v.start_at).toISOString(), new Date(v.end_at).toISOString(), v.team_id, v.status || '']));
}

export function empreinteDe(date: string, orgId: string, visites: VisiteBrute[], changements: Array<{ visit_id: string; apres_debut: string; apres_fin: string }>): string {
  const ch = [...changements].sort((a, b) => a.visit_id.localeCompare(b.visit_id)).map((c) => [c.visit_id, c.apres_debut, c.apres_fin]);
  return crypto.createHash('sha256').update(JSON.stringify([date, orgId, etatCanonique(visites), ch])).digest('hex').slice(0, 32);
}

export async function visitesDuJour(client: SupabaseClient, orgId: string, date: string, fuseau: string, equipes: string[] | null): Promise<VisiteBrute[]> {
  const { debut, fin } = bornesJour(date, fuseau);
  let q = client.from('schedule_events')
    .select('id, job_id, team_id, start_at, end_at, status, title')
    .eq('org_id', orgId).is('deleted_at', null)
    .gte('start_at', debut.toISOString()).lt('start_at', fin.toISOString())
    .order('start_at', { ascending: true }).limit(500);
  if (equipes?.length) q = q.in('team_id', equipes);
  const { data, error } = await q;
  if (error) throw error;
  return ((data || []) as VisiteBrute[]).filter((v) => !['cancelled', 'canceled'].includes(String(v.status || '').toLowerCase()));
}

export async function fuseauDe(client: SupabaseClient, orgId: string): Promise<string> {
  const { data } = await client.from('company_settings').select('timezone').eq('org_id', orgId).maybeSingle();
  return (data as { timezone?: string | null } | null)?.timezone || FUSEAU_PAR_DEFAUT;
}

/**
 * La proposition pour une date (AAAA-MM-JJ au fuseau de l'entreprise) et,
 * au choix, une équipe. `client` = client de l'UTILISATEUR (RLS).
 */
export async function proposerJournee(client: SupabaseClient, orgId: string, date: string, equipe: string | null, maintenant = new Date()): Promise<PropositionJournee> {
  const fuseau = await fuseauDe(client, orgId);
  const hypotheses: string[] = [];
  const visites = await visitesDuJour(client, orgId, date, fuseau, equipe ? [equipe] : null);

  const jobIds = [...new Set(visites.map((v) => v.job_id).filter(Boolean))] as string[];
  const jobs = new Map<string, any>();
  if (jobIds.length) {
    const { data, error } = await client.from('jobs').select('id, title, status, client_name, property_id, latitude, longitude').eq('org_id', orgId).in('id', jobIds);
    if (error) throw error;
    for (const j of data || []) jobs.set(String((j as any).id), j);
  }
  const propIds = [...new Set([...jobs.values()].map((j) => j.property_id).filter(Boolean))] as string[];
  const props = new Map<string, any>();
  if (propIds.length) {
    const { data, error } = await client.from('properties').select('id, latitude, longitude').eq('org_id', orgId).in('id', propIds);
    if (error) throw error;
    for (const p of data || []) props.set(String((p as any).id), p);
  }

  // Visites « confirmées au client » : un texto ou un courriel est déjà parti
  // pour ce rendez-vous (confirmation, rappel). Leur heure ne bouge plus.
  const confirmees = new Set<string>();
  if (visites.length) {
    const { data, error } = await client.from('automation_execution_logs')
      .select('entity_id').eq('org_id', orgId).eq('entity_type', 'schedule_event').eq('result_success', true)
      .in('action_type', ['send_sms', 'send_email']).in('entity_id', visites.map((v) => v.id));
    if (error) throw error;
    for (const r of data || []) confirmees.add(String((r as any).entity_id));
  }

  // Heures de travail : disponibilités de l'équipe ce jour de la semaine ; sinon
  // la journée déjà planifiée (on ne rallonge jamais une journée à l'aveugle).
  const jourSemaine = new Date(`${date}T12:00:00Z`).getUTCDay();
  const { data: dispos } = await client.from('team_availability').select('team_id, start_minute, end_minute, timezone')
    .eq('org_id', orgId).eq('weekday', jourSemaine).is('deleted_at', null);
  const { debut: minuit } = bornesJour(date, fuseau);

  // Départ : en cours de journée, la position du technicien POINTÉ (Loi 25) ;
  // sinon l'adresse de l'entreprise si elle est géolocalisée ; sinon le 1er arrêt.
  const { data: reglages } = await client.from('company_settings').select('weather_lat, weather_lng').eq('org_id', orgId).maybeSingle();
  const depot = pointValide((reglages as any)?.weather_lat, (reglages as any)?.weather_lng);
  if (depot) hypotheses.push('Départ de la journée : l’adresse de l’entreprise.');
  else hypotheses.push('Départ : le premier arrêt (aucune adresse d’entreprise géolocalisée).');
  hypotheses.push('Aucun point de fin configuré : la tournée se termine au dernier arrêt.');

  const aujourdhui = jourDans(maintenant.toISOString(), fuseau) === date;
  const positions = new Map<string, Point>();
  if (aujourdhui) {
    const { data: pos } = await client.from('tracking_live_locations').select('team_id, session_id, latitude, longitude, updated_at')
      .eq('org_id', orgId).gte('updated_at', new Date(maintenant.getTime() - 20 * 60_000).toISOString());
    const sessions = [...new Set((pos || []).map((p: any) => p.session_id).filter(Boolean))];
    const actives = new Set<string>();
    if (sessions.length) {
      const { data: s } = await client.from('tracking_sessions').select('id').eq('org_id', orgId).eq('status', 'active').not('time_entry_id', 'is', null).in('id', sessions);
      for (const x of s || []) actives.add(String((x as any).id));
    }
    for (const p of (pos || []) as any[]) {
      const pt = pointValide(p.latitude, p.longitude);
      if (p.team_id && pt && actives.has(String(p.session_id))) positions.set(String(p.team_id), pt);
    }
  }

  const sansAdresse: PropositionJournee['sans_adresse'] = [];
  const parEquipe = new Map<string, VisiteOpt[]>();
  for (const v of visites) {
    const job = v.job_id ? jobs.get(v.job_id) : null;
    const prop = job?.property_id ? props.get(String(job.property_id)) : null;
    const point = pointValide(prop?.latitude, prop?.longitude) ?? pointValide(job?.latitude, job?.longitude);
    const titre = job?.title || v.title || '';
    if (!point) { sansAdresse.push({ visit_id: v.id, titre }); continue; }
    const statut = String(v.status || '').toLowerCase();
    const statutJob = String(job?.status || '').toLowerCase();
    const debut = new Date(v.start_at).getTime();
    const fixe: RaisonFixe | null =
      statut === 'completed' || statutJob === 'completed' ? 'terminee'
        : statut === 'in_progress' || (statutJob === 'in_progress' && debut <= maintenant.getTime()) ? 'en_cours'
          : confirmees.has(v.id) ? 'confirmee_client'
            : debut < maintenant.getTime() ? 'passee'
              : null;
    const k = v.team_id ?? '';
    parEquipe.set(k, [...(parEquipe.get(k) ?? []), { id: v.id, jobId: v.job_id, titre, debut, fin: new Date(v.end_at).getTime(), point, fixe }]);
  }

  const noms = new Map<string, string>();
  const ids = [...parEquipe.keys()].filter(Boolean);
  if (ids.length) {
    const { data } = await client.from('teams').select('id, name').eq('org_id', orgId).in('id', ids);
    for (const t of data || []) noms.set(String((t as any).id), String((t as any).name));
  }

  const equipesRes: PropositionJournee['equipes'] = [];
  const changements: ChangementPropose[] = [];
  let gainTotal = 0;
  for (const [k, liste] of [...parEquipe.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const d = (dispos || []).find((x: any) => String(x.team_id) === k);
    const debutsPlan = liste.map((v) => v.debut), finsPlan = liste.map((v) => v.fin);
    const debutJournee = d ? minuit.getTime() + Number((d as any).start_minute) * 60_000 : Math.min(...debutsPlan);
    const finJournee = d ? minuit.getTime() + Number((d as any).end_minute) * 60_000 : Math.max(...finsPlan);
    const depart = positions.get(k) ?? depot;
    const entree: EntreeEquipe = { teamId: k || null, visites: liste, debutJournee, finJournee, pasAvant: aujourdhui ? maintenant.getTime() : minuit.getTime(), depart, arrivee: null };
    const points = [...(depart ? [depart] : []), ...liste.map((v) => v.point)];
    const uniques = points.filter((p, i) => points.findIndex((x) => x.lat === p.lat && x.lng === p.lng) === i);
    const m = uniques.length >= 2 ? await matriceTrajets(uniques) : [];
    const idx = (p: Point) => uniques.findIndex((x) => x.lat === p.lat && x.lng === p.lng);
    const tr = (a: Point, b: Point): Trajet => (a.lat === b.lat && a.lng === b.lng) ? { secondes: 0, metres: 0, estime: false } : m[idx(a)][idx(b)];
    const r: ResultatEquipe = optimiserEquipe(entree, tr);
    gainTotal += r.gainSecondes;
    equipesRes.push({
      team_id: k || null, nom: noms.get(k) || 'Sans équipe',
      avant: { ordre: r.avant.ordre, km: Math.round(r.avant.metres / 100) / 10, minutes_route: Math.round(r.avant.secondes / 60) },
      apres: { ordre: r.apres.ordre, km: Math.round(r.apres.metres / 100) / 10, minutes_route: Math.round(r.apres.secondes / 60) },
      gain_minutes: Math.round(r.gainSecondes / 60), fixes: r.fixes.map((f) => ({ visit_id: f.visitId, titre: f.titre, raison: f.raison })),
      impossibles: r.impossibles, exact: r.exact,
    });
    for (const c of r.changements) {
      changements.push({ visit_id: c.visitId, job_id: c.jobId, titre: c.titre, team_id: k || null, avant_debut: new Date(c.avantDebut).toISOString(), avant_fin: new Date(c.avantFin).toISOString(), apres_debut: new Date(c.apresDebut).toISOString(), apres_fin: new Date(c.apresFin).toISOString() });
    }
  }

  const dejaOptimisee = gainTotal < SEUIL_GAIN_SECONDES || changements.length === 0;
  const finalChangements = dejaOptimisee ? [] : changements;

  // Ce qui arrivera chez les clients si on applique : rappels replanifiés
  // (règles « rendez-vous » à délai relatif) et automatisations sur « déplacé ».
  const { data: regles } = await client.from('automation_rules').select('trigger_event, delay_seconds, actions, steps')
    .eq('org_id', orgId).eq('is_active', true).is('deleted_at', null).in('trigger_event', ['appointment.created', 'appointment.rescheduled']);
  const versClient = (r: any) => JSON.stringify([r.actions, r.steps]).match(/"type":"(send_sms|send_email)"/) !== null;
  const clients = {
    rappels_replanifies: (regles || []).some((r: any) => r.trigger_event === 'appointment.created' && Number(r.delay_seconds) < 0 && versClient(r)),
    automatisations_avis: (regles || []).filter((r: any) => r.trigger_event === 'appointment.rescheduled' && versClient(r)).length,
  };

  return {
    date, fuseau,
    empreinte: empreinteDe(date, orgId, visites, finalChangements),
    deja_optimisee: dejaOptimisee,
    gain_total_minutes: Math.round(gainTotal / 60),
    equipes: equipesRes,
    changements: finalChangements,
    sans_adresse: sansAdresse,
    clients,
    hypotheses,
  };
}
