/**
 * Tests de caractérisation — contrat d'envoi d'emails (phase 0).
 *
 * Ces tests FIGENT le comportement actuel des 10 sites d'envoi, bugs compris.
 * Ils ne disent pas « c'est bien », ils disent « c'est ça aujourd'hui ». Leur
 * rôle est d'être le filet du refactor prévu dans docs/plan-emails-transactionnels.md :
 * si une phase ultérieure change un de ces contrats sans le vouloir, le test casse.
 *
 * Trois d'entre eux (marqués BUG CONNU) verrouillent des défauts réels. La
 * phase 2 les inversera EXPLICITEMENT — leur échec à ce moment-là est le signal
 * attendu que la correction a bien atterri, pas une régression.
 *
 * Pourquoi de l'audit de source plutôt que des routes montées : ces handlers
 * sont couplés à Supabase, Stripe et Twilio à travers des clients construits au
 * niveau module. Les instancier demanderait un mock si large qu'il testerait le
 * mock plus que le code. Le repo utilise déjà ce patron — voir
 * tests/agreements-job-only.test.ts.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** Isole le corps d'une route pour éviter qu'une assertion matche ailleurs dans le fichier. */
function routeBody(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  expect(start, `route introuvable : ${startNeedle}`).toBeGreaterThan(-1);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  return source.slice(start, end === -1 ? undefined : end);
}

// ───────────────────────────────────────────────────────────────────
// Le transport
// ───────────────────────────────────────────────────────────────────

