/**
 * RÉGLAGES LUME PAYMENTS — parité « Jobber Payments » (2026-09-17).
 *
 * Ce qui est figé ici :
 *   1. Un pourboire est un entier en cents, borné par le solde et 1 000 $.
 *      Tout le reste est REFUSÉ (null → 400), jamais « corrigé » en silence :
 *      c'est de l'argent envoyé par un inconnu depuis une page sans session.
 *   2. Le webhook sépare part facture / pourboire à partir de ce que Stripe a
 *      RÉELLEMENT encaissé ; une métadonnée de pourboire falsifiée ne peut ni
 *      rendre la part facture négative ni dépasser le montant reçu.
 *   3. Un client ne choisit pas ses colonnes : seuls les six booléens connus
 *      traversent nettoyerPatch / le schéma Zod strict.
 *   4. CLIQUET : chaque route publique qui encaisse ou expose un paiement lit
 *      getPaymentSettings(). Un interrupteur d'interface seul n'empêche rien.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../server/lib/supabase', () => ({ getServiceClient: () => ({ from: vi.fn() }) }));
vi.mock('../server/lib/mailer', () => ({ sendEmail: vi.fn(), isMailerConfigured: () => false }));
vi.mock('../server/lib/notificationHelpers', () => ({ createNotification: vi.fn() }));

const {
  plafonnerPourboire,
  repartirMontantRecu,
  nettoyerPatch,
  normaliserReglages,
  reglagesParDefaut,
  POURBOIRE_MAX_CENTS,
} = await import('../server/lib/payment-settings');
const { sujetPaiementRecu } = await import('../server/lib/paiement-recu');
const { paymentSettingsPatchSchema, publicTipSchema } = await import('../server/lib/validation');

const ORG = '11111111-2222-3333-4444-555555555555';

describe('pourboire : entier borné, jamais corrigé en silence', () => {
  it('accepte 0 et un montant sous le solde', () => {
    expect(plafonnerPourboire(0, 10_000)).toBe(0);
    expect(plafonnerPourboire(1_500, 10_000)).toBe(1_500);
    expect(plafonnerPourboire('1500', 10_000)).toBe(1_500);
  });

  it('refuse négatif, décimal, NaN', () => {
    expect(plafonnerPourboire(-1, 10_000)).toBeNull();
    expect(plafonnerPourboire(10.5, 10_000)).toBeNull();
    expect(plafonnerPourboire('abc', 10_000)).toBeNull();
    expect(plafonnerPourboire(undefined, 10_000)).toBeNull();
  });

  it('refuse au-delà du solde (un 20 $ ne reçoit pas 50 $ de pourboire)', () => {
    expect(plafonnerPourboire(5_000, 2_000)).toBeNull();
    expect(plafonnerPourboire(2_000, 2_000)).toBe(2_000);
  });

  it('refuse au-delà de 1 000 $ même sur une grosse facture', () => {
    expect(POURBOIRE_MAX_CENTS).toBe(100_000);
    expect(plafonnerPourboire(100_001, 1_000_000)).toBeNull();
    expect(plafonnerPourboire(100_000, 1_000_000)).toBe(100_000);
  });
});

describe('webhook : part facture / pourboire depuis le montant réellement reçu', () => {
  it('sépare normalement', () => {
    expect(repartirMontantRecu(11_000, '1000')).toEqual({ factureCents: 10_000, pourboireCents: 1_000 });
  });

  it('sans métadonnée, tout va à la facture', () => {
    expect(repartirMontantRecu(10_000, undefined)).toEqual({ factureCents: 10_000, pourboireCents: 0 });
    expect(repartirMontantRecu(10_000, '')).toEqual({ factureCents: 10_000, pourboireCents: 0 });
  });

  it('un pourboire falsifié ne rend jamais la part facture négative', () => {
    expect(repartirMontantRecu(10_000, '999999')).toEqual({ factureCents: 0, pourboireCents: 10_000 });
    expect(repartirMontantRecu(10_000, '-500')).toEqual({ factureCents: 10_000, pourboireCents: 0 });
  });
});

describe('réglages : seuls les six booléens connus passent', () => {
  it('nettoyerPatch ignore les clés inconnues et les non-booléens', () => {
    expect(nettoyerPatch({
      tips_enabled: true,
      invoice_payments_enabled: 'true',
      org_id: 'autre-org',
      updated_at: '2020-01-01',
      colonne_inventee: true,
    })).toEqual({ tips_enabled: true });
    expect(nettoyerPatch(null)).toEqual({});
  });

  it('le schéma Zod est strict : une clé inconnue fait échouer la requête', () => {
    expect(paymentSettingsPatchSchema.safeParse({ tips_enabled: true }).success).toBe(true);
    expect(paymentSettingsPatchSchema.safeParse({ tips_enabled: 'oui' }).success).toBe(false);
    expect(paymentSettingsPatchSchema.safeParse({ org_id: ORG, stripe_account_id: 'acct_x' }).success).toBe(false);
  });

  it('publicTipSchema : entier ≥ 0 ≤ 1 000 $', () => {
    expect(publicTipSchema.safeParse({ tip_cents: 250 }).success).toBe(true);
    expect(publicTipSchema.safeParse({ tip_cents: 2.5 }).success).toBe(false);
    expect(publicTipSchema.safeParse({ tip_cents: -1 }).success).toBe(false);
    expect(publicTipSchema.safeParse({ tip_cents: 100_001 }).success).toBe(false);
    expect(publicTipSchema.safeParse({ tip_cents: '250' }).success).toBe(false);
  });

  it('ligne absente = défauts (paiements ouverts, pourboires fermés, courriel actif)', () => {
    const d = reglagesParDefaut(ORG);
    expect(d).toMatchObject({
      quote_payments_enabled: true,
      invoice_payments_enabled: true,
      tips_enabled: false,
      wallets_enabled: true,
      require_payment_method_default: false,
      notify_owner_email: true,
    });
    expect(normaliserReglages(ORG, null)).toEqual(d);
    expect(normaliserReglages(ORG, { tips_enabled: true, wallets_enabled: 'non' })).toMatchObject({
      tips_enabled: true,
      wallets_enabled: true,
    });
  });
});

describe('courriel « paiement reçu » au propriétaire', () => {
  it('le sujet porte le montant, la référence et le pourboire', () => {
    const sujet = sujetPaiementRecu({
      orgId: ORG, genre: 'invoice', amountCents: 12_500, tipCents: 1_000, currency: 'CAD', reference: '2026-014',
    }, 'fr');
    expect(sujet).toContain('Paiement reçu');
    expect(sujet).toContain('2026-014');
    expect(sujet).toMatch(/125,00/);
    expect(sujet).toMatch(/10,00.*pourboire/);
  });

  it('dépôt de devis, en anglais, sans pourboire', () => {
    const sujet = sujetPaiementRecu({
      orgId: ORG, genre: 'deposit', amountCents: 5_000, currency: 'CAD', reference: 'Q-7',
    }, 'en');
    expect(sujet).toBe('Payment received — $50.00 — deposit for quote Q-7');
  });
});

describe('cliquet : les routes publiques lisent les réglages côté serveur', () => {
  const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it.each([
    ['server/routes/public-pay.ts', 'invoice_payments_enabled'],
    ['server/routes/payment-requests.ts', 'invoice_payments_enabled'],
    ['server/routes/invoices-public.ts', 'invoice_payments_enabled'],
    ['server/routes/quotes.ts', 'quote_payments_enabled'],
  ])('%s vérifie %s via getPaymentSettings()', (fichier, cle) => {
    const src = lire(fichier);
    expect(src).toContain('getPaymentSettings(');
    expect(src).toContain(cle);
  });

  it('le webhook applique la part facture, pas le total encaissé', () => {
    const src = lire('server/routes/payments.ts');
    expect(src).toContain('repartirMontantRecu(');
    expect(src).toMatch(/const amountPaid = factureCents;/);
  });

  it('la migration révoque les écritures de authenticated sur payment_settings', () => {
    const src = lire('supabase/migrations/20260917200000_reglages_paiements_org.sql');
    expect(src).toMatch(/revoke all on public\.payment_settings from anon, authenticated/);
    expect(src).toMatch(/force row level security/);
    expect(src).not.toMatch(/for (insert|update|delete) to authenticated/);
  });
});

describe('CLIQUET : pas de bouton « Payer » si l’entreprise ne peut pas encaisser', () => {
  const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

  it('la facture publique vérifie charges_enabled, pas seulement le réglage', () => {
    /* Constaté en prod le 2026-09-24 : Coquin lavage affichait « Payer
       229,95 $ », et le clic tombait sur « Paiement indisponible — échec du
       chargement de la page ». Le serveur répondait pourtant clairement
       « This business is not yet ready to accept payments » (503) : le compte
       Stripe existait mais n'était pas activé. La garde vérifiait le réglage
       et l'expiration, jamais la capacité réelle d'encaisser. */
    const src = lire('server/routes/invoices-public.ts');
    const bloc = src.slice(src.indexOf('const payReq ='), src.indexOf('// Suivi de vue'));
    expect(bloc).toContain('getConnectedAccount');
    expect(bloc).toContain('charges_enabled');
    // Le jeton ne part que si les trois conditions tiennent.
    expect(bloc).toMatch(/payTokenActif\s*=\s*payReq\s*&&\s*peutEncaisser/);
  });

  it('Stripe injoignable ne promet pas un paiement : peutEncaisser reste faux', () => {
    const src = lire('server/routes/invoices-public.ts');
    const bloc = src.slice(src.indexOf('let peutEncaisser'), src.indexOf('const payTokenActif'));
    expect(bloc).toContain('let peutEncaisser = false');
    expect(bloc).toContain('catch');
    // aucune réaffectation à vrai dans le catch
    expect(bloc.slice(bloc.indexOf('catch'))).not.toContain('peutEncaisser = true');
  });

  it('la page dit POURQUOI le paiement est indisponible, pas « échec du chargement »', () => {
    const src = lire('src/pages/PublicPayment.tsx');
    expect(src).toContain('not yet ready to accept payments');
    expect(src).toMatch(/n’est pas encore activé par cette entreprise/);
  });
});
