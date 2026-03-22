import { Router } from 'express';
import { requireAuthedClient, isOrgMember, isOrgAdminOrOwner, getServiceClient } from '../lib/supabase';
import { parseOrgId, ensureLeadInPipeline } from '../lib/helpers';
import { validate, createLeadSchema, softDeleteLeadSchema, softDeleteDealSchema, invoiceFromJobSchema, updateLeadStatusSchema, convertLeadToJobSchema } from '../lib/validation';
import { eventBus } from '../lib/eventBus';
import { ensureClientForLead, resolveClientIdForLead, promoteClientFromLead } from '../lib/leadClientSync';

const router = Router();

router.post('/leads/create', validate(createLeadSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const fullName = String(req.body?.full_name || '').trim();
    const email = String(req.body?.email || '').trim() || null;
    const phone = String(req.body?.phone || '').trim() || null;
    const title = String(req.body?.title || '').trim() || null;
    const notes = String(req.body?.notes || '').trim() || null;
    const value = Number(req.body?.value || 0);
    const address = String(req.body?.address || '').trim() || null;
    // eslint-disable-next-line no-console
    console.info('lead_create_request', {
      orgId: requestedOrgId,
      userId: auth.user.id,
      stage: 'new',
      hasEmail: Boolean(email),
      nameLen: fullName.length,
    });

    if (!fullName) return res.status(400).json({ error: 'full_name is required.' });

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    // Insert lead directly — auth.client uses user JWT so org trigger works, and owner role satisfies RLS
    const nameParts = fullName.split(' ');
    const firstName = nameParts[0] || fullName;
    const lastName = nameParts.slice(1).join(' ') || '';

    // ── Ensure a linked client exists BEFORE creating the lead ──
    const admin = getServiceClient();
    const clientId = await ensureClientForLead(admin, {
      orgId: requestedOrgId,
      createdBy: auth.user.id,
      firstName,
      lastName,
      email: email || null,
      phone: phone || null,
      address: address || null,
      company: title || null,
    });

    // Use RPC to insert lead — bypasses PostgREST column cache issues with new client_id column
    // Must use auth.client (user JWT) so that BEFORE INSERT triggers can resolve auth.uid() / org_id
    const { data: leadId_rpc, error: leadInsertError } = await auth.client.rpc('create_lead_with_client', {
      p_org_id: requestedOrgId,
      p_created_by: auth.user.id,
      p_client_id: clientId,
      p_first_name: firstName,
      p_last_name: lastName,
      p_email: email || null,
      p_phone: phone || null,
      p_address: address || null,
      p_title: title || null,
      p_company: title || null,
      p_notes: notes || null,
      p_value: Number.isFinite(value) ? value : 0,
      p_status: 'new',
    });
    if (leadInsertError) throw leadInsertError;
    const leadInsert = { id: String(leadId_rpc) };

    const leadId = String(leadInsert.id);

    // Insert pipeline deal — use service_role to bypass RLS on pipeline_deals.
    // Error MUST be captured; a silent failure leaves the lead with no pipeline card.
    // (admin already declared above for ensureClientForLead)

    // Idempotency: if a deal already exists for this lead, reuse it.
    const { data: existingDeal } = await admin
      .from('pipeline_deals')
      .select('id')
      .eq('org_id', requestedOrgId)
      .eq('lead_id', leadId)
      .is('deleted_at', null)
      .limit(1)
      .maybeSingle();

    let ensuredDealId: string | null = existingDeal?.id ? String(existingDeal.id) : null;

    if (!ensuredDealId) {
      const { data: dealInsert, error: dealError } = await admin
        .from('pipeline_deals')
        .insert({
          org_id: requestedOrgId,
          created_by: auth.user.id,
          lead_id: leadId,
          stage: 'new',
          title: title || fullName,
          value: Number.isFinite(value) ? value : 0,
          notes: notes || null,
        })
        .select('id')
        .single();

      if (dealError) {
        // Roll back the lead to prevent partial state (lead exists but has no pipeline card).
        await admin
          .from('leads')
          .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', leadId);
        // eslint-disable-next-line no-console
        console.error('pipeline_deal_insert_failed', {
          code: String(dealError?.code || ''),
          message: String(dealError?.message || 'unknown'),
          leadId,
          orgId: requestedOrgId,
          stage: 'new',
        });
        throw dealError;
      }

      ensuredDealId = dealInsert?.id ? String(dealInsert.id) : null;
      // eslint-disable-next-line no-console
      console.info('pipeline_deal_created', { orgId: requestedOrgId, leadId, dealId: ensuredDealId, stage: 'new' });
    }

    const { data: leadRow, error: leadError } = await auth.client
      .from('leads_active')
      .select('*')
      .eq('id', leadId)
      .maybeSingle();
    if (leadError) throw leadError;

    // eslint-disable-next-line no-console
    console.info('lead_create_result', {
      orgId: requestedOrgId,
      userId: auth.user.id,
      leadId,
      dealId: ensuredDealId,
      rowFound: Boolean(leadRow?.id),
    });

    // Emit lead.created event
    eventBus.emit('lead.created', {
      orgId: requestedOrgId,
      entityType: 'lead',
      entityId: leadId,
      actorId: auth.user.id,
      metadata: { name: fullName, email, phone },
    });

    return res.status(200).json({
      lead: leadRow,
      deal_id: ensuredDealId,
      lead_id: leadId,
      job_id: null,
    });
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error('lead_create_failed', {
      code: String(error?.code || ''),
      message: String(error?.message || 'unknown'),
    });
    const code = String(error?.code || '');
    if (code === '42501') return res.status(403).json({ error: error?.message || 'Forbidden.' });
    if (code === '23514' || code === '23505' || code === '22023') return res.status(400).json({ error: error?.message || 'Invalid lead payload.' });
    return res.status(500).json({ error: error?.message || 'Unable to create lead.' });
  }
});

