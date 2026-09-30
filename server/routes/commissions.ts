import { Router } from 'express';
import { requireAuthedClient, getServiceClient, isOrgAdminOrOwner } from '../lib/supabase';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { sendSafeError } from '../lib/error-handler';
import { withDeadLetter } from '../lib/dead-letter';
import { logger } from '../lib/logger';
import {
  validate, commissionRuleCreateSchema, commissionRuleUpdateSchema, commissionAssignSchema,
  commissionSettingsSchema, commissionReverseSchema,
} from '../lib/validation';
import {
  getCommissionEntries,
  approveCommission,
  reverseCommission,
  getCommissionRules,
  createCommissionRule,
  getPayrollPreview,
  markCommissionPaid,
  unmarkCommissionPaid,
  generateCommissionsForInvoice,
  projectCommissionForJob,
  voidProjectedCommissionForJob,
  toutesLesEntrees,
  enrichirEntrees,
} from '../lib/field-sales/commission-engine';
import { exigerPeriodeOuverte, PeriodeVerrouillee } from '../lib/field-sales/commission-verrou';
import { totauxCommissions, enCents } from '../lib/field-sales/commission-periode';
import { fuseauOrg } from '../lib/automations-fuseau-org';
import { toLocalDate } from '../lib/reports/dates';
import { csvCell, CSV_BOM } from '../lib/reports/csv';

/** Réponse d'erreur : 409 lisible pour une période versée, sinon erreur sûre. */
function erreurCommission(res: any, err: unknown) {
  if (err instanceof PeriodeVerrouillee) {
    return res.status(409).json({
      error: `Période de paie déjà versée (du ${err.periode.debut} au ${err.periode.fin}) : cette commission est verrouillée. Toute correction passe par la période suivante.`,
      code: 'periode_verrouillee', periode: err.periode,
    });
  }
  return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
}

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

/**
 * Les trois appels « en arrière-plan » (projeter, annuler, générer) sont
 * lancés par le navigateur sans bloquer le flux métier. Si l'un d'eux échoue,
 * un vendeur n'est pas payé — ou l'est pour un job supprimé — et personne ne
 * le voit avant qu'il réclame. On persiste donc chaque échec dans
 * `dead_letters` (payload rejouable) AVANT de répondre 500.
 *
 * Certains « succès » du moteur sont en réalité des échecs (lecture ratée →
 * il s'abstient) : on les journalise aussi, sinon ils passent en 200 muets.
 */
const SKIPS_QUI_SONT_DES_ECHECS = new Set(['dup_check_failed', 'rules_load_failed', 'period_stats_failed', 'insert_failed']);

async function commissionAvecTrace<T extends { skipped?: string | null; voided?: number }>(
  res: any,
  source: string,
  payload: Record<string, unknown>,
  fn: () => Promise<T>,
) {
  let echec: unknown = null;
  const result = await withDeadLetter(source, payload, async () => {
    try {
      return await fn();
    } catch (err) {
      echec = err;
      throw err;
    }
  });
  if (result === null) {
    return sendSafeError(res, echec, 'Commission operation failed.', '[commissions]');
  }
  if (result.skipped && SKIPS_QUI_SONT_DES_ECHECS.has(result.skipped)) {
    await withDeadLetter(source, { ...payload, skipped: result.skipped }, async () => {
      throw new Error(`commission engine skipped: ${result.skipped}`);
    });
    return res.status(500).json({ error: 'Commission operation failed.', skipped: result.skipped });
  }
  return res.json(result);
}

/**
 * Trace d'audit (qui, quand, avant/après) de toute écriture qui touche à
 * l'argent d'un rep : règle, plan, réglages, approbation, versement, reprise.
 * Avant : aucune — impossible de savoir qui avait changé un taux ou versé une
 * commission. Un échec d'écriture de la trace est journalisé, jamais avalé.
 */
async function tracer(
  sc: ReturnType<typeof getServiceClient>,
  auth: { orgId: string; user: { id: string } },
  req: { ip?: string; headers: Record<string, unknown> },
  action: string,
  entite: { type: string; id: string | null },
  avant: unknown,
  apres: unknown,
) {
  const { error } = await sc.from('audit_events').insert({
    org_id: auth.orgId,
    actor_id: auth.user.id,
    action,
    event_type: 'commissions',
    entity_type: entite.type,
    entity_id: entite.id,
    old_values: avant ?? null,
    new_values: apres ?? null,
    metadata: { source: 'api/commissions' },
    user_agent: typeof req.headers['user-agent'] === 'string' ? String(req.headers['user-agent']).slice(0, 500) : null,
  });
  if (error) logger.error('[commissions] trace d\'audit non écrite', { action, orgId: auth.orgId, entityId: entite.id, message: error.message });
}

