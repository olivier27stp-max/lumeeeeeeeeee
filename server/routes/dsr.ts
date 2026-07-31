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
import { sendSafeError } from '../lib/error-handler';
import { logDataExport } from '../lib/data-export-log';

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
  // L'identite provient de requireAuthedClient : on n'exporte que SES propres
  // donnees, l'autorisation est donc acquise par construction. (La garde interne
  // d'export_user_data() compare auth.uid(), NULL sous service_role — elle ne
  // peut pas servir ici : meme cause que /dsr/export/client/:id.)
  const { data, error } = await svc.rpc('export_user_data', { p_user_id: auth.user.id });
  if (error) return sendSafeError(res, error, 'Export failed.', '[dsr/export/me]');

  // N7.7 — journaliser la lecture de donnees personnelles.
  await logDataExport({
    orgId: auth.orgId,
    userId: auth.user.id,
    exportType: 'dsr_portability',
    entityType: 'user',
    recordCount: 1,
    req,
  });

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

  // N3.5 — La garde interne d'export_client_data() repose sur auth.uid(), qui
  // est NULL sous service_role : elle renvoyait donc toujours « Not authorized »
  // et l'export DSR etait CASSE en production pour tout le monde (verifie).
  // On valide l'appartenance ici, avec l'orgId issu de requireAuthedClient —
  // jamais de la requete.
  const { data: client, error: clientErr } = await svc
    .from('clients')
    .select('org_id')
    .eq('id', clientId)
    .maybeSingle();

  if (clientErr) return sendSafeError(res, clientErr, 'Export failed.', '[dsr/export/client]');
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (client.org_id !== auth.orgId) return res.status(403).json({ error: 'Forbidden' });

  const { data, error } = await svc.rpc('export_client_data', { p_client_id: clientId });
  if (error) return sendSafeError(res, error, 'Export failed.', '[dsr/export/client]');

  // N7.7 — journaliser la lecture de donnees personnelles.
  await logDataExport({
    orgId: auth.orgId,
    userId: auth.user.id,
    exportType: 'dsr_portability',
    entityType: 'client',
    recordCount: 1,
    req,
  });

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

  // Meme raison qu'a l'export (N3.5) : la garde interne d'anonymize_client
  // repose sur auth.uid(), NULL sous service_role. On valide donc
  // l'appartenance ici, avec l'orgId issu de requireAuthedClient — jamais de
  // la requete. Sans ceci, reparer le RPC transformerait cette route en
  // effacement destructif cross-tenant.
  const { data: target, error: targetErr } = await svc
    .from('clients')
    .select('org_id')
    .eq('id', clientId)
    .maybeSingle();

  if (targetErr) return sendSafeError(res, targetErr, 'Anonymization failed.', '[dsr/erase/client]');
  if (!target) return res.status(404).json({ error: 'Client not found' });
  if (target.org_id !== auth.orgId) return res.status(403).json({ error: 'Forbidden' });

  const { error } = await svc.rpc('anonymize_client', { p_client_id: clientId });
  if (error) return sendSafeError(res, error, 'Anonymization failed.', '[dsr/erase/client]');

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

  // Leads were folded into `clients` (status='lead') — the old anonymize_lead
  // RPC targets the dropped `leads` table and throws. A lead id IS a client id,
  // so route erasure through the working anonymize_client.
  const svc = getServiceClient();

  // Meme garde que sur /dsr/erase/client : auth.uid() est NULL sous
  // service_role, la verification interne du RPC ne protege donc rien ici.
  const { data: target, error: targetErr } = await svc
    .from('clients')
    .select('org_id')
    .eq('id', leadId)
    .maybeSingle();

  if (targetErr) return sendSafeError(res, targetErr, 'Anonymization failed.', '[dsr/erase/lead]');
  if (!target) return res.status(404).json({ error: 'Lead not found' });
  if (target.org_id !== auth.orgId) return res.status(403).json({ error: 'Forbidden' });

  const { error } = await svc.rpc('anonymize_client', { p_client_id: leadId });
  if (error) return sendSafeError(res, error, 'Anonymization failed.', '[dsr/erase/lead]');

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

  if (error) return sendSafeError(res, error, 'Failed to record request.', '[dsr/request]');
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

  // Integrity guard: this endpoint is intentionally public (cookie banner), so
  // without a check anyone could inject forged rows into ANY org's consent
  // journal. When an org_id is supplied, require the subject to actually belong
  // to it — you can only record consent for a real subject of that tenant.
  if (org_id) {
    if (!/^[0-9a-f-]{36}$/i.test(String(org_id))) return res.status(400).json({ error: 'Invalid org_id' });
    let belongs = false;
    if (subject_type === 'user') {
      const { data: m } = await svc.from('memberships').select('user_id').eq('user_id', subject_id).eq('org_id', org_id).maybeSingle();
      belongs = !!m;
    } else {
      // 'client' and 'lead' both live in the clients table
      const { data: c } = await svc.from('clients').select('id').eq('id', subject_id).eq('org_id', org_id).maybeSingle();
      belongs = !!c;
    }
    if (!belongs) return res.status(403).json({ error: 'Subject does not belong to this organization.' });
  }

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

  if (error) return sendSafeError(res, error, 'Failed to record consent.', '[dsr/consent]');
  return res.status(201).json({ consent_id: data });
});

export default router;
