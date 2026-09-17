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
import { etatBudget, journaliserUsage, reglagesPourPalier, alerterSiSeuilFranchi, reserverBudget, reglerBudget, messagePause } from '../lib/lumi/budget';
import { modeleLumi, coutEnCents } from '../lib/lumi/tarifs';
import { sendEmail, isMailerConfigured } from '../lib/mailer';
import { redisRateLimit } from '../lib/rate-limiter';
import { userKey } from '../lib/security';
import { type Fiche } from '../lib/lumi/fiches';
import { executerEcriture, autorisationsDe, definirAutorisation, modeDe, definirMode, MODES_LUMI, PLAFOND_ECRITURES_PAR_CONVERSATION, compterEcritures, type ModeLumi, type ReçuExecution } from '../lib/lumi/execution';
import { getUserContext } from '../lib/rbac';
import { isLumiConfigured, promptSystemeLumi, tourLumi, purgerVieuxResultats, OUTILS_DE_BASE, type EvenementLumi, type ResultatTour } from '../lib/lumi/orchestrateur';
import { detecterRaccourci, repondreRaccourci, raccourciDepuisAction, IDS_RACCOURCIS, type IdRaccourci } from '../lib/lumi/raccourcis';
import { detecterActionDirecte, repondreActionDirecte } from '../lib/lumi/actions-directes';
import { texteRecus, type LigneRecu } from '../lib/lumi/recus';
import { VERSION_PROMPT } from '../lib/lumi/version';
import { escalader, motifDansResultat } from '../lib/lumi/escalade';
import { classifier, modeRouteur, MODELE_ROUTEUR, type ResultatRouteur, type ContexteRouteur } from '../lib/lumi/routeur';
import { sousAgentDepuisVerdict, focusDuSousAgent, effortDuSousAgent, outilsDuSousAgent } from '../lib/lumi/sous-agents';
import { indiceOutils } from '../lib/lumi/indices-outils';
import type { IdTopic } from '../lib/lumi/topics';
import { reglesCout, messagePlafondConversation } from '../lib/lumi/regles-cout';
import { lireReponse, ecrireReponse, retirerReponse, tourCachable, versionOrg, enonceCachable } from '../lib/lumi/cache-reponses';
import { embed, chercherSemantique, memoriserSemantique, oublierSemantique } from '../lib/lumi/cache-semantique';
import { journaliserTrace, normaliserEnonce, ajouterUsage, usageVide, ETAGE, ORIGINES_TRACE, type OrigineTrace, type UsageAgrege } from '../lib/lumi/traces';
import { PERMISSION_PAR_OUTIL } from '../lib/agent/garde';
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
  // D'où vient le message (mesure pour lumi_traces) : jamais une autorisation, jamais un identifiant.
  origine: z.enum(ORIGINES_TRACE as [OrigineTrace, ...OrigineTrace[]]).optional(),
});
const executeSchema = z.object({
  conversation_id: z.string().regex(UUID),
  tool_use_id: z.string().min(1).max(200),
  // dry_run : même garde, mêmes validations, aucune écriture — renvoie ce qui serait fait (R12).
  decision: z.enum(['confirm', 'cancel', 'dry_run']),
  language: z.enum(['fr', 'en']).optional(),
});

/** Étage 0 : une action d'interface, nommée, avec ses paramètres — pas de texte à interpréter. */
const actionSchema = z.object({
  conversation_id: z.string().regex(UUID).optional().nullable(),
  action: z.enum(IDS_RACCOURCIS as [IdRaccourci, ...IdRaccourci[]]),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  /** Ce que l'utilisateur a cliqué : stocké comme son message, pour que la conversation se lise. */
  label: z.string().trim().min(1).max(200),
  language: z.enum(['fr', 'en']).optional(),
  origine: z.enum(['suggestion', 'lien']).optional(),
});

/** « non », « pas ça », « c'est pas ça »… : l'utilisateur rejette la réponse précédente. Liste courte, exacte. */
const REPLIS: ReadonlySet<string> = new Set(['non', 'no', 'nope', 'pas ca', 'non pas ca', 'c est pas ca', 'ce n est pas ca', 'pas du tout', 'not that', 'wrong', 'mauvaise reponse', 'c est pas la bonne reponse']);
function estUnRepli(message: string): boolean {
  return REPLIS.has(normaliserEnonce(message) ?? '');
}
/** Dernier message texte de l'utilisateur dans l'historique (pour tracer le candidat à retirer). */
function dernierEnonceUtilisateur(msgs: Msg[]): string | null {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user' && typeof msgs[i].content === 'string') return msgs[i].content as string;
  return null;
}
/** Dernier texte de Lumi (blocs texte du dernier message assistant), pour le routeur. */
function dernierTexteAssistant(msgs: Msg[]): string | null {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'assistant') continue;
    if (typeof m.content === 'string') return m.content;
    const t = m.content.filter((b: any) => b.type === 'text').map((b: any) => String(b.text)).join(' ').trim();
    return t || null;
  }
  return null;
}
/** L'échange précédent, s'il existe, pour que le routeur classe une suite de conversation. */
function contexteRouteur(msgs: Msg[]): ContexteRouteur | null {
  const utilisateur = dernierEnonceUtilisateur(msgs);
  const lumi = dernierTexteAssistant(msgs);
  return utilisateur && lumi ? { utilisateur, lumi } : null;
}

// Au-delà, on résume plutôt que de renvoyer 200 messages au modèle.
const MAX_MESSAGES_HISTORIQUE = 60;
/** Une carte de confirmation n'est exécutable que 15 min (mandat §5.6, B9). */
export const EXPIRATION_PROPOSITION_MS = 15 * 60_000;

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
async function chargerHistorique(conversationId: string, cleRefs?: string, max = MAX_MESSAGES_HISTORIQUE): Promise<Msg[]> {
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
  if (msgs.length > max) {
    // On coupe à une frontière de message utilisateur TEXTE (jamais entre un
    // tool_use et son tool_result, sinon l'API refuse la conversation).
    let i = msgs.length - max;
    while (i < msgs.length && !(msgs[i].role === 'user' && typeof msgs[i].content === 'string')) i++;
    msgs = msgs.slice(i);
  }
  // Les vieux résultats d'outils sont allégés en mémoire seulement (voir purgerVieuxResultats).
  return purgerVieuxResultats(msgs);
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
export interface EcritureEnAttente { tool_use_id: string; tool: string; args: Record<string, any> }

/** Toutes les écritures encore sans réponse du DERNIER message assistant (une carte = un groupe). */
export function propositionsEnAttente(msgs: Msg[]): EcritureEnAttente[] {
  const resolus = new Set<string>();
  for (const m of msgs) {
    if (m.role === 'user' && Array.isArray(m.content)) {
      for (const b of m.content) if ((b as any).type === 'tool_result') resolus.add((b as any).tool_use_id);
    }
  }
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const out: EcritureEnAttente[] = [];
    for (const b of m.content) {
      const tu = b as any;
      if (tu.type === 'tool_use' && !resolus.has(tu.id) && TOOLS_BY_NAME[tu.name]?.kind === 'write') {
        out.push({ tool_use_id: tu.id, tool: tu.name, args: (tu.input ?? {}) as Record<string, any> });
      }
    }
    // Le premier message assistant rencontré en remontant décide.
    return out;
  }
  return [];
}

