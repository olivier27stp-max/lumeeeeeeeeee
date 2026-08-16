/* ═══════════════════════════════════════════════════════════════
   Action Executors — Modular actions for the automation engine.
   Each action receives config + context and returns a result.
   ═══════════════════════════════════════════════════════════════ */

import { SupabaseClient } from '@supabase/supabase-js';
import { findOrCreateConversation, normalizeE164, resolvePublicBaseUrl } from '../helpers';

export interface ActionContext {
  supabase: SupabaseClient;
  orgId: string;
  entityType: string;
  entityId: string;
  twilio: { client: any; phoneNumber: string } | null;
  baseUrl: string;
}

export interface ActionResult {
  success: boolean;
  data?: any;
  error?: string;
}

export type ActionType =
  | 'send_email'
  | 'send_sms'
  | 'create_notification'
  | 'send_notification'
  | 'create_task'
  | 'update_status'
  | 'request_review'
  | 'log_activity';

// ── Template variable resolution ─────────────────────────────

export function resolveTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  // Support both {var} and [var] syntax for backward compatibility, normalize to {var}
  return template
    .replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '')
    .replace(/\[(\w+)\]/g, (_, key) => vars[key] ?? '');
}

/**
 * Le contrat à signer d'une job, s'il y en a un en attente.
 *
 * Une confirmation de rendez-vous qui n'apporte pas le document à signer force
 * un second message ; on expose donc le lien aux gabarits :
 *   [contract_link] — l'URL nue
 *   [contract_line] — la phrase complète pour un SMS
 *   [contract_html] — le paragraphe équivalent pour un courriel
 *
 * Les trois sont vides quand il n'y a rien à signer, pour qu'un gabarit qui
 * les contient ne laisse ni trou ni balise orpheline.
 */
async function resolveContractVars(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ contract_link: string; contract_line: string; contract_html: string }> {
  const vide = { contract_link: '', contract_line: '', contract_html: '' };
  if (!jobId) return vide;

  let base = '';
  try {
    base = resolvePublicBaseUrl();
  } catch {
    return vide; // PUBLIC_URL absent : mieux vaut pas de lien qu'un lien cassé.
  }

  const { data, error } = await supabase
    .from('job_agreements')
    .select('view_token, status, require_signature')
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return vide;
  if (!data.require_signature || data.status === 'signed' || !data.view_token) return vide;

  const url = `${base}/contract/${data.view_token}`;
  return {
    contract_link: url,
    contract_line: `Contrat à signer : ${url}`,
    contract_html: `<p>Contrat à signer : <a href="${url}">${url}</a></p>`,
  };
}

/**
 * Le contrat SIGNÉ d'une job, plus le dépôt qui resterait dû.
 *
 * resolveContractVars ne rend rien une fois le document signé — c'est voulu,
 * il n'y a plus rien à signer. Mais la confirmation de signature, elle, a
 * justement besoin du lien à ce moment-là :
 *   [signed_contract_link] l'URL de la copie signée
 *   [deposit_amount]       le dépôt restant, formaté
 *   [deposit_line]         la phrase complète, vide si rien n'est dû
 */
async function resolveSignedContractVars(
  supabase: SupabaseClient,
  jobId: string,
): Promise<{ signed_contract_link: string; deposit_amount: string; deposit_line: string }> {
  const vide = { signed_contract_link: '', deposit_amount: '', deposit_line: '' };
  if (!jobId) return vide;

  let base = '';
  try {
    base = resolvePublicBaseUrl();
  } catch {
    return vide;
  }

  const { data: acc } = await supabase
    .from('job_agreements')
    .select('view_token, status, snapshot')
    .eq('job_id', jobId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!acc?.view_token) return vide;

  const url = `${base}/contract/${acc.view_token}`;

  const { data: job } = await supabase
    .from('jobs')
    .select('deposit_status, currency')
    .eq('id', jobId)
    .maybeSingle();

  const terms = (acc.snapshot as { payment_terms?: { deposit_required?: boolean; deposit_cents?: number } } | null)?.payment_terms;
  const du = terms?.deposit_required && job?.deposit_status !== 'paid'
    ? Math.round(Number(terms.deposit_cents || 0))
    : 0;
  if (du <= 0) return { signed_contract_link: url, deposit_amount: '', deposit_line: '' };

  const montant = new Intl.NumberFormat('fr-CA', {
    style: 'currency',
    currency: (job?.currency || 'CAD').toUpperCase(),
  }).format(du / 100);
  return {
    signed_contract_link: url,
    deposit_amount: montant,
    deposit_line: `Il reste un dépôt de ${montant} à verser, sur cette même page.`,
  };
}

