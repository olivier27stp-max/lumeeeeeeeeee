/* ═══════════════════════════════════════════════════════════════
   Lumi — l'assistant IA dans l'application
   ─────────────────────────────────────────────────────────────
   POST /api/lumi/chat                 { conversation_id?, message, language } → SSE
   POST /api/lumi/execute              { conversation_id, tool_use_id, decision } → SSE
   GET  /api/lumi/quota                → budget du mois
   GET  /api/lumi/conversations        → liste
   GET  /api/lumi/conversations/:id    → messages rendus pour l'interface
   DELETE /api/lumi/conversations/:id

   Le serveur est la seule autorité : plan (includes_ai), budget mensuel en
   dollars (plans.ai_monthly_budget_cents), permission de la page Rôles
   (external_agent.use, via la table RBAC), historique (l'interface ne renvoie
   jamais la conversation), et exécution des écritures APRÈS confirmation.
   ═══════════════════════════════════════════════════════════════ */
import { Router, type Request, type Response } from 'express';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { requireAuthedClient, getServiceClient } from '../lib/supabase';
import { validate } from '../lib/validation';
import { sendSafeError } from '../lib/error-handler';
import { guardCommonShape, maxBodySize } from '../lib/validation-guards';
import { etatBudget, journaliserUsage, reglagesPourPalier, attenteRalenti, alerterSiSeuilFranchi } from '../lib/lumi/budget';
import { modeleLumi } from '../lib/lumi/tarifs';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { redisRateLimit } from '../lib/rate-limiter';
import { userKey } from '../lib/security';
import { ficheCreee, type Fiche } from '../lib/lumi/fiches';
import { isLumiConfigured, promptSystemeLumi, tourLumi, type EvenementLumi } from '../lib/lumi/orchestrateur';
import { executerOutilGarde, PERMISSION_PAR_OUTIL } from '../lib/agent/garde';
import { TOOLS_BY_NAME } from '../lib/agent/tools';
import type { Rapport } from '../lib/agent/tools-rapports';
import { demasquerIds, instantaneRefs, restaurerRefs } from '../lib/agent/refs';
import { logger } from '../lib/logger';

const router = Router();
router.use(maxBodySize());
router.use(guardCommonShape);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const chatSchema = z.object({
  conversation_id: z.string().regex(UUID).optional().nullable(),
  message: z.string().trim().min(1).max(8000),
  language: z.enum(['fr', 'en']).optional(),
});
const executeSchema = z.object({
  conversation_id: z.string().regex(UUID),
  tool_use_id: z.string().min(1).max(200),
  decision: z.enum(['confirm', 'cancel']),
  language: z.enum(['fr', 'en']).optional(),
});

// Au-delà, on résume plutôt que de renvoyer 200 messages au modèle.
const MAX_MESSAGES_HISTORIQUE = 60;

type Msg = Anthropic.Messages.MessageParam;