const DATE_SEULE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/commissions?userId=...&status=...&from=...&to=...
// Reps see only their own commissions; owners/admins see all (and can filter by userId).
router.get('/commissions', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const requestedUserId = req.query.userId as string | undefined;
  const status = req.query.status as string | undefined;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  if ((from && !DATE_SEULE.test(from)) || (to && !DATE_SEULE.test(to))) {
    return res.status(400).json({ error: 'from and to must be YYYY-MM-DD dates.' });
  }

  try {
    const sc = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
    const effectiveUserId = isAdmin ? requestedUserId : auth.user.id;

    const entries = await getCommissionEntries(sc, auth.orgId, {
      userId: effectiveUserId,
      status,
      dateRange: from && to ? { from, to } : undefined,
    });
    res.json(entries);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// POST /api/commissions/project-for-job
// Creates a PENDING (estimated) commission for the job's rep when a job is
// created. Any org member may call it; the recipient is derived from the job
// (salesperson/creator), not the caller, so it can't be used to credit others.
router.post('/commissions/project-for-job', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const { jobId } = req.body || {};
  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json({ error: 'jobId is required.' });
  }
  const sc = getServiceClient();
  return commissionAvecTrace(res, 'commissions:project-for-job',
    { org_id: auth.orgId, job_id: jobId, user_id: auth.user.id },
    () => projectCommissionForJob(sc, auth.orgId, jobId));
});

// POST /api/commissions/void-for-job
// Removes the UNCONFIRMED projected (pending, no-invoice) commission for a job
// when it is deleted/cancelled. Derived from the job + caller's org.
router.post('/commissions/void-for-job', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const { jobId } = req.body || {};
  if (!jobId || typeof jobId !== 'string') {
    return res.status(400).json({ error: 'jobId is required.' });
  }
  const sc = getServiceClient();
  return commissionAvecTrace(res, 'commissions:void-for-job',
    { org_id: auth.orgId, job_id: jobId, user_id: auth.user.id },
    () => voidProjectedCommissionForJob(sc, auth.orgId, jobId));
});

// All write/admin endpoints below this point require owner/admin role.
async function requireAdmin(req: any, res: any) {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return null;
  const sc = getServiceClient();
  const ok = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
  if (!ok) {
    res.status(403).json({ error: 'Only owners and admins can manage commission rules.' });
    return null;
  }
  return auth;
}

// POST /api/commissions/generate-for-invoice
// Appelé par le navigateur quand une facture est marquée payée à la main (Stripe
// passe par le webhook). Ouvert à tout membre — pas seulement aux admins — parce
// que c'est le rôle qui encaisse qui déclenche l'appel : en 403, un vendeur qui
// marquait sa facture payée voyait sa commission ne jamais naître, sans trace.
// Sans risque : le moteur est idempotent, borné à l'org du token, exige une
// facture réellement payée et dérive le bénéficiaire de la facture, pas de
// l'appelant.
router.post('/commissions/generate-for-invoice', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const { invoiceId } = req.body || {};
  if (!invoiceId || typeof invoiceId !== 'string') {
    return res.status(400).json({ error: 'invoiceId is required.' });
  }
  const sc = getServiceClient();
  return commissionAvecTrace(res, 'commissions:generate-for-invoice',
    { org_id: auth.orgId, invoice_id: invoiceId, user_id: auth.user.id },
    () => generateCommissionsForInvoice(sc, auth.orgId, invoiceId));
});

// POST /api/commissions/:id/mark-paid (admin)
router.post('/commissions/:id/mark-paid', async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    await exigerPeriodeOuverte(sc, auth.orgId, req.params.id);
    const entry = await markCommissionPaid(sc, auth.orgId, req.params.id);
    await tracer(sc, auth, req, 'commission.paid', { type: 'fs_commission_entry', id: req.params.id },
      { status: 'approved' }, { status: 'paid', amount: entry?.amount, user_id: entry?.user_id, paid_at: entry?.paid_at });
    res.json(entry);
  } catch (err: any) {
    return erreurCommission(res, err);
  }
});