export async function resolveEntityVariables(
  supabase: SupabaseClient,
  orgId: string,
  entityType: string,
  entityId: string,
): Promise<Record<string, string>> {
  const vars: Record<string, string> = {};

  // Fetch company settings
  const { data: company } = await supabase
    .from('company_settings')
    .select('company_name, phone, google_review_url')
    .eq('org_id', orgId)
    .maybeSingle();

  if (company) {
    vars.company_name = company.company_name || '';
    vars.company_phone = company.phone || '';
    vars.google_review_url = company.google_review_url || '';
  }

  /**
   * Renseigne les variables client à partir d'une fiche `clients`.
   *
   * Centralise ce que les branches recopiaient, et surtout ajoute un repli :
   * `clients.first_name` est nullable et vide sur une fiche d'entreprise. Sans
   * repli, un message commençant par « Bonjour [client_first_name], » partait
   * en « Bonjour , » — `resolveTemplate` remplaçant une variable absente par
   * une chaîne vide, l'anomalie était invisible dans les journaux et visible
   * seulement par le destinataire.
   */
  const setClientVars = (c: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    phone?: string | null;
    company?: string | null;
  }) => {
    const complet = `${c.first_name || ''} ${c.last_name || ''}`.trim();
    const entreprise = (c.company || '').trim();
    vars.client_first_name = c.first_name || entreprise || complet || '';
    vars.client_last_name = c.last_name || '';
    vars.client_name = complet || entreprise || '';
    vars.client_email = c.email || '';
    vars.client_phone = c.phone || '';
  };

  if (entityType === 'lead') {
    const { data: lead } = await supabase
      .from('clients')
      .select('first_name, last_name, email, phone, company, title, client_id:id')
      .eq('id', entityId)
      .maybeSingle();
    if (lead) {
      setClientVars(lead);
    }
  }

  if (entityType === 'client') {
    const { data: client } = await supabase
      .from('clients')
      .select('first_name, last_name, email, phone, company')
      .eq('id', entityId)
      .maybeSingle();
    if (client) {
      setClientVars(client);
    }
  }

  // Soumissions (table `quotes`).
  //
  // Cette branche MANQUAIT, alors que `quote.sent` et `quote.approved` émettent
  // bien `entityType: 'quote'`. Conséquence mesurée en prod : 322 règles
  // actives réparties sur 46 orgs, et ZÉRO exécution — toute la séquence de
  // relance de soumission et de rappel de dépôt était morte.
  //
  // Les envois échouaient sur « No recipient email/phone » (destinataire
  // résolu depuis `vars.client_email`, absent), et les actions internes
  // créaient des tâches à trous : « Urgent: Quote follow-up — » avec un nom
  // vide, puisque `resolveTemplate` remplace une variable inconnue par une
  // chaîne vide plutôt que de laisser le placeholder visible.
  if (entityType === 'quote') {
    const { data: quote } = await supabase
      .from('quotes')
      .select('quote_number, total_cents, currency, valid_until, client_id, lead_id, job_id')
      .eq('id', entityId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (quote) {
      vars.quote_number = quote.quote_number || '';
      vars.quote_total = quote.total_cents
        ? new Intl.NumberFormat('en-CA', { style: 'currency', currency: quote.currency || 'CAD' })
            .format(Number(quote.total_cents) / 100)
        : '$0.00';
      vars.quote_valid_until = quote.valid_until || '';

      // `quotes` porte DEUX liens vers `clients` : `client_id` (client
      // converti) et `lead_id` (prospect). Même repli que la route d'envoi de
      // soumission, sinon un devis encore au stade prospect ne résout rien.
      const contactId = quote.client_id || quote.lead_id;
      if (contactId) {
        const { data: c } = await supabase
          .from('clients')
          .select('first_name, last_name, email, phone, company')
          .eq('id', contactId)
          .maybeSingle();
        if (c) {
          setClientVars(c);
        }
      }
      if (quote.job_id) {
        const { data: j } = await supabase.from('jobs').select('title').eq('id', quote.job_id).maybeSingle();
        if (j) vars.job_name = j.title || '';
      }
    }
  }

  if (entityType === 'job') {
    const { data: job } = await supabase
      .from('jobs')
      .select('title, client_id')
      .eq('id', entityId)
      .maybeSingle();
    if (job) {
      vars.job_name = job.title || '';
      if (job.client_id) {
        const { data: c } = await supabase.from('clients').select('first_name, last_name, email, phone, company').eq('id', job.client_id).maybeSingle();
        if (c) {
          setClientVars(c);
        }
      }
      Object.assign(vars, await resolveContractVars(supabase, entityId));
      Object.assign(vars, await resolveSignedContractVars(supabase, entityId));
    }
  }

  if (entityType === 'invoice') {
    const { data: inv } = await supabase
      .from('invoices')
      .select('invoice_number, due_date, total_cents, client_id, job_id')
      .eq('id', entityId)
      .maybeSingle();
    if (inv) {
      vars.invoice_number = inv.invoice_number || '';
      vars.invoice_due_date = inv.due_date || '';
      vars.invoice_total = inv.total_cents ? `$${(inv.total_cents / 100).toFixed(2)}` : '$0.00';
      if (inv.client_id) {
        const { data: c } = await supabase.from('clients').select('first_name, last_name, email, phone, company').eq('id', inv.client_id).maybeSingle();
        if (c) {
          setClientVars(c);
        }
      }
      if (inv.job_id) {
        const { data: j } = await supabase.from('jobs').select('title').eq('id', inv.job_id).maybeSingle();
        if (j) vars.job_name = j.title || '';
      }
    }
  }

  if (entityType === 'appointment' || entityType === 'schedule_event') {
    // schedule_events → job → client (schedule_events has no direct client_id)
    const { data: evt } = await supabase
      .from('schedule_events')
      .select(`
        id, job_id, start_at, start_time, end_at, end_time, notes, status,
        job:jobs!schedule_events_job_id_fkey(
          id, title, property_address, client_id, client_name,
          clients:clients!jobs_client_id_fkey(first_name, last_name, email, phone, company)
        )
      `)
      .eq('id', entityId)
      .maybeSingle() as any;
    if (evt) {
      const startField = evt.start_at || evt.start_time;
      if (startField) {
        const d = new Date(startField);
        vars.appointment_date = d.toLocaleDateString('fr-CA');
        vars.appointment_time = d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
      }
      vars.appointment_title = evt.job?.title || '';
      // `jobs.property_address` a pour DEFAULT '-' : sans ce filtre, le client
      // recevait littéralement « Adresse : - ».
      const adresse = (evt.job?.property_address || '').trim();
      vars.appointment_address = adresse === '-' ? '' : adresse;
      vars.job_name = evt.job?.title || '';
      const c = evt.job?.clients;
      if (c) {
        setClientVars(c);
      } else if (evt.job?.client_name) {
        vars.client_name = evt.job.client_name;
        vars.client_first_name = evt.job.client_name.split(' ')[0] || '';
      }
      if (evt.job_id) Object.assign(vars, await resolveContractVars(supabase, evt.job_id));
    }
  }

  return vars;
}

