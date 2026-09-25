/**
 * FORFAITS PAYÉS PAR LIEN DE PAIEMENT STRIPE + TRIMESTRIEL (2026-09-25).
 *
 * LE BESOIN
 * Un client paie par un lien créé dans le tableau de bord Stripe, pas sur
 * lumecrm.net. Quand il se connecte avec son courriel, il doit arriver sur
 * le forfait qu'il a payé.
 *
 * LE TROU
 * Le webhook checkout.session.completed ne provisionnait que si la session
 * portait nos métadonnées (plan_slug / plan_id) — un lien Stripe ne les a
 * pas : le client payait et ne recevait ni compte ni forfait. Et un prix
 * trimestriel (`month` / 3) tombait dans « mensuel » partout.
 *
 * CE QUE CES TESTS FIGENT
 * - le forfait se lit sur le prix payé (produit → plan_id, prix → intervalle) ;
 * - le trimestriel dure 3 mois, s'apparie à 3 × le mensuel, ne devient
 *   jamais « annuel » ;
 * - mensuel et annuel donnent exactement ce qu'ils donnaient avant ;
 * - l'accès ne dépend que du statut et du forfait, jamais de l'intervalle.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type Stripe from 'stripe';
import {
  intervalleDepuisPrix, estPrixVersements, finDePeriode, appariementPlan,
  prixCatalogue, forfaitDepuisPrix, intervalleLu, libelleFacturation, libellePeriode, moisParPeriode,
} from '../server/lib/abonnement-intervalle';
import { verdictPourAbonnement } from '../server/lib/subscription-guard';
import { planGrants } from '../server/lib/platformFeatures';
import { prixDuPlan } from '../server/lib/billing-email';
import { courrielForfaitModifie } from '../server/lib/subscription-email';

const lire = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

/** Les forfaits tels qu'en prod le 2026-09-25 (cents). */
const PLANS = {
  starter: { slug: 'starter', monthly_price_usd: 10900, monthly_price_cad: 15000, yearly_price_usd: 117600, yearly_price_cad: 162000, includes_automations: false },
  pro: { slug: 'pro', monthly_price_usd: 24900, monthly_price_cad: 34700, yearly_price_usd: 254400, yearly_price_cad: 354000, includes_automations: true },
  autopilot: { slug: 'autopilot', monthly_price_usd: 35900, monthly_price_cad: 49500, yearly_price_usd: 301200, yearly_price_cad: 416400, includes_automations: true },
} as const;

/** Les 6 prix trimestriels créés dans Stripe (live) le 2026-09-25. */
const TRIMESTRIELS = [
  { slug: 'starter', usd: 32700, cad: 45000 },
  { slug: 'pro', usd: 74700, cad: 104100 },
  { slug: 'autopilot', usd: 107700, cad: 148500 },
] as const;

const QUARTERLY_META = { lume_interval: 'quarterly' };

function prix(p: Partial<Stripe.Price> & { productMeta?: Record<string, string> }): Stripe.Price {
  const { productMeta, ...rest } = p;
  return {
    currency: 'cad',
    metadata: {},
    recurring: { interval: 'month', interval_count: 1 },
    product: { id: 'prod_x', metadata: productMeta ?? { plan_id: 'uuid-pro', plan_slug: 'pro' } },
    ...rest,
  } as unknown as Stripe.Price;
}

describe('Stripe → Lume : l intervalle d un prix', () => {
  it('month/3 avec lume_interval = quarterly → trimestriel', () => {
    expect(intervalleDepuisPrix({ interval: 'month', interval_count: 3 }, QUARTERLY_META)).toBe('quarterly');
  });

  it('non-régression : month/1 et year/1 SANS métadonnée → mensuel et annuel, comme avant', () => {
    expect(intervalleDepuisPrix({ interval: 'month', interval_count: 1 }, {})).toBe('monthly');
    expect(intervalleDepuisPrix({ interval: 'year', interval_count: 1 }, {})).toBe('yearly');
    expect(intervalleDepuisPrix({ interval: 'month' }, undefined)).toBe('monthly');
  });

  it('metadata.lume_interval fait autorité sur la récurrence', () => {
    // Sans la marque, month/12 est inconnu ; avec, c'est la marque qui décide.
    expect(intervalleDepuisPrix({ interval: 'month', interval_count: 12 }, {})).toBeNull();
    expect(intervalleDepuisPrix({ interval: 'month', interval_count: 12 }, { lume_interval: 'yearly' })).toBe('yearly');
    expect(intervalleDepuisPrix({ interval: 'month', interval_count: 1 }, QUARTERLY_META)).toBe('quarterly');
  });

  it('une récurrence inconnue (month/2) n est pas devinée', () => {
    expect(intervalleDepuisPrix({ interval: 'month', interval_count: 2 }, {})).toBeNull();
  });

  it('month/3 AVEC ou SANS métadonnée de versements ne devient jamais annuel', () => {
    const cas: Array<Record<string, string>> = [{}, { installments: '4' }, { installments: '3' }, { ...QUARTERLY_META, installments: '4' }];
    for (const meta of cas) {
      expect(estPrixVersements({ interval: 'month', interval_count: 3 }, meta)).toBe(false);
      expect(intervalleDepuisPrix({ interval: 'month', interval_count: 3 }, meta)).toBe('quarterly');
    }
  });

  it('non-régression : le vrai prix à versements (month/4, installments=3) reste reconnu', () => {
    expect(estPrixVersements({ interval: 'month', interval_count: 4 }, { installments: '3', interval: 'yearly' })).toBe(true);
  });
});

