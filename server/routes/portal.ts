/* Client Portal API — public endpoint for clients to view their data */

import { Router } from 'express';
import crypto from 'crypto';
import { getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';

const router = Router();

/**
 * Constant-time string comparison to prevent timing attacks.
 * If an attacker can measure response time differences between
 * valid-prefix vs invalid tokens, they can brute-force tokens.
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// GET /api/portal/:token — fetch client portal data (public, no auth)
router.get('/portal/:token', async (req, res) => {
  try {
    const { token } = req.params;

    // Validate token format: must be 32+ chars, alphanumeric/hex only
    if (!token || token.length < 32 || !/^[a-zA-Z0-9_-]+$/.test(token)) {
      // Add small random delay to prevent timing-based token length guessing
      await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
      return res.status(404).json({ error: 'Not found' });
    }

    const serviceClient = getServiceClient();
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // Prefer hash lookup (new path) — falls back to plaintext during migration window.
    // Both paths then enforce expires_at + revoked_at.
    let { data: client, error: clientErr } = await serviceClient
      .from('clients')
      .select('id, first_name, last_name, company, email, org_id, portal_token, portal_token_hash, portal_token_expires_at, portal_token_revoked_at')
      .eq('portal_token_hash', tokenHash)
      .is('deleted_at', null)
      .maybeSingle();

    if (!client) {
      // Fallback for tokens not yet backfilled to hash
      ({ data: client, error: clientErr } = await serviceClient
        .from('clients')
        .select('id, first_name, last_name, company, email, org_id, portal_token, portal_token_hash, portal_token_expires_at, portal_token_revoked_at')
        .eq('portal_token', token)
        .is('deleted_at', null)
        .maybeSingle());
    }

    // Constant-time compare + expiry + revocation checks
    const tokenOk = client?.portal_token && timingSafeCompare(token, client.portal_token);
    const notExpired = !client?.portal_token_expires_at || new Date(client.portal_token_expires_at) > new Date();
    const notRevoked = !client?.portal_token_revoked_at;
    if (clientErr || !client || !tokenOk || !notExpired || !notRevoked) {
      await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
      return res.status(404).json({ error: 'Not found' });
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
    return sendSafeError(res, error, 'Failed to load portal', '[portal]');
  }
});

export default router;