// ── Action: Send Email ──────────────────────────────────────

export async function executeSendEmail(
  config: { to?: string; subject: string; body: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const to = config.to ? resolveTemplate(config.to, vars) : vars.client_email;
  if (!to) return { success: false, error: 'No recipient email' };

  const subject = resolveTemplate(config.subject, vars);
  const body = resolveTemplate(config.body, vars);

  try {
    const { sendEmail, isMailerConfigured } = await import('../mailer');
    if (!isMailerConfigured()) return { success: false, error: 'SMTP not configured' };

    // Identité de l'ORG, pas de Lume.
    //
    // Ces courriels partaient au nom de « Lume CRM » avec l'adresse SMTP de la
    // plateforme en Reply-To : le client d'un locataire recevait « Rappel :
    // facture INV-042 » signé Lume, et sa réponse atterrissait dans la boîte de
    // la plateforme au lieu de celle de l'entrepreneur. Le HTML partait aussi
    // brut — sans logo, sans pied de page, sans numéros de taxes — alors que
    // tous les autres envois du produit utilisent ce layout.
    //
    // `senderFor` conserve l'adresse d'expédition VÉRIFIÉE de la plateforme
    // (SPF/DKIM) : seuls le nom affiché et le Reply-To sont ceux du tenant.
    // Envoyer depuis l'adresse réelle de chaque org exigerait une config DNS
    // par client et casserait la délivrabilité de tout le monde.
    // Conformité CASL : ces courriels sont des communications COMMERCIALES
    // (relances, suivis, réengagement à 90 jours), pas des documents demandés
    // par le client. Ils exigent donc un mécanisme de retrait fonctionnel, et
    // le respect de ceux qui s'en sont déjà servis.
    const { isEmailUnsubscribed, getUnsubscribeUrl } = await import('../notificationHelpers');
    if (await isEmailUnsubscribed(ctx.supabase, ctx.orgId, to)) {
      return { success: false, error: `Recipient ${to} has unsubscribed from marketing emails` };
    }

    const { getCompanySettings, buildEmailLayout, senderFor } = await import('../../routes/emails');
    const company = await getCompanySettings(ctx.orgId);
    const unsubUrl = await getUnsubscribeUrl(ctx.supabase, ctx.orgId, to);

    // Lien visible en pied de page + en-têtes standards : Gmail et Outlook
    // affichent alors leur bouton natif « Se désabonner », ce qui améliore
    // aussi nettement la délivrabilité.
    const pied = unsubUrl
      ? `<p style="margin:24px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
           <a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">Se désabonner de ces communications</a>
         </p>`
      : '';

    const result = await sendEmail({
      ...senderFor(company),
      to,
      subject,
      html: buildEmailLayout(company, body + pied),
      ...(unsubUrl
        ? {
            headers: {
              'List-Unsubscribe': `<${unsubUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          }
        : {}),
    });
    if (!result.sent) return { success: false, error: result.error || 'Send failed' };

    // Trace visible dans l'app : sans cette ligne, un courriel d'automatisation
    // n'existait que chez le fournisseur SMTP (les SMS, eux, sont loggés dans
    // Messages). La timeline de l'entité (ActivityTimeline) lit activity_log.
    // Best-effort : un échec de journalisation ne doit pas faire échouer
    // l'envoi, mais il doit être visible dans les logs serveur.
    const { error: logError } = await ctx.supabase.from('activity_log').insert({
      org_id: ctx.orgId,
      entity_type: ctx.entityType,
      entity_id: ctx.entityId,
      event_type: 'email_sent',
      metadata: { to, subject, source: 'automation' },
    });
    if (logError) {
      console.error(`[actions/send_email] activity_log insert failed (org ${ctx.orgId}, ${ctx.entityType} ${ctx.entityId}):`, logError.message);
    }

    return { success: true, data: { to, subject } };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Action: Send SMS ────────────────────────────────────────

export async function executeSendSms(
  config: { to?: string; body: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  if (!ctx.twilio) return { success: false, error: 'Twilio not configured' };

  const to = config.to ? resolveTemplate(config.to, vars) : vars.client_phone;
  if (!to) return { success: false, error: 'No recipient phone' };

  // CASL compliance — manual sends already blocked opted-out recipients, but
  // automations bypassed the list entirely and kept texting after a STOP.
  const optOutPhone = normalizeE164(to);
  const { data: optOut } = await ctx.supabase
    .from('sms_opt_outs')
    .select('id')
    .eq('org_id', ctx.orgId)
    .eq('phone', optOutPhone)
    .maybeSingle();
  if (optOut) {
    return { success: false, error: `Recipient ${optOutPhone} has opted out of SMS (STOP)` };
  }

  const body = resolveTemplate(config.body, vars);

  // Toujours partir du numero DE L'ORG, jamais du numero partage de la
  // plateforme : sinon les automatisations d'un locataire arrivent chez ses
  // clients depuis un numero inconnu, les reponses atterrissent dans la
  // mauvaise boite, et le gate de forfait est contourne.
  let fromNumber: string;
  try {
    const { getOrgSmsFromNumber } = await import('../twilioProvisioning');
    fromNumber = await getOrgSmsFromNumber(ctx.orgId);
  } catch (err: any) {
    return {
      success: false,
      error:
        err?.code === 'plan_excludes_sms'
          ? 'Plan does not include SMS'
          : `Organization has no SMS number provisioned (${err?.code || err?.message || 'unknown'})`,
    };
  }

  try {
    const { getTwilioStatusCallbackUrl } = await import('../config');
    const statusCallback = getTwilioStatusCallbackUrl();
    const sent = await ctx.twilio.client.messages.create({
      body,
      from: fromNumber,
      to,
      // Accusé de réception : la ligne `messages` insérée juste après resterait
      // sinon éternellement à « envoyé », même si le SMS n'arrive jamais.
      ...(statusCallback ? { statusCallback } : {}),
    });

    // Log into the conversations inbox — without this, automation texts were
    // invisible in Messages (they only existed at Twilio) and looked unsent.
    try {
      const normalized = normalizeE164(to);
      const conversation = await findOrCreateConversation(ctx.supabase, ctx.orgId, normalized);
      const { error: logError } = await ctx.supabase.from('messages').insert({
        conversation_id: conversation.id,
        org_id: ctx.orgId,
        client_id: conversation.client_id || null,
        phone_number: normalized,
        direction: 'outbound',
        message_text: body,
        status: 'sent',
        provider_message_id: sent?.sid || null,
      });
      if (logError) {
        console.error(`[actions/send_sms] messages insert failed (org ${ctx.orgId}, sid ${sent?.sid || 'n/a'}):`, logError.message);
      }
    } catch (logErr: any) {
      // Best-effort: a logging failure must not fail the send itself.
      console.error(`[actions/send_sms] conversation logging failed (org ${ctx.orgId}):`, logErr?.message);
    }

    return { success: true, data: { to, body } };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// ── Action: Create Notification ─────────────────────────────

export async function executeCreateNotification(
  config: { title: string; body: string; reference_id?: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const title = resolveTemplate(config.title, vars);
  const body = resolveTemplate(config.body, vars);

  const { error } = await ctx.supabase.from('notifications').insert({
    org_id: ctx.orgId,
    type: 'automation',
    title,
    body,
    reference_id: config.reference_id || ctx.entityId,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, data: { title } };
}

// ── Action: Create Task ─────────────────────────────────────

export async function executeCreateTask(
  config: { title: string; description?: string; due_date?: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const title = resolveTemplate(config.title, vars);
  const description = config.description ? resolveTemplate(config.description, vars) : '';

  // tasks.created_by is NOT NULL and automations run without a user —
  // attribute the task to the org owner so it lands in someone's list.
  const { data: owner } = await ctx.supabase
    .from('memberships')
    .select('user_id')
    .eq('org_id', ctx.orgId)
    .eq('role', 'owner')
    .limit(1)
    .maybeSingle();
  if (!owner?.user_id) return { success: false, error: 'No org owner found to own the task' };

  // `tasks.linked_entity_type` porte un CHECK qui n'admet que cinq valeurs :
  // client, lead, quote, invoice, job. Or le moteur émet aussi
  // `schedule_event`, `payment`, `pipeline_deal`… Écrire `ctx.entityType` tel
  // quel violait donc la contrainte : une règle « quand un rendez-vous est
  // créé → créer une tâche de préparation » échouait à l'insertion, était
  // réessayée trois fois pour rien, puis abandonnée — sans que l'utilisateur
  // ne voie rien. Le bug ne touchait que les règles créées à la main, donc
  // précisément la fonctionnalité annoncée.
  //
  // Un rendez-vous appartient à un job : on rattache la tâche au job porteur
  // quand il existe, plutôt que d'élargir la contrainte.
  const TYPES_VALIDES = ['client', 'lead', 'quote', 'invoice', 'job'];
  let lienType: string | null = ctx.entityType;
  let lienId: string | null = ctx.entityId;

  if (!TYPES_VALIDES.includes(ctx.entityType)) {
    if (ctx.entityType === 'schedule_event' || ctx.entityType === 'appointment') {
      const { data: evt } = await ctx.supabase
        .from('schedule_events')
        .select('job_id')
        .eq('id', ctx.entityId)
        .maybeSingle();
      if (evt?.job_id) {
        lienType = 'job';
        lienId = evt.job_id;
      } else {
        // Visite sans job rattaché : la tâche existe quand même, sans lien.
        lienType = null;
        lienId = null;
      }
    } else {
      // Entité non représentable (paiement, deal…) : tâche sans lien plutôt
      // que pas de tâche du tout.
      lienType = null;
      lienId = null;
    }
  }

  // Column names verified against prod: linked_entity_* (not entity_*),
  // status enum uses 'open' (not 'pending').
  const { error } = await ctx.supabase.from('tasks').insert({
    org_id: ctx.orgId,
    title,
    description: description || null,
    status: 'open',
    linked_entity_type: lienType,
    linked_entity_id: lienId,
    created_by: owner.user_id,
    due_date: config.due_date || null,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, data: { title } };
}

// ── Action: Update Status ───────────────────────────────────

// Le nom de table vient de la configuration d'une règle et l'écriture passe par
// le client service_role : sans liste blanche ni filtre d'org, une règle pouvait
// viser n'importe quelle table et n'importe quelle ligne, RLS contournée.
const UPDATE_STATUS_TABLES = new Set([
  'jobs',
  'quotes',
  'invoices',
  'clients',
  'tasks',
  'schedule_events',
]);

export async function executeUpdateStatus(
  config: { table: string; status: string },
  _vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  if (!UPDATE_STATUS_TABLES.has(config.table)) {
    return { success: false, error: `Table not allowed for update_status: ${config.table}` };
  }

  const { data, error } = await ctx.supabase
    .from(config.table)
    .update({ status: config.status })
    .eq('id', ctx.entityId)
    .eq('org_id', ctx.orgId)
    .select('id');

  if (error) return { success: false, error: error.message };
  // 0 ligne = l'entité n'appartient pas à cette org (ou n'existe plus) :
  // ne pas rapporter un succès pour une écriture qui n'a rien touché.
  if (!data || data.length === 0) {
    return { success: false, error: `No ${config.table} row matched for this organization.` };
  }
  return { success: true, data: { table: config.table, status: config.status } };
}

// ── Action: Request Review ──────────────────────────────────

export async function executeRequestReview(
  _config: Record<string, any>,
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  // 1. Validate google_review_url exists
  if (!vars.google_review_url) {
    return { success: false, error: 'No Google Review URL configured for this company. Set it in Company Settings.' };
  }

  // 1b. Honor the Company Settings "review requests" toggle (it used to be
  // saved but never checked — the setting was write-only).
  const { data: cs } = await ctx.supabase
    .from('company_settings')
    .select('review_enabled')
    .eq('org_id', ctx.orgId)
    .limit(1)
    .maybeSingle();
  if (cs && cs.review_enabled === false) {
    return { success: false, error: 'Review requests are disabled in Company Settings.' };
  }

  // 2. Determine client_id and job_id from entity
  let clientId: string | null = null;
  let jobId: string | null = null;

  if (ctx.entityType === 'job') {
    jobId = ctx.entityId;
    const { data: job } = await ctx.supabase
      .from('jobs')
      .select('client_id')
      .eq('id', ctx.entityId)
      .maybeSingle();
    clientId = job?.client_id || null;
  } else if (ctx.entityType === 'invoice') {
    const { data: inv } = await ctx.supabase
      .from('invoices')
      .select('client_id, job_id')
      .eq('id', ctx.entityId)
      .maybeSingle();
    clientId = inv?.client_id || null;
    jobId = inv?.job_id || null;
  }

  // 3. Validate client has email
  if (!vars.client_email) {
    return { success: false, error: 'Client has no email address.' };
  }

  // 4. Resolve client name: first_name > full name > "Bonjour"
  const clientGreeting = vars.client_first_name
    || vars.client_name
    || 'Bonjour';

  // 5. Anti-duplicate: check if review already sent to this client in last 7 days
  if (clientId) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentReview } = await ctx.supabase
      .from('review_requests')
      .select('id')
      .eq('org_id', ctx.orgId)
      .eq('client_id', clientId)
      .in('status', ['sent', 'clicked', 'submitted'])
      .gte('sent_at', sevenDaysAgo)
      .limit(1)
      .maybeSingle();

    if (recentReview) {
      return { success: false, error: 'A review request was already sent to this client in the last 7 days.' };
    }
  }

  // 6. Generate unique token & create survey
  const token = crypto.randomUUID().replace(/-/g, '');

  const { data: survey, error: surveyError } = await ctx.supabase
    .from('satisfaction_surveys')
    .insert({
      org_id: ctx.orgId,
      client_id: clientId,
      job_id: jobId,
      token,
    })
    .select('id')
    .single();

  if (surveyError) return { success: false, error: surveyError.message };

  // 7. Build survey URL
  const surveyUrl = `${ctx.baseUrl}/survey/${token}`;
  vars.survey_url = surveyUrl;
  vars.review_link = surveyUrl;

  // 8. Try to load custom email template for review_request
  let subject = `${vars.company_name || 'Our team'} — How was your experience?`;
  let body = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h2>Hi ${clientGreeting},</h2>
      <p>We recently completed <strong>${vars.job_name || 'your project'}</strong> and would love to hear your feedback!</p>
      <p>Please take a moment to rate your experience:</p>
      <p style="text-align:center;margin:30px 0;">
        <a href="${surveyUrl}" style="background:#2563eb;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">
          Rate Your Experience
        </a>
      </p>
      <p>Thank you for choosing ${vars.company_name || 'us'}!</p>
    </div>
  `;

  // Check for custom review email template
  const { data: emailTemplate } = await ctx.supabase
    .from('email_templates')
    .select('subject, body')
    .eq('org_id', ctx.orgId)
    .eq('type', 'review_request')
    .eq('is_default', true)
    .eq('is_active', true)
    .maybeSingle();

  if (emailTemplate) {
    // Résolution via `resolveTemplate`, comme partout ailleurs.
    //
    // Ce bloc utilisait un second résolveur maison qui ne comprenait que la
    // syntaxe {var} — alors que TOUS les presets du produit utilisent [var].
    // Un utilisateur composant son modèle en copiant cette syntaxe voyait donc
    // « [client_name] » littéralement dans le courriel reçu par son client :
    // le seul endroit du système où un placeholder brut pouvait atteindre le
    // destinataire.
    //
    // Les variables complètes de l'entité sont désormais disponibles
    // (invoice_number, quote_number, appointment_date…), pas seulement les
    // quatre clés locales ; celles-ci restent prioritaires car elles portent la
    // formule de politesse et le lien du sondage.
    const templateVars: Record<string, string> = {
      ...vars,
      client_name: clientGreeting,
      company_name: vars.company_name || '',
      job_name: vars.job_name || 'your project',
      review_link: surveyUrl,
    };
    subject = resolveTemplate(emailTemplate.subject, templateVars);
    body = resolveTemplate(emailTemplate.body, templateVars);
  }

  // 9. Send email
  const emailResult = await executeSendEmail(
    { subject, body },
    vars,
    ctx,
  );

  // 10. Log review request for tracking
  // C'est aussi ce que lit l'anti-doublon de l'étape 5 : si la ligne n'est pas
  // écrite, la même demande peut repartir chaque jour.
  const { error: trackError } = await ctx.supabase.from('review_requests').insert({
    org_id: ctx.orgId,
    client_id: clientId,
    job_id: jobId,
    survey_id: survey?.id || null,
    subject_sent: subject,
    status: emailResult.success ? 'sent' : 'failed',
    sent_at: emailResult.success ? new Date().toISOString() : null,
  });
  if (trackError) {
    console.error(`[actions/request_review] review_requests insert failed (org ${ctx.orgId}, client ${clientId || 'n/a'}):`, trackError.message);
  }

  // 11. Log activity
  const { error: activityError } = await ctx.supabase.from('activity_log').insert({
    org_id: ctx.orgId,
    entity_type: ctx.entityType,
    entity_id: ctx.entityId,
    related_entity_type: 'client',
    related_entity_id: clientId,
    event_type: 'review_requested',
    metadata: {
      client_name: clientGreeting,
      survey_token: token,
      email_sent: emailResult.success,
    },
  });
  if (activityError) {
    console.error(`[actions/request_review] activity_log insert failed (org ${ctx.orgId}, ${ctx.entityType} ${ctx.entityId}):`, activityError.message);
  }

  // L'action ne vaut que par le courriel : si l'envoi a échoué, la journaliser
  // comme réussie afficherait « exécutée » pour une demande jamais partie.
  if (!emailResult.success) {
    return {
      success: false,
      error: emailResult.error || 'Review request email could not be sent',
      data: { token, surveyUrl, emailSent: false },
    };
  }

  return {
    success: true,
    data: { token, surveyUrl, emailSent: true },
  };
}

// ── Action: Log Activity ────────────────────────────────────

export async function executeLogActivity(
  config: { event_type: string; metadata?: Record<string, any> },
  _vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const { error } = await ctx.supabase.from('activity_log').insert({
    org_id: ctx.orgId,
    entity_type: ctx.entityType,
    entity_id: ctx.entityId,
    event_type: config.event_type,
    metadata: config.metadata || {},
  });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ── Master executor ─────────────────────────────────────────

export async function executeAction(
  actionType: ActionType,
  config: Record<string, any>,
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  switch (actionType) {
    case 'send_email':
      return executeSendEmail(config as any, vars, ctx);
    case 'send_sms':
      return executeSendSms(config as any, vars, ctx);
    case 'create_notification':
    // Alias : les workflows de la table `workflows` (ancien builder) ont été
    // enregistrés avec le type 'send_notification' — même config {title, body}.
    case 'send_notification':
      return executeCreateNotification(config as any, vars, ctx);
    case 'create_task':
      return executeCreateTask(config as any, vars, ctx);
    case 'update_status':
      return executeUpdateStatus(config as any, vars, ctx);
    case 'request_review':
      return executeRequestReview(config, vars, ctx);
    case 'log_activity':
      return executeLogActivity(config as any, vars, ctx);
    default:
      return { success: false, error: `Unknown action type: ${actionType}` };
  }
}