describe('mailer — le contrat de base dont tout le reste dépend', () => {
  const mailer = read('server/lib/mailer.ts');

  it('sendEmail ne throw jamais : il retourne {sent:false} et laisse l’appelant décider', () => {
    // C'est LA raison pour laquelle chaque appelant doit tester result.sent.
    // Si un refactor rend sendEmail throwant, les appelants qui ignorent le
    // résultat se mettraient soudain à faire des 500 — changement de contrat.
    expect(mailer).toContain('return { sent: false, error: err.message }');
    expect(mailer).toMatch(/catch\s*\(err: any\)\s*\{/);
  });

  it('la surface publique reste sendEmail + isMailerConfigured', () => {
    expect(mailer).toContain('export async function sendEmail');
    expect(mailer).toContain('export function isMailerConfigured');
  });

  it('SendEmailParams accepte des en-têtes — List-Unsubscribe est possible', () => {
    // Le champ manquait, ce qui rendait `List-Unsubscribe` techniquement
    // impossible : Gmail et Outlook n'affichaient pas leur bouton natif « Se
    // désabonner », et les courriels commerciaux partaient sans mécanisme de
    // retrait (exposition CASL).
    const params = routeBody(mailer, 'export interface SendEmailParams', 'export interface SendEmailResult');
    expect(params).toMatch(/headers\?: Record<string, string>/);
    // Et les en-têtes sont bien transmis au transport.
    expect(mailer).toContain('...(params.headers ? { headers: params.headers } : {})');
  });

  it('le transport est Nodemailer/SMTP, pas Resend', () => {
    expect(mailer).toContain("import nodemailer from 'nodemailer'");
    expect(mailer).not.toMatch(/from ['"]resend['"]/);
  });
});

// ───────────────────────────────────────────────────────────────────
// Les invariants qu'aucune phase ne doit casser (§3 du plan)
// ───────────────────────────────────────────────────────────────────

describe('invariants — à ne casser sous aucun prétexte', () => {
  const emails = read('server/routes/emails.ts');

  it('senderFor garde l’adresse vérifiée de la plateforme en From, le tenant en Reply-To', () => {
    // Invariant §3.1 : mettre l'email du tenant en From casse SPF/DKIM et la
    // délivrabilité de TOUS les tenants, pas seulement celui-là.
    const fn = routeBody(emails, 'export function senderFor', '// ── POST /api/emails/send-invoice');
    expect(fn).toContain("emailFrom.match(/<([^>]+)>/)?.[1] || process.env.SMTP_USER");
    expect(fn).toContain('from: `${name} <${baseAddr}>`');
    expect(fn).toContain('replyTo: company.company_email || undefined');
    // Le From ne doit jamais être directement l'adresse du tenant.
    expect(fn).not.toMatch(/from:\s*company\.company_email/);
  });

  it('les 3 helpers partagés restent exportés depuis routes/emails.ts', () => {
    // agreements.ts les importe depuis './emails'. La phase 1d les déplacera
    // vers lib/email/layout.ts AVEC un ré-export ici — ce test garantit que le
    // point d'import public ne disparaît pas au passage.
    expect(emails).toContain('export async function getCompanySettings');
    expect(emails).toContain('export function buildEmailLayout');
    expect(emails).toContain('export function senderFor');
    expect(read('server/routes/agreements.ts')).toMatch(
      /import\s*\{[^}]*(getCompanySettings|buildEmailLayout|senderFor)[^}]*\}\s*from\s*['"]\.\/emails['"]/s,
    );
  });

  it('CompanyInfo expose company_email/company_phone (pas email/phone)', () => {
    // §2.3.4 : payment-requests.ts a une interface locale homonyme avec des
    // champs DIFFÉRENTS (email/phone). Unifier naïvement fait disparaître le
    // téléphone du pied de page des emails de paiement, en silence.
    const iface = routeBody(emails, 'export interface CompanyInfo', 'export async function getCompanySettings');
    expect(iface).toContain('company_email');
    expect(iface).toContain('company_phone');

    const pr = read('server/routes/payment-requests.ts');
    expect(pr).toMatch(/interface CompanyInfo/);
    // L'incompatibilité est réelle et doit rester visible tant qu'elle existe.
    expect(pr).toContain('params.company.phone');
  });

  it('getCompanySettings n’échoue jamais : un org sans settings retourne {}', () => {
    const fn = routeBody(emails, 'export async function getCompanySettings', 'export function buildEmailLayout');
    expect(fn).toContain('catch {');
    expect(fn).toContain('return {}');
  });
});

// ───────────────────────────────────────────────────────────────────
// Qui vérifie result.sent, qui ne le vérifie pas
// ───────────────────────────────────────────────────────────────────

describe('vérification de result.sent — l’état des lieux, site par site', () => {
  const emails = read('server/routes/emails.ts');

  it('emails.ts : les 4 routes throw si l’envoi échoue → aucun effet de bord appliqué', () => {
    // Le comportement de référence. Les autres fichiers s'en écartent.
    const matches = emails.match(/if \(!\w*[eE]mailResult\.sent\)/g) || [];
    expect(matches.length).toBe(4);
  });

  it('agreements.ts : vérifie, et le statut draft→sent n’avance qu’après un envoi réussi', () => {
    const ag = read('server/routes/agreements.ts');
    expect(ag).toMatch(/if \(!\w*[eE]mailResult\.sent\)/);
    const sendIdx = ag.indexOf('sendEmail(');
    const statusIdx = ag.indexOf("status: 'sent'", sendIdx);
    expect(statusIdx).toBeGreaterThan(sendIdx);
    // Un contrat déjà signé ne redescend pas en 'sent'.
    expect(ag).toContain("!== 'signed'");
  });

  it('communications.ts : vérifie et throw ; le provider reste "resend" en dur (vestige)', () => {
    const comm = read('server/routes/communications.ts');
    expect(comm).toMatch(/if \(!\w*[rR]esult\.sent\)/);
    // Invariant §3.6 : valeur historiquement fausse, potentiellement lue en
    // aval. On ne la corrige pas dans ce chantier.
    expect(comm).toContain("provider: 'resend'");
  });

  it('actions/index.ts : l’échec remonte via ActionResult, sans throw', () => {
    const actions = read('server/lib/actions/index.ts');
    expect(actions).toMatch(/if \(!result\.sent\)/);
    expect(actions).toMatch(/success:\s*false/);
    // Import dynamique : un déplacement de module ne casserait PAS le build.
    // C'est un piège pour la phase 1 — d'où ce verrou explicite.
    expect(actions).toContain("await import('../mailer')");
  });
});

// ───────────────────────────────────────────────────────────────────
// BUGS CONNUS — la phase 2 inversera ces trois blocs
// ───────────────────────────────────────────────────────────────────

describe('B3 CORRIGÉ — quotes.ts ne ment plus sur l’envoi', () => {
  const quotes = read('server/routes/quotes.ts');
  const route = routeBody(quotes, "router.post('/quotes/send-email'", "router.post('/quotes/send-sms'");

  it('le résultat de sendEmail est lu', () => {
    // Avant : `await sendEmail({...})` nu, retour jamais assigné.
    expect(route).toMatch(/const emailResult = await sendEmail\(\{/);
    expect(route).toContain('if (!emailResult.sent)');
  });

  it('un échec bloque TOUS les effets de bord et renvoie une erreur', () => {
    // Le cœur du bug : l'org voyait « envoyé » partout alors que le client
    // n'avait rien reçu. La route sort maintenant avant d'écrire quoi que ce
    // soit.
    expect(route).toContain("code: 'email_send_failed'");
    expect(route).toContain('return res.status(502)');

    const guardIdx = route.indexOf('if (!emailResult.sent)');
    for (const effect of [
      "status: 'awaiting_response'",  // le devis avance
      "from('quote_send_log')",       // le journal de livraison
      'set_deal_stage',               // le deal bouge dans le pipeline
      "eventBus.emit('quote.sent'",   // les automatisations partent
    ]) {
      expect(route.indexOf(effect, guardIdx), `effet de bord avant la garde : ${effect}`)
        .toBeGreaterThan(guardIdx);
    }
    // Et le 200 optimiste n'est atteint qu'après la garde.
    expect(route.indexOf("return res.json({ ok: true, channel: 'email'")).toBeGreaterThan(guardIdx);
  });

  it('delivery_status est dérivé du résultat, plus écrit en dur', () => {
    expect(route).toContain("delivery_status: emailResult.sent ? 'sent' : 'failed'");
  });

  it('la garde de statut, elle, est correcte : un devis approuvé ne redescend pas', () => {
    // À préserver pendant la correction — c'est le bon comportement.
    expect(route).toContain("['draft', 'awaiting_response', 'changes_requested'].includes(quote.status)");
  });
});

describe('BUG CONNU B6 — payment-requests marque "sent" AVANT d’envoi quoi que ce soit', () => {
  const pr = read('server/routes/payment-requests.ts');
  const route = routeBody(pr, "router.post('/payment-requests/create'", "router.post('/payment-requests/resend'");

  it('updatePaymentRequestStatus(…, "sent") précède l’envoi', () => {
    const statusIdx = route.indexOf("updatePaymentRequestStatus(paymentRequest.id, 'sent'");
    const emailIdx = route.indexOf('sendPaymentEmail(');
    expect(statusIdx).toBeGreaterThan(-1);
    expect(emailIdx).toBeGreaterThan(-1);
    expect(statusIdx).toBeLessThan(emailIdx);
  });

  it('la réponse force status:"sent" même en link_only ou après un échec', () => {
    expect(route).toContain("status: 'sent',");
  });

  it('sendPaymentEmail vérifie bien result.sent — mais l’échec ne bloque rien', () => {
    const fn = routeBody(pr, 'async function sendPaymentEmail', 'async function sendPaymentSms');
    expect(fn).toContain('if (!result.sent) return { sent: false');
    // L'échec finit dans notifications.email.reason, sans jamais changer le statut.
    expect(route).toContain('notifications.email = await sendPaymentEmail(');
  });
});

describe('BUG CONNU B7 — reminders-cron : un échec transitoire bloque la relance à vie', () => {
  const cron = read('server/routes/reminders-cron.ts');

  it('la dédup ne filtre pas sur status → une ligne "failed" bloque autant qu’une "sent"', () => {
    const dedupe = routeBody(cron, "// Dedupe: check log for", '// Fetch client contact');
    expect(dedupe).toContain(".eq('invoice_id', inv.id)");
    expect(dedupe).toContain(".eq('days_after_due', daysAfter)");
    expect(dedupe).toContain(".eq('channel', channel)");
    // Le correctif de phase 2 ajoutera .eq('status', 'sent') ici.
    expect(dedupe).not.toContain("'status'");
  });

  it('une ligne est écrite même quand l’envoi a échoué', () => {
    expect(cron).toContain("status: result.sent ? 'sent' : 'failed'");
  });

  it('channel "both" sans numéro SMS : le fallback existe et doit être préservé', () => {
    // Sans cette branche, l'email part et rien n'est journalisé → relance
    // dupliquée à chaque passage du cron.
    expect(cron).toContain("} else if (channel === 'both' && (inv as any)._email_result) {");
  });

  it('l’échec d’insert du log remonte dans errors[], il n’est pas avalé', () => {
    // C'est ce qui porte l'idempotence (invariant §3.2).
    const fn = routeBody(cron, 'async function insertReminderLog', "router.post('/cron/payment-reminders'");
    expect(fn).toContain('errors.push(');
    expect(fn).toContain('duplicate sends ahead');
  });
});

// ───────────────────────────────────────────────────────────────────
// Effets de bord et events — le contrat observable
// ───────────────────────────────────────────────────────────────────

describe('effets de bord — ce que chaque envoi déclenche', () => {
  it('send-invoice : timestamps, invoice_send_events, activity_log, puis event', () => {
    const emails = read('server/routes/emails.ts');
    const route = routeBody(emails, "router.post('/emails/send-invoice'", "router.post('/emails/send-quote'");
    expect(route).toContain("from('invoice_send_events')");
    expect(route).toContain("event_type: 'invoice_sent'");
    expect(route).toContain("eventBus.emit('invoice.sent'");
    // 'sent' vs 'resent' selon que la facture était en draft.
    expect(route).toMatch(/'sent'\s*:\s*'resent'|'resent'\s*:\s*'sent'/);
  });

  it('send-quote (table invoices) force status:"sent" sans garde — divergent de quotes.ts', () => {
    // §2.3.8 : deux politiques opposées sur deux tables. La phase 2 alignera.
    const emails = read('server/routes/emails.ts');
    const route = routeBody(emails, "router.post('/emails/send-quote'", "router.post('/emails/send-mobile-quote'");
    expect(route).toContain("status: 'sent'");
    expect(route).not.toContain('includes(');
  });

  it('send-mobile-quote (table quotes) a, lui, une garde de statut', () => {
    const emails = read('server/routes/emails.ts');
    const route = routeBody(emails, "router.post('/emails/send-mobile-quote'", "router.post('/emails/send-custom'");
    expect(route).toContain("status: 'awaiting_response'");
    expect(route).toContain(".in('status', ['draft', 'changes_requested'])");
  });

  it('send-custom est réservé aux admin/owner et ne laisse aucune trace en base', () => {
    const emails = read('server/routes/emails.ts');
    const route = routeBody(emails, "router.post('/emails/send-custom'", 'export default router');
    expect(route).toMatch(/admin|owner/);
    expect(route).not.toContain('.insert(');
  });

  it('les noms d’events sont des données stockées chez les tenants — ils ne se renomment pas', () => {
    // Invariant §3.3 : ces chaînes vivent en trigger_event dans les règles
    // d'automatisation déjà provisionnées. Les changer casse la prod.
    const emails = read('server/routes/emails.ts');
    const quotes = read('server/routes/quotes.ts');
    expect(emails).toContain("eventBus.emit('invoice.sent'");
    expect(emails).toContain("eventBus.emit('estimate.sent'");
    expect(quotes).toContain("eventBus.emit('quote.sent'");
  });
});

// ───────────────────────────────────────────────────────────────────
// Les absences — ce que le plan va combler
// ───────────────────────────────────────────────────────────────────

describe('état de départ — les manques que les phases 1 à 4 vont combler', () => {
  it('aucun email de dunning : invoice.payment_failed ne fait qu’un console.warn', () => {
    // §1.5 — le trou le plus coûteux. Phase 3.
    // Le webhook est une suite de `if (event.type === ...)`, pas un switch.
    const payments = read('server/routes/payments.ts');
    const handler = routeBody(
      payments,
      "if (event.type === 'invoice.payment_failed')",
      "if (event.type === 'charge.refunded')",
    );
    expect(handler).toContain('console.warn');
    expect(handler).not.toContain('sendEmail');
    expect(handler).toContain("'past_due'");
  });

  it('past_due est exclu du gate d’accès → coupure immédiate, sans grâce', () => {
    // Phase 3 ajoutera past_due + fenêtre de 7 jours.
    const app = read('src/App.tsx');
    expect(app).toMatch(/\['active',\s*'trialing'\]/);
  });

  it('aucun reçu au client final quand un paiement aboutit', () => {
    // §B9 — phase 4. Le client paie et ne reçoit rien.
    const payments = read('server/routes/payments.ts');
    const handler = routeBody(
      payments,
      "if (event.type === 'payment_intent.succeeded')",
      "if (event.type === 'payment_intent.payment_failed')",
    );
    expect(handler).not.toContain('sendEmail');
  });

  it('clients n’a pas de colonne de langue → bilingue niveau B impossible en l’état', () => {
    // §1.3 — phase 1a ajoutera clients.preferred_language.
    // Le snapshot entoure les noms de table de backticks.
    const snapshot = read('supabase/SCHEMA_SNAPSHOT.md');
    const clientsSection = routeBody(snapshot, '### `clients`', '### `');
    expect(clientsSection).toMatch(/`email`/); // on est bien dans la bonne section
    expect(clientsSection).not.toMatch(/`(preferred_language|language|locale)`/);
  });

  it('memberships.language existe mais n’est JAMAIS écrit — ne pas s’y fier', () => {
    // Le piège du §1.3. La vraie source côté A est user_metadata.language.
    const serverFiles = [
      'server/routes/onboarding.ts',
      'server/routes/invitations.ts',
      'server/routes/request-forms.ts',
    ];
    for (const f of serverFiles) {
      const src = read(f);
      // Aucun insert/update de memberships ne porte le champ language.
      const writes = src.match(/from\('memberships'\)[\s\S]{0,400}?(insert|update|upsert)\([\s\S]{0,400}?\)/g) || [];
      for (const w of writes) {
        expect(w, `${f} écrit memberships.language — le §1.3 du plan est à revoir`).not.toMatch(/\blanguage\b/);
      }
    }
    // Et la seule lecture retombe donc toujours sur le défaut 'fr'.
    expect(read('server/routes/request-forms.ts')).toMatch(/\?\.language === 'en' \? 'en' : 'fr'/);
  });

  it('aucune table de log email générique, aucun désabonnement', () => {
    const snapshot = read('supabase/SCHEMA_SNAPSHOT.md');
    expect(snapshot).not.toMatch(/^### `email_log`/m);
    expect(snapshot).not.toMatch(/^### `email_unsubscribes`/m);
  });

  it('les 2 seules idempotences email existantes sont billing_receipt_log et reminder_log', () => {
    const snapshot = read('supabase/SCHEMA_SNAPSHOT.md');
    expect(snapshot).toMatch(/^### `billing_receipt_log`/m);
    expect(snapshot).toMatch(/^### `reminder_log`/m);
  });
});
