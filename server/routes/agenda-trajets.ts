/**
 * GET /api/agenda/trajets — les trajets PLANIFIÉS de l'horaire (audit Agenda, 2026-09-30).
 *
 *   ?debut=<ISO>&fin=<ISO>&equipes=<id,id|non_assigne>
 *
 * Remplace les appels Mapbox que le navigateur faisait à chaque rendu (100
 * par semaine chargée). Lecture avec le client de l'UTILISATEUR : la RLS
 * (entreprise, portée « soi / équipe / bureau » de la page Équipe) décide
 * de ce qu'il voit ; `org_id` vient de la session, jamais de la requête.
 *
 * Coordonnées : celles de la PROPRIÉTÉ où se fait le travail, sinon celles de
 * la job — jamais l'adresse de facturation du client, jamais 0,0.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuthedClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { matriceTrajets, pointValide, type Point, type Trajet } from '../lib/trajets/matrice';
import { jourDans, ordreChronologique, trajetsParJour, type VisiteTrajet } from '../lib/trajets/journee';

const router = Router();

const Requete = z.object({
  debut: z.string().datetime({ offset: true }),
  fin: z.string().datetime({ offset: true }),
  equipes: z.string().optional(),
});

/** Au-delà, la page demande trop large (une semaine = 7 jours). */
const PLAGE_MAX_JOURS = 42;
const FUSEAU_PAR_DEFAUT = 'America/Toronto';

router.get('/agenda/trajets', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { client, orgId } = auth;

    const q = Requete.safeParse(req.query);
    if (!q.success) return res.status(400).json({ error: 'Paramètres invalides (debut, fin).' });
    const debut = new Date(q.data.debut), fin = new Date(q.data.fin);
    if (!(fin > debut) || (fin.getTime() - debut.getTime()) / 86_400_000 > PLAGE_MAX_JOURS) {
      return res.status(400).json({ error: 'Plage de dates invalide.' });
    }
    const liste = (q.data.equipes || '').split(',').map((s) => s.trim()).filter(Boolean);
    const avecNonAssigne = liste.includes('non_assigne');
    const equipes = liste.filter((s) => s !== 'non_assigne');

    const { data: reglages } = await client.from('company_settings').select('timezone').eq('org_id', orgId).maybeSingle();
    const fuseau = (reglages as { timezone?: string | null } | null)?.timezone || FUSEAU_PAR_DEFAUT;

    let requete = client
      .from('schedule_events')
      .select('id, job_id, team_id, start_at, end_at, status, title')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .lt('start_at', fin.toISOString())
      .gt('end_at', debut.toISOString())
      .order('start_at', { ascending: true })
      .limit(2000);
    if (equipes.length && avecNonAssigne) requete = requete.or(`team_id.in.(${equipes.join(',')}),team_id.is.null`);
    else if (equipes.length) requete = requete.in('team_id', equipes);
    else if (avecNonAssigne) requete = requete.is('team_id', null);
    const { data: evenements, error: errEv } = await requete;
    if (errEv) throw errEv;

    const jobIds = [...new Set((evenements || []).map((e: any) => e.job_id).filter(Boolean))] as string[];
    const jobs = new Map<string, any>();
    for (let i = 0; i < jobIds.length; i += 200) {
      const { data, error } = await client
        .from('jobs')
        .select('id, title, status, client_name, property_id, property_address, address, latitude, longitude, deleted_at')
        .eq('org_id', orgId)
        .in('id', jobIds.slice(i, i + 200));
      if (error) throw error;
      for (const j of data || []) jobs.set(String((j as any).id), j);
    }
    const proprieteIds = [...new Set([...jobs.values()].map((j) => j.property_id).filter(Boolean))] as string[];
    const proprietes = new Map<string, any>();
    for (let i = 0; i < proprieteIds.length; i += 200) {
      const { data, error } = await client
        .from('properties')
        .select('id, address, latitude, longitude')
        .eq('org_id', orgId)
        .in('id', proprieteIds.slice(i, i + 200));
      if (error) throw error;
      for (const p of data || []) proprietes.set(String((p as any).id), p);
    }

    const visites: VisiteTrajet[] = [];
    for (const e of (evenements || []) as any[]) {
      const job = e.job_id ? jobs.get(String(e.job_id)) : null;
      if (job?.deleted_at) continue;
      const prop = job?.property_id ? proprietes.get(String(job.property_id)) : null;
      const point = pointValide(prop?.latitude, prop?.longitude) ?? pointValide(job?.latitude, job?.longitude);
      // Une job annulée n'a plus de visite réelle, même si la ligne existe encore.
      const statut = String(job?.status || '').toLowerCase() === 'cancelled' ? 'cancelled' : String(e.status || 'scheduled');
      visites.push({
        visitId: String(e.id), jobId: e.job_id ? String(e.job_id) : null, teamId: e.team_id ? String(e.team_id) : null,
        debut: e.start_at, fin: e.end_at, statut,
        titre: job?.title || e.title || '', client: job?.client_name ?? null,
        adresse: prop?.address || job?.property_address || job?.address || null, point,
      });
    }

    // Une matrice par équipe et par jour (≤ une douzaine de points), en cache :
    // le solveur « Optimiser la journée » relira exactement les mêmes paires.
    const groupes = new Map<string, Point[]>();
    for (const v of visites) {
      if (!v.point || String(v.statut).toLowerCase() === 'cancelled') continue;
      const k = `${jourDans(v.debut, fuseau)}|${v.teamId ?? ''}`;
      groupes.set(k, [...(groupes.get(k) ?? []), v.point]);
    }
    const connus = new Map<string, Trajet>();
    const cle = (a: Point, b: Point) => `${a.lat},${a.lng}>${b.lat},${b.lng}`;
    for (const points of groupes.values()) {
      const uniques = points.filter((p, i) => points.findIndex((x) => x.lat === p.lat && x.lng === p.lng) === i);
      if (uniques.length < 2) continue;
      const m = await matriceTrajets(uniques);
      uniques.forEach((a, i) => uniques.forEach((b, j) => connus.set(cle(a, b), m[i][j])));
    }
    const trajet = (a: Point, b: Point): Trajet =>
      (a.lat === b.lat && a.lng === b.lng) ? { secondes: 0, metres: 0, estime: false } : (connus.get(cle(a, b)) ?? { secondes: 0, metres: 0, estime: true });

    visites.sort(ordreChronologique);
    return res.json({ fuseau, jours: trajetsParJour(visites, fuseau, trajet) });
  } catch (error) {
    return sendSafeError(res, error, 'Impossible de calculer les trajets.', '[agenda/trajets]');
  }
});

export default router;