// ── SSE ─────────────────────────────────────────────────────────
function ouvrirSse(res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  return (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

// ── Historique ──────────────────────────────────────────────────
async function chargerHistorique(conversationId: string, cleRefs?: string): Promise<Msg[]> {
  const { data, error } = await getServiceClient()
    .from('lumi_messages')
    .select('role, content, refs, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  // Les réfs courtes (ref3 → UUID) sont rejouées depuis la base : un
  // redémarrage du serveur n'efface plus ce que l'assistant sait désigner.
  if (cleRefs) for (const m of data ?? []) if ((m as any).refs) restaurerRefs(cleRefs, (m as any).refs);
  let msgs = (data ?? []).map((m: any) => ({ role: m.role, content: m.content }) as Msg);
  if (msgs.length > MAX_MESSAGES_HISTORIQUE) {
    // On coupe à une frontière de message utilisateur TEXTE (jamais entre un
    // tool_use et son tool_result, sinon l'API refuse la conversation).
    let i = msgs.length - MAX_MESSAGES_HISTORIQUE;
    while (i < msgs.length && !(msgs[i].role === 'user' && typeof msgs[i].content === 'string')) i++;
    msgs = msgs.slice(i);
  }
  return msgs;
}

async function sauverMessages(conversationId: string, orgId: string, msgs: Msg[], cleRefs?: string): Promise<void> {
  if (!msgs.length) return;
  const admin = getServiceClient();
  // L'instantané des réfs part avec le dernier message : c'est lui qui
  // sera rejoué au prochain chargement (voir chargerHistorique).
  const refs = cleRefs ? instantaneRefs(cleRefs) : {};
  const avecRefs = Object.keys(refs).length > 0;
  // Insérés un par un pour garder l'ordre (created_at croissant strict).
  for (const [i, m] of msgs.entries()) {
    const ligne: Record<string, any> = { conversation_id: conversationId, org_id: orgId, role: m.role, content: m.content as any };
    if (avecRefs && i === msgs.length - 1) ligne.refs = refs;
    const { error } = await admin.from('lumi_messages').insert(ligne);
    if (error) throw new Error(error.message);
  }
  await admin.from('lumi_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
}

/** Écriture proposée mais ni confirmée ni annulée : le dernier tool_use d'écriture sans tool_result. */
export function propositionEnAttente(msgs: Msg[]): { tool_use_id: string; tool: string; args: Record<string, any> } | null {
  const resolus = new Set<string>();
  for (const m of msgs) {
    if (m.role === 'user' && Array.isArray(m.content)) {
      for (const b of m.content) if ((b as any).type === 'tool_result') resolus.add((b as any).tool_use_id);
    }
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      const tu = b as any;
      if (tu.type === 'tool_use' && !resolus.has(tu.id) && TOOLS_BY_NAME[tu.name]?.kind === 'write') {
        return { tool_use_id: tu.id, tool: tu.name, args: (tu.input ?? {}) as Record<string, any> };
      }
    }
    // Le premier message assistant rencontré en remontant décide.
    return null;
  }
  return null;
}

// ── Contexte d'un tour ──────────────────────────────────────────
async function contexteTour(req: Request, res: Response) {
  if (!isLumiConfigured()) {
    res.status(503).json({ error: 'Lumi is not configured. Set ANTHROPIC_API_KEY on the server.', code: 'lumi_not_configured' });
    return null;
  }
  const auth = await requireAuthedClient(req, res);
  if (!auth) return null;
  const admin = getServiceClient();
  const budget = await etatBudget(admin, auth.orgId);
  if (!budget.includes_ai) {
    res.status(403).json({ error: 'Lumi is not included in this plan.', code: 'plan_sans_lumi', budget });
    return null;
  }
  // Plafond atteint : Lumi ralentit au lieu de mourir — un tour par minute
  // (sur Haiku, effort bas) jusqu'au 1er. Le client n'est jamais à sec.
  if (budget.palier === 'ralenti') {
    const attente = await attenteRalenti(admin, auth.orgId);
    if (attente > 0) {
      res.setHeader('Retry-After', String(attente));
      res.status(429).json({ error: 'Lumi is slowed down this month.', code: 'ralenti', retry_after_s: attente, budget });
      return null;
    }
  }
  // Alerte à l'exploitant au passage à 60 % (une fois par org et par mois).
  void alerterSiSeuilFranchi(admin, auth.orgId, budget, async (subject, text) => {
    const to = process.env.LUMI_ALERT_EMAIL || process.env.SECURITY_ALERT_EMAIL;
    if (!to || !isMailerConfigured()) return;
    await sendEmail({ to, subject, html: `<pre style="font:14px/1.5 system-ui;white-space:pre-wrap">${text.replace(/</g, '&lt;')}</pre>` });
  });
  let companyName: string | null = null;
  try {
    const { data } = await admin.from('company_settings').select('company_name').eq('org_id', auth.orgId).maybeSingle();
    companyName = data?.company_name || null;
  } catch { /* non-fatal : le prompt tient sans */ }
  const userName = (auth.user.user_metadata as any)?.full_name || (auth.user.user_metadata as any)?.name || auth.user.email || null;
  const language: 'fr' | 'en' = req.body?.language === 'en' ? 'en' : 'fr';
  const systeme = promptSystemeLumi({ companyName, userName, language, todayIso: new Date().toISOString().slice(0, 10) });
  const accessToken = (req.header('authorization') || '').replace(/^Bearer\s+/i, '') || undefined;
  return { auth, admin, budget, systeme, language, accessToken };
}

async function executerTourSse(opts: {
  req: Request; res: Response; ctx: NonNullable<Awaited<ReturnType<typeof contexteTour>>>;
  conversationId: string; historique: Msg[]; nouveauxAvant: Msg[];
  /** Reçu d'une écriture qui vient d'être exécutée (ou refusée) : émis avant que le modèle reprenne. */
  execute?: { tool_use_id: string; ok: boolean; fiche: Fiche | null };
}) {
  const { res, ctx, conversationId } = opts;
  const emettreSse = ouvrirSse(res);
  const emettre = (e: EvenementLumi) => emettreSse(e.type, e);
  let ferme = false;
  opts.req.on('close', () => { ferme = true; });

  try {
    if (opts.execute && !ferme) emettreSse('executed', opts.execute);
    const cleRefs = `${ctx.auth.orgId}:${ctx.auth.user.id}`;
    if (opts.nouveauxAvant.length) await sauverMessages(conversationId, ctx.auth.orgId, opts.nouveauxAvant, cleRefs);
    const resultat = await tourLumi({
      client: ctx.auth.client,
      orgId: ctx.auth.orgId,
      userId: ctx.auth.user.id,
      accessToken: ctx.accessToken,
      systeme: ctx.systeme,
      reglages: reglagesPourPalier(ctx.budget.palier, modeleLumi()),
      historique: [...opts.historique, ...opts.nouveauxAvant],
      emettre: (e) => { if (!ferme) emettre(e); },
      journaliser: (usage, model, cost_cents) => journaliserUsage(ctx.admin, {
        orgId: ctx.auth.orgId, userId: ctx.auth.user.id, conversationId, model,
        input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0, cost_cents,
      }),
    });
    await sauverMessages(conversationId, ctx.auth.orgId, resultat.nouveauxMessages, cleRefs);
    const budget = await etatBudget(ctx.admin, ctx.auth.orgId);
    if (!ferme) emettreSse('done', { conversation_id: conversationId, cost_cents: resultat.cost_cents, budget, proposal: resultat.proposition });
  } catch (err: any) {
    logger.error('[lumi] tour échoué', { error: err?.message || String(err), orgId: ctx.auth.orgId });
    if (!ferme) emettreSse('error', { message: 'Lumi failed to respond.' });
  } finally {
    res.end();
  }
}

// ── POST /lumi/chat ─────────────────────────────────────────────
/**
 * Limite par PERSONNE et par heure : bloque un script ou une boucle sans
 * jamais gêner un humain qui travaille (60 tours/h, c'est un par minute).
 */
const limiteHoraireLumi = redisRateLimit({ preset: 'lumi', keyFn: (req) => `lumi:${userKey(req)}` });

router.post('/lumi/chat', limiteHoraireLumi, validate(chatSchema), async (req, res) => {
  try {
    const ctx = await contexteTour(req, res);
    if (!ctx) return;
    const { conversation_id, message } = req.body as z.infer<typeof chatSchema>;

    let conversationId = conversation_id ?? null;
    let historique: Msg[] = [];
    if (conversationId) {
      const { data: conv } = await ctx.admin.from('lumi_conversations').select('id').eq('id', conversationId).eq('org_id', ctx.auth.orgId).eq('user_id', ctx.auth.user.id).maybeSingle();
      if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
      historique = await chargerHistorique(conversationId, `${ctx.auth.orgId}:${ctx.auth.user.id}`);
    } else {
      const { data: conv, error } = await ctx.admin.from('lumi_conversations')
        .insert({ org_id: ctx.auth.orgId, user_id: ctx.auth.user.id, title: message.slice(0, 80) })
        .select('id').single();
      if (error || !conv) throw new Error(error?.message || 'conversation');
      conversationId = conv.id;
    }

    const nouveaux: Msg[] = [];
    // Une proposition laissée sans réponse est annulée par le nouveau message :
    // l'API exige un tool_result pour chaque tool_use avant de continuer.
    const enAttente = propositionEnAttente(historique);
    if (enAttente) {
      nouveaux.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: enAttente.tool_use_id, content: JSON.stringify({ cancelled: true, note: "L'utilisateur n'a pas confirmé cette action ; elle n'a pas été exécutée." }) }] });
    }
    nouveaux.push({ role: 'user', content: message });

    await executerTourSse({ req, res, ctx, conversationId: conversationId!, historique, nouveauxAvant: nouveaux });
  } catch (error: any) {
    if (res.headersSent) return res.end();
    return sendSafeError(res, error, 'Lumi failed to respond.', '[lumi/chat]');
  }
});

