/* ═══════════════════════════════════════════════════════════════
   POST /api/invoices/:id/mark-paid — « Marquer payée » (paiement manuel).

   Le navigateur n'a plus le droit d'écrire dans `payments` depuis le
   durcissement 20260730140000 (revoke insert/update/delete from
   authenticated) : l'insertion faite côté client échouait avec
   « permission denied for table payments ». Le serveur vérifie le bureau
   et la permission payments.create, puis écrit avec le rôle service.
   ═══════════════════════════════════════════════════════════════ */

import { Router } from 'express';
import { requireFinancialAccess } from '../lib/rbac';
import { getServiceClient } from '../lib/supabase';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { eventBus } from '../lib/eventBus';
import { commissionsFacturePayee } from '../lib/field-sales/commission-declencheurs';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

const METHODS = new Set(['card', 'e-transfer', 'cash', 'check']);

/** `YYYY-MM-DD` → midi heure de Montréal (le jour ne glisse pas en UTC). */
function dateToIso(date: unknown): string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Date().toISOString();
  return new Date(`${date}T12:00:00-05:00`).toISOString();
}

const clip = (v: unknown, max: number) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

router.post('/invoices/:id/mark-paid', requireFinancialAccess('payments.create'), async (req, res) => {
  try {
    const ctx = (req as any).userContext as { orgId: string; userId: string };
    const invoiceId = String(req.params.id || '');
    if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) {
      res.status(400).json({ error: 'Facture invalide.' });
      return;
    }
    const body = req.body || {};
    const method = typeof body.method === 'string' && METHODS.has(body.method) ? body.method : null;
    const paidAtIso = dateToIso(body.paymentDate);
    const db = getServiceClient();

    const { data: inv, error: fetchErr } = await db
      .from('invoices')
      .select('id, total_cents, balance_cents, client_id, job_id, currency, status, deleted_at')
      .eq('id', invoiceId)
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!inv || inv.deleted_at) {
      res.status(404).json({ error: 'Facture introuvable.' });
      return;
    }
    if (inv.status === 'void') {
      res.status(409).json({ error: 'Facture annulée : impossible de la marquer payée.' });
      return;
    }

    const solde = Math.max(0, Number(inv.balance_cents ?? inv.total_cents) || 0);
    // Montant partiel (Lumi « enregistre 40 $ comptant ») : optionnel, entier, au plus le solde.
    // Sans montant = le solde entier, comme le bouton « Marquer payée ».
    let partiel = false;
    if (body.amount_cents !== undefined && body.amount_cents !== null) {
      const m = Number(body.amount_cents);
      if (!Number.isInteger(m) || m <= 0) {
        res.status(400).json({ error: 'Le montant doit être un nombre entier de cents, plus grand que zéro.' });
        return;
      }
      if (m > solde) {
        res.status(400).json({ error: `Le montant dépasse le solde restant (${(solde / 100).toFixed(2)} $).` });
        return;
      }
      partiel = m < solde;
    }
    const amountCents = partiel ? Number(body.amount_cents) : solde;

    // Paiement manuel réel : alimente Paiements/rapports, la synchro
    // QuickBooks et, via le trigger payments_recalculate_invoice, le solde.
    if (amountCents > 0) {
      const payment: Record<string, unknown> = {
        org_id: ctx.orgId,
        created_by: ctx.userId,
        invoice_id: invoiceId,
        client_id: inv.client_id ?? null,
        job_id: inv.job_id ?? null,
        provider: 'manual',
        status: 'succeeded',
        method,
        amount_cents: amountCents,
        currency: inv.currency || 'CAD',
        payment_date: paidAtIso,
        paid_at: paidAtIso,
        reference: clip(body.reference, 200),
        notes: clip(body.notes, 5000),
      };
      let { error: payErr } = await db.from('payments').insert(payment);
      // Colonnes reference/notes absentes (migration 20260928120000 pas encore appliquée).
      if (payErr && (payErr.code === 'PGRST204' || /reference|notes/i.test(payErr.message || ''))) {
        const { reference: _r, notes: _n, ...legacy } = payment;
        ({ error: payErr } = await db.from('payments').insert(legacy));
      }
      if (payErr) throw payErr;
    }

    // Partiel : le trigger payments_recalculate_invoice a déjà recalculé payé, solde et
    // statut (« partielle ») à partir de la ligne insérée — rien à forcer ici.
    if (partiel) {
      res.json({ ok: true, amount_cents: amountCents, partial: true });
      return;
    }

    const { error: upErr } = await db
      .from('invoices')
      .update({
        paid_cents: inv.total_cents,
        balance_cents: 0,
        status: 'paid',
        paid_at: paidAtIso,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invoiceId)
      .eq('org_id', ctx.orgId);
    if (upErr) throw upErr;

    // Automatisations « Facture payée » : émis ICI, après l'écriture, par le
    // serveur (consigné dans l'outbox). Avant, le navigateur l'émettait après
    // coup — onglet fermé, et le remerciement ne partait jamais (launch M2).
    await eventBus.emit('invoice.paid', {
      orgId: ctx.orgId,
      entityType: 'invoice',
      entityId: invoiceId,
      actorId: ctx.userId,
      ...(inv.client_id ? { relatedEntityType: 'client', relatedEntityId: inv.client_id } : {}),
      metadata: { amount_cents: amountCents, provider: 'manual', client_id: inv.client_id ?? null, job_id: inv.job_id ?? null, payment_type: 'full' },
    });

    // Commissions : générées ICI par le serveur. Avant, le navigateur les
    // demandait après coup — onglet fermé, le rep n'était jamais payé.
    await commissionsFacturePayee(db, ctx.orgId, invoiceId, 'mark-paid');

    res.json({ ok: true, amount_cents: amountCents });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Impossible de marquer la facture payée.' });
  }
});

export default router;