/** Compatibilité : la première écriture en attente. */
export function propositionEnAttente(msgs: Msg[]): EcritureEnAttente | null {
  return propositionsEnAttente(msgs)[0] ?? null;
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
  // Plafond atteint (palier « epuise ») : rien n'est refusé ici. Les étages
  // déterministes (raccourcis, caches) répondent encore ; l'appel au modèle
  // est bloqué par la réservation dans executerTourSse (message gabarit).
  // Alerte à l'exploitant au passage à 60 % (une fois par org et par mois).
  void alerterSiSeuilFranchi(admin, auth.orgId, budget, async (subject, text) => {
    const to = process.env.LUMI_ALERT_EMAIL || process.env.SECURITY_ALERT_EMAIL;
    if (!to || !isMailerConfigured()) return;
    await sendEmail({ to, subject, html: `<pre style="font:14px/1.5 system-ui;white-space:pre-wrap">${text.replace(/</g, '&lt;')}</pre>` });
  });
  let companyName: string | null = null;
  let fuseau = 'America/Toronto';
  try {
    const { data } = await admin.from('company_settings').select('company_name, timezone').eq('org_id', auth.orgId).maybeSingle();
    companyName = data?.company_name || null;
    if ((data as any)?.timezone) fuseau = String((data as any).timezone);
  } catch { /* non-fatal : le prompt tient sans */ }
  const userName = (auth.user.user_metadata as any)?.full_name || (auth.user.user_metadata as any)?.name || auth.user.email || null;
  const language: 'fr' | 'en' = req.body?.language === 'en' ? 'en' : 'fr';
  // Ce que Lumi a retenu (org_knowledge « assistant ») entre dans son prompt : il n'a plus à le rechercher.
  let souvenirs: Array<{ key: string; value: string }> = [];
  try {
    const { data } = await admin.from('org_knowledge').select('key, value').eq('org_id', auth.orgId).eq('category', 'assistant').eq('is_active', true).order('updated_at', { ascending: false }).limit(30);
    souvenirs = (data ?? []).map((n: any) => ({ key: String(n.key), value: String(n.value ?? '') }));
  } catch { /* non-fatal : Lumi peut encore les relire avec recall_notes */ }
  const promptCtx = { companyName, userName, language, todayIso: new Date().toISOString().slice(0, 10), souvenirs };
  const systeme = promptSystemeLumi(promptCtx);
  const accessToken = (req.header('authorization') || '').replace(/^Bearer\s+/i, '') || undefined;
  return { auth, admin, budget, systeme, promptCtx, language, accessToken, fuseau, userName };
}

