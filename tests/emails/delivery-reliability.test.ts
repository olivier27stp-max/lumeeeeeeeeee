/**
 * Fiabilité des envois — verrous sur les corrections de la priorité 1.
 *
 * Contrairement à email-send-contract.test.ts (qui FIGE l'existant, bugs
 * compris), ce fichier verrouille des comportements CORRIGÉS. Un échec ici
 * signale une régression, pas une évolution voulue.
 *
 * Les quatre pannes couvertes, toutes vérifiées dans le code avant correction :
 *   1. `sendSmsIfConfigured` avalait tout et retournait `undefined` → les
 *      appelants ne pouvaient pas distinguer envoyé / sauté / échoué ;
 *   2. `reminders-cron` écrivait `status: 'sent'` en base même quand Twilio
 *      rejetait le message (le try/catch était inatteignable) ;
 *   3. le scheduler envoyait depuis le numéro GLOBAL de la plateforme, et
 *      affichait « envoyé » avant même de tenter l'envoi ;
 *   4. créer un job avec une date depuis le modal n'émettait aucun événement
 *      → ni confirmation ni rappel pour le client.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sendSmsIfConfigured, isSmsOptedOut } from '../../server/lib/notificationHelpers';

const root = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

// ───────────────────────────────────────────────────────────────────
// 1. Le contrat de sendSmsIfConfigured — testé en exécution réelle
// ───────────────────────────────────────────────────────────────────

describe('sendSmsIfConfigured — dit désormais ce qui s’est réellement passé', () => {
  const okClient = { messages: { create: async () => ({ sid: 'SM123' }) } };
  const koClient = {
    messages: {
      create: async () => {
        throw new Error('Twilio: unverified number');
      },
    },
  };

  it('envoi réussi → { sent: true } avec le SID', async () => {
    const res = await sendSmsIfConfigured({ client: okClient, phoneNumber: '+15550001' }, '+15550002', 'hello');
    expect(res.sent).toBe(true);
    expect(res.sid).toBe('SM123');
  });

  it('échec Twilio → { sent: false, reason: "send_failed" } et NE LÈVE PAS', async () => {
    // Le non-throw est essentiel : plusieurs appelants comptent dessus pour ne
    // pas interrompre un cron au milieu d'un lot.
    const res = await sendSmsIfConfigured({ client: koClient, phoneNumber: '+15550001' }, '+15550002', 'hello');
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('send_failed');
    expect(res.error).toContain('unverified');
  });

  it('pas de config Twilio → { sent: false, reason: "not_configured" }', async () => {
    expect((await sendSmsIfConfigured(null, '+15550002', 'x')).reason).toBe('not_configured');
    // Un numéro expéditeur vide compte aussi comme « non configuré » : c'est le
    // cas réel quand TWILIO_PHONE_NUMBER n'est pas défini.
    const res = await sendSmsIfConfigured({ client: okClient, phoneNumber: '' }, '+15550002', 'x');
    expect(res.reason).toBe('not_configured');
  });

  it('destinataire sans téléphone → reason "no_recipient", distinct d’un échec', async () => {
    // La distinction compte : « le client n'a pas de téléphone » n'est pas une
    // panne à signaler, « Twilio a refusé » en est une.
    const res = await sendSmsIfConfigured({ client: okClient, phoneNumber: '+15550001' }, null, 'x');
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('no_recipient');
  });

  it('ne lève jamais, quel que soit le cas', async () => {
    await expect(
      sendSmsIfConfigured({ client: koClient, phoneNumber: '+1' }, '+1', 'x'),
    ).resolves.toBeDefined();
  });
});

// ───────────────────────────────────────────────────────────────────
// 2. reminders-cron ne ment plus en base
// ───────────────────────────────────────────────────────────────────

describe('reminders-cron — le journal reflète la réalité', () => {
  const cron = read('server/routes/reminders-cron.ts');

  it('le statut SMS vient du résultat d’envoi, plus d’un try/catch mort', () => {
    expect(cron).toContain('const smsOk = smsRes.sent;');
    // L'ancien `let smsOk = true` suivi d'un catch inatteignable a disparu.
    expect(cron).not.toContain('let smsOk = true;');
  });

  it('canal SMS seul sans envoi possible → une ligne est tracée (fin de la relance perpétuelle)', () => {
    // Sans cette branche, aucune ligne n'était écrite dans reminder_log : la
    // dédup ne trouvait rien et le cron retentait à chaque passage, sans fin.
    expect(cron).toContain("} else if (channel === 'sms') {");
    expect(cron).toContain("'org has no provisioned SMS number");
    expect(cron).toContain("'client has no phone number'");
  });

  it('l’idempotence par (invoice_id, days_after_due, channel) est préservée', () => {
    // Invariant : y toucher provoque des relances dupliquées chez les clients
    // finaux de nos clients.
    expect(cron).toContain(".eq('invoice_id', inv.id)");
    expect(cron).toContain(".eq('days_after_due', daysAfter)");
    expect(cron).toContain(".eq('channel', channel)");
  });

  it('le SMS part toujours du numéro de l’org, jamais d’un numéro partagé', () => {
    expect(cron).toContain('getOrgSmsFromNumber(orgId)');
    expect(cron).toContain('phoneNumber: orgFromNumber');
  });
});

// ───────────────────────────────────────────────────────────────────
// 3. Le scheduler : bon numéro, et notification honnête
// ───────────────────────────────────────────────────────────────────

describe('scheduler — numéro par org et notification fidèle', () => {
  const scheduler = read('server/lib/scheduler.ts');

  it('résout le numéro Twilio de chaque org au lieu du numéro plateforme', () => {
    // Avant : tous les locataires envoyaient depuis TWILIO_PHONE_NUMBER. Si la
    // variable était vide, AUCUN SMS d'automatisation ne partait, en silence.
    expect(scheduler).toContain("await import('./twilioProvisioning')");
    expect(scheduler).toContain('getOrgSmsFromNumber(orgId)');
    expect(scheduler).toContain('async function sendOrgSms');
  });

  it('aucun site n’envoie plus directement avec le numéro global', () => {
    // Ancré sur du code exécutable (`await ...`) : la chaîne nue apparaît aussi
    // dans le commentaire qui explique pourquoi ce détour existe.
    expect(scheduler).not.toMatch(/await sendSmsIfConfigured\(twilio,/);
    // Les 5 déclencheurs passent tous par le chemin unique, qui résout le
    // numéro par org via sendOrgSms.
    expect((scheduler.match(/await runAutomationOnce\(supabase, automation, twilio/g) || []).length).toBe(5);
    expect(scheduler).toContain('await sendOrgSms(twilio, automation.org_id');
  });

  it('l’envoi précède la notification, et la notification reflète le résultat', () => {
    // Avant : la notification était créée AVANT l'appel Twilio et sans jamais
    // regarder son résultat → « envoyé » affiché pour un SMS jamais parti.
    expect(scheduler).toContain('async function notifyAutomationResult');

    const run = scheduler.slice(
      scheduler.indexOf('async function runAutomationOnce'),
      scheduler.indexOf('async function notifyAutomationResult'),
    );
    const send = run.indexOf('await sendOrgSms(');
    const notify = run.indexOf('await notifyAutomationResult(');
    expect(send).toBeGreaterThan(-1);
    expect(notify).toBeGreaterThan(send);
  });

  it('un échec réel produit une notification explicite, pas un faux succès', () => {
    expect(scheduler).toContain('SMS non envoyé');
    expect(scheduler).toContain("aucun numéro SMS n'est configuré");
  });

  it('le titre de notification reste stable, échec compris', () => {
    // Le titre sert de clé à la détection de doublon en base (org_id +
    // reference_id + title). Un titre différent selon l'issue rendrait la
    // garde inopérante dès le premier échec : l'automatisation repartirait au
    // tick suivant. La cause va donc dans le corps, jamais dans le titre.
    const notify = scheduler.slice(
      scheduler.indexOf('async function notifyAutomationResult'),
      scheduler.indexOf('// Recurring invoices'),
    );
    expect(notify).not.toMatch(/`\$\{automation\.name\} — /);
    expect((notify.match(/automation\.name,/g) || []).length).toBe(2);
  });

  it('un client sans téléphone n’est pas signalé comme un échec', () => {
    // Distinction volontaire : rien à envoyer ≠ panne. Sinon on noierait
    // l'utilisateur sous des alertes inutiles.
    expect(scheduler).toContain("smsRes.sent || smsRes.reason === 'no_recipient'");
  });
});

// ───────────────────────────────────────────────────────────────────
// 4. La confirmation de rendez-vous part enfin depuis le modal
// ───────────────────────────────────────────────────────────────────

describe('confirmation de rendez-vous — le chemin principal émet enfin', () => {
  const jobsApi = read('src/lib/jobsApi.ts');

  it('syncJobSchedule émet un événement après avoir planifié', () => {
    // La panne : ce chemin — celui du modal « Nouveau job », le geste le plus
    // courant — n'émettait rien. Ni confirmation, ni rappel J-7/J-1/2h.
    const fn = jobsApi.slice(
      jobsApi.indexOf('async function syncJobSchedule'),
      jobsApi.indexOf('function mapJob'),
    );
    expect(fn).toContain('emitAppointmentCreated');
    expect(fn).toContain('emitAppointmentRescheduled');
  });

  it('distingue création et déplacement via le flag `updated` du RPC', () => {
    // rpc_schedule_job renvoie updated:true quand il DÉPLACE une visite
    // existante. Émettre `created` dans ce cas enverrait une confirmation au
    // client pour un simple changement de date, et laisserait les anciens
    // rappels calés sur l'ancienne heure.
    expect(jobsApi).toContain("if ((data as any)?.updated) emitAppointmentRescheduled(params);");
    expect(jobsApi).toContain('else emitAppointmentCreated(params);');
  });

  it('n’émet rien si le RPC ne renvoie pas d’événement', () => {
    expect(jobsApi).toContain('if (eventId) {');
  });

  it('l’émission ne peut pas faire échouer l’enregistrement du job', () => {
    // fireEvent avale ses erreurs — une automatisation muette ne doit jamais
    // bloquer l'utilisateur qui enregistre son job.
    const events = read('src/lib/automationEventsApi.ts');
    const fire = events.slice(events.indexOf('async function fireEvent'), events.indexOf('/** Notify engine that an appointment'));
    expect(fire).toContain('catch (err)');
    expect(fire).toContain('Non-blocking');
  });

  it('les autres chemins de planification continuent d’émettre', () => {
    // Non-régression : ces trois-là marchaient déjà, ils doivent le rester.
    const scheduleApi = read('src/lib/scheduleApi.ts');
    expect(scheduleApi).toContain('emitAppointmentCreated({');   // scheduleUnscheduledJob + addVisit
    expect(scheduleApi).toContain('emitAppointmentRescheduled({'); // rescheduleEvent
    expect(read('server/lib/recurringJobScheduler.ts')).toContain('appointment.created');
  });
});

// ───────────────────────────────────────────────────────────────────
// 5. Accusé de réception Twilio — on saura enfin si un SMS est arrivé
// ───────────────────────────────────────────────────────────────────

describe('statusCallback — les SMS ne restent plus figés à « envoyé »', () => {
  const SITES = [
    'server/lib/notificationHelpers.ts', // scheduler + relances cron
    'server/routes/messages.ts',
    'server/routes/communications.ts',
    'server/routes/quotes.ts',
    'server/routes/agreements.ts',
    'server/routes/payment-requests.ts',
    'server/lib/actions/index.ts',
  ];

  it('chaque site d’envoi transmet statusCallback à messages.create', () => {
    // Sans ce paramètre PAR MESSAGE, Twilio ne renvoie jamais l'accusé de
    // réception d'un sortant : tout restait à `sent` (= « l'API a accepté »),
    // même pour un message rejeté par l'opérateur.
    for (const site of SITES) {
      expect(read(site), `${site} n'envoie pas de statusCallback`).toContain('statusCallback');
    }
  });

  it('l’URL est centralisée, pas recopiée à sept endroits', () => {
    const config = read('server/lib/config.ts');
    expect(config).toContain('export function getTwilioStatusCallbackUrl');
    for (const site of SITES) {
      expect(read(site)).toContain('getTwilioStatusCallbackUrl');
    }
  });

  it('l’ordre des variables d’URL correspond à celui de la validation de signature', () => {
    // La signature Twilio se valide contre l'URL EXACTE appelée : toute
    // divergence ferait rejeter 100 % des callbacks avec une erreur 403.
    const config = read('server/lib/config.ts');
    const fn = config.slice(
      config.indexOf('export function getTwilioStatusCallbackUrl'),
      config.indexOf('export const stripeWebhookClient'),
    );
    const order = ['TWILIO_WEBHOOK_BASE_URL', 'PUBLIC_URL', 'PUBLIC_BASE_URL', 'FRONTEND_URL'];
    let cursor = -1;
    for (const v of order) {
      const idx = fn.indexOf(v);
      expect(idx, `${v} manquant ou dans le désordre`).toBeGreaterThan(cursor);
      cursor = idx;
    }
    expect(fn).toContain('/api/messages/status');
  });

  it('aucun callback annoncé quand l’URL est absente ou locale', () => {
    // Annoncer une URL relative ou localhost ferait échouer l'appel côté
    // Twilio sans qu'on le sache.
    const config = read('server/lib/config.ts');
    expect(config).toMatch(/localhost\|127\\\.0\\\.0\\\.1/);
    expect(config).toContain('return undefined');
  });

  it('le webhook récepteur reste protégé par signature', () => {
    // Non-régression : ce webhook devient enfin utile, il ne doit pas s'ouvrir.
    const messages = read('server/routes/messages.ts');
    expect(messages).toContain('Twilio.validateRequest');
    expect(messages).toContain("delivered: 'delivered'");
    expect(messages).toContain("undelivered: 'failed'");
    // Un 500 sur échec d'écriture force Twilio à rejouer plutôt que de perdre
    // l'accusé de réception.
    expect(messages).toContain("return res.status(500).json({ error: 'Failed to persist status update' })");
  });
});

// ───────────────────────────────────────────────────────────────────
// 6. Désabonnement STOP — respecté partout, plus seulement 2 sites sur 10
// ───────────────────────────────────────────────────────────────────

describe('conformité CASL — le STOP est respecté sur tous les envois', () => {
  it('isSmsOptedOut détecte un désabonnement', async () => {
    const supa: any = {
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'x' }, error: null }) }) }),
        }),
      }),
    };
    expect(await isSmsOptedOut(supa, 'org1', '+15550001')).toBe(true);
  });

  it('laisse passer quand le numéro n’est pas dans la liste', async () => {
    const supa: any = {
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        }),
      }),
    };
    expect(await isSmsOptedOut(supa, 'org1', '+15550001')).toBe(false);
  });

  it('fail-open sur erreur DB : un incident ne coupe pas toutes les communications', async () => {
    // Choix délibéré : bloquer tous les SMS d'un tenant sur une erreur de
    // lecture serait pire que d'en laisser passer un après un STOP.
    const supa: any = {
      from: () => ({
        select: () => ({
          eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }),
        }),
      }),
    };
    expect(await isSmsOptedOut(supa, 'org1', '+15550001')).toBe(false);
  });

  it('sans numéro, pas de requête inutile', async () => {
    const supa: any = { from: () => { throw new Error('ne doit pas être appelé'); } };
    expect(await isSmsOptedOut(supa, 'org1', null)).toBe(false);
  });

  it('les 6 sites qui ignoraient la liste STOP la vérifient désormais', () => {
    // Avant : seuls messages.ts et actions/index.ts la consultaient. Un client
    // désabonné continuait de recevoir devis, contrats, demandes de paiement
    // et toutes les relances automatiques.
    for (const site of [
      'server/lib/scheduler.ts',        // les 5 automatisations récurrentes
      'server/routes/quotes.ts',        // devis par SMS
      'server/routes/agreements.ts',    // contrats par SMS
      'server/routes/payment-requests.ts',
      'server/routes/reminders-cron.ts',
    ]) {
      expect(read(site), `${site} ne vérifie pas l'opt-out`).toContain('isSmsOptedOut');
    }
  });

  it('les deux sites historiquement conformes le restent', () => {
    expect(read('server/routes/messages.ts')).toContain('sms_opt_outs');
    expect(read('server/lib/actions/index.ts')).toContain('sms_opt_outs');
  });

  it('un opt-out est journalisé comme tel, pas comme une panne d’envoi', () => {
    // Sinon le rapport du cron signalerait des « échecs » pour des clients qui
    // se sont simplement désabonnés.
    expect(read('server/routes/reminders-cron.ts')).toContain("'recipient opted out of SMS (STOP)'");
  });
});

// ───────────────────────────────────────────────────────────────────
// 7. Provisionnement du numéro — les deux parcours d'abonnement
// ───────────────────────────────────────────────────────────────────

describe('provisionnement SMS — branché sur le chemin réellement utilisé', () => {
  it('la logique est partagée, plus enfermée dans le webhook Stripe', () => {
    // Constat en prod : `provisioning_events` était VIDE et 4 orgs payantes sur
    // 5 n'avaient aucun numéro. Cause : la fonction vivait dans payments.ts et
    // n'était appelable que depuis `checkout.session.completed`, alors que les
    // abonnements passent par POST /api/billing/subscribe.
    const lib = read('server/lib/twilioProvisioning.ts');
    expect(lib).toContain('export async function provisionSmsForNewSubscription');
    // La copie locale de payments.ts a disparu au profit de l'import partagé.
    const payments = read('server/routes/payments.ts');
    expect(payments).not.toContain('async function provisionSmsForNewSubscription');
    expect(payments).toContain("await import('../lib/twilioProvisioning')");
  });

  it('billing/subscribe provisionne désormais, sous condition de forfait', () => {
    const billing = read('server/routes/billing.ts');
    expect(billing).toContain('provisionSmsForNewSubscription');
    expect(billing).toContain('plan?.includes_sms && subscription?.id');
  });

  it('le provisionnement ne peut jamais faire échouer un abonnement payé', () => {
    // Un throw côté webhook ferait rejouer Stripe et doublerait le provisioning.
    const lib = read('server/lib/twilioProvisioning.ts');
    const fn = lib.slice(
      lib.indexOf('export async function provisionSmsForNewSubscription'),
      lib.indexOf('async function findAvailableNumber'),
    );
    expect(fn).toContain('return { provisioned: false, error: message }');
    expect(fn).not.toMatch(/^\s*throw err;/m);

    for (const site of ['server/routes/billing.ts', 'server/routes/payments.ts']) {
      expect(read(site)).toContain('non-blocking');
    }
  });

  it('reste idempotent : jamais deux numéros pour la même org', () => {
    const lib = read('server/lib/twilioProvisioning.ts');
    expect(lib).toContain("already_has_channel");
    expect(lib).toContain('restored_pending_release');
  });

  it('l’intention est journalisée AVANT l’achat', () => {
    // Sinon un échec d'achat ne laisserait aucune trace — c'est ce qui rendait
    // le diagnostic impossible.
    const lib = read('server/lib/twilioProvisioning.ts');
    const fn = lib.slice(
      lib.indexOf('export async function provisionSmsForNewSubscription'),
      lib.indexOf('async function findAvailableNumber'),
    );
    const insertIdx = fn.indexOf("from('provisioning_events')");
    const buyIdx = fn.indexOf('await provisionSmsNumber(orgId)');
    expect(insertIdx).toBeGreaterThan(-1);
    expect(buyIdx).toBeGreaterThan(insertIdx);
    // L'échec d'écriture du journal est désormais détecté (il ne l'était pas).
    expect(fn).toContain('if (logErr)');
  });

  it('la route manuelle trace enfin ses tentatives', () => {
    // Un admin qui cliquait « provisionner » et échouait ne laissait aucune
    // trace en base : le support n'avait rien à consulter.
    const comm = read('server/routes/communications.ts');
    const start = comm.indexOf("router.post('/communications/provision-sms'");
    // Le marqueur de fin doit suivre la route : '// A2P 10DLC' apparaît aussi
    // bien plus haut dans le fichier (gate d'envoi), ce qui donnerait une
    // tranche vide.
    const route = comm.slice(start, comm.indexOf("router.get('/communications/a2p/status'", start));
    expect(route).toContain("from('provisioning_events')");
    expect(route).toContain("source: 'manual'");
    expect(route).toContain("status: 'failed'");
    // Le garde de forfait reste en place : acheter un numéro coûte de l'argent.
    expect(route).toContain('orgPlanIncludesSms(orgId)');
  });
});

// ───────────────────────────────────────────────────────────────────
// 8. Accusé de réception au visiteur du formulaire public
// ───────────────────────────────────────────────────────────────────

describe('formulaire public — le visiteur reçoit enfin une confirmation', () => {
  const forms = read('server/routes/request-forms.ts');
  const submit = forms.slice(forms.indexOf("step = 'visitor-ack'"), forms.indexOf("step = 'event-emit'"));

  it('un accusé de réception part vers l’adresse saisie par le visiteur', () => {
    // Avant : seule l'org était prévenue (notification in-app + email au
    // créateur du formulaire). Le visiteur n'avait AUCUN retour et ne pouvait
    // pas savoir si sa demande était passée.
    expect(submit).toContain('to: body.email');
    expect(submit).toContain('sendEmail(');
  });

  it('l’envoi est brandé au nom de l’entreprise, pas de Lume', () => {
    // C'est le client de l'org qui reçoit ce message : il doit voir le nom de
    // l'entreprise, et une réponse doit atterrir dans SA boîte.
    expect(submit).toContain('senderFor(company)');
    expect(submit).toContain('buildEmailLayout(company');
    expect(submit).toContain('getCompanySettings(orgId)');
  });

  it('bilingue fr/en', () => {
    expect(submit).toContain('Nous avons bien reçu votre demande');
    expect(submit).toContain('We received your request');
  });

  it('les valeurs du formulaire public sont échappées', () => {
    // Entrée non authentifiée : un nom contenant du balisage serait sinon
    // interprété dans la boîte de réception du destinataire.
    expect(forms).toContain('function escapeHtml');
    expect(submit).toContain('escapeHtml(fullName)');
    expect(submit).toContain('escapeHtml(body.first_name)');
    expect(submit).toContain('escapeHtml(contactLine)');
  });

  it('un échec d’envoi ne fait jamais échouer la soumission', () => {
    // La demande est déjà enregistrée : la perdre pour un problème de courriel
    // serait bien pire que l'absence d'accusé.
    expect(submit).toContain('catch (e: any)');
    expect(submit).toContain('if (!ack.sent)');
    expect(submit).not.toContain('throw');
  });

  it('la notification à l’org reste en place', () => {
    // Non-régression : l'accusé s'ajoute, il ne remplace rien.
    expect(forms).toContain('form.notify_email !== false && actorId');
    expect(forms).toContain('form.notify_in_app !== false');
  });
});

// ───────────────────────────────────────────────────────────────────
// 9. Doublons : la garde survit aux redéploiements
// ───────────────────────────────────────────────────────────────────

describe('scheduler — plus de doublons au redéploiement', () => {
  const scheduler = read('server/lib/scheduler.ts');

  it('la détection s’appuie sur la base, plus sur la mémoire du processus', () => {
    // Avant : un Set en mémoire, vidé à chaque redémarrage. Le tick suivant
    // (toutes les 5 min) renvoyait les messages déjà envoyés. Avec plusieurs
    // instances, chacune avait sa propre copie.
    expect(scheduler).toContain('async function hasFired');
    expect(scheduler).toContain("from('notifications')");
    expect(scheduler).toContain(".eq('reference_id', refId)");
    expect(scheduler).toContain(".gte('created_at', debutJour)");
  });

  it('la garde couvre l’ENVOI, pas seulement la notification', () => {
    // Le défaut le plus coûteux de l'ancienne version : l'appel SMS était en
    // dehors de la garde, donc il repartait à chaque tick même quand le
    // doublon était détecté. Le client recevait le message en boucle.
    const run = scheduler.slice(
      scheduler.indexOf('async function runAutomationOnce'),
      scheduler.indexOf('async function notifyAutomationResult'),
    );
    const garde = run.indexOf('if (await hasFired(');
    const envoi = run.indexOf('await sendOrgSms(');
    expect(garde).toBeGreaterThan(-1);
    expect(envoi).toBeGreaterThan(garde);
  });

  it('marque AVANT l’envoi — deux ticks rapprochés ne passent pas tous les deux', () => {
    const run = scheduler.slice(
      scheduler.indexOf('async function runAutomationOnce'),
      scheduler.indexOf('async function notifyAutomationResult'),
    );
    expect(run.indexOf('markFired(')).toBeLessThan(run.indexOf('await sendOrgSms('));
  });

  it('fail-open : un incident de lecture ne rend pas les automatisations muettes', () => {
    expect(scheduler).toContain('vérification anti-doublon échouée');
    const has = scheduler.slice(
      scheduler.indexOf('async function hasFired'),
      scheduler.indexOf('function markFired'),
    );
    expect(has).toContain('return false');
  });

  it('les détections internes gardent une garde mémoire dédiée', () => {
    // Facture en retard / devis expiré n'écrivent pas de notification : la
    // vérification en base ne peut pas les couvrir. Un doublon n'y ré-émet
    // qu'un événement interne, sans message au client.
    expect(scheduler).toContain('function hasFiredLocal');
    expect(scheduler).toContain("hasFiredLocal('overdue-detection'");
    expect(scheduler).toContain("hasFiredLocal('quote-expiry'");
  });
});

// ───────────────────────────────────────────────────────────────────
// 10. Sentry : les échecs d'envoi deviennent visibles
// ───────────────────────────────────────────────────────────────────

describe('Sentry — les échecs attrapés remontent quand même', () => {
  it('un échec d’envoi email est signalé', () => {
    // Ces erreurs sont attrapées volontairement pour ne pas casser le flux :
    // le gestionnaire global d'Express ne les voit donc jamais. Sans remontée
    // explicite, un serveur SMTP en panne reste invisible.
    const mailer = read('server/lib/mailer.ts');
    expect(mailer).toContain("await import('./sentry')");
    expect(mailer).toContain("kind: 'email_send_failed'");
  });

  it('un échec d’envoi SMS est signalé, avec le code Twilio', () => {
    // Le code numérique de Twilio est très parlant (21610 = désabonné,
    // 21452 = solde insuffisant) : il permet de regrouper par cause.
    const helpers = read('server/lib/notificationHelpers.ts');
    expect(helpers).toContain("kind: 'sms_send_failed'");
    expect(helpers).toContain('twilio_code: err?.code');
  });

  it('un échec de provisionnement de numéro est signalé', () => {
    // Exactement le type d'incident resté invisible des mois durant :
    // 4 orgs payantes sans numéro, aucune alerte.
    const prov = read('server/lib/twilioProvisioning.ts');
    expect(prov).toContain("kind: 'sms_provisioning_failed'");
    expect(prov).toContain('orgId, subscriptionId');
  });

  it('la remontée ne peut jamais casser l’envoi', () => {
    // Sentry absent ou non configuré ne doit pas faire échouer un envoi.
    for (const f of [
      'server/lib/mailer.ts',
      'server/lib/notificationHelpers.ts',
      'server/lib/twilioProvisioning.ts',
    ]) {
      expect(read(f)).toContain('} catch { /* no-op */ }');
    }
  });

  it('communications.ts vérifie enfin le désabonnement', () => {
    // Ce site avait été oublié : c'était le dernier des 10 points d'envoi
    // à ignorer la liste STOP.
    expect(read('server/routes/communications.ts')).toContain('isSmsOptedOut(serviceClient, orgId, normalizedTo)');
  });
});

