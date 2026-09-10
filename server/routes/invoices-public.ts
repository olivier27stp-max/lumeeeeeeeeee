/**
 * invoices-public.ts — le visualiseur public de facture.
 *
 * Audit QA prod du 2026-09-09, constat n°1 (prouvé en prod) : le bouton
 * « Link » d'une facture copiait /q/<view_token>, la redirection envoyait
 * vers /quote/<token>, et QuoteView demandait /api/quotes/public/<token> —
 * qui cherche dans `quotes`. Un jeton de facture n'y est jamais : « Quote Not
 * Found » pour TOUTES les factures. Et la facture passait quand même à
 * « vue par le client », donc l'entreprise ne relançait pas.
 *
 * Il n'existait aucune route publique de facture. La voici, sur le modèle
 * exact de /quotes/public/:token. Le suivi de vue (is_viewed, view_count,
 * quote_views) se fait ICI, quand la page a réellement résolu la facture —
 * plus jamais sur une redirection qui peut finir en 404.
 *
 * Seuls les champs utiles au client sont renvoyés : ni org_id, ni notes
 * internes, ni coûts.
 */
import { Router } from 'express';
import { getServiceClient } from '../lib/supabase';
import { getCompanyBranding } from '../lib/companyBranding';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FactureVue = {
  id: string; org_id: string; client_id: string | null; invoice_number: string;
  is_viewed: boolean | null; view_count: number | null;
};

/**
 * Compteurs de vue + journal + notification « ouvert » à la première vue.
 * Vivait dans la redirection /q/:token, qui comptait une vue même quand la
 * page finissait en 404. Appelé maintenant depuis la route qui SERT la facture.
 */
export async function enregistrerVueFacture(admin: ReturnType<typeof getServiceClient>, invoice: FactureVue, req: { ip?: string; headers: Record<string, unknown> }): Promise<void> {
  const premiereVue = !invoice.is_viewed;
  const now = new Date().toISOString();
  const taches: Promise<unknown>[] = [
    Promise.resolve(
      admin
        .from('invoices')
        .update({
          is_viewed: true,
          viewed_at: premiereVue ? now : undefined,
          view_count: (invoice.view_count || 0) + 1,
          last_viewed_at: now,
        })
        .eq('id', invoice.id),
    ),
    Promise.resolve(
      admin.from('quote_views').insert({
        invoice_id: invoice.id,
        client_id: invoice.client_id,
        ip_address: req.ip || (req.headers['x-forwarded-for'] as string | undefined) || null,
        user_agent: (req.headers['user-agent'] as string | undefined) || null,
      }),
    ),
  ];
  if (premiereVue) {
    taches.push((async () => {
      let clientName = 'Client';
      if (invoice.client_id) {
        const { data: client } = await admin
          .from('clients')
          .select('first_name, last_name')
          .eq('id', invoice.client_id)
          .is('deleted_at', null)
          .maybeSingle();
        if (client) clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim() || 'Client';
      }
      await admin.from('notifications').insert({
        org_id: invoice.org_id,
        type: 'quote_opened',
        title: `${clientName} opened invoice ${invoice.invoice_number}`,
        body: `${clientName} has viewed their invoice for the first time.`,
        icon: 'eye',
        link: `/invoices/${invoice.id}`,
        reference_id: invoice.id,
      });
    })());
  }
  try {
    const resultats = await Promise.all(taches);
    for (const r of resultats) {
      const err = (r as { error?: { message?: string } } | null)?.error;
      if (err) console.error('[invoices/public] suivi de vue non écrit:', err.message);
    }
  } catch (err: any) {
    console.error('[invoices/public] suivi de vue:', err?.message || err);
  }
}

// GET /api/invoices/public/:token — facture vue par le client, sans session.
router.get('/invoices/public/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token || !UUID.test(token)) return res.status(404).json({ error: 'Invoice not found.' });

    const admin = getServiceClient();
    const { data: invoice, error } = await admin
      .from('invoices')
      .select('id, org_id, client_id, invoice_number, status, subject, issued_at, due_date, sent_at, paid_at, subtotal_cents, discount_cents, tax_cents, total_cents, paid_cents, balance_cents, currency, notes, is_viewed, view_count')
      .eq('view_token', token)
      .is('deleted_at', null)
      .maybeSingle();
    if (error || !invoice) return res.status(404).json({ error: 'Invoice not found.' });

    const [company, itemsRes, clientRes, payReqRes] = await Promise.all([
      getCompanyBranding(
        admin,
        invoice.org_id,
        'company_name, logo_url, phone, email, website, street1, city, province, postal_code, country, brand_color',
      ),
      admin
        .from('invoice_items')
        .select('id, title, description, qty, unit_price_cents, line_total_cents, sort_order')
        .eq('invoice_id', invoice.id)
        .is('deleted_at', null)
        .order('sort_order', { ascending: true }),
      invoice.client_id
        ? admin
            .from('clients')
            .select('first_name, last_name, company, email, phone')
            .eq('id', invoice.client_id)
            .is('deleted_at', null)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      // Un lien de paiement actif (créé depuis la fiche facture) → bouton Payer.
      admin
        .from('payment_requests')
        .select('public_token, status, expires_at, amount_cents')
        .eq('invoice_id', invoice.id)
        .is('deleted_at', null)
        .in('status', ['pending', 'sent'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const payReq = payReqRes.data as { public_token: string; expires_at: string | null } | null;
    const payTokenActif = payReq && (!payReq.expires_at || new Date(payReq.expires_at) > new Date())
      ? payReq.public_token
      : null;

    // Suivi de vue — après avoir résolu et servi la facture, jamais avant.
    // Tâche de fond : l'affichage ne dépend pas de cette écriture.
    void enregistrerVueFacture(admin, invoice, req);

    const { org_id: _org, client_id: _client, is_viewed: _v, view_count: _vc, ...publique } = invoice as any;
    return res.json({
      invoice: publique,
      items: itemsRes.data ?? [],
      client: clientRes.data ?? null,
      company: company ?? null,
      pay_token: payTokenActif,
    });
  } catch (err: any) {
    console.error('[invoices/public]', err?.message || err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

export default router;