async function executerTourSse(opts: {
  req: Request; res: Response; ctx: NonNullable<Awaited<ReturnType<typeof contexteTour>>>;
  conversationId: string; historique: Msg[]; nouveauxAvant: Msg[];
  /** Reçus des écritures qui viennent d'être exécutées (ou refusées) : émis avant que le modèle reprenne. */
  execute?: ReçuExecution[];
  /** Pour la trace : d'où vient le message et ce que l'utilisateur a écrit (null pour une décision de carte). */
  origine: OrigineTrace;
  enonce?: string | null;
  /** Repli : action 'repli' + l'énoncé précédent comme candidat à retirer des énoncés exacts. */
  action?: string | null;
  params?: Record<string, unknown> | null;
  /** Étages 3-4 : mémoriser la réponse si le tour est cachable (premier message, lecture seule). */
  cache?: { historiqueVide: boolean; vecteur: Promise<number[] | null> | null };
  /** Verdict du routeur actif déjà obtenu par la route (étage 5 manqué) : tracé, sans second appel. */
  routeur?: ResultatRouteur | null;
  /** Sous-agent (topic sûr du routeur) : seuls ses outils sont chargés, le sujet est ajouté au bloc variable (B7). */
  sousAgent?: IdTopic | null;
}) {
  const { res, ctx, conversationId } = opts;
  const emettreSse = ouvrirSse(res);
  // La trace du tour se construit au fil des événements : outils qui ont
  // tourné, usage de chaque appel au modèle. Elle part à la fin, sans bloquer.
  const debut = Date.now();
  const outils: string[] = [];
  let usage: UsageAgrege = usageVide();
  let model: string | null = null;
  let erreurModele: string | null = null;
  let ecritureExecutee = false;
  const fiches: Fiche[] = [];
  const emettre = (e: EvenementLumi) => {
    if (e.type === 'tool' && e.statut === 'fin' && !outils.includes(e.name)) outils.push(e.name);
    if (e.type === 'executed') ecritureExecutee = true; // un tour qui a écrit ne se met jamais en cache
    if (e.type === 'usage') { usage = ajouterUsage(usage, e.usage); model = e.model; }
    if (e.type === 'error') erreurModele = e.message;
    if (e.type === 'fiches') for (const f of e.fiches) if (!fiches.some((x) => x.href === f.href)) fiches.push(f);
    emettreSse(e.type, e);
  };
  let ferme = false;
  opts.req.on('close', () => { ferme = true; });
  // Routeur en OBSERVATION : classifie en parallèle, n'agit pas, et son verdict
  // entre dans la trace pour être comparé à ce que le modèle a fait.
  const observation = opts.routeur ? Promise.resolve(opts.routeur) : (modeRouteur() === 'observation' && opts.enonce ? classifier(opts.enonce, contexteRouteur(opts.historique)) : null);
  const tracer = async (resultat: 'ok' | 'proposition' | 'erreur', cost_cents: number, action?: string | null) => {
    const routeur = observation ? await observation : null;
    // Règle stricte : le routeur en OBSERVATION coûte aussi (Haiku) — journalisé
    // dans ai_usage comme en mode actif, jamais un coût hors budget.
    if (routeur && !opts.routeur && routeur.usage) {
      void journaliserUsage(ctx.admin, {
        orgId: ctx.auth.orgId, userId: ctx.auth.user.id, conversationId, model: MODELE_ROUTEUR,
        input_tokens: routeur.usage.input_tokens, output_tokens: routeur.usage.output_tokens,
        cache_creation_input_tokens: routeur.usage.cache_creation_input_tokens, cache_read_input_tokens: routeur.usage.cache_read_input_tokens,
        cost_cents: coutEnCents(MODELE_ROUTEUR, routeur.usage),
      });
    }
    void journaliserTrace(ctx.admin, {
      orgId: ctx.auth.orgId, userId: ctx.auth.user.id, conversationId, canal: 'lumi', origine: opts.origine,
      enonce: normaliserEnonce(opts.enonce), etage: ETAGE.agent, action: opts.action ?? action ?? null,
      params: { ...(opts.params ?? {}), ...(opts.sousAgent ? { sous_agent: opts.sousAgent } : {}), ...(routeur ? { routeur: { verdict: routeur.verdict, statut: routeur.statut, decision: routeur.decision, duree_ms: routeur.duree_ms, usage: routeur.usage ?? null } } : {}) },
      outils, resultat, model, promptVersion: VERSION_PROMPT, usage, costCents: cost_cents, dureeMs: Date.now() - debut,
    });
    // Escalade humaine : le modèle a refusé ou n'a pas pu finir.
    if (erreurModele === 'refusal' || erreurModele === 'trop_d_etapes' || erreurModele === 'plafond_tour') {
      void escalader(ctx.admin, {
        orgId: ctx.auth.orgId, userId: ctx.auth.user.id, conversationId, motif: erreurModele === 'refusal' ? 'refus_modele' : 'trop_d_etapes', fr: ctx.language === 'fr',
        detail: erreurModele === 'refusal'
          ? (ctx.language === 'fr' ? 'Lumi a refusé de répondre à une demande dans cette conversation.' : 'Lumi declined a request in this conversation.')
          : (ctx.language === 'fr' ? 'Lumi a atteint sa limite d’étapes sans pouvoir conclure.' : 'Lumi hit its step limit without concluding.'),
      });
    }
  };

  try {
    for (const recu of opts.execute ?? []) if (!ferme) emettreSse('executed', recu);
    const cleRefs = `${ctx.auth.orgId}:${ctx.auth.user.id}`;
    if (opts.nouveauxAvant.length) await sauverMessages(conversationId, ctx.auth.orgId, opts.nouveauxAvant, cleRefs);
    const reglages = reglagesPourPalier(ctx.budget.palier, modeleLumi());
    // Qualité : les sujets qui raisonnent (rapports, analyse financière) gardent une réflexion medium, hors palier dégradé.
    if (opts.sousAgent && ctx.budget.palier === 'normal') reglages.effort = effortDuSousAgent(opts.sousAgent);
    // Palier épuisé : aucun appel au modèle, même si la RPC de réservation manque.
    const resultat: ResultatTour = !reglages.modele_autorise ? { nouveauxMessages: [], proposition: null, texte: '', cost_cents: 0, plafond: true } : await tourLumi({
      client: ctx.auth.client,
      orgId: ctx.auth.orgId,
      userId: ctx.auth.user.id,
      accessToken: ctx.accessToken,
      // Bloc variable du tour : sujet du sous-agent + indices d'outils différés (code, 0 token d'API).
      systeme: (() => {
        const focus = [
          opts.sousAgent ? focusDuSousAgent(opts.sousAgent, ctx.language) : null,
          opts.enonce ? indiceOutils(opts.enonce, ctx.language, new Set(opts.sousAgent ? outilsDuSousAgent(opts.sousAgent) : OUTILS_DE_BASE)) : null,
        ].filter((x): x is string => !!x).join('\n\n');
        return focus ? promptSystemeLumi({ ...ctx.promptCtx, focus }) : ctx.systeme;
      })(),
      sousAgent: opts.sousAgent ?? null,
      reglages,
      budget: {
        reserver: (cents) => reserverBudget(ctx.admin, ctx.auth.orgId, cents),
        regler: (id, cents) => reglerBudget(ctx.admin, id, cents),
      },
      autorisations: await autorisationsDe(ctx.admin, ctx.auth.orgId, ctx.auth.user.id, Object.keys(TOOLS_BY_NAME).filter((n) => TOOLS_BY_NAME[n]?.kind === 'write')),
      ecrituresRestantes: Math.max(0, PLAFOND_ECRITURES_PAR_CONVERSATION - compterEcritures([...opts.historique, ...opts.nouveauxAvant])),
      historique: [...opts.historique, ...opts.nouveauxAvant],
      emettre: (e) => { if (!ferme) emettre(e); },
      journaliser: (usage, model, cost_cents) => journaliserUsage(ctx.admin, {
        orgId: ctx.auth.orgId, userId: ctx.auth.user.id, conversationId, model,
        input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
        cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: usage.cache_read_input_tokens ?? 0, cost_cents,
      }),
    });
    if (resultat.plafond) {
      // Plafond dur atteint : rien n'est parti au modèle pour cette étape ;
      // message gabarit (0 token), les actions rapides restent servies.
      const texte = messagePause(ctx.language);
      if (!ferme) emettreSse('text', { type: 'text', delta: texte });
      resultat.nouveauxMessages.push({ role: 'assistant', content: [{ type: 'text', text: texte }] });
      resultat.texte = resultat.texte ? `${resultat.texte}\n\n${texte}` : texte;
    }
    await sauverMessages(conversationId, ctx.auth.orgId, resultat.nouveauxMessages, cleRefs);
    const budget = await etatBudget(ctx.admin, ctx.auth.orgId);
    if (!ferme) emettreSse('done', { conversation_id: conversationId, cost_cents: resultat.cost_cents, budget, proposal: resultat.proposition, etage: ETAGE.agent });
    void tracer(resultat.proposition ? 'proposition' : 'ok', resultat.cost_cents, resultat.plafond ? 'budget_epuise' : resultat.proposition?.tool ?? null);
    // Étages 3-4 : une réponse de lecture au premier message se mémorise (exacte + sémantique).
    if (opts.cache && opts.enonce && !erreurModele && !resultat.plafond && tourCachable({ historiqueVide: opts.cache.historiqueVide, texte: resultat.texte, outils, proposition: !!resultat.proposition, resultat: 'ok', ecritureExecutee, enonce: opts.enonce })) {
      const p = { orgId: ctx.auth.orgId, userId: ctx.auth.user.id, enonce: opts.enonce };
      void ecrireReponse(p, { texte: resultat.texte, fiches, outils });
      void (async () => {
        const vec = opts.cache?.vecteur ? await opts.cache.vecteur : null;
        if (vec) await memoriserSemantique({ genre: 'tenant', orgId: p.orgId, userId: p.userId }, { enonce: opts.enonce!, vec, texte: resultat.texte, fiches, outils, version: await versionOrg(p.orgId) });
        // Réponse d'aide pure (seul search_help a servi, aucun nom d'org ni de personne dedans) → cache global 24 h.
        const nomsSensibles = [ctx.promptCtx.companyName, ctx.promptCtx.userName].filter((x): x is string => !!x && x.length > 2);
        if (vec && outils.length > 0 && outils.every((o) => o === 'search_help') && !nomsSensibles.some((n) => resultat.texte.toLowerCase().includes(n.toLowerCase()))) {
          await memoriserSemantique({ genre: 'global', espace: 'aide' }, { enonce: opts.enonce!, vec, texte: resultat.texte, fiches: [], outils, version: 0 });
        }
      })();
    }
  } catch (err: any) {
    logger.error('[lumi] tour échoué', { error: err?.message || String(err), orgId: ctx.auth.orgId });
    if (!ferme) emettreSse('error', { message: 'Lumi failed to respond.' });
    void tracer('erreur', 0);
  } finally {
    res.end();
  }
}

// ── POST /lumi/chat ─────────────────────────────────────────────
/**
 * Limite par PERSONNE et par heure : bloque un script ou une boucle sans
 * jamais gêner un humain qui travaille (60 tours/h, c'est un par minute).
 */