describe('fin de période', () => {
  // Heure locale, comme l'ancien code (setMonth / setFullYear) : janvier →
  // avril traverse le passage à l'heure d'été, l'heure UTC bouge, pas la date.
  const debut = new Date(2026, 0, 15, 12);
  const jour = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()];
  it('un trimestriel finit 3 mois plus tard — pas 1, pas 12', () => {
    expect(jour(finDePeriode(debut, 'quarterly'))).toEqual([2026, 4, 15, 12]);
  });
  it('non-régression : mensuel = 1 mois, annuel = 1 an', () => {
    expect(jour(finDePeriode(debut, 'monthly'))).toEqual([2026, 2, 15, 12]);
    expect(jour(finDePeriode(debut, 'yearly'))).toEqual([2027, 1, 15, 12]);
  });
});

describe('prix et appariement du forfait (webhook subscription.updated)', () => {
  it.each(TRIMESTRIELS)('$slug : le trimestriel (USD et CAD) retrouve son forfait = 3 × le mensuel', ({ slug, usd, cad }) => {
    const plan = PLANS[slug];
    expect(appariementPlan('quarterly', 'USD', usd)).toEqual({ colonne: 'monthly_price_usd', montant: plan.monthly_price_usd });
    expect(appariementPlan('quarterly', 'CAD', cad)).toEqual({ colonne: 'monthly_price_cad', montant: plan.monthly_price_cad });
    expect(prixCatalogue(plan, 'quarterly', 'USD')).toBe(usd);
    expect(prixCatalogue(plan, 'quarterly', 'CAD')).toBe(cad);
  });

  it('non-régression : mensuel et annuel cherchent dans leurs colonnes, montant inchangé', () => {
    expect(appariementPlan('monthly', 'CAD', 34700)).toEqual({ colonne: 'monthly_price_cad', montant: 34700 });
    expect(appariementPlan('yearly', 'USD', 254400)).toEqual({ colonne: 'yearly_price_usd', montant: 254400 });
    expect(prixCatalogue(PLANS.pro, 'monthly', 'CAD')).toBe(34700);
    expect(prixCatalogue(PLANS.pro, 'yearly', 'USD')).toBe(254400);
  });

  it('non-régression : prixDuPlan (reçu d un abonnement posé à la main) inchangé pour mensuel/annuel', () => {
    // Les 2 abonnements prod sans stripe_subscription_id : autopilot CAD, 0 ¢.
    expect(prixDuPlan(PLANS.autopilot, 'monthly', 'CAD')).toBe(49500);
    expect(prixDuPlan(PLANS.autopilot, 'yearly', 'CAD')).toBe(416400);
    expect(prixDuPlan(PLANS.autopilot, null, 'CAD')).toBe(49500);
    expect(prixDuPlan(PLANS.pro, 'quarterly', 'CAD')).toBe(104100);
  });

  it('un trimestriel non divisible par 3 n est apparié à rien', () => {
    expect(appariementPlan('quarterly', 'CAD', 100)).toBeNull();
  });
});

describe('lien de paiement Stripe : le forfait se lit sur le prix payé', () => {
  it('prix trimestriel du produit Scale → forfait pro, trimestriel, CAD', () => {
    expect(forfaitDepuisPrix(prix({ recurring: { interval: 'month', interval_count: 3 } as Stripe.Price.Recurring, metadata: QUARTERLY_META }))).toEqual({
      plan_id: 'uuid-pro', plan_slug: 'pro', interval: 'quarterly', currency: 'CAD',
    });
  });

  it('prix mensuel et annuel sans métadonnée → mensuel / annuel', () => {
    expect(forfaitDepuisPrix(prix({}))?.interval).toBe('monthly');
    expect(forfaitDepuisPrix(prix({ recurring: { interval: 'year', interval_count: 1 } as Stripe.Price.Recurring, currency: 'usd' }))).toMatchObject({ interval: 'yearly', currency: 'USD' });
  });

  it('un produit « siège supplémentaire » n est pas un forfait', () => {
    expect(forfaitDepuisPrix(prix({ productMeta: { plan_id: 'uuid-pro', plan_slug: 'pro', type: 'extra_seat' } }))).toBeNull();
  });

  it('un produit sans plan_id ni plan_slug (autre achat) → rien', () => {
    expect(forfaitDepuisPrix(prix({ productMeta: {} }))).toBeNull();
  });

  it('un paiement unique (sans récurrence) → rien', () => {
    expect(forfaitDepuisPrix(prix({ recurring: null }))).toBeNull();
  });
});

