/**
 * LE PAIEMENT EN LIGNE QUI NE POUVAIT PAS S'ENREGISTRER (2026-09-17).
 *
 * Un paiement de bout en bout sur staging (carte de test Stripe, 15 % de
 * pourboire) a montré que le webhook payment_intent.succeeded répondait 500
 * pour deux raisons indépendantes de Lume Payments :
 *   1. payments.card_brand / card_last4 n'existaient pas (migration
 *      20260709000000 jamais appliquée) — PostgREST refuse toute l'insertion
 *      dès qu'une colonne est inconnue ;
 *   2. le déclencheur trg_payment_to_invoice_paid ré-insérait un paiement
 *      sans created_by, et crm_enforce_scope l'exige hors session.
 * La prod n'avait encore reçu aucun paiement en ligne : le premier client à
 * payer par carte serait tombé dessus. Ces tests figent les trois remèdes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const racine = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(racine, p), 'utf8');

describe('insertion d un paiement par le serveur (webhook Stripe / PayPal)', () => {
  it('pose created_by : crm_enforce_scope l exige quand il n y a pas de session', () => {
    const src = lire('server/lib/payments.ts');
    expect(src).toContain('export async function resoudreCreateurPaiementSisteme'.replace('Sisteme', 'Systeme'));
    expect(src).toMatch(/const createdBy = await resoudreCreateurPaiementSysteme\(admin, input\.org_id, input\.invoice_id\);/);
    expect(src).toMatch(/const insertPayload = \{[\s\S]*?created_by: createdBy,/);
  });

  it('les colonnes de carte et de pourboire ont leur migration', () => {
    const carte = lire('supabase/migrations/20260917210000_payments_colonnes_carte.sql');
    expect(carte).toMatch(/add column if not exists card_last4 text/);
    expect(carte).toMatch(/add column if not exists card_brand text/);
    const tip = lire('supabase/migrations/20260917200000_reglages_paiements_org.sql');
    expect(tip).toMatch(/add column if not exists tip_cents integer not null default 0/);
  });

  it('le déclencheur qui ré-insérait un paiement sans created_by est retiré', () => {
    const m = lire('supabase/migrations/20260917220000_payments_retire_trigger_doublon.sql');
    expect(m).toMatch(/drop trigger if exists trg_payment_to_invoice_paid on public\.payments/);
  });
});