const limiteHoraireLumi = process.env.LUMI_TOURS_PAR_HEURE === '0'
  // Batterie d'évaluation (80 demandes d'un coup, même compte) : la limite est levée par LUMI_TOURS_PAR_HEURE=0, jamais en prod.
  ? ((_req: Request, _res: Response, next: () => void) => next())
  : redisRateLimit({ preset: 'lumi', keyFn: (req) => `lumi:${userKey(req)}` });

router.post('/lumi/chat', limiteHoraireLumi, validate(chatSchema), async (req, res) => {
  try {
    const ctx = await contexteTour(req, res);
    if (!ctx) return;
    const { conversation_id, message, origine = 'texte' } = req.body as z.infer<typeof chatSchema>;

    let conversationId = conversation_id ?? null;
    let historique: Msg[] = [];
    if (conversationId) {
      const { data: conv } = await ctx.admin.from('lumi_conversations').select('id').eq('id', conversationId).eq('org_id', ctx.auth.orgId).eq('user_id', ctx.auth.user.id).maybeSingle();
      if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
      // Fenêtre d'historique selon le palier de budget (60 messages ; 6 en économe/restreint).
      historique = await chargerHistorique(conversationId, `${ctx.auth.orgId}:${ctx.auth.user.id}`, reglagesPourPalier(ctx.budget.palier, modeleLumi()).historique_messages);
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
    const enAttente = propositionsEnAttente(historique);
    if (enAttente.length) {
      nouveaux.push({ role: 'user', content: enAttente.map((a) => ({ type: 'tool_result' as const, tool_use_id: a.tool_use_id, content: JSON.stringify({ cancelled: true, note: "L'utilisateur n'a pas confirmé cette action ; elle n'a pas été exécutée." }) })) });
    }
    nouveaux.push({ role: 'user', content: message });

    // Raccourci déterministe : la question la plus courante a une réponse
    // sans modèle (0 ¢, voir raccourcis.ts). Jamais quand une proposition
    // vient d'être annulée : le modèle doit en rendre compte.
    // Repli (item 6) : « non », « pas ça », ou le bouton Réessayer = la réponse
    // précédente n'était pas la bonne. On n'insiste jamais avec un étage sans
    // modèle : le modèle reprend, avec l'énoncé précédent tracé comme candidat
    // à retirer des énoncés exacts.
    const repli = origine === 'repli' || estUnRepli(message);
    const enoncePrecedent = repli ? dernierEnonceUtilisateur(historique) : null;
    // Jamais un courriel en guise de prénom (« Bonjour will@… »).
    const ctxRaccourci = {
      client: ctx.auth.client, orgId: ctx.auth.orgId, userId: ctx.auth.user.id, accessToken: ctx.accessToken,
      language: ctx.language, fuseau: ctx.fuseau,
      prenom: ctx.userName && !ctx.userName.includes('@') ? ctx.userName.trim().split(/\s+/)[0] || null : null,
    };
    const raccourci = enAttente.length || repli ? null : detecterRaccourci(message);
    if (raccourci) {
      const debut = Date.now();
      const reponse = await repondreRaccourci(raccourci, ctxRaccourci);
      if (reponse) {
        const cleRefs = `${ctx.auth.orgId}:${ctx.auth.user.id}`;
        await sauverMessages(conversationId!, ctx.auth.orgId, [...nouveaux, { role: 'assistant', content: [{ type: 'text', text: reponse.texte }] }], cleRefs);
        const emettreSse = ouvrirSse(res);
        emettreSse('tool', { type: 'tool', name: raccourci.tool, statut: 'debut' });
        emettreSse('tool', { type: 'tool', name: raccourci.tool, statut: 'fin' });
        emettreSse('text', { type: 'text', delta: reponse.texte });
        if (reponse.fiches.length) emettreSse('fiches', { type: 'fiches', fiches: reponse.fiches });
        emettreSse('done', { conversation_id: conversationId, cost_cents: 0, budget: ctx.budget, proposal: null, raccourci: raccourci.id, etage: raccourci.etage ?? ETAGE.raccourci });
        // Étage 2 : répondu sans modèle. C'est cette ligne qui mesure la part de trafic absorbée.
        void journaliserTrace(ctx.admin, {
          orgId: ctx.auth.orgId, userId: ctx.auth.user.id, conversationId, canal: 'lumi', origine,
          enonce: normaliserEnonce(message), etage: raccourci.etage ?? ETAGE.raccourci, action: raccourci.id, params: raccourci.periode ? { periode: raccourci.periode } : raccourci.numero ? { numero: raccourci.numero } : null,
          outils: [raccourci.tool], resultat: 'ok', model: null, usage: usageVide(), costCents: 0, dureeMs: Date.now() - debut,
        });
        return res.end();
      }
    }

    // Étage 2 bis — actions directes (actions-directes.ts, 2026-09-17) : fiches par
    // numéro, listes de réglages, écritures qui ne touchent que l'utilisateur
    // (pointage, pause, mémoire), et cartes préparées par le code (job 33
    // terminé, envoie la facture 4, invite marc@… comme technicien). 0 token.
    // Au moindre doute la fonction rend null et le modèle prend le relais.
    const directe = enAttente.length || repli ? null : detecterActionDirecte(message);
    if (directe) {
      const debut = Date.now();
      const rep = await repondreActionDirecte(directe, { ...ctxRaccourci, maintenant: new Date() });
      if (rep) {
        const cleRefs = `${ctx.auth.orgId}:${ctx.auth.user.id}`;
        await sauverMessages(conversationId!, ctx.auth.orgId, [...nouveaux, ...(rep.messages as Msg[])], cleRefs);
        const emettreSse = ouvrirSse(res);
        if (rep.genre === 'texte') {
          emettreSse('tool', { type: 'tool', name: directe.tool, statut: 'debut' });
          emettreSse('tool', { type: 'tool', name: directe.tool, statut: 'fin' });
          if (rep.recu) emettreSse('executed', { type: 'executed', ...rep.recu });
          emettreSse('text', { type: 'text', delta: rep.texte });
          if (rep.fiches.length) emettreSse('fiches', { type: 'fiches', fiches: rep.fiches });
          emettreSse('done', { conversation_id: conversationId, cost_cents: 0, budget: ctx.budget, proposal: null, raccourci: directe.id, etage: ETAGE.raccourci });
        } else {
          emettreSse('proposal', { type: 'proposal', tool_use_id: rep.tool_use_id, tool: rep.tool, args: rep.args, capacite: rep.capacite, apercu: rep.apercu });
          emettreSse('done', { conversation_id: conversationId, cost_cents: 0, budget: ctx.budget, proposal: { tool_use_id: rep.tool_use_id, tool: rep.tool, args: rep.args }, raccourci: directe.id, etage: ETAGE.raccourci });
        }
        void journaliserTrace(ctx.admin, {
          orgId: ctx.auth.orgId, userId: ctx.auth.user.id, conversationId, canal: 'lumi', origine,
          enonce: normaliserEnonce(message), etage: ETAGE.raccourci, action: directe.id, params: directe.cible ? { cible: directe.cible } : undefined,
          outils: [directe.tool], resultat: rep.genre === 'carte' ? 'proposition' : 'ok', model: null, usage: usageVide(), costCents: 0, dureeMs: Date.now() - debut,
        });
        return res.end();
      }
    }

    // Repli : la réponse précédente n'était pas la bonne → on l'oublie dans les deux caches.
    if (repli && enoncePrecedent) {
      void retirerReponse({ orgId: ctx.auth.orgId, userId: ctx.auth.user.id, enonce: enoncePrecedent });
      void oublierSemantique({ genre: 'tenant', orgId: ctx.auth.orgId, userId: ctx.auth.user.id }, enoncePrecedent);
      void oublierSemantique({ genre: 'global', espace: 'aide' }, enoncePrecedent);
    }
    // Étages 3 (exact) et 4 (sémantique) : premier message d'une conversation seulement,
    // jamais après un repli ni avec une proposition en attente.
    const premierMessage = historique.length === 0 && !enAttente.length && !repli;
    const vecteur = premierMessage ? embed(message) : null;
    // Jamais de cache pour une demande de document ou de mémoire (voir enonceCachable).
    if (premierMessage && enonceCachable(message)) {
      const debut = Date.now();
      const p = { orgId: ctx.auth.orgId, userId: ctx.auth.user.id, enonce: message };
      let hit: { texte: string; fiches: Fiche[]; outils: string[] } | null = await lireReponse(p);
      let etage: number = ETAGE.cacheReponse;
      if (!hit) {
        const vec = await vecteur;
        const s = vec ? await chercherSemantique({ genre: 'tenant', orgId: p.orgId, userId: p.userId }, vec, await versionOrg(p.orgId), message) : null;
        if (s) { hit = s.entree; etage = ETAGE.cacheSemantique; }
        // Cache d'AIDE partagé par toutes les orgs (B8) : « comment je fais X dans
        // Lume » répondu une fois pour tout le monde (aucune donnée d'org dedans).
        const g = !s && vec ? await chercherSemantique({ genre: 'global', espace: 'aide' }, vec, null, message) : null;
        if (g) { hit = g.entree; etage = ETAGE.cacheSemantique; }
      }
      if (hit) {
        const cleRefs = `${ctx.auth.orgId}:${ctx.auth.user.id}`;
        await sauverMessages(conversationId!, ctx.auth.orgId, [...nouveaux, { role: 'assistant', content: [{ type: 'text', text: hit.texte }] }], cleRefs);
        const emettreSse = ouvrirSse(res);
        for (const o of hit.outils) { emettreSse('tool', { type: 'tool', name: o, statut: 'debut' }); emettreSse('tool', { type: 'tool', name: o, statut: 'fin' }); }
        emettreSse('text', { type: 'text', delta: hit.texte });
        if (hit.fiches.length) emettreSse('fiches', { type: 'fiches', fiches: hit.fiches });
        emettreSse('done', { conversation_id: conversationId, cost_cents: 0, budget: ctx.budget, proposal: null, etage });
        void journaliserTrace(ctx.admin, {
          orgId: ctx.auth.orgId, userId: ctx.auth.user.id, conversationId, canal: 'lumi', origine,
          enonce: message, etage, action: etage === ETAGE.cacheReponse ? 'cache-exact' : 'cache-semantique', outils: hit.outils, resultat: 'ok',
          model: null, promptVersion: VERSION_PROMPT, usage: usageVide(), costCents: etage === ETAGE.cacheReponse ? 0 : null, dureeMs: Date.now() - debut,
        });
        return res.end();
      }
    }

    // Règle stricte : une conversation qui a déjà coûté plus que le plafond ne
    // repasse plus par le modèle (gabarit, 0 token) ; les étages 0-4 ci-dessus
    // ont déjà eu leur chance. Vérifié seulement quand l'historique est long.
    if (historique.length >= 10) {
      const { data: lignes } = await ctx.admin.from('ai_usage').select('cost_cents').eq('conversation_id', conversationId!);
      const depense = ((lignes ?? []) as Array<{ cost_cents: number | string }>).reduce((s, l) => s + Number(l.cost_cents ?? 0), 0);
      if (depense >= reglesCout().plafond_cout_conversation_cents) {
        const debut = Date.now();
        const texte = messagePlafondConversation(ctx.language);
        await sauverMessages(conversationId!, ctx.auth.orgId, [...nouveaux, { role: 'assistant', content: [{ type: 'text', text: texte }] }], `${ctx.auth.orgId}:${ctx.auth.user.id}`);
        const emettreSse = ouvrirSse(res);
        emettreSse('text', { type: 'text', delta: texte });
        emettreSse('done', { conversation_id: conversationId, cost_cents: 0, budget: ctx.budget, proposal: null, etage: ETAGE.interface });
        void journaliserTrace(ctx.admin, {
          orgId: ctx.auth.orgId, userId: ctx.auth.user.id, conversationId, canal: 'lumi', origine,
          enonce: normaliserEnonce(message), etage: ETAGE.interface, action: 'plafond_conversation', params: { depense_cents: Math.round(depense * 100) / 100 },
          outils: [], resultat: 'refus', model: null, usage: usageVide(), costCents: 0, dureeMs: Date.now() - debut,
        });
        return res.end();
      }
    }

    // Étage 5 — routeur ACTIF (LUMI_ROUTEUR=actif) : Haiku classe l'énoncé
    // (~0,03 ¢, prompt en cache) ; une action déterministe reconnue avec assez
    // de confiance (SEUIL_CONFIANCE) répond sans le gros modèle — 0,3 à 0,6 ¢
    // économisés par tour reconnu. Sinon le verdict voyage dans la trace du
    // tour (calibrage du seuil), sans second appel. PREMIER message d'une
    // conversation seulement (comme les caches) : le routeur ne voit que
    // l'énoncé, et « il a-tu des factures pas payées ? » après une fiche
    // client était routé vers TOUS les retards (sondage du 2026-09-16).
    // Jamais après un repli ni avec une proposition en attente.
    let routeur: ResultatRouteur | null = null;
    if (modeRouteur() === 'actif' && !enAttente.length && !repli) {
      const debut = Date.now();
      // Suite de conversation : le routeur voit l'échange précédent (tronqué) et
      // n'agit que si le message se suffit (changement de période) — un « il »
      // ou « le pire » reste au modèle complet, qui a tout le contexte.
      routeur = await classifier(message, contexteRouteur(historique));
      const coutRouteur = routeur.usage ? coutEnCents(MODELE_ROUTEUR, routeur.usage) : 0;
      if (routeur.usage) {
        void journaliserUsage(ctx.admin, {
          orgId: ctx.auth.orgId, userId: ctx.auth.user.id, conversationId, model: MODELE_ROUTEUR,
          input_tokens: routeur.usage.input_tokens, output_tokens: routeur.usage.output_tokens,
          cache_creation_input_tokens: routeur.usage.cache_creation_input_tokens, cache_read_input_tokens: routeur.usage.cache_read_input_tokens, cost_cents: coutRouteur,
        });
      }
      const r = routeur.decision === 'action' && routeur.verdict?.action ? raccourciDepuisAction(routeur.verdict.action, routeur.verdict.params ?? {}) : null;
      const reponse = r ? await repondreRaccourci(r, ctxRaccourci) : null;
      if (r && reponse) {
        const cleRefs = `${ctx.auth.orgId}:${ctx.auth.user.id}`;
        await sauverMessages(conversationId!, ctx.auth.orgId, [...nouveaux, { role: 'assistant', content: [{ type: 'text', text: reponse.texte }] }], cleRefs);
        const emettreSse = ouvrirSse(res);
        emettreSse('tool', { type: 'tool', name: r.tool, statut: 'debut' });
        emettreSse('tool', { type: 'tool', name: r.tool, statut: 'fin' });
        emettreSse('text', { type: 'text', delta: reponse.texte });
        if (reponse.fiches.length) emettreSse('fiches', { type: 'fiches', fiches: reponse.fiches });
        emettreSse('done', { conversation_id: conversationId, cost_cents: coutRouteur, budget: ctx.budget, proposal: null, raccourci: r.id, etage: ETAGE.routeur });
        // La même question, redemandée : servie par les caches (étages 3-4), sans même le routeur. Premier message seulement.
        if (premierMessage) {
          const p = { orgId: ctx.auth.orgId, userId: ctx.auth.user.id, enonce: message };
          void ecrireReponse(p, { texte: reponse.texte, fiches: reponse.fiches, outils: [r.tool] });
          void (async () => {
            const vec = vecteur ? await vecteur : null;
            if (vec) await memoriserSemantique({ genre: 'tenant', orgId: p.orgId, userId: p.userId }, { enonce: message, vec, texte: reponse.texte, fiches: reponse.fiches, outils: [r.tool], version: await versionOrg(p.orgId) });
          })();
        }
        void journaliserTrace(ctx.admin, {
          orgId: ctx.auth.orgId, userId: ctx.auth.user.id, conversationId, canal: 'lumi', origine,
          enonce: normaliserEnonce(message), etage: ETAGE.routeur, action: r.id,
          params: { ...(r.periode ? { periode: r.periode } : {}), ...(r.numero ? { numero: r.numero } : {}), routeur: { verdict: routeur.verdict, statut: routeur.statut, decision: routeur.decision, duree_ms: routeur.duree_ms, usage: routeur.usage ?? null } },
          outils: [r.tool], resultat: 'ok', model: MODELE_ROUTEUR, usage: routeur.usage ? ajouterUsage(usageVide(), routeur.usage) : usageVide(), costCents: coutRouteur, dureeMs: Date.now() - debut,
        });
        return res.end();
      }
    }

    // B7 : un topic sûr sans action déterministe → le modèle part avec les outils de ce sous-agent seulement.
    const sousAgent = sousAgentDepuisVerdict(routeur);
    await executerTourSse({ req, res, ctx, conversationId: conversationId!, historique, nouveauxAvant: nouveaux, origine: repli ? 'repli' : origine, enonce: message, routeur, sousAgent, ...(repli ? { action: 'repli', params: { candidat_retrait: normaliserEnonce(enoncePrecedent) } } : {}), cache: { historiqueVide: premierMessage, vecteur } });
  } catch (error: any) {
    if (res.headersSent) return res.end();
    return sendSafeError(res, error, 'Lumi failed to respond.', '[lumi/chat]');
  }
});

// ── POST /lumi/action — étage 0 : action d'interface, sans texte ni modèle ──
router.post('/lumi/action', validate(actionSchema), async (req, res) => {
  try {
    const ctx = await contexteTour(req, res);
    if (!ctx) return;
    const { conversation_id, action, params = {}, label, origine = 'suggestion' } = req.body as z.infer<typeof actionSchema>;
    const raccourci = raccourciDepuisAction(action, params);
    if (!raccourci) return res.status(422).json({ error: 'Unknown action or parameters.', code: 'action_indisponible' });

    let conversationId = conversation_id ?? null;
    let historique: Msg[] = [];
    if (conversationId) {
      const { data: conv } = await ctx.admin.from('lumi_conversations').select('id').eq('id', conversationId).eq('org_id', ctx.auth.orgId).eq('user_id', ctx.auth.user.id).maybeSingle();
      if (!conv) return res.status(404).json({ error: 'Conversation not found.' });
      historique = await chargerHistorique(conversationId, `${ctx.auth.orgId}:${ctx.auth.user.id}`);
    } else {
      const { data: conv, error } = await ctx.admin.from('lumi_conversations')
        .insert({ org_id: ctx.auth.orgId, user_id: ctx.auth.user.id, title: label.slice(0, 80) })
        .select('id').single();
      if (error || !conv) throw new Error(error?.message || 'conversation');
      conversationId = conv.id;
    }
    // Une proposition laissée en attente est annulée par le clic (même règle que /lumi/chat).
    const nouveaux: Msg[] = [];
    const enAttente = propositionsEnAttente(historique);
    if (enAttente.length) {
      nouveaux.push({ role: 'user', content: enAttente.map((a) => ({ type: 'tool_result' as const, tool_use_id: a.tool_use_id, content: JSON.stringify({ cancelled: true, note: "L'utilisateur n'a pas confirmé cette action ; elle n'a pas été exécutée." }) })) });
    }
    nouveaux.push({ role: 'user', content: label });

    const debut = Date.now();
    const reponse = await repondreRaccourci(raccourci, {
      client: ctx.auth.client, orgId: ctx.auth.orgId, userId: ctx.auth.user.id, accessToken: ctx.accessToken,
      language: ctx.language, fuseau: ctx.fuseau,
      prenom: ctx.userName && !ctx.userName.includes('@') ? ctx.userName.trim().split(/\s+/)[0] || null : null,
    });
    // Refus de rôle ou outil en échec : on ne devine rien, le client renvoie le texte au modèle s'il le veut.
    if (!reponse) return res.status(422).json({ error: 'Action unavailable for this user.', code: 'action_indisponible' });

    const cleRefs = `${ctx.auth.orgId}:${ctx.auth.user.id}`;
    await sauverMessages(conversationId!, ctx.auth.orgId, [...nouveaux, { role: 'assistant', content: [{ type: 'text', text: reponse.texte }] }], cleRefs);
    const emettreSse = ouvrirSse(res);
    emettreSse('tool', { type: 'tool', name: raccourci.tool, statut: 'debut' });
    emettreSse('tool', { type: 'tool', name: raccourci.tool, statut: 'fin' });
    emettreSse('text', { type: 'text', delta: reponse.texte });
    if (reponse.fiches.length) emettreSse('fiches', { type: 'fiches', fiches: reponse.fiches });
    emettreSse('done', { conversation_id: conversationId, cost_cents: 0, budget: ctx.budget, proposal: null, raccourci: raccourci.id, etage: ETAGE.interface });
    void journaliserTrace(ctx.admin, {
      orgId: ctx.auth.orgId, userId: ctx.auth.user.id, conversationId, canal: 'lumi', origine,
      enonce: label, etage: ETAGE.interface, action, params, outils: [raccourci.tool], resultat: 'ok', model: null, usage: usageVide(), costCents: 0, dureeMs: Date.now() - debut,
    });
    return res.end();
  } catch (error: any) {
    if (res.headersSent) return res.end();
    return sendSafeError(res, error, 'Lumi failed to run the action.', '[lumi/action]');
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
    // La décision porte sur le GROUPE : toutes les écritures en attente du
    // dernier message (une carte), identifiées par la première.
    const enAttente = propositionsEnAttente(historique);
    if (!enAttente.length || !enAttente.some((a) => a.tool_use_id === tool_use_id)) {
      return res.status(409).json({ error: 'No such pending action.', code: 'aucune_proposition' });
    }
    // B9 : une proposition n'est valable que 15 min. Passé ce délai, Confirmer
    // refuse (le message suivant l'annule, comme d'habitude) : on n'exécute
    // jamais une carte oubliée ouverte sur un écran.
    if (decision === 'confirm') {
      const { data: dernier } = await ctx.admin.from('lumi_messages').select('created_at').eq('conversation_id', conversation_id).eq('role', 'assistant').order('created_at', { ascending: false }).limit(1).maybeSingle();
      const age = dernier?.created_at ? Date.now() - new Date(dernier.created_at as string).getTime() : 0;
      if (age > EXPIRATION_PROPOSITION_MS) {
        return res.status(409).json({
          error: ctx.language === 'fr' ? 'Cette proposition a expiré (15 minutes). Redemande-la à Lumi pour l’exécuter.' : 'This proposal has expired (15 minutes). Ask Lumi again to run it.',
          code: 'proposition_expiree',
        });
      }
    }
    // Cran d'arrêt : au-delà du plafond, Confirmer refuse (la proposition reste
    // affichée, l'utilisateur ouvre une nouvelle conversation pour continuer).
    const faites = compterEcritures(historique);
    if (decision === 'confirm' && faites + enAttente.length > PLAFOND_ECRITURES_PAR_CONVERSATION) {
      void escalader(ctx.admin, { orgId: ctx.auth.orgId, userId: ctx.auth.user.id, conversationId: conversation_id, motif: 'plafond_ecritures', fr: ctx.language === 'fr',
        detail: ctx.language === 'fr' ? `Une conversation Lumi a atteint ${PLAFOND_ECRITURES_PAR_CONVERSATION} actions.` : `A Lumi conversation reached ${PLAFOND_ECRITURES_PAR_CONVERSATION} actions.` });
      return res.status(409).json({
        error: ctx.language === 'fr'
          ? `Cette conversation a déjà fait ${faites} actions : c'est le maximum (${PLAFOND_ECRITURES_PAR_CONVERSATION}). Ouvre une nouvelle conversation pour continuer.`
          : `This conversation already made ${faites} actions: that is the maximum (${PLAFOND_ECRITURES_PAR_CONVERSATION}). Start a new conversation to continue.`,
        code: 'plafond_ecritures', plafond: PLAFOND_ECRITURES_PAR_CONVERSATION, faites,
      });
    }

    if (decision === 'dry_run') {
      const simulations = [];
      for (const a of enAttente) {
        const args = demasquerIds(`${ctx.auth.orgId}:${ctx.auth.user.id}`, a.args);
        const r = await executerEcriture({ tool: a.tool, toolUseId: a.tool_use_id, args, userId: ctx.auth.user.id, orgId: ctx.auth.orgId, client: ctx.auth.client, accessToken: ctx.accessToken, dryRun: true });
        simulations.push({ tool_use_id: a.tool_use_id, tool: a.tool, ...JSON.parse(r.contenu) });
      }
      // Rien n'est sauvé ni exécuté : la proposition reste en attente telle quelle.
      return res.json({ dry_run: true, simulations });
    }

    const blocs: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
    const execute: ReçuExecution[] = [];
    for (const a of enAttente) {
      if (decision === 'cancel') {
        blocs.push({ type: 'tool_result', tool_use_id: a.tool_use_id, content: JSON.stringify({ cancelled: true, note: "L'utilisateur a annulé cette action ; elle n'a pas été exécutée." }) });
        continue;
      }
      // Exécution RÉELLE, dans l'ordre, à l'identité de l'utilisateur, avec les
      // gardes du MCP — même chemin que l'exécution d'office d'un outil autorisé.
      const args = demasquerIds(`${ctx.auth.orgId}:${ctx.auth.user.id}`, a.args);
      const r = await executerEcriture({ tool: a.tool, toolUseId: a.tool_use_id, args, userId: ctx.auth.user.id, orgId: ctx.auth.orgId, client: ctx.auth.client, accessToken: ctx.accessToken });
      blocs.push({ type: 'tool_result', tool_use_id: a.tool_use_id, content: r.contenu });
      execute.push(r.recu);
      // Effet partiel (job créé sans ses articles, envoi « peut-être parti ») : un humain doit vérifier.
      const motif = motifDansResultat(r.contenu);
      if (motif) {
        void escalader(ctx.admin, { orgId: ctx.auth.orgId, userId: ctx.auth.user.id, conversationId: conversation_id, motif, fr: ctx.language === 'fr',
          detail: ctx.language === 'fr' ? `Une action de Lumi (${a.tool.replace(/_/g, ' ')}) s’est arrêtée à mi-chemin : à vérifier dans la conversation.` : `A Lumi action (${a.tool.replace(/_/g, ' ')}) stopped halfway: check the conversation.` });
      }
    }
    const resultat: Msg = { role: 'user', content: blocs };

    // Reçu SANS modèle (item 5, étage 0) : la phrase « c'est fait » est un
    // gabarit à partir du reçu. Avant, un appel complet au modèle partait
    // pour cette seule phrase. Le modèle relira ce texte comme le sien si
    // l'utilisateur écrit ensuite.
    const debut = Date.now();
    const lignes: LigneRecu[] = enAttente.map((a, i) => {
      const bloc = blocs[i];
      let erreur: string | null = null;
      try { const j = JSON.parse(bloc.content); if (typeof j?.error === 'string') erreur = j.error; } catch { /* contenu non JSON : pas d'erreur métier lisible */ }
      return { recu: execute[i] ?? { tool_use_id: a.tool_use_id, ok: false, fiche: null }, erreur, outil: a.tool };
    });
    const texte = texteRecus(lignes, decision, ctx.language === 'fr');
    const cleRefs = `${ctx.auth.orgId}:${ctx.auth.user.id}`;
    await sauverMessages(conversation_id, ctx.auth.orgId, [resultat, { role: 'assistant', content: [{ type: 'text', text: texte }] }], cleRefs);
    const emettreSse = ouvrirSse(res);
    for (const recu of execute) emettreSse('executed', recu);
    emettreSse('text', { type: 'text', delta: texte });
    const budget = await etatBudget(ctx.admin, ctx.auth.orgId);
    emettreSse('done', { conversation_id, cost_cents: 0, budget, proposal: null, recu: true, etage: ETAGE.interface });
    void journaliserTrace(ctx.admin, {
      orgId: ctx.auth.orgId, userId: ctx.auth.user.id, conversationId: conversation_id, canal: 'lumi', origine: 'carte',
      enonce: null, etage: ETAGE.interface, action: decision, outils: enAttente.map((a) => a.tool),
      resultat: decision === 'cancel' ? 'ok' : (execute.every((e) => e.ok) ? 'ok' : 'erreur'), model: null, usage: usageVide(), costCents: 0, dureeMs: Date.now() - debut,
    });
    return res.end();
  } catch (error: any) {
    if (res.headersSent) return res.end();
    return sendSafeError(res, error, 'Lumi failed to execute the action.', '[lumi/execute]');
  }
});

// ── Mode de confirmation (demander | argent | tout) ─────────────
router.get('/lumi/mode', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    return res.json({ mode: await modeDe(getServiceClient(), auth.orgId, auth.user.id) });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to load Lumi mode.', '[lumi/mode]');
  }
});