// ───────────────────────────────────────────────────────────────────
// 11. Les emails d'automatisation partent au nom de l'entreprise
// ───────────────────────────────────────────────────────────────────

describe('automatisations — identité de l’org, plus de « Lume CRM »', () => {
  const actions = read('server/lib/actions/index.ts');
  const fn = actions.slice(
    actions.indexOf('async function executeSendEmail'),
    actions.indexOf('async function executeSendSms'),
  );

  it('le nom affiché et le Reply-To sont ceux du tenant', () => {
    // Avant : ni `from` ni `replyTo`. Le client d'un locataire recevait
    // « Rappel : facture INV-042 » signé Lume CRM, et sa réponse arrivait dans
    // la boîte de la plateforme au lieu de celle de l'entrepreneur.
    expect(fn).toContain('senderFor(company)');
    expect(fn).toContain('getCompanySettings(ctx.orgId)');
  });

  it('le courriel est brandé (logo, pied de page, numéros de taxes)', () => {
    // Avant : `html: body` brut. Tous les autres envois du produit passent par
    // ce layout — l'automatisation était le seul trou. Le corps porte
    // désormais aussi le lien de désinscription.
    expect(fn).toContain('buildEmailLayout(company, body + pied)');
    expect(fn).not.toMatch(/html:\s*body,/);
  });

  it('l’adresse d’expédition reste celle, vérifiée, de la plateforme', () => {
    // Invariant SPF/DKIM : envoyer depuis l'adresse réelle de chaque org
    // exigerait une config DNS par client et casserait la délivrabilité de
    // tout le monde.
    const emails = read('server/routes/emails.ts');
    const sender = emails.slice(emails.indexOf('export function senderFor'), emails.indexOf('// ── POST /api/emails/send-invoice'));
    expect(sender).toContain('process.env.SMTP_USER');
    expect(sender).not.toMatch(/from:\s*company\.company_email/);
  });

  it('le résultat reste vérifié', () => {
    expect(fn).toContain('if (!result.sent)');
  });
});

