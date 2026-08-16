/**
 * Security Incidents / Breach Response endpoints (Bloc 6)
 *
 * - POST /api/incidents                     create incident
 * - GET  /api/incidents                     list org incidents
 * - GET  /api/incidents/:id                 detail + timeline
 * - PATCH /api/incidents/:id                update fields (status, risk, notification timestamps…)
 * - POST /api/incidents/:id/timeline        append timeline entry
 * - POST /api/incidents/failed-login        journalise un échec de connexion (public)
 *
 * Loi 25 art. 3.5 / 3.8 — registre incidents + notifications CAI.
 * RGPD art. 33-34 — 72h CNIL + personnes concernées si risque élevé.
 */

import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';

const router = Router();
const UUID_RE = /^[0-9a-f-]{36}$/i;

// ────────────────────────────────────────────────────────────────────
// POST /api/incidents
// ────────────────────────────────────────────────────────────────────
router.post('/incidents', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { title, type, severity, description, detection_method } = req.body || {};
  if (!title || typeof title !== 'string' || title.length > 300) return res.status(400).json({ error: 'title required' });
  if (!type || typeof type !== 'string' || type.length > 60) return res.status(400).json({ error: 'type required' });
  const okSev = ['low', 'medium', 'high', 'critical'];
  const sev = okSev.includes(severity) ? severity : 'low';

  // Appel avec le client DE L'UTILISATEUR, pas en service_role. create_incident
  // derive son org depuis `memberships where user_id = auth.uid()` puis exige
  // has_org_admin_role(auth.uid(), ...) : en service_role, auth.uid() vaut NULL,
  // donc la fonction echouait TOUJOURS en « No organization context » et la
  // declaration d'incident etait morte. Passer par auth.client renseigne
  // auth.uid(), ce qui repare la fonctionnalite ET applique enfin le controle
  // admin — que cette route ne faisait pas elle-meme.
  const { data, error } = await auth.client.rpc('create_incident', {
    p_title: title,
    p_type: type,
    p_severity: sev,
    p_description: description ? String(description).slice(0, 5000) : null,
    p_detection: detection_method ? String(detection_method).slice(0, 60) : 'manual',
  });
  if (error) return res.status(403).json({ error: error.message });

  // Fire-and-forget admin alert (logging only here; Bloc 7 may wire email)
  console.warn(`[incident] declared id=${data} severity=${sev} type=${type} org=${auth.orgId}`);

  return res.status(201).json({ incident_id: data });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/incidents
// ────────────────────────────────────────────────────────────────────
router.get('/incidents', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const svc = getServiceClient();
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  let q = svc.from('security_incidents')
    .select('*')
    .eq('org_id', auth.orgId)
    .order('detected_at', { ascending: false })
    .limit(500);
  if (status) q = q.eq('status', status);

  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ incidents: data ?? [] });
});

// ────────────────────────────────────────────────────────────────────
// GET /api/incidents/:id
// ────────────────────────────────────────────────────────────────────
router.get('/incidents/:id', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid id' });

  const svc = getServiceClient();
  const { data: incident, error } = await svc
    .from('security_incidents').select('*')
    .eq('id', id).eq('org_id', auth.orgId).maybeSingle();
  if (error || !incident) return res.status(404).json({ error: 'Not found' });

  const { data: timeline } = await svc
    .from('incident_timeline').select('*')
    .eq('incident_id', id).order('created_at', { ascending: true });

  return res.status(200).json({ incident, timeline: timeline ?? [] });
});

// ────────────────────────────────────────────────────────────────────
// PATCH /api/incidents/:id
// ────────────────────────────────────────────────────────────────────
const ALLOWED_UPDATE_FIELDS = new Set([
  'status', 'severity', 'risk_serious', 'risk_rationale',
  'affected_users', 'affected_records', 'data_categories',
  'root_cause', 'containment_actions',
  'cai_notified_at', 'cnil_notified_at', 'opc_notified_at',
  'affected_notified_at', 'notification_method',
  'resolved_at', 'lessons_learned',
]);