// POST /api/commissions/:id/unmark-paid (admin) — « Annuler le versement » d'une
// commission versée par erreur. Refusé si sa période de paie est versée.
router.post('/commissions/:id/unmark-paid', async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    await exigerPeriodeOuverte(sc, auth.orgId, req.params.id);
    const { data: avant } = await sc.from('fs_commission_entries').select('status, paid_at, amount, user_id')
      .eq('id', req.params.id).eq('org_id', auth.orgId).maybeSingle();
    const entry = await unmarkCommissionPaid(sc, auth.orgId, req.params.id);
    await tracer(sc, auth, req, 'commission.unpaid', { type: 'fs_commission_entry', id: req.params.id },
      avant, { status: 'approved', paid_at: null });
    res.json(entry);
  } catch (err: any) {
    return erreurCommission(res, err);
  }
});

// POST /api/commissions/:id/approve (admin)
router.post('/commissions/:id/approve', async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    await exigerPeriodeOuverte(sc, auth.orgId, req.params.id);
    const entry = await approveCommission(sc, auth.orgId, req.params.id, auth.user.id);
    await tracer(sc, auth, req, 'commission.approved', { type: 'fs_commission_entry', id: req.params.id },
      { status: 'pending' }, { status: 'approved', amount: entry?.amount, user_id: entry?.user_id });
    res.json(entry);
  } catch (err: any) {
    return erreurCommission(res, err);
  }
});

// POST /api/commissions/:id/reverse (admin)
router.post('/commissions/:id/reverse', validate(commissionReverseSchema), async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const reason = req.body.reason || '';

  try {
    const sc = getServiceClient();
    await exigerPeriodeOuverte(sc, auth.orgId, req.params.id);
    const { data: avant } = await sc.from('fs_commission_entries').select('status, amount, user_id')
      .eq('id', req.params.id).eq('org_id', auth.orgId).maybeSingle();
    const entry = await reverseCommission(sc, auth.orgId, req.params.id, reason);
    await tracer(sc, auth, req, 'commission.reversed', { type: 'fs_commission_entry', id: req.params.id },
      avant, { status: 'reversed', reason });
    res.json(entry);
  } catch (err: any) {
    return erreurCommission(res, err);
  }
});

