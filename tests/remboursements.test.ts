/**
 * REMBOURSEMENTS — la facture reflète ce qui a été rendu au client.
 *
 * Défauts corrigés (catalogue de tâches Lumi, 2026-09-29) :
 *  1. Remboursement complet par la route : le trigger recalculait déjà la
 *     facture, puis reverse_invoice_payment retranchait le montant une 2e fois.
 *  2. Remboursement partiel : la facture restait « payée » ; le webhook
 *     écrivait le statut 'partially_refunded', refusé par la contrainte.
 *  3. La route ne regardait que « admin », pas la case « Rembourser » de la
 *     page Rôles.
 * Le comportement SQL a été éprouvé sur staging (voir la PR).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { montantRembourse } from '../server/lib/remboursements';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('montantRembourse', () => {
  it('partiel : ce que Stripe a rendu', () => expect(montantRembourse(5000, 22995)).toBe(5000));
  it('charge entière avec pourboire : borné à la part facture', () => expect(montantRembourse(26444, 22995)).toBe(22995));
  it('rien ou illisible : 0', () => {
    expect(montantRembourse(null, 22995)).toBe(0);
    expect(montantRembourse(-10, 22995)).toBe(0);
  });
});

describe('route POST /payments/refund', () => {
  const routes = lire('server/routes/payments.ts');
  it('ne retranche plus le montant une deuxième fois (reverse_invoice_payment)', () => {
    expect(routes).not.toContain("rpc('reverse_invoice_payment'");
  });
  it('inscrit le montant rendu, relu sur la charge Stripe (rejouable sans double compte)', () => {
    expect(routes).toContain("stripe.paymentIntents.retrieve(stripePaymentIntentId, { expand: ['latest_charge'] })");
    expect(routes).toContain('refunded_cents: rembourse,');
  });
  it('protégée par la case « Rembourser des paiements » de la page Rôles', () => {
    expect(lire('server/lib/route-permissions.ts')).toContain("'POST /api/payments/refund': 'payments.refund',");
  });
});

describe('migration : la facture compte « montant − remboursé »', () => {
  const MIG = lire('supabase/migrations/20261002900000_paiements_montant_rembourse.sql');
  it('colonne bornée entre 0 et le montant', () => {
    expect(MIG).toContain('add column if not exists refunded_cents integer not null default 0');
    expect(MIG).toContain('check (refunded_cents >= 0 and refunded_cents <= amount_cents)');
  });
  it('recalcul de la facture et revenus encaissés nets du remboursement', () => {
    expect(MIG.match(/p\.amount_cents - coalesce\(p\.refunded_cents, 0\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
  it('la vue des revenus garde security_invoker (sinon elle contourne la RLS)', () => {
    expect(MIG).toContain('create or replace view public.v_revenue_analytics\nwith (security_invoker = true) as');
  });
});
