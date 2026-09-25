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
import { liensPieces, pieceJointeSlack, LIEN_EQUIPE_S, type Piece } from './captures';
import { logger } from '../logger';
import { rendreCourrielLume, echapper, type LigneDetail } from '../courriels/gabarit';

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
  /** 👍 / 👎 du client sur une réponse de Lumi. */
  avis?: 'bon' | 'mauvais' | null;
  /** Captures jointes par le client (bucket support-captures). */
  pieces?: Piece[] | null;
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

/** Statut à la réouverture : chez l'humain si un fil Slack existe, sinon l'assistant reprend. Pur, testé. */
export function statutReouverture(t: Pick<Ticket, 'slack_thread_ts'>): 'open' | 'ai' {
  return t.slack_thread_ts ? 'open' : 'ai';
}

/**
 * Le client écrit dans une conversation fermée : on la ROUVRE (même fil Slack,
 * même historique) plutôt que de l'obliger à en commencer une autre.
 */
export async function rouvrirTicket(admin: SupabaseClient, t: Ticket): Promise<Ticket> {
  const { data, error } = await admin.from('support_tickets')
    .update({ status: statutReouverture(t), closed_at: null, last_message_at: new Date().toISOString() })
    .eq('id', t.id).select('*').single();
  if (error) throw new Error(`support_tickets reopen : ${error.message}`);
  await ajouterMessage(admin, { ticket: t, author: 'system', body: 'reopened:client' });
  logger.info('[support] conversation rouverte par le client', { ticketId: t.id });
  return data as Ticket;
}

/** Jours sans activité avant de fermer une conversation répondue (ou restée avec l'assistant). `SUPPORT_FERMETURE_APRES_JOURS=0` désactive ; défaut 3. */
export function joursAvantFermeture(env: NodeJS.ProcessEnv = process.env): number {
  if (env.SUPPORT_FERMETURE_APRES_JOURS === '0') return 0;
  const v = Number(env.SUPPORT_FERMETURE_APRES_JOURS);
  return Number.isFinite(v) && v >= 1 ? v : 3;
}

/**
 * Ferme les conversations sans activité : celles où l'équipe a répondu et le
 * client n'est pas revenu (`answered`), et celles restées avec l'assistant
 * (`ai`). Une conversation `open` (le client attend un humain) n'est JAMAIS
 * fermée d'office. Le client peut toujours rouvrir en écrivant.
 */
export async function fermerTicketsInactifs(admin: SupabaseClient, jours: number = joursAvantFermeture()): Promise<number> {
  if (!jours) return 0;
  const limite = new Date(Date.now() - jours * 86_400_000).toISOString();
  const { data, error } = await admin.from('support_tickets')
    .update({ status: 'closed', closed_at: new Date().toISOString() })
    .in('status', ['answered', 'ai'])
    .lt('last_message_at', limite)
    .select('id');
  if (error) { logger.error('[support] fermeture automatique impossible', { error: error.message }); return 0; }
  const n = (data || []).length;
  if (n) logger.info('[support] conversations fermées (inactives)', { n, jours });
  return n;
}

export async function ticketDe(admin: SupabaseClient, ticketId: string, orgId: string, userId: string): Promise<Ticket | null> {
  const { data } = await admin.from('support_tickets').select('*').eq('id', ticketId).eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  return (data as Ticket) || null;
}

export async function messagesDuTicket(admin: SupabaseClient, ticketId: string): Promise<MessageTicket[]> {
  const { data, error } = await admin.from('support_messages').select('id, ticket_id, author, author_name, body, created_at, avis, pieces').eq('ticket_id', ticketId).order('created_at', { ascending: true }).limit(200);
  if (error) throw new Error(`support_messages select : ${error.message}`);
  return (data || []) as MessageTicket[];
}

