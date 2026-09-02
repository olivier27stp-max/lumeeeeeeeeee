/**
 * Audit des tarifs : table `plans` (source de verite) vs objets Stripe.
 *
 * Les montants factures viennent de la table `plans`; les Price Stripe sont
 * crees a la volee puis PERSISTES. Comme un Price Stripe est immuable, changer
 * un prix en base ne met pas a jour le Price deja enregistre — c'est la
 * divergence que ce script cherche.
 *
 *   npx tsx scripts/audit-stripe-prices.ts
 *
 * Lecture seule : aucun appel d'ecriture vers Stripe ou Supabase.
 */
import dotenv from 'dotenv';
// .env.local d'abord : c'est la que vivent les secrets locaux.
dotenv.config({ path: '.env.local' });
dotenv.config();
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const KEY = process.env.STRIPE_AUDIT_KEY || process.env.STRIPE_SECRET_KEY;
if (!KEY) {
  console.error('Aucune cle. Remplis STRIPE_AUDIT_KEY dans .env.local (voir les commentaires du fichier).');
  process.exit(1);
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Config Supabase manquante (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
  process.exit(1);
}

const stripe = new Stripe(KEY);
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const money = (cents: number | null | undefined, cur: string) =>
  cents == null ? '—' : `${(cents / 100).toFixed(2)} ${cur}`;

type Row = { ok: boolean; label: string; attendu: string; stripe: string; note: string };

async function main() {
  const { data: plans, error } = await db
    .from('plans')
    .select('*')
    .order('monthly_price_cad');

  if (error) throw new Error(`Lecture plans: ${error.message}`);

  const rows: Row[] = [];

  for (const p of plans as any[]) {
    for (const cur of ['cad', 'usd'] as const) {
      for (const interval of ['monthly', 'yearly'] as const) {
        const expected = p[`${interval}_price_${cur}`] as number | null;
        const priceId = p[`stripe_${interval}_price_id_${cur}`] as string | null;
        const label = `${p.name} ${interval === 'monthly' ? 'mensuel' : 'annuel'} ${cur.toUpperCase()}`;

        if (expected == null) continue;

        if (!priceId) {
          rows.push({
            ok: true,
            label,
            attendu: money(expected, cur.toUpperCase()),
            stripe: 'aucun Price',
            note: 'sera cree au 1er achat',
          });
          continue;
        }

        try {
          const price = await stripe.prices.retrieve(priceId);
          const actual = price.unit_amount;
          const curOk = price.currency?.toLowerCase() === cur;
          const intervalOk =
            price.recurring?.interval === (interval === 'yearly' ? 'year' : 'month');
          const amountOk = actual === expected;

          const notes: string[] = [];
          if (!amountOk) notes.push('MONTANT DIFFERENT');
          if (!curOk) notes.push(`devise Stripe=${price.currency}`);
          if (!intervalOk) notes.push(`recurrence Stripe=${price.recurring?.interval}`);
          if (price.active === false) notes.push('Price INACTIF');

          rows.push({
            ok: amountOk && curOk && intervalOk && price.active !== false,
            label,
            attendu: money(expected, cur.toUpperCase()),
            stripe: money(actual, (price.currency || cur).toUpperCase()),
            note: notes.join(', ') || 'ok',
          });
        } catch (e: any) {
          rows.push({
            ok: false,
            label,
            attendu: money(expected, cur.toUpperCase()),
            stripe: 'INTROUVABLE',
            note: e?.message?.slice(0, 60) || 'erreur Stripe',
          });
        }
      }
    }
  }

  // ── Coupons d'intro (promo 1re annee) ──
  const couponRows: Row[] = [];
  for (const p of plans as any[]) {
    for (const cur of ['cad', 'usd'] as const) {
      for (const interval of ['monthly', 'yearly'] as const) {
        const couponId = p[`stripe_intro_coupon_id_${interval}_${cur}`] as string | null;
        const introPrice = p[`intro_price_${interval}_${cur}`] as number | null;
        const fullPrice = p[`${interval}_price_${cur}`] as number | null;
        const label = `${p.name} intro ${interval === 'monthly' ? 'mensuel' : 'annuel'} ${cur.toUpperCase()}`;

        if (!couponId && introPrice == null) continue;

        if (!couponId) {
          couponRows.push({
            ok: true,
            label,
            attendu: money(introPrice, cur.toUpperCase()),
            stripe: 'aucun coupon',
            note: 'sera cree au 1er achat',
          });
          continue;
        }

        try {
          const c = await stripe.coupons.retrieve(couponId);
          const expectedOff = fullPrice != null && introPrice != null ? fullPrice - introPrice : null;
          const actualOff = c.amount_off ?? null;
          const ok = expectedOff != null && actualOff === expectedOff;
          const notes: string[] = [];
          if (c.percent_off) notes.push(`remise en % (${c.percent_off}%)`);
          if (!ok && expectedOff != null) notes.push('REMISE DIFFERENTE');
          if (c.valid === false) notes.push('coupon INVALIDE');
          couponRows.push({
            ok: ok || (c.percent_off != null && c.valid !== false),
            label,
            attendu: expectedOff != null ? `-${money(expectedOff, cur.toUpperCase())}` : '—',
            stripe: actualOff != null ? `-${money(actualOff, cur.toUpperCase())}` : `${c.percent_off}%`,
            note: notes.join(', ') || 'ok',
          });
        } catch (e: any) {
          couponRows.push({
            ok: false,
            label,
            attendu: money(introPrice, cur.toUpperCase()),
            stripe: 'INTROUVABLE',
            note: e?.message?.slice(0, 60) || 'erreur Stripe',
          });
        }
      }
    }
  }

  const show = (title: string, list: Row[]) => {
    console.log(`\n=== ${title} ===`);
    for (const r of list) {
      console.log(
        `${r.ok ? '  OK  ' : ' ECART'} | ${r.label.padEnd(28)} | base: ${r.attendu.padEnd(14)} | stripe: ${r.stripe.padEnd(14)} | ${r.note}`,
      );
    }
  };

  show('PRIX', rows);
  show('COUPONS INTRO', couponRows);

  const bad = [...rows, ...couponRows].filter((r) => !r.ok);
  console.log(
    bad.length
      ? `\nRESULTAT: ${bad.length} ecart(s) a corriger.`
      : '\nRESULTAT: tout concorde entre la base et Stripe.',
  );
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => {
  console.error('Echec:', e?.message || e);
  process.exit(1);
});