router.post('/leads/soft-delete', validate(softDeleteLeadSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const leadId = String(req.body?.leadId || '').trim();
    if (!leadId) return res.status(400).json({ error: 'leadId is required.' });

    // Use service_role for everything — bypasses RLS and trigger (auth.uid() = null → trigger allows)
    const admin = getServiceClient();

    // Fetch lead by primary key only — do NOT scope by auth.orgId here.
    // current_org_id() has no ORDER BY and can return the wrong org for multi-org users,
    // causing a false 404 that the client silently ignores (deletion appears to succeed but DB is unchanged).
    const { data: leadRow, error: fetchErr } = await admin
      .from('leads')
      .select('id, org_id')
      .eq('id', leadId)
      .is('deleted_at', null)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!leadRow) return res.status(404).json({ error: 'Lead not found or already deleted.' });

    // Verify the authenticated user is a member of the lead's actual org.
    const leadOrgId = String(leadRow.org_id);
    const member = await isOrgMember(auth.client, auth.user.id, leadOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden: not a member of this organization.' });

    const now = new Date().toISOString();

    const { error: leadErr } = await admin
      .from('leads')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', leadId)
      .is('deleted_at', null);
    if (leadErr) throw leadErr;

    // Soft-delete associated pipeline deals
    await admin
      .from('pipeline_deals')
      .update({ deleted_at: now, updated_at: now })
      .eq('lead_id', leadId)
      .eq('org_id', leadOrgId)
      .is('deleted_at', null);

    // Soft-delete associated quotes linked to this lead
    await admin
      .from('quotes')
      .update({ deleted_at: now, updated_at: now })
      .eq('lead_id', leadId)
      .eq('org_id', leadOrgId)
      .is('deleted_at', null);

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error('lead_soft_delete_failed', {
      code: String(error?.code || ''),
      message: String(error?.message || 'unknown'),
    });
    const code = String(error?.code || '');
    if (code === '42501') return res.status(403).json({ error: error?.message || 'Forbidden.' });
    if (code === 'P0002') return res.status(404).json({ error: error?.message || 'Lead not found.' });
    if (code === '23514') return res.status(409).json({ error: error?.message || 'Lead state is invalid for delete.' });
    return res.status(500).json({ error: error?.message || 'Unable to delete lead.' });
  }
});

