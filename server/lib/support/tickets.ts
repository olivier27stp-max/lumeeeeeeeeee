/**
 * Tickets de support : création, escalade vers Slack (ou courriel en repli),
 * relais des messages dans les deux sens, notification du client.
 *
 * Toutes les écritures passent par le client service_role ; org_id et user_id
 * viennent du contexte serveur, jamais du corps de la requête.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail, isMailerConfigured } from '../mailer';
import { emailFrom, supportEmail } from '../config';
import { resolvePublicBaseUrl } from '../helpers';
import { isSlackConfigured, canalSupport, envoyerMessageSlack, echapperSlack } from '../slack';
import { logger } from '../logger';

// Forfaits prioritaires (« Support prioritaire » sur la page des prix).
const PRIORITY_PLANS = new Set(['pro', 'autopilot', 'enterprise']);
export type SlaKey = '4h' | '1d' | '2d';

export function slaKeyForPlan(plan: string): SlaKey {
  if (plan === 'autopilot' || plan === 'enterprise') return '4h';
  if (plan === 'pro') return '1d';
  return '2d';
}
export function slaTexte(key: SlaKey, langue: 'fr' | 'en'): string {
  const fr = { '4h': '4 heures ouvrables', '1d': '1 jour ouvrable', '2d': '2 jours ouvrables' };
  const en = { '4h': '4 business hours', '1d': '1 business day', '2d': '2 business days' };
  return (langue === 'fr' ? fr : en)[key];
}

export interface Ticket {
  id: string;
  org_id: string;
  user_id: string | null;
  subject: string;
  category: string | null;
  priority: 'priority' | 'normal';
  plan_slug: string | null;
  sla_key: SlaKey | null;
  status: 'ai' | 'open' | 'answered' | 'closed';
  company_name: string | null;
  user_email: string | null;
  user_name: string | null;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  escalated_at: string | null;
  escalation_reason: string | null;
  last_message_at: string;
  created_at: string;
  closed_at: string | null;
}
export interface MessageTicket {
  id: string;
  ticket_id: string;
  author: 'user' | 'ai' | 'agent' | 'system';
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface ContexteOrg {
  plan: string;
  planLabel: string;
  isPriority: boolean;
  slaKey: SlaKey;
  companyName: string;
  userName: string;
  userEmail: string | null;
  langue: 'fr' | 'en';
}

/** Forfait, priorité, entreprise, langue : lus une fois par requête. */
export async function contexteOrg(admin: SupabaseClient, orgId: string, user: { id: string; email?: string; user_metadata?: Record<string, any> }): Promise<ContexteOrg> {
  const [subRes, companyRes] = await Promise.all([
    admin.from('subscriptions').select('status, plan_id').eq('org_id', orgId).in('status', ['active', 'trialing']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('company_settings').select('company_name, default_language').eq('org_id', orgId).maybeSingle(),
  ]);
  let planRow: { slug?: string; name?: string } | null = null;
  if (subRes.data?.plan_id) {
    const { data } = await admin.from('plans').select('slug, name').eq('id', subRes.data.plan_id).maybeSingle();
    planRow = data;
  }
  const plan = (planRow?.slug || 'starter').toLowerCase();
  const userEmail = user.email || null;
  const langueMeta = user.user_metadata?.language;
  return {
    plan,
    planLabel: planRow?.name || plan.charAt(0).toUpperCase() + plan.slice(1),
    isPriority: PRIORITY_PLANS.has(plan),
    slaKey: slaKeyForPlan(plan),
    companyName: companyRes.data?.company_name || 'Entreprise inconnue',
    userName: (user.user_metadata?.full_name as string | undefined) || userEmail || 'Utilisateur',
    userEmail,
    langue: langueMeta === 'en' ? 'en' : companyRes.data?.default_language === 'en' ? 'en' : 'fr',
  };
}

export async function creerTicket(admin: SupabaseClient, p: {
  orgId: string; userId: string; subject: string; category?: string | null; ctx: ContexteOrg; status: 'ai' | 'open';
  /** D'où le client écrit (défaut : app). Le portail de migration rattache le ticket à sa migration. */
  source?: 'app' | 'migration_portal' | 'public'; migrationId?: string | null;
}): Promise<Ticket> {
  const { data, error } = await admin.from('support_tickets').insert({
    org_id: p.orgId, user_id: p.userId, subject: p.subject.slice(0, 200), category: p.category || null,
    priority: p.ctx.isPriority ? 'priority' : 'normal', plan_slug: p.ctx.plan, sla_key: p.ctx.slaKey, status: p.status,
    company_name: p.ctx.companyName, user_email: p.ctx.userEmail, user_name: p.ctx.userName,
    source: p.source ?? 'app', migration_id: p.migrationId ?? null,
  }).select('*').single();
  if (error) throw new Error(`support_tickets insert : ${error.message}`);
  return data as Ticket;
}

export async function ticketDe(admin: SupabaseClient, ticketId: string, orgId: string, userId: string): Promise<Ticket | null> {
  const { data } = await admin.from('support_tickets').select('*').eq('id', ticketId).eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  return (data as Ticket) || null;
}

export async function messagesDuTicket(admin: SupabaseClient, ticketId: string): Promise<MessageTicket[]> {
  const { data, error } = await admin.from('support_messages').select('id, ticket_id, author, author_name, body, created_at').eq('ticket_id', ticketId).order('created_at', { ascending: true }).limit(200);
  if (error) throw new Error(`support_messages select : ${error.message}`);
  return (data || []) as MessageTicket[];
}

export async function ajouterMessage(admin: SupabaseClient, p: {
  ticket: Pick<Ticket, 'id' | 'org_id'>; author: MessageTicket['author']; body: string; authorName?: string | null; slackTs?: string | null;
}): Promise<MessageTicket | null> {
  const { data, error } = await admin.from('support_messages').insert({
    ticket_id: p.ticket.id, org_id: p.ticket.org_id, author: p.author, author_name: p.authorName || null, body: p.body.slice(0, 10_000), slack_ts: p.slackTs || null,
  }).select('id, ticket_id, author, author_name, body, created_at').maybeSingle();
  if (error) {
    // Doublon Slack (même ts) : le webhook a été rejoué, on ignore.
    if (error.code === '23505') return null;
    throw new Error(`support_messages insert : ${error.message}`);
  }
  await admin.from('support_tickets').update({ last_message_at: new Date().toISOString() }).eq('id', p.ticket.id);
  return data as MessageTicket;
}

// ── Escalade vers un humain ──────────────────────────────────

function enTeteSlack(t: Ticket, ctx: ContexteOrg, motif: string): { text: string; blocks: unknown[] } {
  const tag = t.priority === 'priority' ? ':rotating_light: PRIORITAIRE' : ':speech_balloon: Normal';
  const text = `${tag} · ${ctx.planLabel} — ${t.company_name} : ${t.subject}`;
  const champs = [
    `*Entreprise*\n${echapperSlack(t.company_name || '')}`,
    `*De*\n${echapperSlack(t.user_name || '')}${t.user_email ? ` <mailto:${t.user_email}|${echapperSlack(t.user_email)}>` : ''}`,
    `*Forfait*\n${echapperSlack(ctx.planLabel)}`,
    `*Réponse attendue*\n${slaTexte(t.sla_key || '2d', 'fr')}`,
    ...(t.category ? [`*Catégorie*\n${echapperSlack(t.category)}`] : []),
    `*Org*\n\`${t.org_id}\``,
  ];
  return {
    text,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `${t.priority === 'priority' ? '🚨 ' : '💬 '}${t.subject.slice(0, 140)}`, emoji: true } },
      { type: 'section', fields: champs.map((f) => ({ type: 'mrkdwn', text: f })) },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Motif : ${echapperSlack(motif)} · *Répondez dans ce fil* : le client lit la réponse dans l’app et par courriel.` }] },
    ],
  };
}

function transcriptSlack(messages: MessageTicket[]): string {
  const lignes = messages.slice(-10).map((m) => {
    const qui = m.author === 'user' ? `👤 ${m.author_name || 'Client'}` : m.author === 'ai' ? '🤖 Assistant' : m.author === 'agent' ? `🧑‍💼 ${m.author_name || 'Support'}` : '·';
    return `*${echapperSlack(qui)}* — ${echapperSlack(m.body).slice(0, 700)}`;
  });
  const texte = lignes.join('\n\n');
  return texte.length > 2800 ? `…\n${texte.slice(-2800)}` : texte;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Repli sans Slack : le courriel d'avant, avec le transcript. */
async function escaladerParCourriel(t: Ticket, ctx: ContexteOrg, messages: MessageTicket[], motif: string): Promise<boolean> {
  if (!isMailerConfigured()) return false;
  const priorityTag = t.priority === 'priority' ? 'PRIORITY' : 'Normal';
  const lignes = messages.map((m) => `<p style="margin:0 0 10px;"><strong>${escapeHtml(m.author === 'user' ? (m.author_name || 'Client') : m.author === 'ai' ? 'Assistant' : (m.author_name || 'Support'))}</strong><br/><span style="white-space:pre-wrap;">${escapeHtml(m.body)}</span></p>`).join('');
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a1a2e;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <tr><td style="background:${t.priority === 'priority' ? '#1a1a2e' : '#6b7280'};color:#fff;padding:14px 20px;font-weight:700;font-size:14px;">${priorityTag} SUPPORT REQUEST · ${escapeHtml(ctx.planLabel)} plan</td></tr>
        <tr><td style="padding:20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;line-height:1.6;">
            <tr><td style="color:#6b7280;width:120px;">Company</td><td style="font-weight:600;">${escapeHtml(t.company_name || '')}</td></tr>
            <tr><td style="color:#6b7280;">From</td><td>${escapeHtml(t.user_name || '')}${t.user_email ? ` &lt;${escapeHtml(t.user_email)}&gt;` : ''}</td></tr>
            <tr><td style="color:#6b7280;">Target reply</td><td>${escapeHtml(slaTexte(t.sla_key || '2d', 'en'))}</td></tr>
            <tr><td style="color:#6b7280;">Reason</td><td>${escapeHtml(motif)}</td></tr>
            <tr><td style="color:#6b7280;">Ticket</td><td style="font-family:monospace;font-size:11px;color:#9ca3af;">${t.id}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
          <div style="font-size:14px;font-weight:600;margin-bottom:8px;">${escapeHtml(t.subject)}</div>
          <div style="font-size:13px;line-height:1.7;">${lignes}</div>
        </td></tr>
      </table>
      <p style="font-size:11px;color:#9ca3af;margin-top:12px;">Reply to this email to respond directly to the customer.</p>
    </div>`;
  const r = await sendEmail({ from: emailFrom, to: supportEmail, replyTo: t.user_email || undefined, subject: `[${priorityTag} · ${ctx.planLabel}] ${t.subject}`, html });
  return r.sent;
}

