/**
 * Support en deux niveaux.
 *
 *   POST /support/chat            { ticketId?, message, humain? }  → l'assistant IA répond ; il transfère à un humain quand il le faut (ou tout de suite si `humain`)
 *   POST /support/:id/messages    { message }                       → message du client sur un ticket escaladé → fil Slack
 *   POST /support/:id/escalate    { reason? }                       → « Parler à un humain »
 *   POST /support/:id/close
 *   GET  /support/tickets                                           → mes conversations récentes
 *   GET  /support/tickets/:id                                       → une conversation + ses messages
 *   POST /support                 { subject, message, category? }  → formulaire classique (repli quand l'IA n'est pas configurée) : ticket escaladé d'emblée
 *
 * Le serveur est la seule autorité sur l'org, l'utilisateur, le forfait et la
 * priorité. Les réponses humaines arrivent par routes/webhooks-slack.ts.
 */
import { Router, type Request, type Response } from 'express';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { validate, supportRequestSchema, supportChatSchema, supportMessageSchema, supportEscalateSchema, supportAvisSchema } from '../lib/validation';
import { sendSafeError } from '../lib/error-handler';
import { redisRateLimit } from '../lib/rate-limiter';
import { userKey } from '../lib/security';
import { supportEmail } from '../lib/config';
import { isMailerConfigured } from '../lib/mailer';
import { isSlackConfigured } from '../lib/slack';
import { isSupportIAConfigured, repondreSupportIA } from '../lib/support/ia';
import { dossierClient } from '../lib/support/dossier';
import { reponseFaqPour } from '../lib/support/faq';
import { statutMigrationPour, demarrerMigrationPour } from '../lib/support/migration-outils';
import { journaliserTrace } from '../lib/lumi/traces';
import { embed, chercherSemantique, memoriserSemantique, oublierSemantique } from '../lib/lumi/cache-semantique';
import { versionOrg } from '../lib/lumi/version-org';
import { PLAFOND_MODELE_PAR_JOUR, reponsesModeleAujourdhui, texteAuPlafond, PORTEE_CACHE_SUPPORT, PORTEE_CACHE_SUPPORT_GLOBALE, outilsDeDoc, reponseGenerique } from '../lib/support/garde-fous';
import {
  contexteOrg, creerTicket, ticketDe, messagesDuTicket, ajouterMessage, escaladerTicket, relayerMessageClient, humainActifRecemment, slaTexte, rouvrirTicket,
  type Ticket, type MessageTicket,
} from '../lib/support/tickets';

const router = Router();

// Même préréglage que Lumi : 60 tours par personne et par heure — un humain
// n'y arrive jamais, un script oui.
const limiteChat = redisRateLimit({ preset: 'lumi', keyFn: (req) => `support:${userKey(req)}` });

function vue(t: Ticket, messages: MessageTicket[] = []) {
  return {
    id: t.id, subject: t.subject, category: t.category, status: t.status, priority: t.priority, slaKey: t.sla_key,
    createdAt: t.created_at, lastMessageAt: t.last_message_at, escalatedAt: t.escalated_at, closedAt: t.closed_at,
    messages: messages.filter((m) => m.author !== 'system').map((m) => ({ id: m.id, author: m.author, authorName: m.author_name, body: m.body, createdAt: m.created_at, avis: m.avis ?? null })),
  };
}

async function marquerLu(admin: ReturnType<typeof getServiceClient>, ticketId: string) {
  await admin.from('support_messages').update({ read_by_user_at: new Date().toISOString() }).eq('ticket_id', ticketId).eq('author', 'agent').is('read_by_user_at', null);
}

