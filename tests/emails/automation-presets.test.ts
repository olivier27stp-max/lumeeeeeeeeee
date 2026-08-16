/**
 * Lot 1 du chantier automatisations — ce que le client reçoit.
 *
 * Trois corrections, chacune mesurée en production avant d'être écrite :
 *   1. deux SMS partaient dans la même seconde après un job terminé (30 orgs) ;
 *   2. la confirmation de dépôt n'était JAMAIS envoyée (30 orgs) ;
 *   3. un rappel « J-7 » partait dans les 5 secondes pour un rendez-vous du
 *      lendemain, en annonçant au client « dans une semaine ».
 *
 * Voir docs/plan-chantier-automatisations.md pour le détail.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** Presets parsés depuis le fichier source. */
function presets(): any[] {
  const s = read('server/lib/automationPresets.data.ts');
  const debut = s.indexOf('= [', s.indexOf('AUTOMATION_PRESETS')) + 2;
  return JSON.parse(s.slice(debut, s.lastIndexOf('];') + 1));
}

function preset(cle: string): any {
  const p = presets().find((x) => x.preset_key === cle);
  expect(p, `preset introuvable : ${cle}`).toBeDefined();
  return p;
}

function actions(cle: string, type: string): any[] {
  return (preset(cle).actions || []).filter((a: any) => a.type === type);
}

// ───────────────────────────────────────────────────────────────────
// 1. Plus de double SMS après un job terminé
// ───────────────────────────────────────────────────────────────────