/**
 * Passe le ticket à un humain : ouvre le fil Slack (en-tête + transcript) ou,
 * sans Slack, envoie le courriel d'avant. Idempotent : un ticket déjà escaladé
 * ne rouvre pas de fil.
 */
export async function escaladerTicket(admin: SupabaseClient, ticket: Ticket, ctx: ContexteOrg, motif: string): Promise<{ ok: boolean; canal: 'slack' | 'email' | 'none'; ticket: Ticket }> {
  if (ticket.slack_thread_ts) return { ok: true, canal: 'slack', ticket };
  const messages = await messagesDuTicket(admin, ticket.id);
  const maj: Partial<Ticket> = { status: 'open', escalated_at: new Date().toISOString(), escalation_reason: motif.slice(0, 300) };

  if (isSlackConfigured()) {
    try {
      // Un canal par entreprise (canaux-slack.ts). S'il ne peut pas être créé
      // (scope channels:manage manquant…), le fil va dans #support comme avant.
      const { canalClient, signalerDansSupport } = await import('./canaux-slack');
      let cible = canalSupport();
      let canalEntreprise: Awaited<ReturnType<typeof canalClient>> | null = null;
      try {
        canalEntreprise = await canalClient(admin, ticket.org_id, ticket.company_name || ctx.companyName, ctx.planLabel);
        cible = canalEntreprise.channel_id;
      } catch (e: any) {
        logger.warn('[support] canal client impossible, fil dans #support', { orgId: ticket.org_id, error: e?.message, indice: /missing_scope/.test(String(e?.message)) ? 'ajouter le scope channels:manage à l’app Slack et la réinstaller' : undefined });
      }
      const { text, blocks } = enTeteSlack(ticket, ctx, motif);
      const parent = await envoyerMessageSlack({ channel: cible, text, blocks });
      const transcript = transcriptSlack(messages);
      if (transcript) await envoyerMessageSlack({ channel: parent.channel, thread_ts: parent.ts, text: transcript });
      maj.slack_channel_id = parent.channel;
      maj.slack_thread_ts = parent.ts;
      const { data } = await admin.from('support_tickets').update(maj).eq('id', ticket.id).select('*').single();
      await ajouterMessage(admin, { ticket, author: 'system', body: 'escalated:slack' });
      if (canalEntreprise) await signalerDansSupport(ticket, canalEntreprise, motif);
      return { ok: true, canal: 'slack', ticket: (data as Ticket) || { ...ticket, ...maj } as Ticket };
    } catch (e: any) {
      logger.error('[support] escalade Slack impossible, repli courriel', { ticketId: ticket.id, error: e?.message });
    }
  }
  const envoye = await escaladerParCourriel(ticket, ctx, messages, motif);
  const { data } = await admin.from('support_tickets').update(maj).eq('id', ticket.id).select('*').single();
  await ajouterMessage(admin, { ticket, author: 'system', body: envoye ? 'escalated:email' : 'escalated:none' });
  if (!envoye) logger.error('[support] escalade impossible : ni Slack ni courriel configurés', { ticketId: ticket.id });
  return { ok: envoye, canal: envoye ? 'email' : 'none', ticket: (data as Ticket) || { ...ticket, ...maj } as Ticket };
}