// ── Conversation avec l'assistant ────────────────────────────
router.post('/support/chat', limiteChat, validate(supportChatSchema), async (req: Request, res: Response) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { ticketId, message, humain, origine, page } = req.body as { ticketId?: string; message: string; humain?: boolean; origine?: 'texte' | 'suggestion'; page?: string };
    const admin = getServiceClient();

    if (!isSupportIAConfigured() && !humain) {
      return res.status(503).json({ error: 'Support assistant is not configured.', code: 'ai_unconfigured', supportEmail });
    }

    const ctx = await contexteOrg(admin, auth.orgId, auth.user);
    let ticket: Ticket | null = ticketId ? await ticketDe(admin, ticketId, auth.orgId, auth.user.id) : null;
    if (ticketId && !ticket) return res.status(404).json({ error: 'Conversation not found.' });
    if (ticket && ticket.status === 'closed') ticket = await rouvrirTicket(admin, ticket);

    if (!ticket) {
      ticket = await creerTicket(admin, { orgId: auth.orgId, userId: auth.user.id, subject: message.split('\n')[0].slice(0, 120), ctx, status: 'ai' });
    }
    await ajouterMessage(admin, { ticket, author: 'user', body: message, authorName: ctx.userName });

    // Ticket déjà chez un humain : le message part dans son canal, mais Lumi répond quand même aux
    // questions banales (sinon chaque question suivante remplit le support). Exception : un humain
    // a écrit il y a moins de 30 min — la conversation est vivante, on ne parle pas par-dessus lui.
    const chezHumain = ticket.status === 'open' || ticket.status === 'answered';
    if (chezHumain) {
      await relayerMessageClient(admin, ticket, ctx, message);
      if (humain || await humainActifRecemment(admin, ticket.id)) {
        return res.json({ ticket: vue(ticket, await messagesDuTicket(admin, ticket.id)), reply: null, escalated: true, slaKey: ticket.sla_key, sla: slaTexte(ticket.sla_key || '2d', ctx.langue) });
      }
    }

    let reply: string | null = null;
    let transferer = !!humain;
    let motif = humain ? 'Le client a demandé à parler à un humain' : '';
    // Étage 0 : une question classique (la FAQ, mot pour mot) a une réponse fixe — 0 appel modèle, même Lumi.
    const fixe = humain ? null : reponseFaqPour(message, ctx.langue);
    if (fixe) {
      reply = fixe.reponse;
      await ajouterMessage(admin, { ticket, author: 'ai', body: reply, authorName: 'Lumi' });
      if (chezHumain) await relayerMessageClient(admin, ticket, ctx, reply, 'lumi');
      void journaliserTrace(admin, { orgId: auth.orgId, userId: auth.user.id, canal: 'support', origine: origine === 'suggestion' ? 'suggestion' : 'texte', enonce: message, etage: 0, action: `faq:${fixe.id}`, resultat: 'ok', model: null, costCents: 0, dureeMs: 0 });
    } else if (!humain) {
      const historique = (await messagesDuTicket(admin, ticket.id))
        .filter((m) => (m.author === 'user' || m.author === 'ai'))
        .slice(0, -1) // le message courant est passé à part
        .map((m) => ({ role: m.author === 'user' ? 'user' as const : 'assistant' as const, content: m.body }));
      const debut = Date.now();
      // Étage 4 : même question (reformulée) déjà répondue — pour TOUTES les entreprises (« comment faire » générique,
      // par langue) ou dans cette entreprise → même réponse, 0 modèle.
      // Seulement en début de conversation (pas de contexte à perdre) ; l'index de l'org se vide à chaque écriture de Lumi (versionOrg).
      const premierMessage = historique.length === 0;
      const vecteur = premierMessage ? await embed(message) : null;
      const version = vecteur ? await versionOrg(auth.orgId) : null;
      const memo = vecteur
        ? (await chercherSemantique(PORTEE_CACHE_SUPPORT_GLOBALE(ctx.langue), vecteur, null, message)) ?? (await chercherSemantique(PORTEE_CACHE_SUPPORT(auth.orgId), vecteur, version, message))
        : null;
      // Plafond par entreprise et par jour : au-delà, réponses fixes seulement, jamais le modèle.
      const auPlafond = !memo && (await reponsesModeleAujourdhui(admin, auth.orgId)) >= PLAFOND_MODELE_PAR_JOUR;
      if (memo) {
        reply = memo.entree.texte;
        await ajouterMessage(admin, { ticket, author: 'ai', body: reply, authorName: 'Lumi' });
        if (chezHumain) await relayerMessageClient(admin, ticket, ctx, reply, 'lumi');
        void journaliserTrace(admin, { orgId: auth.orgId, userId: auth.user.id, canal: 'support', origine: origine === 'suggestion' ? 'suggestion' : 'texte', enonce: message, etage: 4, action: 'cache-semantique', resultat: 'ok', model: null, costCents: 0, dureeMs: Date.now() - debut });
      } else if (auPlafond) {
        reply = texteAuPlafond(ctx.langue);
        await ajouterMessage(admin, { ticket, author: 'ai', body: reply, authorName: 'Lumi' });
        void journaliserTrace(admin, { orgId: auth.orgId, userId: auth.user.id, canal: 'support', origine: origine === 'suggestion' ? 'suggestion' : 'texte', enonce: message, etage: 0, action: 'plafond-jour', resultat: 'refus', model: null, costCents: 0, dureeMs: Date.now() - debut });
      } else try {
        // Le même Lumi partout : il connaît le compte (dossier) et peut suivre ou démarrer une migration.
        const dossier = await dossierClient(admin, auth.orgId, auth.user.id);
        const r = await repondreSupportIA(
          { langue: ctx.langue, companyName: ctx.companyName, planLabel: ctx.planLabel, userName: ctx.userName, slaTexte: slaTexte(ctx.slaKey, ctx.langue), surface: 'app', dossier: dossier.texte, page: page ?? null },
          historique, message,
          {
            statutMigration: () => statutMigrationPour(admin, auth.orgId),
            demarrerMigration: ({ sourceCrm }) => demarrerMigrationPour(admin, { orgId: auth.orgId, userId: auth.user.id, userEmail: ctx.userEmail, companyName: ctx.companyName, sourceCrm }),
          },
        );
        reply = r.texte;
        transferer = r.transferer;
        motif = r.motif || motif;
        await ajouterMessage(admin, { ticket, author: 'ai', body: reply, authorName: 'Lumi' });
        // L'équipe voit ce que Lumi a répondu dans son canal ; elle n'a rien à faire si ça suffit.
        if (chezHumain) await relayerMessageClient(admin, ticket, ctx, reply, 'lumi');
        // Mémoriser : seulement une réponse sans transfert ni outil autre que la doc (un « comment faire »), jamais une réponse liée à l'état du moment.
        // Pour l'entreprise toujours ; pour toutes les entreprises si elle ne parle pas de ce compte (reponseGenerique).
        if (vecteur && !transferer && outilsDeDoc(r.outils) && !page) {
          void memoriserSemantique(PORTEE_CACHE_SUPPORT(auth.orgId), { enonce: message, vec: vecteur, texte: reply, fiches: [], outils: [], version: version ?? 0 });
          if (reponseGenerique(reply, r.outils, ctx)) void memoriserSemantique(PORTEE_CACHE_SUPPORT_GLOBALE(ctx.langue), { enonce: message, vec: vecteur, texte: reply, fiches: [], outils: [], version: 0 });
        }
        void journaliserTrace(admin, { orgId: auth.orgId, userId: auth.user.id, canal: 'support', origine: origine === 'suggestion' ? 'suggestion' : 'texte', enonce: message, etage: 6, action: 'app', outils: r.outils, resultat: transferer ? 'proposition' : 'ok', model: 'claude-sonnet-5', costCents: r.coutCents, dureeMs: Date.now() - debut });
      } catch (e: any) {
        // L'assistant tombe → un humain prend le relais, jamais un mur.
        console.error('[support/chat] assistant en erreur, transfert humain:', e?.message);
        transferer = true;
        motif = 'Assistant indisponible';
      }
    }

    if (transferer && !chezHumain) {
      const r = await escaladerTicket(admin, ticket, ctx, motif || 'Transféré');
      ticket = r.ticket;
    }
    return res.json({
      ticket: vue(ticket, await messagesDuTicket(admin, ticket.id)),
      reply, escalated: transferer || chezHumain,
      slaKey: ctx.slaKey, sla: slaTexte(ctx.slaKey, ctx.langue),
    });
  } catch (err: any) {
    return sendSafeError(res, err, 'Could not reach support.', '[support/chat]');
  }
});