// ───────────────────────────────────────────────────────────────────
// 12. Reprise sur échec des tâches planifiées
// ───────────────────────────────────────────────────────────────────

describe('moteur d’automatisation — les échecs transitoires sont réessayés', () => {
  const engine = read('server/lib/automationEngine.ts');

  it('une tâche échouée peut repasser en attente au lieu d’être perdue', () => {
    // Avant : `status: 'failed'` définitif. Le fetch ne sélectionne que les
    // 'pending', donc la tâche n'était PLUS JAMAIS reprise. Mesuré en prod :
    // 8 tâches perdues, dont 6 courriels sur « SMTP not configured ».
    expect(engine).toContain('function nextStateAfterFailure');
    expect(engine).toContain("status: 'pending'");
    expect(engine).toContain('execute_at:');
  });

  it('le compteur de tentatives est enfin LU, pas seulement incrémenté', () => {
    expect(engine).toContain('MAX_TASK_ATTEMPTS');
    expect(engine).toContain('dejaTentees < MAX_TASK_ATTEMPTS');
  });

  it('les échecs définitifs ne sont pas réessayés', () => {
    // Un client sans adresse courriel ne le sera pas davantage à la 4e
    // tentative : réessayer ne ferait que polluer les journaux.
    expect(engine).toContain('function isTransientFailure');
    for (const cas of ['no recipient', 'not configured', 'opted out', 'plan does not include']) {
      expect(engine).toContain(cas);
    }
  });

  it('le délai entre reprises est croissant', () => {
    // Laisse à un service externe le temps de se rétablir sans marteler la file.
    expect(engine).toContain('[5, 30, 120]');
  });

  it('un succès ferme la tâche proprement', () => {
    expect(engine).toContain("status: 'completed'");
    expect(engine).toContain('last_error: null');
  });
});

