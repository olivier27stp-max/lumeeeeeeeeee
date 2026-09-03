/**
 * LES ABONNEMENTS QUI SE FIGENT.
 *
 * Un abonnement Stripe se renouvelle seul : Stripe prélève, envoie
 * `customer.subscription.updated`, et le webhook avance
 * `current_period_end` (payments.ts, l. 404-420). Ce chemin fonctionne.
 *
 * Mais si l'événement n'arrive jamais — case décochée côté Stripe, URL
 * erronée, livraison en échec — la période reste figée. Or l'accès aux
 * fonctionnalités se décide sur `status = 'active'` SANS regarder la date :
 * le client garde tout, indéfiniment, et rien ne le signale.
 *
 * CONSTAT DU 2026-09-03 (production, lecture seule)
 *   7 abonnements `active` avec une période finie, jusqu'à 109 jours.
 *   Deux portaient un vrai `stripe_subscription_id`, créés en juillet,
 *   échéance en août — Stripe aurait dû écrire. Dernier événement
 *   d'abonnement reçu : 29 mai.
 *
 * Le détecteur, passé sur la prod, retrouve bien les 7 et distingue les 2
 * porteurs d'un id Stripe.
 *
 * CE QUE CES TESTS FIGENT
 * Le contrat du module : il alerte, il ne suspend jamais. Un cron qui
 * couperait l'accès de lui-même fermerait la porte à des comptes d'essai
 * ou victimes d'un webhook mal configuré.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RACINE = resolve(__dirname, '..');
const lire = (p: string) => readFileSync(resolve(RACINE, p), 'utf8');

const MODULE = lire('server/lib/abonnements-figes.ts');

describe('le détecteur n écrit jamais sur les abonnements', () => {
  it('il ne modifie aucun abonnement', () => {
    // Le point le plus important : ce cron ne doit RIEN suspendre.
    // Un abonnement figé n'est pas forcément un impayé.
    expect(MODULE).not.toMatch(/\.from\('subscriptions'\)[\s\S]{0,120}\.(update|upsert|delete)\(/);
  });

  it('il ne touche à aucune table en écriture', () => {
    expect(MODULE).not.toMatch(/\.(update|upsert|insert|delete)\(/);
  });

  it('il pose une trace au lieu d agir', () => {
    expect(MODULE).toContain('logSecurityEvent');
    expect(MODULE).toContain('subscription_period_stale');
  });
});

describe('ce que le détecteur cherche', () => {
  it('il ne regarde que les abonnements ACTIFS', () => {
    // Les `past_due` sont le travail de dunning-engine, qui les suspend.
    expect(MODULE).toContain(".eq('status', 'active')");
  });

  it('il exige une période réellement dépassée', () => {
    expect(MODULE).toContain(".lt('current_period_end', limite)");
  });

  it('il ignore les abonnements sans date de fin', () => {
    // Sans ce filtre, un abonnement sans période remonterait à chaque passage.
    expect(MODULE).toContain(".not('current_period_end', 'is', null)");
  });

  it('il laisse un délai avant d alerter', () => {
    // Un renouvellement peut arriver avec quelques heures de retard : alerter
    // à la seconde près produirait du bruit à chaque échéance.
    const m = MODULE.match(/const JOURS_AVANT_ALERTE = (\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1);
  });
});

describe('une lecture en échec ne passe pas pour un silence', () => {
  it('une erreur de lecture lève, elle n est pas avalée', () => {
    // supabase-js ne lève jamais : sans ce test explicite, une panne de
    // lecture ressemblerait à « aucun abonnement figé » et le cron se
    // tairait pour toujours. C'est la leçon inscrite dans dunning-engine.
    expect(MODULE).toContain('if (error) throw new Error');
  });

  it('une date illisible ne fait pas planter le passage', () => {
    expect(MODULE).toContain('Number.isFinite');
  });
});

describe('la trace est exploitable par un humain', () => {
  it('elle distingue les abonnements porteurs d un id Stripe', () => {
    // C'est le cas parlant : Stripe AURAIT DÛ écrire. Sans cette distinction,
    // un compte d'essai et un vrai renouvellement manqué se ressemblent.
    expect(MODULE).toContain('has_stripe_subscription');
    expect(MODULE).toMatch(/severity: abo\.stripe_subscription_id \? 'medium' : 'low'/);
  });

  it('elle porte le nombre de jours de dépassement', () => {
    expect(MODULE).toContain('days_overdue');
  });

  it('elle dit quoi vérifier en premier', () => {
    // La trace doit se suffire à elle-même : celui qui la lit dans six mois
    // ne doit pas avoir à refaire le raisonnement.
    expect(MODULE).toContain('hint');
    expect(MODULE).toContain('customer.subscription.updated');
  });
});

describe('le cron est réellement branché', () => {
  const INDEX = lire('server/index.ts');

  it('il est démarré au lancement du serveur', () => {
    // Un module jamais importé ne tourne jamais — et sans erreur.
    expect(INDEX).toContain("import('./lib/abonnements-figes')");
    expect(INDEX).toContain('detecterAbonnementsFiges');
  });

  it('il est protégé par un verrou, comme les autres crons', () => {
    // Plusieurs instances du serveur ne doivent pas journaliser en double.
    expect(INDEX).toContain("withAdvisoryLock('abonnements-figes'");
  });

  it('un import en échec est signalé, pas silencieux', () => {
    expect(INDEX).toContain("captureCronFailure('abonnements-figes-import'");
  });
});

describe('le renouvellement Stripe, côté réception', () => {
  const PAIEMENTS = lire('server/routes/payments.ts');

  it('customer.subscription.updated avance bien la période', () => {
    // Vérifié le 2026-09-03 : ce chemin existe et fonctionne. Le problème
    // constaté en prod est que l'événement n'arrive pas — pas que le code
    // l'ignore. Ce test empêche qu'on casse le chemin en le croyant mort.
    expect(PAIEMENTS).toContain("event.type === 'customer.subscription.updated'");
    expect(PAIEMENTS).toContain('current_period_end: periodEnd');
  });

  it('les trois événements de facturation sont traités', () => {
    for (const e of ['invoice.paid', 'invoice.payment_failed', 'customer.subscription.deleted']) {
      expect(PAIEMENTS).toContain(`event.type === '${e}'`);
    }
  });

  it('invoice.paid efface l impayé au lieu de le laisser courir', () => {
    // Sans cela, la grâce continuerait à courir et suspendrait un client
    // pourtant à jour.
    expect(PAIEMENTS).toContain('past_due_since: null');
  });
});