// ── Message du client sur un ticket ──────────────────────────
router.post('/support/:id/messages', limiteChat, validate(supportMessageSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    let ticket = await ticketDe(admin, String(req.params.id), auth.orgId, auth.user.id);
    if (!ticket) return res.status(404).json({ error: 'Conversation not found.' });
    if (ticket.status === 'closed') ticket = await rouvrirTicket(admin, ticket);
    const ctx = await contexteOrg(admin, auth.orgId, auth.user);
    const { message } = req.body as { message: string };
    await ajouterMessage(admin, { ticket, author: 'user', body: message, authorName: ctx.userName });
    if (ticket.status === 'ai') {
      // Pas encore chez un humain : on y va (le client a écrit hors de la boucle IA).
      await escaladerTicket(admin, ticket, ctx, 'Message du client');
    } else {
      await relayerMessageClient(admin, ticket, ctx, message);
      if (ticket.status === 'answered') await admin.from('support_tickets').update({ status: 'open' }).eq('id', ticket.id);
    }
    const apres = await ticketDe(admin, ticket.id, auth.orgId, auth.user.id);
    return res.json({ ticket: vue(apres || ticket, await messagesDuTicket(admin, ticket.id)) });
  } catch (err: any) {
    return sendSafeError(res, err, 'Could not send your message.', '[support/messages]');
  }
});

