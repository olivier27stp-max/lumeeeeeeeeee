import { Router } from 'express';
import { requireAuthedClient, isOrgMember, isOrgAdminOrOwner, getServiceClient } from '../lib/supabase';
import { chargeInvoiceOnFile } from '../lib/stripe-connect';
import { parseOrgId, ensureLeadInPipeline } from '../lib/helpers';
import { validate, createLeadSchema, softDeleteLeadSchema, softDeleteClientSchema, softDeleteDealSchema, invoiceFromJobSchema, updateLeadStatusSchema, convertLeadToJobSchema } from '../lib/validation';
import { eventBus } from '../lib/eventBus';
import { dispatchWebhook } from '../lib/webhookDispatcher';
import { ensureClientForLead, resolveClientIdForLead, promoteClientFromLead } from '../lib/leadClientSync';
import { sendSafeError } from '../lib/error-handler';

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
      stage: 'new_prospect',
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

    // A lead IS a client with status='lead'. Stamp the lead-specific fields
    // onto the client that ensureClientForLead created/returned.
    const { error: leadUpdateError } = await admin
      .from('clients')
      .update({
        status: 'lead',
        lead_status: 'new_prospect',
        title: title || null,
        company: title || null,
        notes: notes || null,
        value: Number.isFinite(value) ? value : 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', clientId);
    if (leadUpdateError) throw leadUpdateError;

    // The lead id is the client id.
    const leadId = String(clientId);

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
          stage: 'new_prospect',
          title: title || fullName,
          value: Number.isFinite(value) ? value : 0,
          notes: notes || null,
        })
        .select('id')
        .single();

      if (dealError) {
        // Roll back the lead-client to prevent partial state (lead exists but has no pipeline card).
        const { error: rollbackError } = await admin
          .from('clients')
          .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', leadId);
        if (rollbackError) {
          // eslint-disable-next-line no-console
          console.error('lead_rollback_failed', { leadId, orgId: requestedOrgId, message: rollbackError.message });
        }
        // eslint-disable-next-line no-console
        console.error('pipeline_deal_insert_failed', {
          code: String(dealError?.code || ''),
          message: String(dealError?.message || 'unknown'),
          leadId,
          orgId: requestedOrgId,
          stage: 'new_prospect',
        });
        throw dealError;
      }

      ensuredDealId = dealInsert?.id ? String(dealInsert.id) : null;
      // eslint-disable-next-line no-console
      console.info('pipeline_deal_created', { orgId: requestedOrgId, leadId, dealId: ensuredDealId, stage: 'new_prospect' });
    }

    const { data: leadRow, error: leadError } = await auth.client
      .from('clients')
      .select('*')
      .eq('id', leadId)
      .is('deleted_at', null)
      .maybeSingle();
    if (leadError) throw leadError;
    // PII decryption handled automatically by piiDecryptResponseMiddleware

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

    // Outbound webhooks — lead.created (always) + client.created (best-effort).
    dispatchWebhook(requestedOrgId, 'lead.created', {
      lead_id: leadId,
      client_id: clientId,
      first_name: firstName,
      last_name: lastName,
      email,
      phone,
      address,
      title,
      value: Number.isFinite(value) ? value : 0,
    }).catch((err) => console.error('[webhooks] lead.created failed:', err?.message));
    if (clientId) {
      dispatchWebhook(requestedOrgId, 'client.created', {
        client_id: clientId,
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        address,
        created_via: 'lead.create',
      }).catch((err) => console.error('[webhooks] client.created failed:', err?.message));
    }

    return res.status(200).json({
      lead: leadRow,
      deal_id: ensuredDealId,
      lead_id: leadId,
      job_id: null,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to create lead.', '[leads/create]');
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
      .from('clients')
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

    // A lead is a client with status='lead' — soft-delete the client row.
    const { error: leadErr } = await admin
      .from('clients')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', leadId)
      .is('deleted_at', null);
    if (leadErr) throw leadErr;

    // Soft-delete associated pipeline deals.
    // Le lead est déjà supprimé : on ne rejoue pas la requête (elle répondrait
    // 404 « déjà supprimé »), mais une cascade ratée laisse une carte fantôme
    // dans le pipeline — ça doit se voir dans les journaux.
    const { error: dealsErr } = await admin
      .from('pipeline_deals')
      .update({ deleted_at: now, updated_at: now })
      .eq('lead_id', leadId)
      .eq('org_id', leadOrgId)
      .is('deleted_at', null);
    if (dealsErr) console.error('[leads/soft-delete] pipeline_deals cascade failed:', { leadId, orgId: leadOrgId, error: dealsErr.message });

    // Soft-delete associated quotes linked to this lead
    const { error: quotesErr } = await admin
      .from('quotes')
      .update({ deleted_at: now, updated_at: now })
      .eq('lead_id', leadId)
      .eq('org_id', leadOrgId)
      .is('deleted_at', null);
    if (quotesErr) console.error('[leads/soft-delete] quotes cascade failed:', { leadId, orgId: leadOrgId, error: quotesErr.message });

    return res.status(200).json({ ok: true });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to delete lead.', '[leads/soft-delete]');
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

    // Optionally soft-delete the lead too (deal.lead_id is a client id now)
    let leadDeleted = false;
    if (alsoDeleteLead && deal.lead_id) {
      const { error: leadErr } = await admin
        .from('clients')
        .update({ deleted_at: now, updated_at: now })
        .eq('id', deal.lead_id)
        .is('deleted_at', null);
      if (leadErr) console.error('[deals/soft-delete] lead cascade failed:', { dealId, leadId: deal.lead_id, error: leadErr.message });
      else leadDeleted = true;
    }

    return res.status(200).json({ ok: true, deal_deleted: true, lead_deleted: leadDeleted });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to delete deal.', '[deals/soft-delete]');
  }
});