export async function ajouterMessage(admin: SupabaseClient, p: {
  ticket: Pick<Ticket, 'id' | 'org_id'>; author: MessageTicket['author']; body: string; authorName?: string | null; slackTs?: string | null; pieces?: Piece[];
}): Promise<MessageTicket | null> {
  const { data, error } = await admin.from('support_messages').insert({
    ticket_id: p.ticket.id, org_id: p.ticket.org_id, author: p.author, author_name: p.authorName || null, body: p.body.slice(0, 10_000), slack_ts: p.slackTs || null,
    ...(p.pieces?.length ? { pieces: p.pieces } : {}),
  }).select('id, ticket_id, author, author_name, body, created_at, pieces').maybeSingle();
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
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Motif : ${echapperSlack(motif)} · *Répondez dans ce fil* : le client lit la réponse dans l’app et par courriel. 📌 devant une réponse (ou en réaction) = Lumi la retient pour les prochains clients ; 🔒 devant une note = elle reste ici.` }] },
    ],
  };
}

function libelleAuteur(m: MessageTicket): string {
  return m.author === 'user' ? `👤 ${m.author_name || 'Client'}` : m.author === 'ai' ? '🤖 Assistant' : m.author === 'agent' ? `🧑‍💼 ${m.author_name || 'Support'}` : '·';
}

/**
 * La conversation COMPLÈTE (pas les 10 derniers, pas coupée), en morceaux
 * de ≤ 3 500 caractères pour Slack. Rafba veut la lire en entier dans le
 * canal du client — c'est ce qui lui manquait avec l'extrait.
 */
export function transcriptSlackComplet(messages: MessageTicket[], tailleMax = 3500, liens: Map<string, string> = new Map()): string[] {
  const visibles = messages.filter((m) => m.author !== 'system');
  // Les captures du client : « 📎 <lien signé|nom> » sous son message (liens = chemin → url, signés par l'appelant).
  const lignes = visibles.map((m) => `*${echapperSlack(libelleAuteur(m))}* — ${echapperSlack(m.body)}${pieceJointeSlack((m.pieces || []).filter((p) => liens.has(p.chemin)).map((p) => ({ nom: p.nom, url: liens.get(p.chemin)! })))}`);
  const morceaux: string[] = [];
  let courant = '';
  for (const l of lignes) {
    if (l.length > tailleMax) {
      // Un seul message plus long que la limite : on vide l'en-cours, puis on le tranche.
      if (courant) { morceaux.push(courant); courant = ''; }
      for (let i = 0; i < l.length; i += tailleMax) morceaux.push(l.slice(i, i + tailleMax));
      continue;
    }
    const ajout = courant ? `

${l}` : l;
    if (courant && (courant.length + ajout.length) > tailleMax) { morceaux.push(courant); courant = l; continue; }
    courant += ajout;
  }
  if (courant) morceaux.push(courant);
  return morceaux;
}

/** Export texte de la conversation (fichier .txt déposé dans le canal, si files:write). */
export function transcriptTexte(t: Ticket, messages: MessageTicket[]): string {
  const entete = [`Conversation de support — ${t.company_name || ''}`, `Sujet : ${t.subject}`, `De : ${t.user_name || ''}${t.user_email ? ` <${t.user_email}>` : ''}`, `Ouverte le : ${t.created_at}`, ''];
  const corps = messages.filter((m) => m.author !== 'system').map((m) => `[${m.created_at.slice(0, 16).replace('T', ' ')}] ${libelleAuteur(m)}\n${m.body}\n`);
  return [...entete, ...corps].join('\n');
}

/** Texte libre (message du client, réponse d'un humain) → HTML sûr, sauts de ligne conservés. */
function texteHtml(s: string): string {
  return echapper(s).replace(/\r?\n/g, '<br/>');
}

/** Les lignes d'en-tête d'un courriel interne (escalade, relais) : qui écrit, d'où, sur quel forfait. */
function lignesTicket(t: Ticket, ctx: ContexteOrg, motif?: string): LigneDetail[] {
  return [
    { libelle: 'Entreprise', valeur: t.company_name || ctx.companyName || '—', fort: true },
    { libelle: 'Personne', valeur: `${t.user_name || ctx.userName || ''}${t.user_email ? ` <${t.user_email}>` : ''}`.trim() || '—' },
    { libelle: 'Forfait', valeur: `${ctx.planLabel}${t.priority === 'priority' ? ' · prioritaire' : ''}` },
    { libelle: 'Réponse attendue', valeur: slaTexte(t.sla_key || '2d', 'fr') },
    ...(t.category ? [{ libelle: 'Catégorie', valeur: t.category }] : []),
    ...(motif ? [{ libelle: 'Motif', valeur: motif }] : []),
    { libelle: 'Ticket', valeur: t.id },
  ];
}

/** La conversation, message par message, pour un courriel interne. */
function conversationHtml(messages: MessageTicket[]): string {
  return messages.filter((m) => m.author !== 'system').map((m) => {
    const qui = m.author === 'user' ? (m.author_name || 'Client') : m.author === 'ai' ? 'Assistant' : (m.author_name || 'Support');
    return `<p style="margin:0 0 12px;"><strong>${echapper(qui)}</strong><br/>${texteHtml(m.body)}</p>`;
  }).join('');
}

/** Repli sans Slack : la même escalade, par courriel au support (gabarit Lume, sans signature : alerte interne). */
async function escaladerParCourriel(t: Ticket, ctx: ContexteOrg, messages: MessageTicket[], motif: string): Promise<boolean> {
  if (!isMailerConfigured()) return false;
  const priorityTag = t.priority === 'priority' ? 'PRIORITY' : 'Normal';
  const html = rendreCourrielLume({
    langue: 'fr',
    preheader: `${t.company_name || ctx.companyName} · ${ctx.planLabel} — ${t.subject}`,
    titre: t.priority === 'priority' ? 'Demande de support prioritaire' : 'Demande de support',
    intro: `Un client attend un humain. Répondre à ce courriel répond directement au client.`,
    lignes: lignesTicket(t, ctx, motif),
    corpsHtml: `<p style="margin:0 0 12px;font-weight:700;">${echapper(t.subject)}</p>${conversationHtml(messages)}`,
    signature: null,
  });
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
      // Dans le canal du client, la conversation se lit au premier niveau, en
      // entier ; dans #support (repli), elle reste sous l'en-tête, dans le fil.
      const dansLeFil = canalEntreprise ? {} : { thread_ts: parent.ts };
      const liens = new Map<string, string>();
      for (const m of messages) for (const l of await liensPieces(admin, m.pieces, LIEN_EQUIPE_S)) { const p = (m.pieces || []).find((x) => x.nom === l.nom); if (p) liens.set(p.chemin, l.url); }
      for (const morceau of transcriptSlackComplet(messages, 3500, liens)) {
        await envoyerMessageSlack({ channel: parent.channel, ...dansLeFil, text: morceau });
      }
      // Export .txt de la même conversation (scope files:write ; sinon on s'en passe).
      try {
        const { deposerFichierSlack } = await import('../slack');
        const date = new Date().toISOString().slice(0, 10);
        await deposerFichierSlack({ channel: parent.channel, ...dansLeFil, nom: `conversation-${(ticket.company_name || 'client').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'client'}-${date}.txt`, titre: `Conversation complète — ${ticket.company_name || ''} (${date})`, contenu: transcriptTexte(ticket, messages) });
      } catch (e: any) {
        logger.info('[support] export .txt non déposé dans Slack', { error: e?.message, indice: /missing_scope/.test(String(e?.message)) ? 'ajouter le scope files:write à l’app Slack' : undefined });
      }
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
      const { canalClientExistant, desarchiverSiBesoin } = await import('./canaux-slack');
      const canal = await canalClientExistant(admin, ticket.org_id);
      const auPremierNiveau = !!canal && canal.channel_id === ticket.slack_channel_id;
      if (auPremierNiveau && canal) await desarchiverSiBesoin(admin, canal);
      const entete = auteur === 'lumi' ? '*🤖 Lumi a répondu*' : `*👤 ${echapperSlack(ticket.user_name || 'Client')}*`;
      const r = await envoyerMessageSlack({ channel: ticket.slack_channel_id, ...(auPremierNiveau ? {} : { thread_ts: ticket.slack_thread_ts }), text: `${entete} — ${echapperSlack(body)}` });
      if (auteur === 'client') await admin.from('support_messages').update({ slack_ts: r.ts }).eq('ticket_id', ticket.id).eq('author', 'user').is('slack_ts', null).order('created_at', { ascending: false }).limit(1);
      return;
    } catch (e: any) {
      logger.error('[support] relais Slack impossible', { ticketId: ticket.id, error: e?.message });
    }
  }
  if (isMailerConfigured() && auteur === 'client') {
    const html = rendreCourrielLume({
      langue: 'fr',
      preheader: `${ticket.user_name || 'Client'} — ${body.slice(0, 120)}`,
      titre: 'Nouveau message du client',
      intro: `${ticket.user_name || 'Le client'} a écrit dans la conversation « ${ticket.subject} ». Répondre à ce courriel répond directement au client.`,
      lignes: lignesTicket(ticket, ctx),
      corpsHtml: `<p style="margin:0;"><strong>${echapper(ticket.user_name || 'Client')}</strong><br/>${texteHtml(body)}</p>`,
      signature: null,
    });
    await sendEmail({ from: emailFrom, to: supportEmail, replyTo: ticket.user_email || undefined, subject: `Re: [${ticket.priority === 'priority' ? 'PRIORITY' : 'Normal'} · ${ctx.planLabel}] ${ticket.subject}`, html });
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
    const prenom = (ticket.user_name || '').trim().split(/\s+/)[0] || '';
    await sendEmail({
      from: emailFrom, to: ticket.user_email, replyTo: supportEmail,
      subject: `Re: ${ticket.subject}`,
      html: rendreCourrielLume({
        langue,
        preheader: body.slice(0, 140),
        titre: langue === 'fr' ? 'Réponse du support' : 'Support replied',
        salutation: prenom ? (langue === 'fr' ? `Bonjour ${prenom},` : `Hi ${prenom},`) : null,
        intro: langue === 'fr' ? `${auteur}, du support Lume, te répond au sujet de « ${ticket.subject} » :` : `${auteur} from Lume support replied about "${ticket.subject}":`,
        corpsHtml: `<p style="margin:0;padding:14px 16px;background:#f9fafb;border-left:3px solid #111827;border-radius:6px;">${texteHtml(body)}</p>`,
        bouton: lien ? { texte: langue === 'fr' ? 'Répondre dans Lume' : 'Reply in Lume', url: lien } : null,
        note: langue === 'fr' ? 'Tu peux aussi répondre directement à ce courriel.' : 'You can also reply directly to this email.',
        supportEmail,
      }),
      // Envoi de fond (réponse relayée depuis Slack) : un échec transitoire part dans la file de reprise.
      reessayer: true,
    });
  }
}