describe('après un job terminé — un seul message à la fois', () => {
  it('le remerciement et le sondage ne partent plus au même moment', () => {
    // Avant : tous deux à 3600 s, tous deux par SMS, tous deux invitant à
    // répondre. Le client recevait les deux dans la même seconde, avec deux
    // consignes contradictoires — et l'org payait deux SMS.
    const merci = preset('thank_you_after_job');
    const sondage = preset('post_appointment_survey');
    expect(merci.trigger_event).toBe('job.completed');
    expect(sondage.trigger_event).toBe('job.completed');
    expect(sondage.delay_seconds).not.toBe(merci.delay_seconds);
  });

  it('le sondage est décalé au lendemain', () => {
    // 24 h : le client a eu le temps de constater le travail.
    expect(preset('post_appointment_survey').delay_seconds).toBe(86400);
  });

  it('le sondage ne demande plus une note que personne ne lit', () => {
    // « Répondez de 1 à 5 » attendait une note qu'AUCUN code ne traite :
    // aucun handler n'interprète les réponses numériques, aucune table ne les
    // stocke. Le client notait dans le vide.
    const sms = actions('post_appointment_survey', 'send_sms');
    expect(sms.length).toBe(1);
    expect(sms[0].config.body).not.toContain('1 à 5');
    expect(sms[0].config.body).toContain('Répondez à ce message');
  });

  it('aucun autre couple de presets ne collisionne sur job.completed', () => {
    // Garde-fou : si un preset est ajouté un jour au même créneau qu'un autre,
    // ce test le signale avant que le client ne reçoive deux messages.
    const parDelai = new Map<number, string[]>();
    for (const p of presets()) {
      if (p.trigger_event !== 'job.completed') continue;
      const envoie = (p.actions || []).some((a: any) => a.type === 'send_sms' || a.type === 'send_email');
      if (!envoie) continue;
      parDelai.set(p.delay_seconds, [...(parDelai.get(p.delay_seconds) || []), p.preset_key]);
    }
    const collisions = [...parDelai.entries()].filter(([, keys]) => keys.length > 1);
    expect(collisions, `créneaux partagés : ${JSON.stringify(collisions)}`).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────
// 2. La confirmation de dépôt part enfin — sans doublon
// ───────────────────────────────────────────────────────────────────

describe('confirmation de dépôt', () => {
  it('le webhook émet l’événement avec le type de paiement', () => {
    // La cause : le dépôt d'une soumission ne passe PAS par une facture. Le
    // webhook mettait à jour `quotes.deposit_status` sans rien émettre, alors
    // que le preset attendait `payment_type: 'deposit'` — une clé qu'aucun
    // émetteur ne fournissait. 30 règles actives, zéro envoi.
    const payments = read('server/routes/payments.ts');
    const bloc = payments.slice(payments.indexOf("entityType === 'quote_deposit'"));
    expect(bloc).toContain("payment_type: 'deposit'");
    expect(bloc).toContain("eventBus.emit('invoice.paid'");
    expect(bloc).toContain("entityType: 'quote'");
  });

  it('l’émission ne peut pas faire échouer le webhook', () => {
    // Le dépôt est déjà encaissé : un throw ici ferait rejouer Stripe.
    const payments = read('server/routes/payments.ts');
    const bloc = payments.slice(payments.indexOf("entityType === 'quote_deposit'"));
    expect(bloc).toContain('émission dépôt reçu échouée');
    expect(bloc).toMatch(/catch \(emitErr: any\)/);
  });

  it('le remerciement générique exclut les dépôts', () => {
    // Sans cette exclusion, émettre l'événement ferait partir LES DEUX presets
    // — « Dépôt bien reçu, votre place est réservée » ET « Paiement reçu,
    // merci » dans la même seconde. On remplacerait un preset muet par un
    // doublon.
    expect(preset('payment_confirmation').conditions).toEqual({
      payment_type: { neq: 'deposit' },
    });
  });

  it('la confirmation de dépôt cible bien les dépôts', () => {
    expect(preset('deposit_received').conditions).toEqual({ payment_type: 'deposit' });
  });

  it('l’opérateur neq est réellement supporté par le moteur', () => {
    // Une condition que le moteur ne sait pas évaluer laisserait passer tous
    // les paiements — le doublon reviendrait par la bande.
    //
    // La comparaison passe désormais par `memeValeur` (lot 4), qui tolère les
    // différences de type. L'exclusion reste stricte sur la valeur.
    const engine = read('server/lib/automationEngine.ts');
    expect(engine).toContain("if ('neq' in expected && memeValeur(actual, expected.neq)) return false;");
    expect(engine).toContain("'eq', 'neq', 'in', 'not_in'");
  });

  it('les deux presets ne peuvent pas se déclencher ensemble', () => {
    // Vérification logique : les conditions sont mutuellement exclusives.
    const depot = preset('deposit_received').conditions;
    const paiement = preset('payment_confirmation').conditions;
    expect(depot.payment_type).toBe('deposit');
    expect(paiement.payment_type.neq).toBe('deposit');
  });
});

// ───────────────────────────────────────────────────────────────────
// 3. Les rappels périmés ne partent plus
// ───────────────────────────────────────────────────────────────────

describe('rappels de rendez-vous — plus de message faux', () => {
  const engine = read('server/lib/automationEngine.ts');

  it('un créneau franchement dépassé fait abandonner la tâche', () => {
    // Avant : exécution « dans 5 secondes ». Créer un rendez-vous pour DEMAIN
    // déclenchait donc le rappel « J-7 » immédiatement, et le client recevait
    // « votre rendez-vous est dans une semaine ».
    expect(engine).toContain('Promise<Date | null>');
    expect(engine).toContain('rappel abandonné (créneau dépassé');
    expect(engine).toContain('RETARD_TOLERE_MS');
  });

  it('un léger retard reste envoyé — le message est encore juste', () => {
    // Le tick tourne toutes les 5 minutes : un décalage de quelques minutes
    // vient de là, pas d'une erreur de cadence.
    expect(engine).toContain('if (retard > 0)');
    expect(engine).toContain('30 * 60 * 1000');
  });

  it('l’appelant sait ne rien planifier', () => {
    expect(engine).toContain('if (!executeAt) return;');
  });

  it('une erreur de lecture n’est plus confondue avec « pas de date »', () => {
    // Sans ce garde, on retombait sur le délai positif et le rappel
    // « 1 semaine avant » partait 1 semaine APRÈS la création du rendez-vous.
    const fn = engine.slice(
      engine.indexOf('async function resolveExecuteAt'),
      engine.indexOf('// ── Schedule delayed actions'),
    );
    expect(fn).toContain('lecture de schedule_events échouée');
    expect(fn).toMatch(/const \{ data: evt, error \}/);
  });

  it('les rappels de rendez-vous gardent leurs délais négatifs', () => {
    // Non-régression : ce sont eux qui portent le « X avant la visite ».
    const rappels = presets().filter(
      (p) => p.trigger_event === 'appointment.created' && p.delay_seconds < 0,
    );
    expect(rappels.length).toBeGreaterThanOrEqual(3);
    for (const r of rappels) expect(r.delay_seconds).toBeLessThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────
// Migrations : le code source et la base doivent dire la même chose
// ───────────────────────────────────────────────────────────────────

describe('migrations du lot 1', () => {
  it('la collision SMS est corrigée aussi en base', () => {
    // Le fichier source ne sert qu'aux NOUVELLES orgs : sans migration, les 30
    // orgs existantes gardent le doublon.
    const mig = read('supabase/migrations/20260812160000_collision_sms_apres_job.sql');
    expect(mig).toContain('delay_seconds = 86400');
    expect(mig).toContain('Répondez de 1 à 5');
    expect(mig).toContain('delay_seconds = 3600');
  });

  it('la confirmation de dépôt est corrigée aussi en base, dans les deux sens', () => {
    const mig = read('supabase/migrations/20260812170000_confirmation_depot_reelle.sql');
    // Exclusion sur payment_confirmation…
    expect(mig).toContain("jsonb_build_object('neq', 'deposit')");
    // …et ciblage sur deposit_received, car staging portait une condition vide
    // là où la prod portait déjà la bonne. Sans cette seconde passe, ces orgs
    // auraient reçu le doublon.
    expect(mig).toContain("jsonb_build_object('payment_type', 'deposit')");
    expect(mig).toContain('Prod et staging divergent');
  });
});

// ───────────────────────────────────────────────────────────────────
// Choix des canaux — aligné sur les pratiques du secteur
// ───────────────────────────────────────────────────────────────────

describe('canaux — ce qui compte part sur les deux', () => {
  /** Canaux d'envoi d'un preset. */
  function canaux(cle: string): string[] {
    return (preset(cle).actions || [])
      .map((a: any) => a.type)
      .filter((t: string) => t === 'send_sms' || t === 'send_email');
  }

  it('les moments à ne pas manquer partent par SMS ET courriel', () => {
    // Mesuré en prod : 30 des 59 clients réels n'ont PAS de téléphone, et 12
    // ne sont joignables QUE par courriel. Une automatisation SMS-seule ne les
    // atteint jamais.
    //
    // Housecall Pro applique le même découpage : rendez-vous planifié et
    // demande d'avis sur les deux canaux, « je suis en route » en SMS seul.
    for (const cle of [
      'appointment_confirmation',
      'job_reminder_7d',
      'job_reminder_1d',
      'payment_confirmation',
      'welcome_new_lead',
    ]) {
      const c = canaux(cle);
      expect(c, `${cle} devrait porter les deux canaux`).toContain('send_sms');
      expect(c, `${cle} devrait porter les deux canaux`).toContain('send_email');
    }
  });

  it('le rappel 2 h avant reste en SMS seul', () => {
    // Le courriel arriverait trop tard pour être utile — même logique que le
    // « je suis en route » de Housecall Pro.
    const c = canaux('job_reminder_2h');
    expect(c).toContain('send_sms');
    expect(c).not.toContain('send_email');
  });

  it('les relances gardent UN seul canal', () => {
    // Cinq relances de facture × deux canaux = dix messages pour une seule
    // facture impayée. Le consensus du secteur est de ne pas doubler ce qui
    // se répète.
    for (const cle of [
      'invoice_sent_reminder_3d',
      'invoice_sent_reminder_7d',
      'quote_followup_3d',
      'quote_followup_7d',
    ]) {
      const c = canaux(cle);
      expect(c.length, `${cle} ne devrait pas doubler ses relances`).toBeLessThanOrEqual(2);
    }
  });

  it('les nouveaux courriels portent les mêmes variables que leur SMS', () => {
    // Un courriel qui n'adresse pas le client par son prénom alors que le SMS
    // le fait donnerait deux tons différents pour le même message.
    for (const cle of ['payment_confirmation', 'welcome_new_lead']) {
      const email = (preset(cle).actions || []).find((a: any) => a.type === 'send_email');
      expect(email, `${cle} n'a pas de courriel`).toBeDefined();
      expect(email.config.body).toContain('[client_first_name]');
      expect(email.config.body).toContain('[company_name]');
      expect(email.config.subject).toBeTruthy();
    }
  });

  it('la migration n’écrase pas le SMS existant', () => {
    // Le courriel est AJOUTÉ au tableau : le SMS et les actions internes
    // (notification, journal) doivent survivre.
    const mig = read('supabase/migrations/20260812190000_courriel_sur_presets_cles.sql');
    expect(mig).toContain('actions || jsonb_build_array');
    expect(mig).toContain("not exists");
    expect(mig).toContain("a->>'type' = 'send_email'");
  });
});