describe('le webhook branche bien le complément', () => {
  const PAYMENTS = lire('server/routes/payments.ts');

  it('sans plan_slug, il lit le prix payé au lieu d abandonner', () => {
    expect(PAYMENTS).toContain('meta.plan_slug ? meta : await metaDepuisPrixPaye(session, meta)');
    expect(PAYMENTS).not.toMatch(/else if \(meta\.plan_slug && session\.payment_status === 'paid'\)/);
  });

  it('le complément reste derrière le refus des comptes Connect', () => {
    const refus = PAYMENTS.indexOf("event_type: 'stripe_billing_event_from_connect_rejected'");
    const complement = PAYMENTS.indexOf('await metaDepuisPrixPaye(session, meta)');
    expect(refus).toBeGreaterThan(0);
    expect(complement).toBeGreaterThan(refus);
  });

  it('il ne provisionne que sur un forfait ACTIF de la table plans', () => {
    const corps = PAYMENTS.slice(PAYMENTS.indexOf('async function metaDepuisPrixPaye'), PAYMENTS.indexOf('async function handleCheckoutSessionCompleted'));
    expect(corps).toContain(".eq('is_active', true)");
    expect(corps).toContain("session.mode !== 'subscription'");
  });

  it('la fin de période du checkout passe par finDePeriode (plus de ternaire binaire)', () => {
    expect(PAYMENTS).toContain('finDePeriode(now, interval)');
    expect(PAYMENTS).not.toContain("as 'monthly' | 'yearly'");
  });
});

describe('accès PLEIN : l intervalle ne décide jamais de l accès', () => {
  it('les deux gardes ne lisent jamais interval ni current_period_end', () => {
    for (const f of ['server/lib/subscription-guard.ts', 'server/lib/feature-guard.ts']) {
      const src = lire(f);
      expect(src).not.toMatch(/\binterval\b/);
      expect(src).not.toMatch(/current_period_end/);
    }
  });

  it('un trimestriel actif passe subscription-guard comme un mensuel', () => {
    const trimestriel = { status: 'active', interval: 'quarterly', past_due_since: null };
    const mensuel = { status: 'active', interval: 'monthly', past_due_since: null };
    expect(verdictPourAbonnement(trimestriel)).toEqual(verdictPourAbonnement(mensuel));
    expect(verdictPourAbonnement(trimestriel).autorise).toBe(true);
  });

  it('un trimestriel impayé suit la même grâce qu un mensuel impayé', () => {
    const maintenant = Date.parse('2026-10-01T00:00:00Z');
    for (const depuis of ['2026-09-30T00:00:00Z', '2026-08-01T00:00:00Z']) {
      expect(verdictPourAbonnement({ status: 'past_due', past_due_since: depuis, interval: 'quarterly' } as never, maintenant))
        .toEqual(verdictPourAbonnement({ status: 'past_due', past_due_since: depuis, interval: 'monthly' } as never, maintenant));
    }
  });

  it('Scale trimestriel a les automatisations, Minimum trimestriel non — comme en mensuel', () => {
    // feature-guard décide sur le forfait joint (plans:plan_id), via planGrants.
    expect(planGrants(PLANS.pro, 'includes_automations')).toBe(true);
    expect(planGrants(PLANS.starter, 'includes_automations')).toBe(false);
  });
});

describe('libellés : plus de « Mensuel » sur un trimestriel', () => {
  it('reçu, courriel de changement, revenu mensuel', () => {
    expect(libelleFacturation('quarterly')).toBe('Trimestriel');
    expect(libellePeriode('quarterly')).toBe('3 mois');
    expect(moisParPeriode('quarterly')).toBe(3);
    const c = courrielForfaitModifie({ planName: 'Scale', amountCents: 104100, currency: 'CAD', interval: 'quarterly', periodEnd: null });
    expect(c.html).toContain('/ 3 mois');
  });

  it('non-régression : mensuel et annuel gardent leurs libellés', () => {
    expect(libelleFacturation('monthly')).toBe('Mensuel');
    expect(libelleFacturation('yearly')).toBe('Annuel');
    expect(courrielForfaitModifie({ planName: 'Scale', amountCents: 34700, currency: 'CAD', interval: 'monthly', periodEnd: null }).html).toContain('/ mois');
    expect(intervalleLu(undefined)).toBe('monthly');
    expect(intervalleLu('annual')).toBe('yearly');
  });
});

describe('exclusivité : la page publique ne vend pas le trimestriel', () => {
  it('create-checkout-session refuse un intervalle qu elle ne sait pas vendre (au lieu de facturer le mensuel)', () => {
    const BILLING = lire('server/routes/billing.ts');
    expect(BILLING).toContain("code: 'INTERVAL_NOT_OFFERED'");
    expect(BILLING).not.toMatch(/quarterly_price|stripe_quarterly/);
  });
});