// ───────────────────────────────────────────────────────────────────
// 13. Courriel de vérification : plus de blocage silencieux
// ───────────────────────────────────────────────────────────────────

describe('auth — l’échec du courriel de vérification est remonté', () => {
  const auth = read('server/routes/auth.ts');

  it('sendVerificationEmail retourne son résultat au lieu de void', () => {
    // Avant : `Promise<void>`. Aucun appelant ne pouvait savoir, et le serveur
    // journalisait « Verification email sent » sans aucune preuve.
    expect(auth).toContain('Promise<{ sent: boolean; error?: string }>');
    expect(auth).toContain('return { sent: result.sent, error: result.error }');
  });

  it('le parcours d’achat remonte l’échec au client', () => {
    // Sur ce parcours, le paiement est bloqué tant que l'adresse n'est pas
    // confirmée : un courriel non délivré laissait un client payant coincé.
    expect(auth).toContain('verification_email_sent: verif.sent');
    expect(auth).toContain('verification_email_error');
  });

  it('le renvoi manuel dit s’il a réussi', () => {
    expect(auth).toContain('sent: verif.sent');
  });

  it('plus aucun console.log affirmant un envoi non vérifié', () => {
    expect(auth).not.toContain("console.log('[auth/register-checkout] Verification email sent to:'");
    expect(auth).not.toContain("console.log('[auth] Resent verification email for existing unconfirmed user:'");
  });

  it('SMTP absent est journalisé comme un incident, pas comme une trace', () => {
    expect(auth).toContain('SMTP non configuré');
    expect(auth).toMatch(/console\.error\('\[auth\] SMTP non configuré/);
  });
});

// ───────────────────────────────────────────────────────────────────
// 14. Désabonnement courriel (CASL)
// ───────────────────────────────────────────────────────────────────

describe('désabonnement courriel — le pendant email de STOP', () => {
  const helpers = read('server/lib/notificationHelpers.ts');
  const route = read('server/routes/unsubscribe.ts');
  const actions = read('server/lib/actions/index.ts');

  it('la liste est consultée avant tout envoi commercial', () => {
    // Le SMS respecte STOP sur ses 8 points d'envoi ; l'email n'avait aucun
    // équivalent, et aucun des 23 messages d'automatisation ne portait de lien
    // de retrait.
    expect(helpers).toContain('export async function isEmailUnsubscribed');
    expect(actions).toContain('isEmailUnsubscribed(ctx.supabase, ctx.orgId, to)');
    expect(actions).toContain('has unsubscribed from marketing emails');
  });

  it('un porteur de jeton n’est pas traité comme un désabonné', () => {
    // La ligne est créée à l'avance pour construire le lien du pied de page.
    // Sans ce filtre, le premier courriel envoyé rendrait l'adresse désabonnée.
    const fn = helpers.slice(
      helpers.indexOf('export async function isEmailUnsubscribed'),
      helpers.indexOf('export async function getUnsubscribeUrl'),
    );
    expect(fn).toContain(".neq('category', 'pending')");
  });

  it('fail-open : un incident de lecture ne coupe pas les communications', () => {
    const fn = helpers.slice(
      helpers.indexOf('export async function isEmailUnsubscribed'),
      helpers.indexOf('export async function getUnsubscribeUrl'),
    );
    expect(fn).toContain('return false');
    expect(fn).toContain('envoi autorisé par défaut');
  });

  it('le lien figure dans le pied de page ET dans les en-têtes', () => {
    // Les deux comptent : le lien visible pour l'humain, l'en-tête pour le
    // bouton natif de Gmail/Outlook (qui améliore aussi la délivrabilité).
    expect(actions).toContain("'List-Unsubscribe'");
    expect(actions).toContain("'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'");
    expect(actions).toContain('Se désabonner de ces communications');
  });

  it('la route publique valide le format du jeton', () => {
    // 32 octets en hexadécimal. Filtrer ici évite une requête pour toute URL
    // manifestement invalide.
    expect((route.match(/\^\[a-f0-9\]\{64\}\$/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('le GET et le POST sont tous deux gérés', () => {
    // Le POST est requis par `List-Unsubscribe-Post` : sans lui, le bouton
    // natif de Gmail ne s'affiche pas.
    expect(route).toContain("router.get('/unsubscribe/:token'");
    expect(route).toContain("router.post('/unsubscribe/:token'");
  });

  it('recliquer le lien ne produit pas d’erreur', () => {
    expect(route).toContain('Vous êtes déjà désabonné');
  });

  it('le POST est exempté du contrôle CSRF, par préfixe et non par égalité', () => {
    // Gmail n'envoie aucun en-tête personnalisé. La liste d'exemptions est en
    // correspondance exacte, donc un chemin à jeton variable n'y entre pas.
    const index = read('server/index.ts');
    // Ancré sur les éléments stables plutôt que sur la regex littérale, dont
    // l'échappement rendrait l'assertion fragile.
    expect(index).toContain('unsubscribe');
    expect(index).toContain('[a-f0-9]{64}');
    expect(index).toContain('.test(req.path)) return next();');
  });

  it('le désabonnement n’affecte pas les courriels transactionnels', () => {
    // Reçus, factures et courriels de sécurité ne consultent pas cette liste :
    // c'est légal et attendu.
    for (const f of ['server/routes/emails.ts', 'server/lib/billing-email.ts']) {
      expect(read(f)).not.toContain('isEmailUnsubscribed');
    }
  });
});

// ───────────────────────────────────────────────────────────────────
// 15. Les échecs d'automatisation deviennent visibles dans l'app
// ───────────────────────────────────────────────────────────────────

describe('visibilité — l’utilisateur voit enfin les échecs', () => {
  const api = read('src/lib/automationRulesApi.ts');
  const page = read('src/pages/Automations.tsx');

  it('les journaux d’exécution sont enfin lus par le front', () => {
    // Le moteur écrivait consciencieusement dans cette table depuis toujours ;
    // aucune page ne la lisait. Une automatisation cassée restait affichée
    // « active » avec un badge vert.
    expect(api).toContain("from('automation_execution_logs')");
    expect(api).toContain("eq('result_success', false)");
    expect(api).toContain('export async function getRecentAutomationFailures');
  });

  it('la lecture est cloisonnée par organisation', () => {
    const fn = api.slice(
      api.indexOf('export async function getRecentAutomationFailures'),
      api.indexOf('export async function getFailureCountsByRule'),
    );
    expect(fn).toContain("eq('org_id', orgId)");
  });

  it('un badge signale les échecs sur la règle concernée', () => {
    expect(page).toContain('failureCounts[rule.id]');
    expect(page).toContain('échec(s) dans les 7 derniers jours');
  });

  it('un échec de ce chargement ne casse pas la page', () => {
    // La liste des automatisations doit s'afficher même si les journaux sont
    // illisibles.
    const load = page.slice(page.indexOf('const load = useCallback'), page.indexOf('useEffect(() => { load(); }'));
    expect(load).toContain('Failed to load automation failures');
  });
});