// ── « Parler à un humain » ───────────────────────────────────
router.post('/support/:id/escalate', validate(supportEscalateSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    let ticket = await ticketDe(admin, String(req.params.id), auth.orgId, auth.user.id);
    if (!ticket) return res.status(404).json({ error: 'Conversation not found.' });
    if (ticket.status === 'closed') ticket = await rouvrirTicket(admin, ticket);
    const ctx = await contexteOrg(admin, auth.orgId, auth.user);
    const { reason } = req.body as { reason?: string };
    const r = await escaladerTicket(admin, ticket, ctx, reason || 'Le client a demandé à parler à un humain');
    if (!r.ok) return res.status(502).json({ error: 'Could not reach a human right now. Please email ' + supportEmail + '.', code: 'send_failed', supportEmail });
    return res.json({ ticket: vue(r.ticket, await messagesDuTicket(admin, ticket.id)), slaKey: ctx.slaKey, sla: slaTexte(ctx.slaKey, ctx.langue) });
  } catch (err: any) {
    return sendSafeError(res, err, 'Could not escalate.', '[support/escalate]');
  }
});

// ── 👍 / 👎 sur une réponse de Lumi ──────────────────────────
// Un 👎 fait oublier la réponse mémorisée pour cette question (entreprise et
// partagée) : la prochaine fois, Lumi repasse par le modèle. Compté dans le
// résumé quotidien Slack.
router.post('/support/:id/messages/:mid/avis', validate(supportAvisSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const ticket = await ticketDe(admin, String(req.params.id), auth.orgId, auth.user.id);
    if (!ticket) return res.status(404).json({ error: 'Conversation not found.' });
    const { avis } = req.body as { avis: 'bon' | 'mauvais' };
    const { data: m } = await admin.from('support_messages').select('id, author, created_at').eq('id', String(req.params.mid)).eq('ticket_id', ticket.id).maybeSingle();
    if (!m || m.author !== 'ai') return res.status(404).json({ error: 'Message not found.' });
    const { error } = await admin.from('support_messages').update({ avis }).eq('id', m.id);
    if (error) throw new Error(error.message);
    if (avis === 'mauvais') {
      const { data: q } = await admin.from('support_messages').select('body').eq('ticket_id', ticket.id).eq('author', 'user').lt('created_at', m.created_at).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (q?.body) {
        const ctx = await contexteOrg(admin, auth.orgId, auth.user);
        await Promise.all([oublierSemantique(PORTEE_CACHE_SUPPORT(auth.orgId), q.body), oublierSemantique(PORTEE_CACHE_SUPPORT_GLOBALE(ctx.langue), q.body)]);
      }
    }
    void journaliserTrace(admin, { orgId: auth.orgId, userId: auth.user.id, canal: 'support', origine: 'texte', enonce: `avis:${avis}`, etage: 0, action: `avis:${avis}`, resultat: 'ok', model: null, costCents: 0, dureeMs: 0 });
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Could not save your feedback.', '[support/avis]');
  }
});

