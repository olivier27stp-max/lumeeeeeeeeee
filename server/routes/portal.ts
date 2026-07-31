/* Client Portal API — public endpoint for clients to view their data */

import { Router } from 'express';
import crypto from 'crypto';
import { getServiceClient } from '../lib/supabase';
import { sendSafeError } from '../lib/error-handler';
import { recordClientActivity } from '../lib/clientActivity';

const router = Router();

// timingSafeCompare() a été retiré (audit 2026-07-31).
//
// Il comparait le jeton fourni au jeton EN CLAIR stocké en base, ce qui
// obligeait à conserver ce clair — précisément ce dont le hachage devait
// protéger. La recherche se fait désormais par `portal_token_hash` : retrouver
// la ligne prouve déjà la validité du jeton, par correspondance exacte SHA-256.
//
// La défense contre les attaques temporelles n'est pas perdue pour autant : un
// index sur le hash répond en temps constant vis-à-vis du contenu du jeton, et
// le délai aléatoire de 50–150 ms sur les échecs est conservé.

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

    // Recherche PAR LE HASH uniquement.
    //
    // Le repli par jeton en clair a été retiré (audit 2026-07-31). Il existait
    // pour la fenêtre de migration, mais 47 clients sur 56 n'avaient jamais reçu
    // leur hash : le repli était donc le chemin NORMAL pour 84 % d'entre eux, et
    // le hachage ne servait à rien. Les hash ont été remplis pour les 56, avec
    // la formule vérifiée contre les 9 qui possédaient déjà les deux valeurs.
    //
    // Retrouver la ligne par son hash PROUVE déjà que le jeton est le bon :
    // c'est une correspondance exacte sur SHA-256. La comparaison en temps
    // constant sur le jeton en clair devient donc inutile — et c'est elle qui
    // empêchait de cesser de stocker le clair.
    const { data: client, error: clientErr } = await serviceClient
      .from('clients')
      .select('id, first_name, last_name, company, display_as_company, email, org_id, portal_token_expires_at, portal_token_revoked_at')
      .eq('portal_token_hash', tokenHash)
      .is('deleted_at', null)
      .maybeSingle();

    // Expiration + révocation. La validité du jeton est acquise par la
    // correspondance de hash ci-dessus.
    const notExpired = !client?.portal_token_expires_at || new Date(client.portal_token_expires_at) > new Date();
    const notRevoked = !client?.portal_token_revoked_at;
    if (clientErr || !client || !notExpired || !notRevoked) {
      await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
      return res.status(404).json({ error: 'Not found' });
    }

    // Client opened their portal link — stamp last activity (fire-and-forget).
    void recordClientActivity(serviceClient, client.id);

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

    // Written agreements (job contracts) — jobs created without a quote. The
    // client can always view their contract, and sign it while pending.
    // (Jobs converted from a quote have no agreement: the quote above IS the
    // approved contract.)
    let agreements: any[] = [];
    try {
      const { data } = await serviceClient
        .from('job_agreements')
        .select('id, job_id, status, require_signature, view_token, signed_at, created_at')
        .eq('client_id', client.id)
        .not('job_id', 'is', null)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(20);
      agreements = data || [];
    } catch { /* migration pending */ }

    return res.json({
      client: {
        id: client.id,
        first_name: client.first_name,
        last_name: client.last_name,
        company: client.company,
        display_as_company: client.display_as_company,
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
      contracts: agreements.map((a: any) => ({
        id: a.id,
        job_id: a.job_id,
        status: a.status || 'draft',
        require_signature: a.require_signature !== false,
        signed_at: a.signed_at,
        view_token: a.view_token,
      })),
    });
  } catch (error: any) {
    return sendSafeError(res, error, 'Failed to load portal', '[portal]');
  }
});

export default router;
