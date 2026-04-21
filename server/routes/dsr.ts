/**
 * Data Subject Rights (DSR) endpoints
 *
 * - GET  /api/dsr/export/me              : export JSON complet du user connecté
 * - GET  /api/dsr/export/client/:id      : export d'un client (admin org)
 * - POST /api/dsr/request                : enregistre une demande formelle
 * - POST /api/dsr/erase/client/:id       : anonymise un client (admin org)
 * - POST /api/dsr/erase/lead/:id         : anonymise un lead (admin org)
 * - POST /api/dsr/consent                : journalise un consentement
 *
 * RGPD art. 15/17/20, Loi 25 art. 27-28.1, LPRPDE 12.1
 * Délai de réponse obligatoire : 30 jours.
 */

import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';

const router = Router();

function clientIp(req: any): string | null {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0]?.trim() || null;
  return req.ip || req.socket?.remoteAddress || null;
}

// ────────────────────────────────────────────────────────────────────
// GET /api/dsr/export/me
// ────────────────────────────────────────────────────────────────────
router.get('/dsr/export/me', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const svc = getServiceClient();
  const { data, error } = await svc.rpc('export_user_data', { p_user_id: auth.user.id });
  if (error) return res.status(500).json({ error: error.message });

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="lume-export-${auth.user.id}.json"`);
  return res.status(200).send(JSON.stringify(data, null, 2));
});

// ────────────────────────────────────────────────────────────────────
// GET /api/dsr/export/client/:id
// ────────────────────────────────────────────────────────────────────
router.get('/dsr/export/client/:id', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const clientId = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return res.status(400).json({ error: 'Invalid client id' });

  const svc = getServiceClient();
  const { data, error } = await svc.rpc('export_client_data', { p_client_id: clientId });
  if (error) return res.status(403).json({ error: error.message });

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="lume-client-${clientId}.json"`);
  return res.status(200).send(JSON.stringify(data, null, 2));
});

// ────────────────────────────────────────────────────────────────────
// POST /api/dsr/erase/client/:id
// ────────────────────────────────────────────────────────────────────
router.post('/dsr/erase/client/:id', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const clientId = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) return res.status(400).json({ error: 'Invalid client id' });

  const { confirm } = req.body || {};
  if (confirm !== 'ERASE') {
    return res.status(400).json({ error: 'Confirmation required: body.confirm must equal "ERASE"' });
  }

  const svc = getServiceClient();
  const { error } = await svc.rpc('anonymize_client', { p_client_id: clientId });
  if (error) return res.status(403).json({ error: error.message });

  return res.status(200).json({ ok: true, anonymized: clientId });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/dsr/erase/lead/:id
// ────────────────────────────────────────────────────────────────────
router.post('/dsr/erase/lead/:id', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const leadId = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return res.status(400).json({ error: 'Invalid lead id' });

  const { confirm } = req.body || {};
  if (confirm !== 'ERASE') {
    return res.status(400).json({ error: 'Confirmation required: body.confirm must equal "ERASE"' });
  }

  const svc = getServiceClient();
  const { error } = await svc.rpc('anonymize_lead', { p_lead_id: leadId });
  if (error) return res.status(403).json({ error: error.message });

  return res.status(200).json({ ok: true, anonymized: leadId });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/dsr/request — enregistre une demande formelle (horodatée, 30j SLA)
// ────────────────────────────────────────────────────────────────────
router.post('/dsr/request', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const { subject_type, subject_id, request_type, justification } = req.body || {};
  const validTypes = ['access', 'erasure', 'rectification', 'portability', 'objection', 'restriction'];
  const validSubjects = ['user', 'client', 'lead'];

  if (!validSubjects.includes(subject_type)) return res.status(400).json({ error: 'Invalid subject_type' });
  if (!validTypes.includes(request_type)) return res.status(400).json({ error: 'Invalid request_type' });
  if (!subject_id || !/^[0-9a-f-]{36}$/i.test(String(subject_id))) return res.status(400).json({ error: 'Invalid subject_id' });

  const svc = getServiceClient();
  const { data, error } = await svc
    .from('dsar_requests')
    .insert({
      org_id: auth.orgId,
      subject_type,
      subject_id,
      request_type,
      requested_by: auth.user.id,
      requester_ip: clientIp(req),
      justification: justification ? String(justification).slice(0, 2000) : null,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ request: data, sla_days: 30 });
});

// ────────────────────────────────────────────────────────────────────
// POST /api/dsr/consent — journalise un consentement (cookies/email/sms/tos)
// ────────────────────────────────────────────────────────────────────
router.post('/dsr/consent', async (req, res) => {
  // Peut être appelé par un user authentifié OU anonyme (cookie banner sur page publique)
  const { subject_type, subject_id, purpose, granted, doc_version, doc_url, method, org_id } = req.body || {};

  if (!['user', 'client', 'lead'].includes(subject_type)) return res.status(400).json({ error: 'Invalid subject_type' });
  if (!subject_id || !/^[0-9a-f-]{36}$/i.test(String(subject_id))) return res.status(400).json({ error: 'Invalid subject_id' });
  if (!purpose || typeof purpose !== 'string' || purpose.length > 60) return res.status(400).json({ error: 'Invalid purpose' });
  if (typeof granted !== 'boolean') return res.status(400).json({ error: 'granted must be boolean' });

  const svc = getServiceClient();
  const { data, error } = await svc.rpc('record_consent', {
    p_subject_type: subject_type,
    p_subject_id: subject_id,
    p_purpose: purpose,
    p_granted: granted,
    p_doc_version: doc_version ?? null,
    p_doc_url: doc_url ?? null,
    p_ip: clientIp(req),
    p_user_agent: (req.headers['user-agent'] || '').toString().slice(0, 500),
    p_method: method ?? 'web-banner',
    p_org_id: org_id ?? null,
  });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(201).json({ consent_id: data });
});

export default router;