// ── POST /lumi/execute — confirmer ou annuler une écriture proposée ──
router.post('/lumi/execute', validate(executeSchema), async (req, res) => {
  try {
    const ctx = await contexteTour(req, res);
    if (!ctx) return;
    const { conversation_id, tool_use_id, decision } = req.body as z.infer<typeof executeSchema>;

    const { data: conv } = await ctx.admin.from('lumi_conversations').select('id').eq('id', conversation_id).eq('org_id', ctx.auth.orgId).eq('user_id', ctx.auth.user.id).maybeSingle();
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
    const historique = await chargerHistorique(conversation_id, `${ctx.auth.orgId}:${ctx.auth.user.id}`);
    const enAttente = propositionEnAttente(historique);
    if (!enAttente || enAttente.tool_use_id !== tool_use_id) {
      return res.status(409).json({ error: 'No such pending action.', code: 'aucune_proposition' });
    }

    let contenu: string;
    let execute: { tool_use_id: string; ok: boolean; fiche: Fiche | null } = { tool_use_id, ok: false, fiche: null };
    if (decision === 'cancel') {
      contenu = JSON.stringify({ cancelled: true, note: "L'utilisateur a annulé cette action ; elle n'a pas été exécutée." });
    } else {
      // Exécution RÉELLE, à l'identité de l'utilisateur, avec les gardes du MCP.
      const args = demasquerIds(`${ctx.auth.orgId}:${ctx.auth.user.id}`, enAttente.args);
      try {
        const r = await executerOutilGarde({ name: enAttente.tool, args, userId: ctx.auth.user.id, orgId: ctx.auth.orgId, client: ctx.auth.client, accessToken: ctx.accessToken });
        const echec = !('refus' in r) && r.result && typeof r.result === 'object' && typeof (r.result as any).error === 'string' ? String((r.result as any).error) : null;
        if ('refus' in r) {
          contenu = JSON.stringify({ error: r.refus });
        } else if (echec) {
          // L'outil a répondu par une erreur métier (devis pas encore accepté…) :
          // c'est un échec, pas un reçu — la carte l'affiche comme tel et le
          // modèle ne dit pas « c'est fait ».
          contenu = JSON.stringify({ error: echec });
        } else {
          // La fiche créée (« Devis Q-0043 ») est gardée avec le résultat :
          // c'est ce qui permet au reçu de réapparaître quand on rouvre la
          // conversation (rendreMessages), sans deuxième table.
          const fiche = await ficheCreee(enAttente.tool, args, r.result, { client: ctx.auth.client, orgId: ctx.auth.orgId, userId: ctx.auth.user.id });
          execute = { tool_use_id, ok: true, fiche };
          // La note guide la phrase qui suit : sans elle, le modèle redisait
          // « tu peux le confirmer ci-dessous » alors que c'était déjà fait.
          contenu = JSON.stringify({
            executed: true, result: r.result ?? null, fiche,
            note: 'DONE: this action has been executed and is complete. Tell the user in one short sentence that it is done (never ask for confirmation again), then offer the natural next step if any (e.g. send it to the client).',
          }).slice(0, 60_000);
        }
      } catch (err: any) {
        logger.error('[lumi/execute] écriture échouée', { tool: enAttente.tool, error: err?.message || String(err), orgId: ctx.auth.orgId });
        contenu = JSON.stringify({ error: 'Tool execution failed.' });
      }
    }
    const resultat: Msg = { role: 'user', content: [{ type: 'tool_result', tool_use_id, content: contenu }] };

    // Le modèle reprend la main pour confirmer en mots ce qui s'est passé.
    await executerTourSse({ req, res, ctx, conversationId: conversation_id, historique, nouveauxAvant: [resultat], execute });
  } catch (error: any) {
    if (res.headersSent) return res.end();
    return sendSafeError(res, error, 'Lumi failed to execute the action.', '[lumi/execute]');
  }
});