/** Message du client sur un ticket déjà escaladé → dans le fil Slack (ou courriel). */
export async function relayerMessageClient(admin: SupabaseClient, ticket: Ticket, ctx: ContexteOrg, body: string, auteur: 'client' | 'lumi' = 'client'): Promise<void> {
  if (ticket.slack_thread_ts && ticket.slack_channel_id && isSlackConfigured()) {
    try {
      // Dans le canal de l'entreprise, le client écrit au premier niveau (une
      // conversation, pas un ticket) ; dans #support (repli), dans le fil.
      const { canalClientExistant } = await import('./canaux-slack');
      const canal = await canalClientExistant(admin, ticket.org_id);
      const auPremierNiveau = !!canal && canal.channel_id === ticket.slack_channel_id;
      const entete = auteur === 'lumi' ? '*🤖 Lumi a répondu*' : `*👤 ${echapperSlack(ticket.user_name || 'Client')}*`;
      const r = await envoyerMessageSlack({ channel: ticket.slack_channel_id, ...(auPremierNiveau ? {} : { thread_ts: ticket.slack_thread_ts }), text: `${entete} — ${echapperSlack(body)}` });
      if (auteur === 'client') await admin.from('support_messages').update({ slack_ts: r.ts }).eq('ticket_id', ticket.id).eq('author', 'user').is('slack_ts', null).order('created_at', { ascending: false }).limit(1);
      return;
    } catch (e: any) {
      logger.error('[support] relais Slack impossible', { ticketId: ticket.id, error: e?.message });
    }
  }
  if (isMailerConfigured() && auteur === 'client') {
    await sendEmail({ from: emailFrom, to: supportEmail, replyTo: ticket.user_email || undefined, subject: `Re: [${ticket.priority === 'priority' ? 'PRIORITY' : 'Normal'} · ${ctx.planLabel}] ${ticket.subject}`, html: `<p style="white-space:pre-wrap;font-family:sans-serif;">${escapeHtml(body)}</p>` });
  }
}