router.post('/clients/soft-delete', validate(softDeleteClientSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const clientId = String(req.body?.clientId || '').trim();
    if (!clientId) return res.status(400).json({ error: 'clientId is required.' });

    const admin = getServiceClient();

    const { data: clientRow, error: fetchErr } = await admin
      .from('clients')
      .select('id, org_id')
      .eq('id', clientId)
      .is('deleted_at', null)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!clientRow) return res.status(404).json({ error: 'Client not found or already deleted.' });

    const clientOrgId = String(clientRow.org_id);
    const member = await isOrgMember(auth.client, auth.user.id, clientOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden: not a member of this organization.' });

    const now = new Date().toISOString();

    // Soft-delete the client
    const { error: clientErr } = await admin
      .from('clients')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', clientId)
      .is('deleted_at', null);
    if (clientErr) throw clientErr;

    // Cascade: soft-delete related entities (leads are clients now — nothing extra)
    // `.select('id')` est indispensable : sans lui supabase-js renvoie data:null,
    // donc `deletedJobIds` restait vide et la cascade sur schedule_events ne
    // s'executait JAMAIS (creneaux orphelins au calendrier), en plus de faire
    // repondre 0 partout dans le decompte.
    const [jobsRes, dealsRes, invoicesRes, quotesRes] = await Promise.all([
      admin.from('jobs').update({ deleted_at: now }).eq('client_id', clientId).eq('org_id', clientOrgId).is('deleted_at', null).select('id'),
      admin.from('pipeline_deals').update({ deleted_at: now, updated_at: now }).eq('client_id', clientId).eq('org_id', clientOrgId).is('deleted_at', null).select('id'),
      admin.from('invoices').update({ deleted_at: now }).eq('client_id', clientId).eq('org_id', clientOrgId).is('deleted_at', null).select('id'),
      admin.from('quotes').update({ deleted_at: now, updated_at: now }).eq('client_id', clientId).eq('org_id', clientOrgId).is('deleted_at', null).select('id'),
    ]);

    // Le client est déjà supprimé : une cascade ratée laisse des jobs/factures
    // orphelins visibles, mais rejouer la route répondrait 404. On trace.
    const logCascade = (label: string, err: { message: string } | null) => {
      if (err) console.error(`[clients/soft-delete] ${label} cascade failed:`, { clientId, orgId: clientOrgId, error: err.message });
    };
    logCascade('jobs', jobsRes.error);
    logCascade('pipeline_deals', dealsRes.error);
    logCascade('invoices', invoicesRes.error);
    logCascade('quotes', quotesRes.error);

    // Cascade: schedule events (if any deleted jobs) + tag cleanup — parallel
    const deletedJobIds = (jobsRes.data ?? []).map((j: any) => j.id).filter(Boolean);
    const cleanupTasks: Promise<unknown>[] = [
      Promise.resolve(admin.from('client_tags').delete().eq('client_id', clientId)),
    ];
    if (deletedJobIds.length > 0) {
      cleanupTasks.push(
        Promise.resolve(
          admin
            .from('schedule_events')
            .update({ deleted_at: now })
            .in('job_id', deletedJobIds)
            .eq('org_id', clientOrgId)
            .is('deleted_at', null)
        )
      );
    }
    const cleanupResults = await Promise.all(cleanupTasks);
    for (const result of cleanupResults) {
      const cleanupErr = (result as any)?.error;
      if (cleanupErr) console.error('[clients/soft-delete] cleanup failed:', { clientId, orgId: clientOrgId, error: cleanupErr.message });
    }

    return res.status(200).json({
      ok: true,
      client: 1,
      jobs: (jobsRes.data ?? []).length,
      leads: 0,
      pipeline_deals: (dealsRes.data ?? []).length,
      other_rows: (invoicesRes.data ?? []).length + (quotesRes.data ?? []).length,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to delete client.', '[clients/soft-delete]');
  }
});

router.post('/invoices/from-job', validate(invoiceFromJobSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const requestedOrgId = parseOrgId(req.body?.orgId) || auth.orgId;
    const jobId = String(req.body?.jobId || '').trim();
    const milestoneId = String(req.body?.milestoneId || '').trim() || null;
    const visitId = String(req.body?.visitId || '').trim() || null;
    const sendNow = Boolean(req.body?.sendNow);

    if (!jobId) {
      return res.status(400).json({ error: 'Missing jobId.' });
    }

    const member = await isOrgMember(auth.client, auth.user.id, requestedOrgId);
    if (!member) return res.status(403).json({ error: 'Forbidden for this organization.' });

    // Per-visit invoices (billing_mode = per_visit) are triggered by the person
    // completing the visit in the field — membership is enough, the RPC computes
    // the amount itself. Milestone/full-job invoices stay owner/admin only.
    if (!visitId) {
      const canManage = await isOrgAdminOrOwner(auth.client, auth.user.id, requestedOrgId);
      if (!canManage) {
        return res.status(403).json({ error: 'Only owner/admin can create an invoice from a job.' });
      }
    }

    // With a milestoneId, the invoice covers a single payment-schedule
    // milestone (billing split); with a visitId, the invoice covers one
    // completed visit (per-visit billing) — otherwise the whole job.
    const { data, error } = visitId
      ? await auth.client.rpc('create_invoice_from_visit', {
          p_org_id: requestedOrgId,
          p_job_id: jobId,
          p_visit_id: visitId,
          p_send_now: sendNow,
        })
      : milestoneId
        ? await auth.client.rpc('create_invoice_from_milestone', {
            p_org_id: requestedOrgId,
            p_job_id: jobId,
            p_milestone_id: milestoneId,
            p_send_now: sendNow,
          })
        : await auth.client.rpc('create_invoice_from_job', {
            p_org_id: requestedOrgId,
            p_job_id: jobId,
            p_send_now: sendNow,
          });
    if (error) throw error;

    const payload = Array.isArray(data) ? data[0] : data;
    const invoiceId = String((payload as any)?.invoice_id || '').trim();
    const alreadyExists = Boolean((payload as any)?.already_exists);
    const status = String((payload as any)?.status || '').trim() || (sendNow ? 'sent' : 'draft');

    // Visite sans services (plan personnalisé, poids nul) : la RPC saute la
    // facture — on relaie tel quel pour que le client n'affiche pas d'erreur.
    if ((payload as any)?.skipped) {
      return res.json({ skipped: true, already_exists: false, status: 'skipped' });
    }

    if (!invoiceId) {
      return res.status(500).json({ error: 'Invoice creation succeeded but invoice_id is missing.' });
    }

    const { data: invoiceRow, error: invoiceError } = await auth.client
      .from('invoices')
      .select('id,invoice_number,status,client_id,job_id,total_cents,balance_cents,currency,updated_at')
      .eq('id', invoiceId)
      .maybeSingle();
    if (invoiceError) throw invoiceError;

    if (!alreadyExists) {
      dispatchWebhook(requestedOrgId, 'invoice.created', {
        invoice_id: invoiceId,
        job_id: jobId,
        status,
        client_id: (invoiceRow as any)?.client_id || null,
        invoice_number: (invoiceRow as any)?.invoice_number || null,
        total_cents: (invoiceRow as any)?.total_cents || null,
        currency: (invoiceRow as any)?.currency || null,
      }).catch((err) => console.error('[webhooks] invoice.created failed:', err?.message));
      if (sendNow) {
        dispatchWebhook(requestedOrgId, 'invoice.sent', {
          invoice_id: invoiceId,
          job_id: jobId,
          client_id: (invoiceRow as any)?.client_id || null,
        }).catch((err) => console.error('[webhooks] invoice.sent failed:', err?.message));
      }
    }

    // « Se faire payer automatiquement » (jobs.auto_charge) : la facture vient
    // d'être émise → tenter le charge hors-session sur la carte au dossier du
    // client. Best-effort : sans carte (ou migration pending), la facture
    // reste simplement payable par le lien public.
    let cardCharge: { attempted: boolean; ok?: boolean; status?: string } = { attempted: false };
    if (!alreadyExists && sendNow) {
      try {
        const admin = getServiceClient();
        const { data: jobRow } = await admin
          .from('jobs')
          .select('*')
          .eq('id', jobId)
          .maybeSingle();
        if ((jobRow as any)?.auto_charge) {
          const result = await chargeInvoiceOnFile({ orgId: requestedOrgId, invoiceId });
          cardCharge = { attempted: true, ok: result.ok, status: result.status };
          if (!result.ok && result.status !== 'no_card_on_file') {
            console.error('[invoices/from-job] auto-charge failed:', result.status, result.reason);
          }
        }
      } catch (chargeErr: any) {
        console.error('[invoices/from-job] auto-charge error:', chargeErr?.message);
        cardCharge = { attempted: true, ok: false, status: 'error' };
      }
    }

    return res.json({
      invoice: invoiceRow || { id: invoiceId, status },
      invoice_id: invoiceId,
      already_exists: alreadyExists,
      status,
      card_charge: cardCharge,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to create invoice from job.', '[invoices/from-job]');
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

    // Get current lead (a client with status='lead')
    const { data: lead, error: fetchError } = await auth.client
      .from('clients')
      .select('id, lead_status, org_id')
      .eq('id', leadId)
      .eq('org_id', requestedOrgId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!lead) return res.status(404).json({ error: 'Lead not found.' });

    const oldStatus = lead.lead_status;
    if (oldStatus === newStatus) {
      return res.json({ ok: true, status: newStatus, changed: false });
    }

    // Update the funnel status on the client
    const updatePayload: Record<string, any> = { lead_status: newStatus };

    const { data: updated, error: updateError } = await auth.client
      .from('clients')
      .update(updatePayload)
      .eq('id', leadId)
      .select('*')
      .single();
    if (updateError) throw updateError;

    // When the lead is won/closed, promote it to an active client
    if (newStatus === 'closed' || newStatus === 'closed_won') {
      await promoteClientFromLead(getServiceClient(), leadId);
    }

    // Sync pipeline deal stage (status and stage use the same slugs).
    // Le statut du lead est déjà écrit ; si la carte ne suit pas, le kanban et
    // la fiche divergent silencieusement — au minimum, ça se journalise.
    const { error: stageErr } = await auth.client
      .from('pipeline_deals')
      .update({ stage: newStatus })
      .eq('lead_id', leadId)
      .is('deleted_at', null);
    if (stageErr) console.error('[leads/update-status] pipeline stage sync failed:', { leadId, newStatus, error: stageErr.message });

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
    return sendSafeError(res, error, 'Unable to update lead status.', '[leads/update-status]');
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

    // Get lead (a client with status='lead')
    const { data: lead, error: leadError } = await auth.client
      .from('clients')
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

    // Mark lead as converted: promote the client to active.
    // Le job est créé : on ne renvoie pas d'erreur (l'utilisateur relancerait
    // et créerait un job en double), mais un lead resté ouvert après une
    // conversion réussie doit apparaître dans les journaux.
    const { error: promoteErr } = await auth.client
      .from('clients')
      .update({
        status: 'active',
        lead_status: 'closed_won',
        updated_at: new Date().toISOString(),
      })
      .eq('id', leadId);
    if (promoteErr) console.error('[leads/convert-to-job] lead status stamp failed:', { leadId, jobId: job.id, error: promoteErr.message });

    // Update pipeline deal
    const { error: dealErr } = await auth.client
      .from('pipeline_deals')
      .update({ stage: 'closed_won', won_at: new Date().toISOString(), job_id: job.id })
      .eq('lead_id', leadId)
      .is('deleted_at', null);
    if (dealErr) console.error('[leads/convert-to-job] pipeline deal close failed:', { leadId, jobId: job.id, error: dealErr.message });

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
    const { error: notifErr } = await auth.client.from('notifications').insert({
      org_id: requestedOrgId,
      type: 'success',
      title: 'Lead converted to job',
      body: `${leadName} — ${job.title}`,
      reference_id: job.id,
    });
    if (notifErr) console.error('[leads/convert-to-job] notification insert failed:', { leadId, jobId: job.id, error: notifErr.message });

    return res.json({
      ok: true,
      lead_id: leadId,
      client_id: clientId,
      job_id: job.id,
      job_title: job.title,
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to convert lead.', '[leads/convert-to-job]');
  }
});

// ── Resolve client for lead (creates one if missing) ─────────

router.post('/leads/resolve-client', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const leadId = String(req.body?.leadId || '').trim();
    if (!leadId) return res.status(400).json({ error: 'leadId is required.' });

    // Verify the lead/client belongs to the caller's org before resolving —
    // resolveClientIdForLead() looks it up by id with no org scope.
    const svc = getServiceClient();
    const { data: leadRow } = await svc.from('clients')
      .select('id').eq('id', leadId).eq('org_id', auth.orgId).maybeSingle();
    if (!leadRow) return res.status(404).json({ error: 'Lead not found.' });

    const clientId = await resolveClientIdForLead(svc, leadId);
    return res.json({ ok: true, clientId });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to resolve client.', '[leads/resolve-client]');
  }
});

export default router;