// ── GET /lumi/quota ─────────────────────────────────────────────
router.get('/lumi/quota', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const budget = await etatBudget(getServiceClient(), auth.orgId);
    return res.json({ ...budget, configured: isLumiConfigured() });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to load Lumi quota.', '[lumi/quota]');
  }
});

// ── Conversations ───────────────────────────────────────────────
router.get('/lumi/conversations', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { data, error } = await getServiceClient().from('lumi_conversations')
      .select('id, title, created_at, updated_at')
      .eq('org_id', auth.orgId).eq('user_id', auth.user.id)
      .order('updated_at', { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return res.json({ conversations: data ?? [] });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to list conversations.', '[lumi/conversations]');
  }
});

/** Rend les blocs stockés en éléments d'interface : texte, appels d'outils, propositions et leur sort. */
export function rendreMessages(msgs: Msg[]): Array<{ role: 'user' | 'assistant'; text: string; tools: string[]; proposal?: { tool_use_id: string; tool: string; args: Record<string, any>; capacite: string | null; statut: 'en_attente' | 'confirmee' | 'annulee' | 'echouee'; fiche?: Fiche | null }; report?: Rapport }> {
  const sorts = new Map<string, 'confirmee' | 'annulee' | 'echouee'>();
  const fiches = new Map<string, Fiche>();
  const rapports = new Map<string, Rapport>();
  for (const m of msgs) {
    if (m.role === 'user' && Array.isArray(m.content)) {
      for (const b of m.content as any[]) {
        if (b.type !== 'tool_result') continue;
        const txt = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
        sorts.set(b.tool_use_id, /"cancelled":true/.test(txt) ? 'annulee' : /"executed":true/.test(txt) ? 'confirmee' : 'echouee');
        if (/"executed":true/.test(txt) && txt.includes('"fiche":{')) {
          try { const f = JSON.parse(txt)?.fiche; if (f?.href && f?.label) fiches.set(b.tool_use_id, f); } catch { /* résultat tronqué : pas de lien */ }
        }
        if (txt.startsWith('{"rapport":')) {
          try { const r = JSON.parse(txt)?.rapport; if (r?.sections) rapports.set(b.tool_use_id, r); } catch { /* résultat tronqué : pas de carte */ }
        }
      }
    }
  }
  const out: ReturnType<typeof rendreMessages> = [];
  for (const m of msgs) {
    if (m.role === 'user') {
      if (typeof m.content === 'string') out.push({ role: 'user', text: m.content, tools: [] });
      continue; // les tool_result ne s'affichent pas
    }
    const blocs = Array.isArray(m.content) ? (m.content as any[]) : [{ type: 'text', text: String(m.content) }];
    const texte = blocs.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    const tools: string[] = [];
    let proposal: ReturnType<typeof rendreMessages>[number]['proposal'];
    let report: Rapport | undefined;
    for (const b of blocs) {
      if (b.type !== 'tool_use') continue;
      if (rapports.has(b.id)) report = rapports.get(b.id);
      const outil = TOOLS_BY_NAME[b.name];
      if (outil?.kind === 'write') {
        proposal = { tool_use_id: b.id, tool: b.name, args: b.input ?? {}, capacite: PERMISSION_PAR_OUTIL[b.name]?.capacite ?? null, statut: sorts.get(b.id) ?? 'en_attente', fiche: fiches.get(b.id) ?? null };
      } else tools.push(b.name);
    }
    if (texte || proposal || tools.length) out.push({ role: 'assistant', text: texte, tools, ...(proposal ? { proposal } : {}), ...(report ? { report } : {}) });
  }
  return out;
}

router.get('/lumi/conversations/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(400).json({ error: 'Invalid id' });
    const { data: conv } = await getServiceClient().from('lumi_conversations').select('id, title').eq('id', id).eq('org_id', auth.orgId).eq('user_id', auth.user.id).maybeSingle();
    if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
    const msgs = await chargerHistorique(id);
    return res.json({ conversation: conv, messages: rendreMessages(msgs) });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to load conversation.', '[lumi/conversation]');
  }
});

router.delete('/lumi/conversations/:id', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const id = String(req.params.id);
    if (!UUID.test(id)) return res.status(400).json({ error: 'Invalid id' });
    const { error } = await getServiceClient().from('lumi_conversations').delete().eq('id', id).eq('org_id', auth.orgId).eq('user_id', auth.user.id);
    if (error) throw new Error(error.message);
    return res.json({ ok: true });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to delete conversation.', '[lumi/conversation]');
  }
});

export default router;