router.post('/deals/soft-delete', validate(softDeleteDealSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const dealId = String(req.body?.dealId || '').trim();
    const alsoDeleteLead = Boolean(req.body?.alsoDeleteLead);

    const member = await isOrgMember(auth.client, auth.user.id, auth.orgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const admin = getServiceClient();
    const now = new Date().toISOString();

    // Fetch the deal first to get lead_id
    const { data: deal, error: fetchErr } = await admin
      .from('pipeline_deals')
      .select('id,lead_id,org_id')
      .eq('id', dealId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!deal) return res.status(404).json({ error: 'Deal not found.' });
    if (deal.org_id !== auth.orgId) return res.status(403).json({ error: 'Forbidden.' });

    // Soft-delete the deal using service_role (bypasses RLS)
    const { error: delErr } = await admin
      .from('pipeline_deals')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', dealId);
    if (delErr) throw delErr;

    // Optionally soft-delete the lead too
    let leadDeleted = false;
    if (alsoDeleteLead && deal.lead_id) {
      const { error: leadErr } = await admin
        .from('leads')
        .update({ deleted_at: now, updated_at: now })
        .eq('id', deal.lead_id)
        .is('deleted_at', null);
      if (!leadErr) leadDeleted = true;
    }

    return res.status(200).json({ ok: true, deal_deleted: true, lead_deleted: leadDeleted });
  } catch (error: any) {
    // eslint-disable-next-line no-console
    console.error('deal_soft_delete_failed', { message: error?.message || 'unknown' });
    return res.status(500).json({ error: error?.message || 'Unable to delete deal.' });
  }
});

router.post('/invoices/from-job', validate(invoiceFromJobSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const jobId = String(req.body?.jobId || '').trim();
    const sendNow = Boolean(req.body?.sendNow);

    if (!jobId) {
      return res.status(400).json({ error: 'Missing jobId.' });
    }

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);
    if (!canManage) {
      return res.status(403).json({ error: 'Only owner/admin can create an invoice from a job.' });
    }

    const { data, error } = await auth.client.rpc('create_invoice_from_job', {
      p_org_id: requestedOrgId,
      p_job_id: jobId,
      p_send_now: sendNow,
    });
    if (error) throw error;

    const payload = Array.isArray(data) ? data[0] : data;
    const invoiceId = String((payload as any)?.invoice_id || '').trim();
    const alreadyExists = Boolean((payload as any)?.already_exists);
    const status = String((payload as any)?.status || '').trim() || (sendNow ? 'sent' : 'draft');

    if (!invoiceId) {
      return res.status(500).json({ error: 'Invoice creation succeeded but invoice_id is missing.' });
    }

    const { data: invoiceRow, error: invoiceError } = await auth.client
      .from('invoices')
      .select('id,invoice_number,status,client_id,job_id,total_cents,balance_cents,currency,updated_at')
      .eq('id', invoiceId)
      .maybeSingle();
    if (invoiceError) throw invoiceError;

    return res.json({
      invoice: invoiceRow || { id: invoiceId, status },
      invoice_id: invoiceId,
      already_exists: alreadyExists,
      status,
    });
  } catch (error: any) {
    const code = String(error?.code || '');
    if (code === '42501') return res.status(403).json({ error: error?.message || 'Forbidden.' });
    if (code === 'P0002') return res.status(404).json({ error: error?.message || 'Job not found.' });
    if (code === '23514') return res.status(400).json({ error: error?.message || 'Job must be linked to a client.' });
    if (code === '23505') return res.status(409).json({ error: 'An active invoice already exists for this job.' });
    return res.status(500).json({ error: error?.message || 'Unable to create invoice from job.' });
  }
});

// ── Update lead status ───────────────────────────────────────

router.post('/leads/update-status', validate(updateLeadStatusSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const leadId = String(req.body.leadId).trim();
    const newStatus = String(req.body.status).trim();

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    // Get current lead
    const { data: lead, error: fetchError } = await auth.client
      .from('leads')
      .select('id, status, org_id')
      .eq('id', leadId)
      .eq('org_id', requestedOrgId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });

    const oldStatus = lead.status;
    if (oldStatus === newStatus) {
      return res.json({ ok: true, status: newStatus, changed: false });
    }

    // Update status
    const updatePayload: Record<string, any> = { status: newStatus };

    const { data: updated, error: updateError } = await auth.client
      .from('leads')
      .update(updatePayload)
      .eq('id', leadId)
      .select('*')
      .single();
    if (updateError) throw updateError;

    // When lead moves to 'closed', promote linked client to 'active'
    if (newStatus === 'closed' && updated.client_id) {
      await promoteClientFromLead(getServiceClient(), updated.client_id);
    }

    // Sync pipeline deal stage (status and stage use the same slugs)
    await auth.client
      .from('pipeline_deals')
      .update({ stage: newStatus })
      .eq('lead_id', leadId)
      .is('deleted_at', null);

    // Emit event
    await eventBus.emit('lead.status_changed', {
      orgId: requestedOrgId,
      entityType: 'lead',
      entityId: leadId,
      actorId: auth.user.id,
      metadata: { old_status: oldStatus, new_status: newStatus },
    });

    return res.json({ ok: true, lead: updated, status: newStatus, changed: true });
  } catch (error: any) {
    console.error('lead_status_update_failed', { code: error?.code, message: error?.message });
    return res.status(500).json({ error: error?.message || 'Unable to update lead status.' });
  }
});

