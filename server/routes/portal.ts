/* Client Portal API — public endpoint for clients to view their data */

import { Router } from 'express';
import { getServiceClient } from '../lib/supabase';

const router = Router();

// GET /api/portal/:token — fetch client portal data (public, no auth)
router.get('/portal/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token || token.length < 20) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    const serviceClient = getServiceClient();

    // Find client by portal_token (stored in clients table)
    const { data: client, error: clientErr } = await serviceClient
      .from('clients')
      .select('id, first_name, last_name, company, email, org_id')
      .eq('portal_token', token)
      .is('deleted_at', null)
      .maybeSingle();

    if (clientErr || !client) {
      return res.status(404).json({ error: 'Portal not found' });
    }

    // Fetch company info
    const { data: company } = await serviceClient
      .from('company_settings')
      .select('company_name, logo_url, phone')
      .eq('org_id', client.org_id)
      .maybeSingle();

    // Fetch invoices for this client
    const { data: invoices } = await serviceClient
      .from('invoices')
      .select('id, invoice_number, status, total_cents, balance_cents, due_date, subject, view_token')
      .eq('client_id', client.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50);

    // Fetch quotes for this client
    const { data: quotes } = await serviceClient
      .from('quotes')
      .select('id, quote_number, title, status, total_cents, currency, valid_until, view_token')
      .eq('client_id', client.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50);

    // Fetch active jobs for this client
    const { data: jobs } = await serviceClient
      .from('jobs')
      .select('id, title, status, scheduled_at')
      .eq('client_id', client.id)
      .is('deleted_at', null)
      .not('status', 'in', '("cancelled","archived")')
      .order('scheduled_at', { ascending: false, nullsFirst: false })
      .limit(20);

    return res.json({
      client: {
        id: client.id,
        first_name: client.first_name,
        last_name: client.last_name,
        company: client.company,
        email: client.email,
      },
      company: {
        company_name: company?.company_name || 'Business',
        company_logo_url: company?.logo_url || null,
        company_phone: company?.phone || null,
      },
      invoices: (invoices || []).map((inv: any) => ({
        id: inv.id,
        invoice_number: inv.invoice_number || '',
        status: inv.status || 'draft',
        total_cents: Number(inv.total_cents || 0),
        balance_cents: Number(inv.balance_cents || 0),
        due_date: inv.due_date,
        subject: inv.subject,
        view_token: inv.view_token,
      })),
      quotes: (quotes || []).map((q: any) => ({
        id: q.id,
        quote_number: q.quote_number || '',
        title: q.title || '',
        status: q.status || 'draft',
        total_cents: Number(q.total_cents || 0),
        currency: q.currency || 'CAD',
        valid_until: q.valid_until,
        view_token: q.view_token,
      })),
      jobs: (jobs || []).map((j: any) => ({
        id: j.id,
        title: j.title || '',
        status: j.status || 'pending',
        scheduled_at: j.scheduled_at,
      })),
    });
  } catch (error: any) {
    console.error('Portal API error:', error);
    return res.status(500).json({ error: 'Failed to load portal' });
  }
});

export default router;