// GET /api/commissions/rules — un admin voit toutes les règles ; tout autre
// membre ne voit QUE son plan (règle qui lui est assignée, sinon le plan par
// défaut), sans la liste des autres bénéficiaires. Avant, chaque membre
// lisait les taux, paliers et assignations de tous ses collègues (Loi 25).
router.get('/commissions/rules', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  try {
    const sc = getServiceClient();
    const rules = await getCommissionRules(sc, auth.orgId);
    if (await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId)) return res.json(rules);
    const { data: reglages } = await sc.from('commission_settings').select('default_rule_id').eq('org_id', auth.orgId).maybeSingle();
    const assignee = rules.find((r: any) => r.is_active && Array.isArray(r.assigned_user_ids) && r.assigned_user_ids.includes(auth.user.id));
    const plan = assignee ?? rules.find((r: any) => r.is_active && r.id === reglages?.default_rule_id);
    if (!plan) return res.json([]);
    const splits = plan.attribution?.mode === 'split' && Array.isArray(plan.attribution.splits)
      ? plan.attribution.splits.filter((s: any) => s.user_id === auth.user.id) : undefined;
    return res.json([{
      ...plan,
      assigned_user_ids: assignee ? [auth.user.id] : [],
      attribution: splits ? { mode: 'split', splits } : plan.attribution,
    }]);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

/** Tous les bénéficiaires nommés dans une règle doivent être membres de l'org. */
async function membresInconnus(sc: ReturnType<typeof getServiceClient>, orgId: string, body: any): Promise<string[]> {
  const ids = new Set<string>([
    ...(Array.isArray(body.assigned_user_ids) ? body.assigned_user_ids : []),
    ...(Array.isArray(body.attribution?.splits) ? body.attribution.splits.map((s: any) => s.user_id) : []),
  ]);
  if (ids.size === 0) return [];
  const { data, error } = await sc.from('memberships').select('user_id').eq('org_id', orgId).in('user_id', [...ids]);
  if (error) throw new Error(error.message);
  const connus = new Set((data ?? []).map((m: any) => m.user_id));
  return [...ids].filter((id) => !connus.has(id));
}

// POST /api/commissions/rules (admin)
router.post('/commissions/rules', validate(commissionRuleCreateSchema), async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const {
    name, description, priority, is_active,
    base_kind, base_percent, base_value_cents,
    product_overrides, performance_tiers, bonuses,
    attribution, assigned_user_ids,
  } = req.body;

  try {
    const sc = getServiceClient();
    const inconnus = await membresInconnus(sc, auth.orgId, req.body);
    if (inconnus.length) return res.status(400).json({ error: 'Some users are not members of this organization.' });
    const rule = await createCommissionRule(sc, auth.orgId, {
      name,
      description: description ?? null,
      // Legacy required columns — keep DB happy
      type: 'percentage',
      priority: priority ?? 0,
      is_active: is_active ?? true,
      // New engine columns
      base_kind: base_kind ?? 'percent',
      base_percent: base_percent ?? null,
      base_value_cents: base_value_cents ?? null,
      product_overrides: product_overrides ?? [],
      performance_tiers: performance_tiers ?? [],
      bonuses: bonuses ?? [],
      attribution: attribution ?? { mode: 'solo' },
      assigned_user_ids: assigned_user_ids ?? [],
    });
    await tracer(sc, auth, req, 'commission_rule.created', { type: 'fs_commission_rule', id: rule?.id ?? null }, null, rule);
    res.json(rule);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// PUT /api/commissions/rules/:id (admin). Le changement de taux n'est PAS
// rétroactif : les commissions déjà calculées gardent leur montant (et leur
// taux dans calc_breakdown) ; la trace garde l'avant/après.
router.put('/commissions/rules/:id', validate(commissionRuleUpdateSchema), async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const payload: Record<string, any> = {};
  // `!= null` : un null explicite du client atteignait sinon des colonnes
  // NOT NULL (name, is_active, priority) → 23502.
  for (const [key, value] of Object.entries(req.body)) {
    if (value != null) payload[key] = value;
  }
  if (Object.keys(payload).length === 0) return res.status(400).json({ error: 'No editable fields provided.' });

  try {
    const sc = getServiceClient();
    const inconnus = await membresInconnus(sc, auth.orgId, payload);
    if (inconnus.length) return res.status(400).json({ error: 'Some users are not members of this organization.' });
    const { data: avant } = await sc.from('fs_commission_rules').select('*')
      .eq('id', req.params.id).eq('org_id', auth.orgId).is('deleted_at', null).maybeSingle();
    if (!avant) return res.status(404).json({ error: 'Commission rule not found.' });
    const { data, error } = await sc
      .from('fs_commission_rules')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('org_id', auth.orgId)
      .is('deleted_at', null)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await tracer(sc, auth, req, 'commission_rule.updated', { type: 'fs_commission_rule', id: req.params.id }, avant, data);
    res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// POST /api/commissions/rules/assign-member (admin) — atomically move a rep
// onto ONE plan: removed from every other active rule's assigned_user_ids,
// added to the target (rule_id null = default plan only).
router.post('/commissions/rules/assign-member', validate(commissionAssignSchema), async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;

  const userId = String(req.body.user_id);
  const ruleId = req.body.rule_id ? String(req.body.rule_id) : null;

  try {
    const sc = getServiceClient();
    if ((await membresInconnus(sc, auth.orgId, { assigned_user_ids: [userId] })).length) {
      return res.status(400).json({ error: 'This user is not a member of this organization.' });
    }
    const { data: rules, error } = await sc
      .from('fs_commission_rules')
      .select('id, assigned_user_ids')
      .eq('org_id', auth.orgId)
      .is('deleted_at', null);
    if (error) throw new Error(error.message);
    if (ruleId && !(rules || []).some((r: any) => r.id === ruleId)) {
      return res.status(404).json({ error: 'Commission rule not found.' });
    }
    const planAvant = (rules || []).find((r: any) => Array.isArray(r.assigned_user_ids) && r.assigned_user_ids.includes(userId))?.id ?? null;

    for (const rule of rules || []) {
      const current: string[] = Array.isArray(rule.assigned_user_ids) ? rule.assigned_user_ids : [];
      const shouldContain = rule.id === ruleId;
      const contains = current.includes(userId);
      if (contains === shouldContain) continue;
      const next = shouldContain ? [...current, userId] : current.filter((u) => u !== userId);
      const { error: upErr } = await sc
        .from('fs_commission_rules')
        .update({ assigned_user_ids: next, updated_at: new Date().toISOString() })
        .eq('id', rule.id)
        .eq('org_id', auth.orgId);
      if (upErr) throw new Error(upErr.message);
    }

    await tracer(sc, auth, req, 'commission_plan.assigned', { type: 'membership', id: userId }, { rule_id: planAvant }, { rule_id: ruleId });
    res.json({ ok: true, rule_id: ruleId });
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// DELETE /api/commissions/rules/:id (admin) — soft delete
router.delete('/commissions/rules/:id', async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const { data: avant, error } = await sc.from('fs_commission_rules')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('org_id', auth.orgId).is('deleted_at', null)
      .select('*');
    if (error) throw new Error(error.message);
    if (!avant?.length) return res.status(404).json({ error: 'Commission rule not found.' });
    await tracer(sc, auth, req, 'commission_rule.deleted', { type: 'fs_commission_rule', id: req.params.id }, avant[0], { deleted: true });
    res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// GET /api/commissions/settings
router.get('/commissions/settings', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const { data, error } = await sc.from('commission_settings').select('*').eq('org_id', auth.orgId).maybeSingle();
    if (error) throw new Error(error.message);
    res.json(data || { org_id: auth.orgId, reversal_policy: 'alert', default_rule_id: null });
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// PUT /api/commissions/settings (admin)
router.put('/commissions/settings', validate(commissionSettingsSchema), async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const { reversal_policy, default_rule_id } = req.body;
  try {
    const sc = getServiceClient();
    if (default_rule_id) {
      const { data: regle } = await sc.from('fs_commission_rules').select('id').eq('id', default_rule_id).eq('org_id', auth.orgId).is('deleted_at', null).maybeSingle();
      if (!regle) return res.status(404).json({ error: 'Commission rule not found.' });
    }
    const { data: avant } = await sc.from('commission_settings').select('*').eq('org_id', auth.orgId).maybeSingle();
    const payload: Record<string, any> = { org_id: auth.orgId, updated_at: new Date().toISOString() };
    if (reversal_policy) payload.reversal_policy = reversal_policy;
    if (default_rule_id !== undefined) payload.default_rule_id = default_rule_id;
    const { data, error } = await sc.from('commission_settings').upsert(payload, { onConflict: 'org_id' }).select().single();
    // « Reprendre » exige la migration 20261005100400 : tant qu'elle n'est pas
    // appliquée, la contrainte de la base refuse la valeur — on le dit clairement
    // au lieu d'un « Data validation failed » incompréhensible.
    if (error && error.code === '23514' && reversal_policy === 'clawback') {
      return res.status(409).json({
        error: 'L’option « Reprendre » sera disponible après la prochaine mise à jour de la base. Les autres options fonctionnent déjà.',
        code: 'clawback_indisponible',
      });
    }
    if (error) throw error;
    await tracer(sc, auth, req, 'commission_settings.updated', { type: 'commission_settings', id: null }, avant, data);
    res.json(data);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// GET /api/commissions/export.csv?from=&to=&userId=&status=&lang=fr|en
// Export de la page, et « relevé » d'un rep quand userId est donné. Un non-admin
// n'exporte QUE ses commissions (même portée que la page). Toutes les lignes de
// la période (pas de plafond de 1 000), plus les totaux en pied de fichier.
router.get('/commissions/export.csv', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  if ((from && !DATE_SEULE.test(from)) || (to && !DATE_SEULE.test(to)) || (!!from !== !!to)) {
    return res.status(400).json({ error: 'from and to must both be YYYY-MM-DD dates.' });
  }
  const fr = req.query.lang !== 'en';
  try {
    const sc = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
    const userId = isAdmin ? (req.query.userId as string | undefined) || undefined : auth.user.id;
    const status = typeof req.query.status === 'string' && ['pending', 'approved', 'paid', 'reversed'].includes(req.query.status) ? req.query.status : undefined;
    const tz = await fuseauOrg(sc, auth.orgId);
    const brutes = await toutesLesEntrees(sc, auth.orgId, '*', { userId, status, dateRange: from && to ? { from, to } : undefined });
    brutes.sort((a, b) => String(a.triggered_at).localeCompare(String(b.triggered_at)));
    const lignes = await enrichirEntrees(sc, auth.orgId, brutes);

    const statut = (e: any) => (!e.invoice_id && e.status === 'pending')
      ? (fr ? 'Estimation' : 'Estimate')
      : ({ pending: fr ? 'En attente' : 'Pending', approved: fr ? 'Approuvé' : 'Approved', paid: fr ? 'Versé' : 'Paid', reversed: fr ? 'Reversé' : 'Reversed' } as Record<string, string>)[e.status] ?? e.status;
    const dollars = (cents: number) => (cents / 100).toFixed(2); // nombre brut : jamais neutralisé (les reprises sont négatives)
    const texte = (v: unknown) => csvCell(v);
    const entete = fr
      ? ['Gagnée le', 'Représentant', 'Facture', 'Job', 'Client', 'Base avant taxes ($)', 'Commission ($)', 'Statut', 'Versée le', 'Remarque']
      : ['Earned', 'Rep', 'Invoice', 'Job', 'Client', 'Pre-tax base ($)', 'Commission ($)', 'Status', 'Paid on', 'Note'];
    let csv = CSV_BOM + entete.map(texte).join(',') + '\r\n';
    for (const e of lignes as any[]) {
      csv += [
        texte(toLocalDate(e.triggered_at, tz)), texte(e.rep_name), texte(e.invoice_number ?? ''), texte(e.job_number ?? ''),
        texte(e.client_name ?? ''), dollars(enCents(e.base_amount)), dollars(enCents(e.amount)), texte(statut(e)),
        texte(e.paid_at ? toLocalDate(e.paid_at, tz) : ''), texte(e.reverse_reason || (e.calc_breakdown?.reprise_de ? e.description : '') || ''),
      ].join(',') + '\r\n';
    }
    const t = totauxCommissions(lignes);
    const pied: Array<[string, number]> = fr
      ? [['Total dû (en attente + approuvé + versé)', t.du_cents], ['dont versé', t.verse_cents], ['dont à verser', t.en_attente_cents + t.approuve_cents], ['Reprises (non dues)', t.repris_cents], ['Estimations (jobs non payés, non dues)', t.estime_cents]]
      : [['Total owed (pending + approved + paid)', t.du_cents], ['of which paid', t.verse_cents], ['of which to pay', t.en_attente_cents + t.approuve_cents], ['Reversed (not owed)', t.repris_cents], ['Estimates (unpaid jobs, not owed)', t.estime_cents]];
    csv += '\r\n';
    for (const [libelle, cents] of pied) csv += [texte(libelle), '', '', '', '', '', dollars(cents), '', '', ''].join(',') + '\r\n';

    const nom = `commissions${userId ? `-${(lignes[0] as any)?.rep_name ?? 'rep'}`.replace(/[^\w-]+/g, '-') : ''}${from ? `-${from}_${to}` : ''}.csv`;
    await tracer(sc, auth, req, 'commissions.exported', { type: 'fs_commission_entries', id: null }, null, { from, to, userId: userId ?? null, lignes: lignes.length });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    res.send(csv);
  } catch (err: any) {
    return erreurCommission(res, err);
  }
});

// GET /api/commissions/payroll-preview?userId=...&from=...&to=...
// Reps can only preview their own; admins can preview anyone or all.
router.get('/commissions/payroll-preview', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;

  const requestedUserId = (req.query.userId as string) || null;
  const from = req.query.from as string;
  const to = req.query.to as string;

  if (!from || !to || !DATE_SEULE.test(from) || !DATE_SEULE.test(to)) {
    return res.status(400).json({ error: 'from and to query parameters are required (YYYY-MM-DD).' });
  }

  try {
    const sc = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
    const effectiveUserId = isAdmin ? requestedUserId : auth.user.id;
    const preview = await getPayrollPreview(sc, auth.orgId, effectiveUserId, from, to);
    res.json(preview);
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

// GET /api/commissions/me — current user's role flag (used by UI to hide admin controls)
router.get('/commissions/me', async (req, res) => {
  const auth = await requireAuthedClient(req, res);
  if (!auth) return;
  try {
    const sc = getServiceClient();
    const isAdmin = await isOrgAdminOrOwner(sc, auth.user.id, auth.orgId);
    res.json({ user_id: auth.user.id, is_admin: isAdmin });
  } catch (err: any) {
    return sendSafeError(res, err, 'Commission operation failed.', '[commissions]');
  }
});

export default router;