// ── Convert lead to job ──────────────────────────────────────

router.post('/leads/convert-to-job', validate(convertLeadToJobSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const leadId = String(req.body.leadId).trim();
    const jobTitle = String(req.body.jobTitle || '').trim();

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);
    if (!canManage) return res.status(403).json({ error: 'Only owner/admin can convert leads.' });

    // Get lead
    const { data: lead, error: leadError } = await auth.client
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .eq('org_id', requestedOrgId)
      .maybeSingle();

    if (leadError) throw leadError;
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });

    // Resolve client_id — always use the sync service
    const clientId = await resolveClientIdForLead(getServiceClient(), leadId);

    // Promote client status from 'lead' to 'active'
    await promoteClientFromLead(getServiceClient(), clientId);

    // Create job via RPC — ensures job_number, schedule event wiring, and triggers fire
    const title = jobTitle || lead.title || `${lead.first_name || ''} ${lead.last_name || ''} — Job`.trim();
    const leadAddress = lead.address || null;
    const { data: rpcResult, error: rpcError } = await auth.client.rpc('rpc_create_job_with_optional_schedule', {
      p_lead_id: leadId,
      p_client_id: clientId,
      p_team_id: null,
      p_title: title,
      p_job_number: null,
      p_job_type: null,
      p_status: 'draft',
      p_address: leadAddress,
      p_notes: lead.notes || null,
      p_scheduled_at: null,
      p_end_at: null,
      p_timezone: 'America/Montreal',
    });
    if (rpcError) throw rpcError;
    const jobId = String((rpcResult as any)?.job_id || '');
    if (!jobId) throw new Error('Job created but job_id is missing from RPC response.');

    // Fetch the created job row for the response
    const { data: job, error: jobFetchError } = await auth.client
      .from('jobs')
      .select('id, title')
      .eq('id', jobId)
      .single();
    if (jobFetchError) throw jobFetchError;

    // Mark lead as closed (converted)
    await auth.client
      .from('leads')
      .update({
        status: 'closed',
        converted_to_client_id: clientId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', leadId);

    // Update pipeline deal
    await auth.client
      .from('pipeline_deals')
      .update({ stage: 'closed', job_id: job.id })
      .eq('lead_id', leadId)
      .is('deleted_at', null);

    // Emit lead converted event
    await eventBus.emit('lead.converted', {
      orgId: requestedOrgId,
      entityType: 'lead',
      entityId: leadId,
      actorId: auth.user.id,
      relatedEntityType: 'job',
      relatedEntityId: job.id,
      metadata: {
        client_id: clientId,
        job_id: job.id,
        job_title: job.title,
        client_name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
      },
    });

    // Emit job created event
    await eventBus.emit('job.created', {
      orgId: requestedOrgId,
      entityType: 'job',
      entityId: job.id,
      actorId: auth.user.id,
      relatedEntityType: 'lead',
      relatedEntityId: leadId,
      metadata: { title: job.title, client_id: clientId, from_lead: true },
    });

    // Create notification for admin
    const leadName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown';
    await auth.client.from('notifications').insert({
      org_id: requestedOrgId,
      type: 'success',
      title: 'Lead converted to job',
      body: `${leadName} — ${job.title}`,
      reference_id: job.id,
    });

    return res.json({
      ok: true,
      lead_id: leadId,
      client_id: clientId,
      job_id: job.id,
      job_title: job.title,
    });
  } catch (error: any) {
    console.error('lead_convert_failed', { code: error?.code, message: error?.message });
    return res.status(500).json({ error: error?.message || 'Unable to convert lead.' });
  }
});

// ── Resolve client for lead (creates one if missing) ─────────

router.post('/leads/resolve-client', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const leadId = String(req.body?.leadId || '').trim();
    if (!leadId) return res.status(400).json({ error: 'leadId is required.' });

    const clientId = await resolveClientIdForLead(getServiceClient(), leadId);
    return res.json({ ok: true, clientId });
  } catch (error: any) {
    console.error('lead_resolve_client_failed', { code: error?.code, message: error?.message });
    return res.status(500).json({ error: error?.message || 'Unable to resolve client.' });
  }
});

export default router;