router.post('/support/:id/close', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const ticket = await ticketDe(admin, String(req.params.id), auth.orgId, auth.user.id);
    if (!ticket) return res.status(404).json({ error: 'Conversation not found.' });
    await admin.from('support_tickets').update({ status: 'closed', closed_at: new Date().toISOString() }).eq('id', ticket.id);
    return res.json({ ok: true });
  } catch (err: any) {
    return sendSafeError(res, err, 'Could not close.', '[support/close]');
  }
});

// ── Lecture ──────────────────────────────────────────────────
router.get('/support/tickets', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const { data, error } = await admin.from('support_tickets').select('*').eq('org_id', auth.orgId).eq('user_id', auth.user.id).order('last_message_at', { ascending: false }).limit(20);
    if (error) throw new Error(error.message);
    return res.json({ tickets: ((data || []) as Ticket[]).map((t) => vue(t)), aiConfigured: isSupportIAConfigured(), humanChannel: isSlackConfigured() ? 'slack' : isMailerConfigured() ? 'email' : 'none' });
  } catch (err: any) {
    return sendSafeError(res, err, 'Could not load conversations.', '[support/tickets]');
  }
});

router.get('/support/tickets/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const admin = getServiceClient();
    const ticket = await ticketDe(admin, String(req.params.id), auth.orgId, auth.user.id);
    if (!ticket) return res.status(404).json({ error: 'Conversation not found.' });
    const messages = await messagesDuTicket(admin, ticket.id);
    await marquerLu(admin, ticket.id);
    return res.json({ ticket: vue(ticket, messages) });
  } catch (err: any) {
    return sendSafeError(res, err, 'Could not load the conversation.', '[support/ticket]');
  }
});

// ── Formulaire classique (repli) ─────────────────────────────
router.post('/support', validate(supportRequestSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    if (!isSlackConfigured() && !isMailerConfigured()) {
      return res.status(503).json({ error: 'Support email is not configured. Please email ' + supportEmail + ' directly.', code: 'mailer_unconfigured', supportEmail });
    }
    const { subject, message, category } = req.body as { subject: string; message: string; category?: string };
    const admin = getServiceClient();
    const ctx = await contexteOrg(admin, auth.orgId, auth.user);
    const ticket = await creerTicket(admin, { orgId: auth.orgId, userId: auth.user.id, subject, category, ctx, status: 'ai' });
    await ajouterMessage(admin, { ticket, author: 'user', body: message, authorName: ctx.userName });
    const r = await escaladerTicket(admin, ticket, ctx, 'Formulaire de contact');
    if (!r.ok) {
      console.error('[support] escalade impossible pour le ticket', ticket.id);
      return res.status(502).json({ error: 'Could not send your request right now. Please try again, or email ' + supportEmail + '.', code: 'send_failed', supportEmail });
    }
    return res.json({ ok: true, ticketId: ticket.id, priority: ctx.isPriority ? 'priority' : 'normal', sla: slaTexte(ctx.slaKey, 'en'), slaKey: ctx.slaKey });
  } catch (err: any) {
    return sendSafeError(res, err, 'Could not send your support request.', '[support]');
  }
});

export default router;
