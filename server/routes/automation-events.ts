/* ═══════════════════════════════════════════════════════════════
   Routes — Automation Event Hooks

   These endpoints allow the frontend to notify the automation
   engine when events happen that are managed client-side
   (appointments, job status changes, etc.) and therefore
   can't emit server-side events on their own.

   The frontend calls these AFTER performing the Supabase
   operation successfully, purely to trigger automation rules.
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { eventBus } from '../lib/eventBus';
import { validate, automationEventSchema } from '../lib/validation';

const router = Router();

// ── POST /automations/events/appointment-created ──
// Called after a schedule_event is created
router.post('/automations/events/appointment-created', validate(automationEventSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { eventId, jobId, clientId, startTime, title, address } = req.body;
    if (!eventId) return res.status(400).json({ error: 'eventId is required' });

    // Fetch details for variable resolution
    const admin = getServiceClient();
    let clientName = '';
    let clientEmail = '';
    let clientPhone = '';
    let jobName = '';

    if (jobId && auth.orgId) {
      const { data: job } = await admin
        .from('jobs')
        .select('title, client_id')
        .eq('id', jobId)
        .eq('org_id', auth.orgId)
        .maybeSingle();
      if (job) {
        jobName = job.title || '';
        const cid = clientId || job.client_id;
        if (cid) {
          const { data: client } = await admin
            .from('clients')
            .select('first_name, last_name, email, phone')
            .eq('id', cid)
            .eq('org_id', auth.orgId)
            .maybeSingle();
          if (client) {
            clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim();
            clientEmail = client.email || '';
            clientPhone = client.phone || '';
          }
        }
      }
    }

    await eventBus.emit('appointment.created', {
      orgId: auth.orgId,
      entityType: 'schedule_event',
      entityId: eventId,
      actorId: auth.user.id,
      metadata: {
        job_id: jobId || null,
        client_id: clientId || null,
        start_time: startTime || null,
        title: title || jobName || '',
        address: address || '',
        client_name: clientName,
        client_email: clientEmail,
        client_phone: clientPhone,
        job_name: jobName,
      },
      relatedEntityType: jobId ? 'job' : undefined,
      relatedEntityId: jobId || undefined,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[automation-events] appointment.created error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /automations/events/appointment-cancelled ──
// Called after a schedule_event is deleted/cancelled
router.post('/automations/events/appointment-cancelled', validate(automationEventSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { eventId, jobId, clientId } = req.body;
    if (!eventId) return res.status(400).json({ error: 'eventId is required' });

    await eventBus.emit('appointment.cancelled', {
      orgId: auth.orgId,
      entityType: 'schedule_event',
      entityId: eventId,
      actorId: auth.user.id,
      metadata: {
        job_id: jobId || null,
        client_id: clientId || null,
      },
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[automation-events] appointment.cancelled error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /automations/events/job-completed ──
// Called when a job status is changed to "completed"
router.post('/automations/events/job-completed', validate(automationEventSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { jobId } = req.body;
    if (!jobId) return res.status(400).json({ error: 'jobId is required' });

    // Fetch job + client details for variable resolution
    const admin = getServiceClient();
    const { data: job } = await admin
      .from('jobs')
      .select('title, client_id, status')
      .eq('id', jobId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    if (!job) return res.status(404).json({ error: 'Job not found' });

    let clientName = '';
    let clientEmail = '';
    let clientPhone = '';

    if (job.client_id) {
      const { data: client } = await admin
        .from('clients')
        .select('first_name, last_name, email, phone')
        .eq('id', job.client_id)
        .eq('org_id', auth.orgId)
        .maybeSingle();
      if (client) {
        clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim();
        clientEmail = client.email || '';
        clientPhone = client.phone || '';
      }
    }

    // Check if actor is a technician — if so, emit job.ready_for_invoicing
    // and notify owner/admin for invoicing instead of auto-invoicing
    const userCtx = req.userContext;
    const isTechnician = userCtx?.role === 'technician';

    await eventBus.emit('job.completed', {
      orgId: auth.orgId,
      entityType: 'job',
      entityId: jobId,
      actorId: auth.user.id,
      metadata: {
        job_name: job.title || '',
        client_id: job.client_id || null,
        client_name: clientName,
        client_email: clientEmail,
        client_phone: clientPhone,
        completed_by_technician: isTechnician,
      },
    });

    // When a technician completes a job, emit a separate event for invoicing
    // and create a notification for owner/admin to handle the invoice
    if (isTechnician) {
      await eventBus.emit('job.ready_for_invoicing', {
        orgId: auth.orgId,
        entityType: 'job',
        entityId: jobId,
        actorId: auth.user.id,
        metadata: {
          job_name: job.title || '',
          client_id: job.client_id || null,
          client_name: clientName,
          client_email: clientEmail,
          client_phone: clientPhone,
          technician_id: auth.user.id,
        },
      });

      // Create notification for all owner/admin members
      try {
        const { data: admins } = await admin
          .from('memberships')
          .select('user_id')
          .eq('org_id', auth.orgId)
          .eq('status', 'active')
          .in('role', ['owner', 'admin']);

        if (admins && admins.length > 0) {
          const notifications = admins.map((m: { user_id: string }) => ({
            org_id: auth.orgId,
            user_id: m.user_id,
            type: 'job_ready_for_invoicing',
            title: `Job ready for invoicing: ${job.title || 'Untitled'}`,
            body: `${clientName || 'A job'} has been completed by a technician and is ready for invoicing.`,
            entity_type: 'job',
            entity_id: jobId,
            read: false,
          }));
          await admin.from('notifications').insert(notifications);
        }
      } catch (notifErr: any) {
        console.error('[automation-events] notification insert failed:', notifErr.message);
      }
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[automation-events] job.completed error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /automations/events/deal-stage-changed ──
router.post('/automations/events/deal-stage-changed', validate(automationEventSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;

    const { dealId, leadId, jobId, oldStage, newStage } = req.body;
    if (!dealId) return res.status(400).json({ error: 'dealId is required' });

    const admin = getServiceClient();
    let clientName = '';
    let clientEmail = '';
    let clientPhone = '';
    let leadName = '';

    if (leadId && auth.orgId) {
      const { data: lead } = await admin
        .from('leads').select('first_name, last_name, email, phone, client_id')
        .eq('id', leadId).eq('org_id', auth.orgId).maybeSingle();
      if (lead) {
        leadName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim();
        clientEmail = lead.email || '';
        clientPhone = lead.phone || '';
        if (lead.client_id) {
          const { data: client } = await admin
            .from('clients').select('first_name, last_name, email, phone')
            .eq('id', lead.client_id).eq('org_id', auth.orgId).maybeSingle();
          if (client) {
            clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim();
            clientEmail = client.email || clientEmail;
            clientPhone = client.phone || clientPhone;
          }
        }
      }
    }

    await eventBus.emit('pipeline_deal.stage_changed', {
      orgId: auth.orgId,
      entityType: 'pipeline_deal',
      entityId: dealId,
      actorId: auth.user.id,
      relatedEntityType: leadId ? 'lead' : undefined,
      relatedEntityId: leadId || undefined,
      metadata: {
        old_stage: oldStage || null,
        new_stage: newStage || null,
        lead_id: leadId || null,
        job_id: jobId || null,
        lead_name: leadName || clientName,
        client_name: clientName,
        client_email: clientEmail,
        client_phone: clientPhone,
      },
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[automation-events] deal.stage_changed error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /automations/events/quote-sent ──
router.post('/automations/events/quote-sent', validate(automationEventSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { quoteId, leadId, channel } = req.body;

    await eventBus.emit('quote.sent', {
      orgId: auth.orgId,
      entityType: 'quote',
      entityId: quoteId || '',
      actorId: auth.user.id,
      metadata: { lead_id: leadId || null, channel: channel || 'email' },
    });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /automations/events/quote-approved ──
router.post('/automations/events/quote-approved', validate(automationEventSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { quoteId, leadId } = req.body;

    await eventBus.emit('quote.approved', {
      orgId: auth.orgId,
      entityType: 'quote',
      entityId: quoteId || '',
      actorId: auth.user.id,
      metadata: { lead_id: leadId || null },
    });
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /automations/events/invoice-paid ──
// Called when an invoice is manually marked as paid
router.post('/automations/events/invoice-paid', validate(automationEventSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { invoiceId, clientId } = req.body;
    if (!invoiceId) return res.status(400).json({ error: 'invoiceId is required' });

    const admin = getServiceClient();
    const { data: inv } = await admin
      .from('invoices')
      .select('invoice_number, client_id, job_id, total_cents')
      .eq('id', invoiceId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    let clientName = '';
    let clientEmail = '';
    let clientPhone = '';
    const cid = clientId || inv?.client_id;
    if (cid) {
      const { data: client } = await admin
        .from('clients')
        .select('first_name, last_name, email, phone')
        .eq('id', cid)
        .eq('org_id', auth.orgId)
        .maybeSingle();
      if (client) {
        clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim();
        clientEmail = client.email || '';
        clientPhone = client.phone || '';
      }
    }

    await eventBus.emit('invoice.paid', {
      orgId: auth.orgId,
      entityType: 'invoice',
      entityId: invoiceId,
      actorId: auth.user.id,
      metadata: {
        invoice_number: inv?.invoice_number || '',
        client_id: cid || null,
        client_name: clientName,
        client_email: clientEmail,
        client_phone: clientPhone,
        total_cents: inv?.total_cents || 0,
      },
    });
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[automation-events] invoice.paid error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /automations/events/lead-created ──
router.post('/automations/events/lead-created', validate(automationEventSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { leadId } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId is required' });

    const admin = getServiceClient();
    const { data: lead } = await admin
      .from('leads')
      .select('first_name, last_name, email, phone, status')
      .eq('id', leadId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    await eventBus.emit('lead.created', {
      orgId: auth.orgId,
      entityType: 'lead',
      entityId: leadId,
      actorId: auth.user.id,
      metadata: {
        lead_name: lead ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() : '',
        email: lead?.email || '',
        phone: lead?.phone || '',
        status: lead?.status || 'new',
      },
    });
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[automation-events] lead.created error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /automations/events/lead-status-changed ──
router.post('/automations/events/lead-status-changed', validate(automationEventSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { leadId, oldStatus, newStatus } = req.body;
    if (!leadId) return res.status(400).json({ error: 'leadId is required' });

    const admin = getServiceClient();
    const { data: lead } = await admin
      .from('leads')
      .select('first_name, last_name, email, phone')
      .eq('id', leadId)
      .eq('org_id', auth.orgId)
      .maybeSingle();

    await eventBus.emit('lead.status_changed', {
      orgId: auth.orgId,
      entityType: 'lead',
      entityId: leadId,
      actorId: auth.user.id,
      metadata: {
        old_status: oldStatus || null,
        new_status: newStatus || null,
        lead_name: lead ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() : '',
        email: lead?.email || '',
        phone: lead?.phone || '',
      },
    });
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('[automation-events] lead.status_changed error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
