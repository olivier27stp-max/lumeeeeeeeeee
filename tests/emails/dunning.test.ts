/**
 * Relance d'impayé — le filet qui évite qu'un client perde son CRM sans préavis.
 *
 * Avant ce lot : Stripe refusait la carte, le webhook passait l'abonnement en
 * `past_due`, et le gate de src/App.tsx — qui n'accepte que `active` et
 * `trialing` — fermait l'accès le jour même. Aucun courriel n'était envoyé :
 * le handler contenait un `console.warn` et rien d'autre.
 *
 * Le client découvrait donc la coupure en ouvrant son CRM, en pleine journée,
 * pour une carte expirée qu'il aurait corrigée en trente secondes.
 *
 * Ces tests figent les décisions qui font que ça ne peut pas se reproduire.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const payments = read('server/routes/payments.ts');
const billing = read('server/routes/billing.ts');
const emails = read('server/lib/subscription-email.ts');
const engine = read('server/lib/dunning-engine.ts');
const app = read('src/App.tsx');

describe('la date d’impayé est posée une seule fois', () => {
  it('le premier échec date l’abonnement', () => {
    expect(payments).toContain('past_due_since: new Date().toISOString()');
  });

  it('les tentatives suivantes ne repoussent pas la date', () => {
    // Stripe réessaie (Smart Retries) et réémet `invoice.payment_failed` à
    // chaque tentative. Sans le `.is('past_due_since', null)`, la date serait
    // réécrite à chaque fois : la grâce ne se terminerait jamais et le client
    // ne serait jamais suspendu.
    const bloc = payments.slice(payments.indexOf("event.type === 'invoice.payment_failed'"));
    expect(bloc.slice(0, 2000)).toContain(".is('past_due_since', null)");
  });

  it('un paiement réussi efface la date', () => {
    // Sinon la grâce continuerait de courir sur un client à jour, et le cron
    // finirait par suspendre quelqu'un qui a payé.
    const bloc = payments.slice(payments.indexOf("event.type === 'invoice.paid'"));
    expect(bloc.slice(0, 1200)).toContain('past_due_since: null');
  });

  it('la colonne existe en base', () => {
    const mig = read('supabase/migrations/20260813020000_dunning_past_due_since.sql');
    expect(mig).toContain('add column if not exists past_due_since timestamptz');
  });
});

describe('l’accès reste ouvert pendant la grâce', () => {
  it('un past_due dans la fenêtre garde l’accès', () => {
    // Le cœur du correctif : sans cette branche, le courriel d'avertissement
    // arriverait chez quelqu'un déjà dehors.
    expect(app).toContain("subscription?.status === 'past_due' && grace?.actif");
    const bloc = app.slice(app.indexOf("subscription?.status === 'past_due'"));
    expect(bloc.slice(0, 700)).toContain('setHasSubscription(true)');
  });

  it('la durée de grâce est décidée par le serveur', () => {
    // Une règle d'accès ne se calcule pas dans un navigateur. Le front ne
    // reçoit que le verdict.
    expect(billing).toContain('JOURS_DE_GRACE');
    expect(app).not.toContain('JOURS_DE_GRACE');
  });

  it('la grâce dure 7 jours — la fenêtre de relance de Stripe', () => {
    // Couper avant, c'est couper des clients dont le paiement allait aboutir
    // tout seul au deuxième essai.
    expect(emails).toContain('JOURS_DE_GRACE = 7');
  });

  it('un employé sans droit financier reçoit aussi le verdict', () => {
    // Il subit la suspension comme les autres : sans `grace` dans la réponse
    // restreinte, le gate le mettrait dehors pendant que son patron a encore
    // accès.
    const bloc = billing.slice(billing.indexOf('restricted: true'));
    expect(bloc.slice(0, 200)).toContain('grace');
  });

  it('le client est prévenu dans l’app, pas seulement par courriel', () => {
    expect(app).toContain('graceImpaye?.actif');
    expect(app).toContain('/settings/billing');
  });
});

describe('les trois courriels de relance', () => {
  it('les trois existent', () => {
    expect(emails).toContain('export async function sendPaymentFailedEmail');
    expect(emails).toContain('export async function sendDunningReminderEmail');
    expect(emails).toContain('export async function sendAccessSuspendedEmail');
  });

  it('chacun dit comment corriger', () => {
    // Un courriel qui annonce une coupure sans dire quoi faire ne sert à rien.
    expect(emails).toContain('function commentCorriger');
    expect(emails).toContain('Paramètres → Facturation');
  });

  it('le courriel de suspension rassure sur les données', () => {
    // C'est LA question de quelqu'un qui vient de perdre l'accès à son carnet
    // de clients.
    const bloc = emails.slice(emails.indexOf('sendAccessSuspendedEmail'));
    expect(bloc).toContain('conservé');
  });

  it('l’échec de paiement est annoncé à chaque tentative de Stripe', () => {
    // La clé d'idempotence porte le numéro de tentative : sans lui, seul le
    // tout premier échec serait annoncé, et les relances suivantes seraient
    // prises pour des rejeux.
    expect(payments).toContain('${inv.id}:${inv.attempt_count ?? 0}');
  });

  it('un courriel raté ne fait pas rejouer le webhook', () => {
    // La facture est déjà en échec chez Stripe ; faire échouer le webhook ne
    // corrigerait rien et le ferait rejouer en boucle.
    const bloc = payments.slice(payments.indexOf('envoyerCourrielEchecPaiement(stripeSubId'));
    expect(bloc.slice(0, 400)).toContain('catch');
  });
});

describe('le cron de relance', () => {
  it('relance à J+3 et suspend à J+7', () => {
    expect(engine).toContain('JOUR_RELANCE = 3');
    expect(engine).toContain('jours >= JOURS_DE_GRACE');
  });

  it('ne réactive jamais un abonnement de lui-même', () => {
    // Seul Stripe sait si un paiement a abouti — il nous le dit par
    // `invoice.paid`. Un cron qui réactiverait rouvrirait l'accès à un impayé.
    expect(engine).not.toContain("status: 'active'");
  });

  it('ne suspend pas un client qui vient de payer', () => {
    // Garde contre la course entre la lecture et l'écriture.
    // La fenêtre de 400 caractères était trop étroite : le garde-fou existe
    // toujours (dunning-engine.ts, `.eq('status', 'past_due')` sur l'update),
    // mais quelques lignes plus loin depuis l'ajout de son commentaire. Ce
    // test bloquait tout déploiement alors que le code était correct.
    const bloc = engine.slice(engine.indexOf("status: 'canceled'"));
    expect(bloc.slice(0, 900)).toContain(".eq('status', 'past_due')");
  });

  it('pose canceled_at comme partout ailleurs', () => {
    // Les deux autres sites de suspension du produit le font ; sans lui la
    // suspension n'aurait pas de date d'effet.
    expect(engine).toContain('canceled_at');
  });

  it('une erreur de lecture ne fait pas passer le cron pour « aucun impayé »', () => {
    // supabase-js ne lève jamais : sans ce test, le cron se tairait pour
    // toujours sans que rien ne le signale.
    expect(engine).toContain('lecture des impayés impossible');
  });

  it('un abonnement en échec ne prive pas les autres de leur relance', () => {
    const bloc = engine.slice(engine.indexOf('for (const sub of subs'));
    expect(bloc).toContain('abonnement ignoré');
  });

  it('le cron est réellement branché, avec verrou', () => {
    // Un moteur non enregistré ne tourne jamais, sans erreur ni trace.
    const index = read('server/index.ts');
    expect(index).toContain("withAdvisoryLock('dunning-engine'");
    expect(index).toContain('runDunningScan');
    expect(index).toContain("captureCronFailure('dunning-engine-import'");
  });
});

describe('détecteur schema-refs — il doit réellement analyser', () => {
  const script = read('scripts/check-schema-refs.py');

  it('les chemins Windows ne font plus tout ignorer', () => {
    // `os.path.relpath` rend des antislashs sous Windows ('src\lib\x.ts') :
    // le test `startswith('src/')` ne matchait jamais, le détecteur analysait
    // 0 fichier et affichait quand même « aucun écart ».
    //
    // C'est le détecteur que CLAUDE.md décrit comme celui qui a trouvé les
    // jobs récurrents jamais créés et la gamification terrain morte. Il rendait
    // un verdict vert sans rien lire.
    expect(script).toContain("replace(os.sep, '/')");
  });

  it('un accent dans la sortie ne fait plus planter après l’analyse', () => {
    // La console Windows sort en cp1252 : le script mourait sur son propre
    // message de conclusion, verdict perdu.
    expect(script).toContain("reconfigure(encoding='utf-8'");
  });

  it('un octet non-ASCII dans .env.local ne bloque plus le démarrage', () => {
    expect(script).toContain("open(path, encoding='utf-8', errors='replace')");
  });
});

describe('récupération des tâches figées', () => {
  it('ne filtre pas sur une colonne inexistante', () => {
    // `automation_scheduled_tasks` n'a PAS d'`updated_at` (colonnes vérifiées
    // en base). Avec PostgREST une seule colonne inconnue fait échouer toute
    // la requête, et supabase-js ne lève pas : les tâches bloquées en
    // `running` après un redéploiement le restaient pour toujours, en silence.
    const engineAuto = read('server/lib/automationEngine.ts');
    const bloc = engineAuto.slice(engineAuto.indexOf('async function recupererTachesFigees'));
    expect(bloc.slice(0, 900)).not.toContain("lt('updated_at'");
    expect(bloc.slice(0, 900)).toContain("lt('execute_at'");
  });
});