/** Un humain a écrit dans ce ticket il y a moins de `minutes` : la conversation est vivante, on ne parle pas par-dessus lui. */
export async function humainActifRecemment(admin: SupabaseClient, ticketId: string, minutes = 30): Promise<boolean> {
  const { data } = await admin.from('support_messages').select('author, created_at').eq('ticket_id', ticketId).in('author', ['agent', 'user']).order('created_at', { ascending: false }).limit(6);
  const dernierAgent = (data ?? []).find((m) => m.author === 'agent');
  return !!dernierAgent && Date.now() - new Date(dernierAgent.created_at).getTime() < minutes * 60_000;
}

/** Réponse d'un humain (Slack) → le client : notification dans l'app + courriel — et le portail de migration si c'est de là qu'il écrivait. */
export async function notifierClientReponse(admin: SupabaseClient, ticket: Ticket, body: string, auteur: string): Promise<void> {
  const langue: 'fr' | 'en' = 'fr';
  const migrationId = (ticket as { migration_id?: string | null }).migration_id ?? null;
  if (migrationId) {
    const { data: mig } = await admin.from('data_migrations').select('assigned_admin, created_by').eq('id', migrationId).maybeSingle();
    const authorId = (mig as { assigned_admin?: string | null; created_by?: string } | null)?.assigned_admin ?? (mig as { created_by?: string } | null)?.created_by ?? ticket.user_id;
    if (authorId) {
      const { error } = await admin.from('migration_messages').insert({ migration_id: migrationId, author_id: authorId, author_kind: 'admin', body: body.slice(0, 10_000) });
      if (error) logger.error('[support] copie dans le portail de migration impossible', { ticketId: ticket.id, error: error.message });
    }
  }
  if (ticket.user_id) {
    const { error } = await admin.from('notifications').insert({
      org_id: ticket.org_id, user_id: ticket.user_id, type: 'support_reply', category: 'support',
      title: langue === 'fr' ? `Réponse du support : ${ticket.subject.slice(0, 80)}` : `Support replied: ${ticket.subject.slice(0, 80)}`,
      body: body.length > 180 ? `${body.slice(0, 177)}…` : body,
      link: `/support?ticket=${ticket.id}`, entity_type: 'support_ticket', entity_id: ticket.id, is_read: false,
    });
    if (error) logger.error('[support] notification impossible', { ticketId: ticket.id, error: error.message });
  }
  if (ticket.user_email && isMailerConfigured()) {
    let base = '';
    try { base = resolvePublicBaseUrl(); } catch { base = ''; }
    const lien = base ? `${base}/support?ticket=${ticket.id}` : '';
    await sendEmail({
      from: emailFrom, to: ticket.user_email, replyTo: supportEmail,
      subject: `Re: ${ticket.subject}`,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a2e;font-size:14px;line-height:1.6;">
        <p><strong>${escapeHtml(auteur)}</strong> (support Lume) :</p>
        <p style="white-space:pre-wrap;">${escapeHtml(body)}</p>
        ${lien ? `<p><a href="${lien}">Répondre dans Lume</a></p>` : ''}
        <p style="font-size:12px;color:#9ca3af;">Vous pouvez aussi répondre à ce courriel.</p>
      </div>`,
    });
  }
}