const modeSchema = z.object({ mode: z.enum(['demander', 'argent', 'tout']) });
router.put('/lumi/mode', validate(modeSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { mode } = req.body as { mode: ModeLumi };
    if (!MODES_LUMI.includes(mode)) return res.status(400).json({ error: 'Unknown mode.' });
    // « Tout faire sans demander » = un texto peut partir sans être vu (R11) :
    // réservé au propriétaire de l'entreprise, jamais à un employé.
    if (mode === 'tout') {
      const ctxRole = await getUserContext(getServiceClient(), auth.user.id, auth.orgId);
      if (ctxRole?.role !== 'owner') {
        return res.status(403).json({ error: 'Only the owner can let Lumi act without asking.', code: 'mode_reserve_proprietaire' });
      }
    }
    await definirMode(getServiceClient(), auth.orgId, auth.user.id, mode);
    return res.json({ mode });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to update Lumi mode.', '[lumi/mode]');
  }
});

// ── Autorisations « toujours confirmer » ────────────────────────
router.get('/lumi/autorisations', async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const outils = await autorisationsDe(getServiceClient(), auth.orgId, auth.user.id);
    return res.json({ tools: [...outils].sort() });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to load Lumi authorizations.', '[lumi/autorisations]');
  }
});

const autorisationSchema = z.object({ tool: z.string().trim().min(1).max(80).regex(/^[a-z0-9_]+$/), actif: z.boolean() });
router.put('/lumi/autorisations', validate(autorisationSchema), async (req, res) => {
  try {
    const auth = await requireAuthedClient(req, res);
    if (!auth) return;
    const { tool, actif } = req.body as z.infer<typeof autorisationSchema>;
    // Seul un outil d'ÉCRITURE connu peut être autorisé d'office.
    if (TOOLS_BY_NAME[tool]?.kind !== 'write') return res.status(400).json({ error: 'Unknown write tool.', code: 'outil_inconnu' });
    await definirAutorisation(getServiceClient(), auth.orgId, auth.user.id, tool, actif);
    const outils = await autorisationsDe(getServiceClient(), auth.orgId, auth.user.id);
    return res.json({ tools: [...outils].sort() });
  } catch (error: any) {
    return sendSafeError(res, error, 'Unable to update Lumi authorizations.', '[lumi/autorisations]');
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
type PropositionRendue = { tool_use_id: string; tool: string; args: Record<string, any>; capacite: string | null; statut: 'en_attente' | 'confirmee' | 'annulee' | 'echouee'; fiche?: Fiche | null; auto?: boolean; groupe?: PropositionRendue[] };
export function rendreMessages(msgs: Msg[]): Array<{ role: 'user' | 'assistant'; text: string; tools: string[]; proposal?: PropositionRendue; report?: Rapport }> {
  const sorts = new Map<string, 'confirmee' | 'annulee' | 'echouee'>();
  const fiches = new Map<string, Fiche>();
  const autos = new Set<string>();
  const rapports = new Map<string, Rapport>();
  for (const m of msgs) {
    if (m.role === 'user' && Array.isArray(m.content)) {
      for (const b of m.content as any[]) {
        if (b.type !== 'tool_result') continue;
        const txt = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
        sorts.set(b.tool_use_id, /"cancelled":true/.test(txt) ? 'annulee' : /"executed":true/.test(txt) ? 'confirmee' : 'echouee');
        if (/"executed":true/.test(txt)) {
          try {
            const j = JSON.parse(txt);
            if (j?.fiche?.href && j?.fiche?.label) fiches.set(b.tool_use_id, j.fiche);
            if (j?.auto === true) autos.add(b.tool_use_id);
          } catch { /* résultat tronqué : pas de lien */ }
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
    let proposal: PropositionRendue | undefined;
    const ecritures: PropositionRendue[] = [];
    let report: Rapport | undefined;
    for (const b of blocs) {
      if (b.type !== 'tool_use') continue;
      if (rapports.has(b.id)) report = rapports.get(b.id);
      const outil = TOOLS_BY_NAME[b.name];
      if (outil?.kind === 'write') {
        ecritures.push({ tool_use_id: b.id, tool: b.name, args: b.input ?? {}, capacite: PERMISSION_PAR_OUTIL[b.name]?.capacite ?? null, statut: sorts.get(b.id) ?? 'en_attente', fiche: fiches.get(b.id) ?? null, ...(autos.has(b.id) ? { auto: true } : {}) });
      } else tools.push(b.name);
    }
    if (ecritures.length === 1) proposal = ecritures[0];
    else if (ecritures.length > 1) {
      // Plusieurs écritures du même message = une carte ; l'état de la carte suit le pire de ses lignes.
      const statut = ecritures.some((e) => e.statut === 'en_attente') ? 'en_attente' : ecritures.some((e) => e.statut === 'echouee') ? 'echouee' : ecritures.every((e) => e.statut === 'annulee') ? 'annulee' : 'confirmee';
      proposal = { ...ecritures[0], statut, groupe: ecritures };
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
    // Tokens et coût réels de la conversation (table ai_usage, écrite à chaque
    // appel au modèle) : le chiffre vérifiable, pas une estimation.
    let usage: { model: string | null; input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cost_cents: number; appels: number } | undefined;
    const { data: lignes } = await getServiceClient().from('ai_usage').select('model, input_tokens, output_tokens, cache_read_input_tokens, cost_cents').eq('conversation_id', id).eq('org_id', auth.orgId);
    if (lignes && lignes.length) {
      usage = { model: (lignes[lignes.length - 1] as any).model ?? null, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cost_cents: 0, appels: lignes.length };
      for (const l of lignes as any[]) { usage.input_tokens += l.input_tokens || 0; usage.output_tokens += l.output_tokens || 0; usage.cache_read_input_tokens += l.cache_read_input_tokens || 0; usage.cost_cents += l.cost_cents || 0; }
    }
    return res.json({ conversation: conv, messages: rendreMessages(msgs), usage });
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
