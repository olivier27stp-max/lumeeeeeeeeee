/* ═══════════════════════════════════════════════════════════════
   /api/quickbooks/sync — état et réglages de la synchro QuickBooks.
   Propriétaire / admin seulement : c'est la comptabilité du bureau.
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { requireRole } from '../lib/rbac';
import { getServiceClient } from '../lib/supabase';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { QboError, qboContext, qboQuery } from '../lib/quickbooks/api';
import { isMissingSchema, listTaxCodes, loadSettings, runQuickBooksSync } from '../lib/quickbooks/sync';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

const adminOnly = requireRole('owner', 'admin');

function orgOf(req: any): string {
  return String(req.userContext?.orgId || req.userContext?.org_id || '');
}

function fail(res: any, err: unknown) {
  if (err && typeof err === 'object' && isMissingSchema(err as any)) {
    res.status(503).json({ error: 'migration_pending', message: 'Synchro QuickBooks pas encore activée sur le serveur.' });
    return;
  }
  const status = err instanceof QboError && err.auth ? 409 : 500;
  res.status(status).json({ error: err instanceof Error ? err.message : 'Erreur interne' });
}

// ── État : réglages, compteurs, derniers envois ────────────────
router.get('/quickbooks/sync/status', adminOnly, async (req, res) => {
  try {
    const orgId = orgOf(req);
    const db = getServiceClient();
    const settings = await loadSettings(db, orgId);

    const count = async (status: string, sinceMs?: number) => {
      let q = db.from('quickbooks_sync_queue').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', status);
      if (sinceMs) q = q.gte('updated_at', new Date(Date.now() - sinceMs).toISOString());
      const { count: n, error } = await q;
      if (error) throw error;
      return n ?? 0;
    };
    const [pending, errors, done24h] = await Promise.all([
      count('pending'),
      count('error'),
      count('done', 24 * 3600_000),
    ]);

    const { data: recent, error: recentErr } = await db
      .from('quickbooks_sync_queue')
      .select('id, entity_type, entity_id, status, last_error, attempts, updated_at')
      .eq('org_id', orgId)
      .in('status', ['error', 'done', 'pending', 'skipped'])
      .order('updated_at', { ascending: false })
      .limit(30);
    if (recentErr) throw recentErr;

    // Libellés lisibles : numéro de facture, client.
    const rows = recent || [];
    const invoiceIds = rows.filter((r) => r.entity_type === 'invoice').map((r) => r.entity_id);
    const paymentIds = rows.filter((r) => r.entity_type === 'payment').map((r) => r.entity_id);
    const clientIds = rows.filter((r) => r.entity_type === 'client').map((r) => r.entity_id);
    const [invs, pays, clis] = await Promise.all([
      invoiceIds.length
        ? db.from('invoices').select('id, invoice_number').in('id', invoiceIds)
        : Promise.resolve({ data: [] as any[] }),
      paymentIds.length
        ? db.from('payments').select('id, amount_cents, invoice_id, invoices(invoice_number)').in('id', paymentIds)
        : Promise.resolve({ data: [] as any[] }),
      clientIds.length
        ? db.from('clients').select('id, first_name, last_name, company').in('id', clientIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const label = new Map<string, string>();
    for (const i of invs.data || []) label.set(i.id, `Facture #${i.invoice_number ?? ''}`);
    for (const p of pays.data || []) {
      const num = (p as any).invoices?.invoice_number;
      label.set(p.id, `Paiement ${((Number(p.amount_cents) || 0) / 100).toFixed(2)} $${num ? ` — facture #${num}` : ''}`);
    }
    for (const c of clis.data || []) {
      label.set(c.id, c.company || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Client');
    }

    res.json({
      settings,
      counts: { pending, errors, done24h },
      recent: rows.map((r) => ({ ...r, label: label.get(r.entity_id) || null })),
    });
  } catch (err) {
    fail(res, err);
  }
});

// ── Listes QuickBooks pour les menus des réglages ──────────────
router.get('/quickbooks/sync/options', adminOnly, async (req, res) => {
  try {
    const orgId = orgOf(req);
    const ctx = await qboContext(orgId);
    const [items, accounts, paymentMethods, taxCodes] = await Promise.all([
      qboQuery<any>(orgId, 'Item', 'Active = true'),
      qboQuery<any>(orgId, 'Account', 'Active = true'),
      qboQuery<any>(orgId, 'PaymentMethod', 'Active = true'),
      listTaxCodes(ctx).catch(() => []),
    ]);
    res.json({
      items: items
        .filter((i) => ['Service', 'NonInventory'].includes(i.Type))
        .map((i) => ({ id: String(i.Id), name: String(i.FullyQualifiedName || i.Name) })),
      // Dépôt d'un paiement : banque ou actif à court terme (fonds non déposés, compte d'attente Stripe…).
      depositAccounts: accounts
        .filter((a) => ['Bank', 'Other Current Asset'].includes(a.AccountType))
        .map((a) => ({ id: String(a.Id), name: String(a.FullyQualifiedName || a.Name), type: a.AccountType })),
      paymentMethods: paymentMethods.map((p) => ({ id: String(p.Id), name: String(p.Name) })),
      taxCodes,
    });
  } catch (err) {
    fail(res, err);
  }
});

// ── Réglages ───────────────────────────────────────────────────
const TEXT_FIELDS = [
  'item_id',
  'item_name',
  'deposit_account_id',
  'deposit_account_name',
  'deposit_account_online_id',
  'deposit_account_online_name',
  'tax_code_taxable_id',
  'tax_code_exempt_id',
] as const;
const METHOD_KEYS = ['card', 'cash', 'check', 'e-transfer', 'paypal', 'bank'];

router.put('/quickbooks/sync/settings', adminOnly, async (req, res) => {
  try {
    const orgId = orgOf(req);
    const db = getServiceClient();
    await loadSettings(db, orgId);
    const body = req.body || {};
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    for (const f of TEXT_FIELDS) {
      if (f in body) {
        const v = body[f];
        patch[f] = typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null;
      }
    }
    if (body.payment_methods && typeof body.payment_methods === 'object') {
      const pm: Record<string, { id: string; name: string }> = {};
      for (const k of METHOD_KEYS) {
        const v = body.payment_methods[k];
        if (v && typeof v.id === 'string' && v.id.trim()) {
          pm[k] = { id: v.id.trim().slice(0, 50), name: String(v.name || '').slice(0, 100) };
        }
      }
      patch.payment_methods = pm;
    }

    const { data, error } = await db
      .from('quickbooks_settings')
      .update(patch)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    res.json({ settings: data });
  } catch (err) {
    fail(res, err);
  }
});

// ── Envoi de l'historique depuis une date ──────────────────────
router.post('/quickbooks/sync/history', adminOnly, async (req, res) => {
  try {
    const orgId = orgOf(req);
    const from = String(req.body?.from || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      res.status(400).json({ error: 'Date de départ invalide (AAAA-MM-JJ).' });
      return;
    }
    const db = getServiceClient();
    await loadSettings(db, orgId);
    const { data, error } = await db.rpc('quickbooks_enqueue_history', {
      p_org: orgId,
      p_from: new Date(`${from}T00:00:00-05:00`).toISOString(),
    });
    if (error) throw error;
    void runQuickBooksSync(db).catch(() => {});
    res.json({ queued: Number(data) || 0 });
  } catch (err) {
    fail(res, err);
  }
});

// ── Relancer les envois en erreur ──────────────────────────────
router.post('/quickbooks/sync/retry', adminOnly, async (req, res) => {
  try {
    const orgId = orgOf(req);
    const db = getServiceClient();
    let q = db.from('quickbooks_sync_queue').select('id').eq('org_id', orgId).eq('status', 'error');
    if (typeof req.body?.id === 'string') q = q.eq('id', req.body.id);
    const { data, error } = await q.limit(500);
    if (error) throw error;

    let retried = 0;
    for (const row of data || []) {
      const { error: upErr } = await db
        .from('quickbooks_sync_queue')
        .update({ status: 'pending', attempts: 0, next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', row.id);
      // Déjà une modification en attente pour la même entité : elle suffit.
      if (upErr?.code === '23505') {
        await db.from('quickbooks_sync_queue').update({ status: 'superseded' }).eq('id', row.id);
      } else if (upErr) {
        throw upErr;
      } else {
        retried++;
      }
    }
    void runQuickBooksSync(db).catch(() => {});
    res.json({ retried });
  } catch (err) {
    fail(res, err);
  }
});

// ── Synchroniser maintenant ────────────────────────────────────
router.post('/quickbooks/sync/run', adminOnly, async (_req, res) => {
  try {
    const result = await runQuickBooksSync(getServiceClient());
    res.json(result);
  } catch (err) {
    fail(res, err);
  }
});

export default router;