router.patch('/incidents/:id', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid id' });

  const patch: Record<string, any> = {};
  for (const [k, v] of Object.entries(req.body || {})) {
    if (ALLOWED_UPDATE_FIELDS.has(k)) patch[k] = v;
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
  patch.updated_at = new Date().toISOString();

  const svc = getServiceClient();
  // Ensure the incident belongs to the caller's org before touching service_role
  const { data: existing } = await svc
    .from('security_incidents').select('id, org_id, status')
    .eq('id', id).maybeSingle();
  if (!existing || existing.org_id !== auth.orgId) return res.status(404).json({ error: 'Not found' });

  const { data, error } = await svc
    .from('security_incidents').update(patch).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // Timeline entry — registre exige par la Loi 25 / RGPD art. 33 : un trou
  // dans la chronologie n'est pas rattrapable apres coup, il doit se voir.
  const { error: timelineErr } = await svc.from('incident_timeline').insert({
    incident_id: id,
    actor_id: auth.user.id,
    event_type: patch.status && patch.status !== existing.status ? 'status_change' : 'update',
    payload: patch,
  });
  if (timelineErr) {
    console.error('[incidents] timeline entry insert failed:', { incidentId: id, actorId: auth.user.id, error: timelineErr.message });
  }

  return res.status(200).json({ incident: data });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/incidents/:id/timeline
// Body: { event_type, payload? }
// ────────────────────────────────────────────────────────────────────
router.post('/incidents/:id/timeline', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'Invalid id' });

  const { event_type, payload } = req.body || {};
  if (!event_type || typeof event_type !== 'string') return res.status(400).json({ error: 'event_type required' });

  const svc = getServiceClient();
  const { data: existing } = await svc
    .from('security_incidents').select('id, org_id').eq('id', id).maybeSingle();
  if (!existing || existing.org_id !== auth.orgId) return res.status(404).json({ error: 'Not found' });

  const { data, error } = await svc.from('incident_timeline').insert({
    incident_id: id,
    actor_id: auth.user.id,
    event_type: event_type.slice(0, 60),
    payload: payload && typeof payload === 'object' ? payload : {},
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ entry: data });
});

// GET /api/incidents/anomalies a été retiré avec le back-office Platform Admin.
//
// La route agrégeait `failed_login_attempts`, une table SANS org_id : elle
// exposait donc les adresses courriel et IP de tous les locataires confondus.
// C'était le dernier accès inter-tenants de l'application, conservé par
// inadvertance parce qu'il vit dans un autre fichier que le back-office.
//
// Rien ne l'appelait (aucun client, aucune page) et elle n'était consultable
// que depuis le Platform Admin, supprimé. Une détection que personne ne
// regarde n'est pas une détection.
//
// La COLLECTE reste en place (POST /incidents/failed-login ci-dessous) : la
// table continue de se remplir et `detect_login_anomalies` existe toujours.
// Si le besoin d'alerter sur du bourrage d'identifiants revient, la bonne
// forme est une notification automatique — pas une page à penser à ouvrir.

// ────────────────────────────────────────────────────────────────────
// POST /api/incidents/failed-login (no auth — called by frontend after login fail)
// Body: { email, reason }
// Rate-limited at router mount (index.ts).
// ────────────────────────────────────────────────────────────────────
router.post('/incidents/failed-login', async (req, res) => {
  const { email, reason } = req.body || {};
  if (!email || typeof email !== 'string' || email.length > 320) return res.status(400).json({ error: 'email required' });

  const fwd = req.headers['x-forwarded-for'];
  const ip = typeof fwd === 'string' ? fwd.split(',')[0]?.trim() : (req.ip || null);

  const svc = getServiceClient();
  // La reponse reste 204 (route publique, on ne renseigne pas l'attaquant),
  // mais un echec silencieux ici aveugle detect_login_anomalies : plus aucune
  // detection de force brute.
  const { error } = await svc.rpc('record_failed_login', {
    p_email: email,
    p_ip: ip,
    p_user_agent: (req.headers['user-agent'] || '').toString().slice(0, 500),
    p_reason: reason ? String(reason).slice(0, 120) : 'invalid_credentials',
  });
  if (error) console.error('[incidents] record_failed_login failed:', error.message);
  return res.status(204).end();
});

export default router;
