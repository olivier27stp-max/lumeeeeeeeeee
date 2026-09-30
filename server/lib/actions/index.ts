/* ═══════════════════════════════════════════════════════════════
   Action Executors — Modular actions for the automation engine.
   Each action receives config + context and returns a result.
   ═══════════════════════════════════════════════════════════════ */

import { SupabaseClient } from '@supabase/supabase-js';
import { insertTargetedNotifications } from '../notificationHelpers';
import { annoncerEtiquette } from '../etiquettes';
import { executerMajChamp } from '../champs/automatisations';
import { variablesChamps } from '../champs/service';
import { findOrCreateConversation, normalizeE164, resolvePublicBaseUrl } from '../helpers';
import { reviewDestinations, reviewEmail, reviewSmsBody } from '../reviews';
import { baseLegalePour, methodePourJournal, type AncragesTacite, type BaseLegale } from '../consentement/base-legale';
import { motifSaut } from '../desabonnement';
import { drapeauActif, DRAPEAUX_AUTOMATISATIONS } from '../automations-drapeaux';
import { raisonLisible } from '../paiement-echoue';
import { creerLienReservation, demandeLienReservation } from '../client-inactif';

export interface ActionContext {
  supabase: SupabaseClient;
  orgId: string;
  entityType: string;
  entityId: string;
  twilio: { client: any; phoneNumber: string } | null;
  baseUrl: string;
  /**
   * true = message COMMERCIAL (relance, suivi, cross-sell — toute action
   * différée). Soumis au plafond de fréquence par destinataire. false/absent
   * = transactionnel (confirmation, reçu, rappel de RDV attendu) : toujours
   * livré, jamais plafonné. Posé par le worker des tâches différées.
   */
  commercial?: boolean;
  /**
   * Langue des messages envoyés au client ('fr' | 'en'), = default_language de
   * l'org. Le moteur choisit body_en/subject_en si 'en' et qu'ils existent,
   * sinon la version FR (repli). Absent → 'fr'.
   */
  langue?: 'fr' | 'en';
  /**
   * La regle en cours d'execution.
   *
   * Sert a « arreter cette automatisation » : sans elle, l'action ne saurait
   * pas QUELLE regle arreter et devrait tout annuler. Absente sur les appels
   * qui ne viennent pas du moteur (un test, un rejeu manuel).
   */
  ruleId?: string;
  /**
   * Règles qui ont produit l'événement en cours (anti-boucle des étiquettes,
   * voir server/lib/etiquettes.ts). Une étiquette posée ici l'annonce avec
   * cette chaîne + la règle courante.
   */
  chaine?: string[];
  /**
   * Drapeau `auto_desabonnement_canal` actif pour cette entreprise.
   *
   * Change deux choses, et seulement quand il est vrai :
   *   - `commercial` suit le TYPE de l'envoi (transactionnel / marketing,
   *     voir `server/lib/desabonnement`) au lieu de « différé = commercial » ;
   *   - un envoi marketing vers un client désabonné de CE canal est SAUTÉ
   *     (`success: true, data.saute`) au lieu d'échouer : le parcours
   *     continue, le motif est dans le journal. Le transactionnel part.
   */
  parCanal?: boolean;
}

/**
 * {{client.lien_reservation}} : un lien de 30 jours propre au client de
 * l'entité, créé SEULEMENT si le message l'utilise et si l'entreprise a le
 * drapeau `auto_client_inactif`. Sinon les variables sont rendues telles
 * quelles (la variable se résout à vide, comme toute variable inconnue).
 * Un échec ne bloque jamais l'envoi : le message part sans lien.
 */
async function avecLienReservation(
  ctx: ActionContext,
  vars: Record<string, string>,
  ...textes: string[]
): Promise<Record<string, string>> {
  if (!demandeLienReservation(...textes)) return vars;
  if (!(await drapeauActif(ctx.supabase, ctx.orgId, DRAPEAUX_AUTOMATISATIONS.clientInactif))) return vars;
  try {
    const clientId = await clientDeLEntite(ctx);
    if (!clientId) return vars;
    const { getServiceClient } = await import('../supabase');
    const lien = await creerLienReservation(getServiceClient(), ctx.orgId, clientId);
    return { ...vars, 'client.lien_reservation': lien };
  } catch (e: any) {
    console.error(`[actions] lien de réservation non créé (org ${ctx.orgId}):`, e?.message || e);
    return vars;
  }
}

/** Un envoi volontairement non fait : le parcours continue, le motif est journalisé. */
function saute(motif: string): ActionResult {
  return { success: true, data: { saute: motif } };
}

/** Le résultat est-il un vrai envoi (pas un saut) ? */
export function estEnvoye(r: ActionResult): boolean {
  return r.success && !(r.data && typeof r.data === 'object' && 'saute' in r.data);
}

/**
 * Version localisée d'un champ de message. En anglais, on prend `<champ>_en`
 * s'il est renseigné ; sinon on retombe sur la version française (jamais de
 * trou : une action pas encore traduite reste en français plutôt que vide).
 */
function champLocalise(config: Record<string, any>, champ: string, langue?: 'fr' | 'en'): string {
  if (langue === 'en') {
    const en = config[`${champ}_en`];
    if (typeof en === 'string' && en.trim()) return en;
  }
  return config[champ] || '';
}

/**
 * DESTINATAIRE_IMPOSE (F18, 2026-09-23) — pourquoi `config.to` n'est plus lu.
 * ──────────────────────────────────────────────────────────────────────────
 * Une action d'automatisation acceptait `config.to` : un courriel ou un numéro
 * écrit dans la règle, qui remplaçait le destinataire réel. Le message partait
 * donc ailleurs, AVEC les données du client dedans — `[client_name]`,
 * `[invoice_total]`, l'adresse. Un chemin d'exfiltration ouvert à quiconque
 * peut modifier une règle.
 *
 * Mesuré avant de le retirer : aucun champ dans l'interface pour le saisir,
 * aucun preset qui l'utilise, et ZÉRO usage sur 671 règles réelles (210 en
 * production, 461 en staging). Personne ne perd rien.
 *
 * Le destinataire vient désormais toujours de l'entité concernée
 * (`vars.client_email` / `vars.client_phone`), et de nulle part ailleurs.
 * Si un jour il faut prévenir quelqu'un d'autre que le client — le patron,
 * par exemple — ça passera par une action dédiée avec sa propre garde, pas
 * par un champ libre.
 */

/**
 * Le fuseau dans lequel un client lit ses messages. Identique à `QUIET_TZ`
 * dans `automationEngine.ts` (la fenêtre 8h–20h) : les deux décrivent la même
 * chose — l'heure locale de l'entreprise et de ses clients, au Québec.
 *
 * Une date sans fuseau explicite prend celui du SERVEUR, et Railway tourne en
 * UTC : c'est ainsi qu'un rendez-vous de 9 h devenait « 13 h 00 » dans le
 * message envoyé au client.
 */
/**
 * REPLI seulement. Le fuseau réel vient de `company_settings.timezone`
 * (NOT NULL, DEFAULT 'America/Toronto') — cette constante ne sert que si la
 * ligne de réglages de l'org n'existe pas encore. Ne pas l'utiliser
 * directement pour formater : voir `fuseau` plus bas.
 */
const FUSEAU_CLIENT = 'America/Toronto';

/**
 * Plafond anti-spam : nombre max de messages COMMERCIAUX d'automatisation
 * qu'un même destinataire peut recevoir par 24 h, tous canaux/règles
 * confondus. Réglable via env, défaut prudent.
 */
const PLAFOND_MSG_COMMERCIAUX_24H = (() => {
  const v = Number(process.env.AUTOMATION_MAX_COMMERCIAL_PER_DAY);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 3;
})();

/**
 * A-t-on atteint le plafond de messages commerciaux pour ce destinataire dans
 * les dernières 24 h ? On compte les envois d'AUTOMATISATION uniquement (SMS :
 * messages sortants sans sender_user_id ; courriel : activity_log
 * event_type='email_sent'), jamais les envois manuels du propriétaire.
 */
async function depassePlafondFrequence(
  ctx: ActionContext,
  canal: 'sms' | 'email',
  destinataire: string,
): Promise<boolean> {
  if (!ctx.commercial) return false; // transactionnel : jamais plafonné
  const depuis = new Date(Date.now() - 24 * 3600_000).toISOString();
  try {
    if (canal === 'sms') {
      const { count } = await ctx.supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', ctx.orgId)
        .eq('phone_number', normalizeE164(destinataire))
        .eq('direction', 'outbound')
        .is('sender_user_id', null)
        .gte('created_at', depuis);
      return (count ?? 0) >= PLAFOND_MSG_COMMERCIAUX_24H;
    }
    const { count } = await ctx.supabase
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', ctx.orgId)
      .eq('event_type', 'email_sent')
      // Le destinataire est dans metadata.to (voir l'insert plus bas) :
      // `activity_log` n'a pas de colonne `description` — la requête échouait
      // et le plafond courriel ne s'appliquait jamais (check:schema-refs).
      .eq('metadata->>to', destinataire)
      .gte('created_at', depuis);
    return (count ?? 0) >= PLAFOND_MSG_COMMERCIAUX_24H;
  } catch (e: any) {
    // En cas de doute, on NE bloque PAS : mieux vaut un message de trop qu'une
    // relance légitime avalée par une erreur transitoire.
    console.error(`[actions] plafond fréquence indéterminable (${canal}, org ${ctx.orgId}):`, e?.message || e);
    return false;
  }
}

/**
 * Consentement pour un message COMMERCIAL (F7 de l'audit automatisations).
 * ─────────────────────────────────────────────────────────────────────
 * Au Canada, un message électronique commercial exige le consentement du
 * destinataire (LCAP ; loi 25 au Québec pour les renseignements personnels).
 * Un message TRANSACTIONNEL — confirmation de rendez-vous, reçu, rappel de
 * visite attendue — n'est pas visé : il répond à une demande du client.
 *
 * Le moteur distinguait déjà les deux (`ctx.commercial`, posé par le worker
 * des tâches différées) et plafonnait la fréquence des commerciaux, mais ne
 * vérifiait JAMAIS le consentement lui-même. Les presets `cross_sell_30d`,
 * `seasonal_reminder_6m` et `lost_lead_reengagement` partaient donc à tout le
 * monde, avec `"conditions": {}`.
 *
 * Les colonnes existaient déjà sur `clients` (`email_consent_at`,
 * `sms_consent_at`, `email_opt_out_at`) mais n'étaient lues nulle part :
 * aucune migration n'est nécessaire, seulement s'en servir.
 *
 * ── Élargi le 2026-09-23 : le TACITE compte aussi ──
 * La première version n'acceptait que le consentement EXPRÈS. Or la LCAP en
 * reconnaît deux, et le tacite découle de la relation elle-même : 2 ans après
 * un contrat ou une facture, 6 mois après une demande de prix. Mesuré en
 * production : sur 30 clients joignables, 19 avaient une relation d'affaires
 * de moins de 2 ans — donc le droit d'être contactés — et tous étaient
 * bloqués. Le verrou était juste, mais plus strict que la loi, et comme
 * aucun écran ne permettait de saisir un exprès, la fonctionnalité était
 * inutilisable.
 *
 * Règle appliquée, dans cet ordre :
 *  - un retrait explicite (`email_opt_out_at`) bloque, même transactionnel
 *    pour le courriel — c'est le sens d'un désabonnement, et aucune base
 *    légale ne survit à un retrait ;
 *  - un transactionnel passe sans consentement (il est attendu) ;
 *  - un commercial exige une base : exprès (`*_consent_at`) ou tacite
 *    (calculé depuis les jobs, factures et devis du client) ;
 *  - sans base, on bloque.
 *
 * Le verdict PORTE la base retenue : le CRTC met la charge de la preuve sur
 * l'expéditeur, donc savoir qu'on avait le droit ne suffit pas — il faut
 * pouvoir dire pourquoi. L'appelant la journalise dans `consents`.
 *
 * En cas d'erreur, on BLOQUE — à l'inverse du plafond de fréquence. Un
 * message de trop est un désagrément ; un envoi sans consentement est une
 * infraction. Le doute doit coûter un message perdu, pas une plainte.
 */
export type VerdictConsentement =
  | { autorise: true; base?: BaseLegale; clientId?: string }
  | { autorise: false; motif: string; desabonne?: boolean };

/**
 * Les dates qui peuvent fonder un tacite, pour un client donné.
 *
 * Trois requêtes courtes, faites SEULEMENT si aucun exprès n'a été trouvé :
 * le cas fréquent (exprès présent, ou destinataire inconnu) ne les paie pas.
 */
async function ancragesDuClient(ctx: ActionContext, clientId: string): Promise<AncragesTacite> {
  const recent = async (table: 'jobs' | 'invoices' | 'quotes') => {
    const { data, error } = await ctx.supabase
      .from(table)
      .select('id, created_at')
      .eq('org_id', ctx.orgId)
      .eq('client_id', clientId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    // Une erreur ici doit remonter : la traiter comme « pas d'ancrage »
    // transformerait une panne en refus silencieux, et l'appelant ne saurait
    // pas distinguer « pas de droit » de « on n'a pas pu vérifier ».
    if (error) throw new Error(`${table}: ${error.message}`);
    return data ? { id: String(data.id), date: String(data.created_at) } : null;
  };
  const [dernierJob, derniereFacture, dernierDevis] = await Promise.all([
    recent('jobs'), recent('invoices'), recent('quotes'),
  ]);
  return { dernierJob, derniereFacture, dernierDevis };
}

async function consentementCommercial(
  ctx: ActionContext,
  canal: 'sms' | 'email',
  destinataire: string,
): Promise<VerdictConsentement> {
  // Le client n'est identifiable que par son adresse/numéro : sans
  // destinataire, l'appelant a déjà échoué avant nous.
  if (!destinataire) return { autorise: true };

  /**
   * Un SMS TRANSACTIONNEL n'a rien à vérifier ici : le consentement ne
   * concerne que le commercial, et le retrait (STOP) est déjà contrôlé par
   * `sms_opt_outs` avant cet appel. On lisait pourtant `clients` à chaque
   * confirmation de rendez-vous pour finir par un `{ autorise: true }` —
   * une requête par envoi, pour rien.
   *
   * Le courriel transactionnel, lui, continue de passer par la lecture :
   * `email_opt_out_at` bloque TOUT courriel, y compris transactionnel, et
   * c'est cette colonne qu'il faut aller chercher.
   */
  if (!ctx.commercial && canal === 'sms') return { autorise: true };

  try {
    type Fiche = { id: string; email_consent_at: string | null; sms_consent_at: string | null; email_opt_out_at: string | null; phone?: string | null };
    let data: Fiche | null = null;
    if (canal === 'email') {
      const res = await ctx.supabase
        .from('clients')
        .select('id, email_consent_at, sms_consent_at, email_opt_out_at')
        .eq('org_id', ctx.orgId)
        .eq('email', destinataire.trim().toLowerCase())
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();
      if (res.error) throw new Error(res.error.message);
      data = (res.data as Fiche | null) ?? null;
    } else {
      // Le numéro est stocké tel que saisi ou importé (« (819) 479-0116 »,
      // « 819-479-0116 », « +18194790116 ») : une égalité stricte sur la forme
      // E.164 ne retrouvait pas un tiers des clients importés de Jobber, et tout
      // SMS commercial vers eux échouait en « destinataire inconnu du carnet »
      // (Vision Lavage, 2026-09-25). On préfiltre sur les 4 derniers chiffres,
      // puis on compare chiffres seuls des deux côtés.
      const chiffres = normalizeE164(destinataire).replace(/\D/g, '').slice(-10);
      const res = await ctx.supabase
        .from('clients')
        .select('id, phone, email_consent_at, sms_consent_at, email_opt_out_at')
        .eq('org_id', ctx.orgId)
        .ilike('phone', `%${chiffres.slice(-4)}`)
        .is('deleted_at', null)
        .limit(50);
      if (res.error) throw new Error(res.error.message);
      data = ((res.data ?? []) as Fiche[]).find((c) => String(c.phone ?? '').replace(/\D/g, '').slice(-10) === chiffres) ?? null;
    }

    // Destinataire hors du carnet de clients (prospect saisi à la main,
    // adresse d'essai) : pas de commercial vers quelqu'un qu'on ne connaît pas.
    if (!data) {
      return ctx.commercial
        ? { autorise: false, motif: 'destinataire inconnu du carnet de clients — pas de consentement vérifiable' }
        : { autorise: true };
    }

    // Un désabonnement vaut pour tout courriel, y compris transactionnel —
    // sauf avec le désabonnement par canal, où il ne coupe que le marketing.
    if (canal === 'email' && data.email_opt_out_at && !(ctx.parCanal && !ctx.commercial)) {
      return { autorise: false, motif: 'le client s\'est désabonné des courriels', desabonne: true };
    }
    if (!ctx.commercial) return { autorise: true };

    const clientId = String(data.id);
    const consenti = canal === 'email' ? data.email_consent_at : data.sms_consent_at;
    // L'exprès d'abord : il ne coûte aucune requête et prime sur le tacite.
    if (consenti) {
      const base = baseLegalePour(consenti, {});
      if (base) return { autorise: true, base, clientId };
    }

    // Pas d'exprès : la relation elle-même peut suffire.
    const base = baseLegalePour(null, await ancragesDuClient(ctx, clientId));
    if (base) return { autorise: true, base, clientId };

    return {
      autorise: false,
      motif: `aucune base légale ${canal === 'email' ? 'courriel' : 'SMS'} : ni consentement enregistré, ni relation d'affaires de moins de 2 ans, ni demande de moins de 6 mois`,
    };
  } catch (e: any) {
    console.error(`[actions] consentement indéterminable (${canal}, org ${ctx.orgId}):`, e?.message || e);
    // Doute = on ne part pas. Voir l'en-tête : l'inverse du plafond de fréquence.
    return ctx.commercial
      ? { autorise: false, motif: 'consentement invérifiable (erreur technique) — envoi commercial suspendu' }
      : { autorise: true };
  }
}

/**
 * Consigne la base légale dans `consents` — le registre probant.
 *
 * Ne lève jamais et ne bloque jamais l'envoi : le message est déjà autorisé,
 * et perdre une ligne de journal ne doit pas coûter une communication
 * légitime. Un échec est journalisé pour être vu.
 */
async function journaliserBaseLegale(
  ctx: ActionContext,
  canal: 'sms' | 'email',
  clientId: string | null,
  base: BaseLegale | undefined,
): Promise<void> {
  if (!base || !clientId) return;
  try {
    const { error } = await ctx.supabase.rpc('record_consent', {
      p_subject_type: 'client',
      p_subject_id: clientId,
      p_purpose: canal === 'email' ? 'email-marketing' : 'sms-marketing',
      p_granted: true,
      p_method: methodePourJournal(base),
      p_doc_version: base.type === 'tacite' ? base.reference : null,
      p_org_id: ctx.orgId,
    });
    if (error) throw new Error(error.message);
  } catch (e: any) {
    console.error(`[actions] journal de consentement non écrit (${canal}, org ${ctx.orgId}):`, e?.message || e);
  }
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
  | 'move_deal_stage'
  | 'request_review'
  | 'log_activity'
  | 'update_custom_field'
  // Les actions ajoutees le 2026-09-24, transposees de GoHighLevel.
  | 'envoyer_slack'
  | 'ajouter_etiquette'
  | 'retirer_etiquette'
  | 'modifier_client'
  | 'assigner_responsable'
  | 'ajouter_note'
  | 'modifier_statut_rendezvous'
  | 'modifier_deal'
  | 'assigner_deal'
  | 'envoyer_facture'
  | 'envoyer_soumission'
  | 'webhook'
  | 'arreter_automatisation'
  | 'demarrer_automatisation';

// ── Template variable resolution ─────────────────────────────

export function resolveTemplate(
  template: string,
  vars: Record<string, string | null | undefined>,
): string {
  // Support both {var} and [var] syntax for backward compatibility, normalize to {var}
  // Champs personnalisés : {{client.cle}} (format GoHighLevel) = {client_cf_cle}.
  // UNE seule passe : une valeur insérée n'est jamais relue. En trois passes, un
  // client « [QA] Équipe » ou une note « voir [annexe] » perdait son texte entre
  // crochets, pris pour une ancienne variable [annexe] (constaté le 2026-09-28).
  return template.replace(
    /\{\{\s*([a-z]+)\.([a-z][a-z0-9_]*)\s*\}\}|\{(\w+)\}|\[(\w+)\]/g,
    (_, objet: string | undefined, cle: string | undefined, accolade: string | undefined, crochet: string | undefined) => {
      // Variables intégrées pointées ({{client.nom}}, {{soumission.total}}…)
      // AVANT les champs personnalisés : un champ perso nommé « nom » ne doit
      // pas masquer le nom du client.
      if (objet) return vars[`${objet}.${cle}`] ?? vars[`${objet}_cf_${cle}`] ?? '';
      return vars[(accolade ?? crochet) as string] ?? '';
    },
  );
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
  orgId: string,
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
    .eq('org_id', orgId)
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
  orgId: string,
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
    .eq('org_id', orgId)
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
    .eq('org_id', orgId)
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
    .select('company_name, phone, google_review_url, facebook_review_url, default_language, timezone')
    .eq('org_id', orgId)
    .maybeSingle();

  /**
   * Les montants suivent la LANGUE DE L'ENTREPRISE, pas une locale figée.
   * `en-CA` rend « $1,626.90 » et `fr-CA` « 1 626,90 $ » : pour une entreprise
   * québécoise, la première forme est un montant américain dans un courriel
   * français. Les rappels de facture l'aggravaient en concaténant à la main
   * (`$${(cents/100).toFixed(2)}` → « $1626.90 », sans même le séparateur de
   * milliers) — visible par le client, sur cinq presets.
   */
  const locale = (company?.default_language === 'en' ? 'en-CA' : 'fr-CA');
  const argent = (cents: number | null | undefined, devise = 'CAD') =>
    new Intl.NumberFormat(locale, { style: 'currency', currency: devise || 'CAD' })
      .format(Number(cents ?? 0) / 100);

  if (company) {
    vars.company_name = company.company_name || '';
    vars.company_phone = company.phone || '';
    vars.google_review_url = company.google_review_url || '';
    vars.facebook_review_url = company.facebook_review_url || '';
    // Première plateforme configurée (Google d'abord) : utilisable dans les SMS
    // de rappel quel que soit le réseau choisi par l'entreprise.
    vars.review_page_url = reviewDestinations(company)[0]?.url || '';
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

  // Un deal du pipeline de ventes. Sans ce bloc, une automatisation d'étape
  // enverrait « Bonjour  » : le moteur ne saurait pas remonter au client.
  if (entityType === 'deal') {
    const { data: deal } = await supabase
      .from('deals')
      .select(`
        id, source, stage_entered_at, created_at,
        client:clients!deals_client_same_org(first_name, last_name, email, phone, company),
        etape:pipeline_stages!deals_stage_same_org(name_fr, name_en, kind)
      `)
      .eq('id', entityId)
      .maybeSingle() as any;
    if (deal) {
      if (deal.client) setClientVars(deal.client);
      vars.deal_stage = deal.etape?.name_fr || '';
      vars.deal_stage_en = deal.etape?.name_en || '';
      vars.deal_source = deal.source || '';
      // Depuis combien de jours le deal dort dans son étape : c'est la
      // variable d'une relance (« ça fait 5 jours… »).
      if (deal.stage_entered_at) {
        const jours = Math.floor(
          (Date.now() - new Date(deal.stage_entered_at).getTime()) / 86_400_000,
        );
        vars.deal_jours_dans_etape = String(Math.max(0, jours));
      }
    }
  }

  if (entityType === 'lead') {
    const { data: lead } = await supabase
      .from('clients')
      .select('first_name, last_name, email, phone, company, title, client_id:id')
      .eq('id', entityId)
      .eq('org_id', orgId)
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
      .eq('org_id', orgId)
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
      .select('quote_number, total_cents, currency, valid_until, client_id, lead_id, job_id, view_token, view_count, viewed_at')
      .eq('id', entityId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (quote) {
      vars.quote_number = quote.quote_number || '';
      vars.quote_total = argent(quote.total_cents, quote.currency || 'CAD');
      vars.quote_valid_until = quote.valid_until || '';
      // Le lien public de la soumission — la page `/quote/:token` que le
      // client ouvre sans compte (`TokenRoutes`). Sans lui, une action
      // « envoyer la soumission » n'aurait rien a mettre dans le courriel.
      if (quote.view_token) {
        vars.quote_link = `${resolvePublicBaseUrl()}/quote/${quote.view_token}`;
      }

      // `quotes` porte DEUX liens vers `clients` : `client_id` (client
      // converti) et `lead_id` (prospect). Même repli que la route d'envoi de
      // soumission, sinon un devis encore au stade prospect ne résout rien.
      const contactId = quote.client_id || quote.lead_id;
      if (contactId) {
        const { data: c } = await supabase
          .from('clients')
          .select('first_name, last_name, email, phone, company')
          .eq('id', contactId)
          .eq('org_id', orgId)
          .maybeSingle();
        if (c) {
          setClientVars(c);
        }
      }
      if (quote.job_id) {
        const { data: j } = await supabase.from('jobs').select('title').eq('id', quote.job_id).eq('org_id', orgId).maybeSingle();
        if (j) vars.job_name = j.title || '';
      }

      // Variables « à la GoHighLevel » du déclencheur « Soumission ouverte
      // par le client » (mission 2026-09-28) — utilisables partout.
      vars['soumission.numero'] = vars.quote_number;
      vars['soumission.total'] = vars.quote_total;
      vars['soumission.lien'] = vars.quote_link ?? '';
      // Lien INTERNE (la fiche dans l'app) : c'est lui qu'ouvre le bouton
      // d'une notification à l'équipe, pas la page publique du client.
      vars['soumission.lien_interne'] = `/quotes/${entityId}`;
      vars['soumission.nb_vues'] = String(quote.view_count ?? 0);
      vars['soumission.ouverte_le'] = quote.viewed_at
        ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium', timeStyle: 'short', timeZone: company?.timezone || 'America/Montreal',
        }).format(new Date(quote.viewed_at))
        : '';
    }
  }

  if (entityType === 'job') {
    const { data: job } = await supabase
      .from('jobs')
      .select('title, client_id')
      .eq('id', entityId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (job) {
      vars.job_name = job.title || '';
      if (job.client_id) {
        const { data: c } = await supabase.from('clients').select('first_name, last_name, email, phone, company').eq('id', job.client_id).eq('org_id', orgId).maybeSingle();
        if (c) {
          setClientVars(c);
        }
      }
      Object.assign(vars, await resolveContractVars(supabase, entityId, orgId));
      Object.assign(vars, await resolveSignedContractVars(supabase, entityId, orgId));
    }
  }

  if (entityType === 'invoice') {
    const { data: inv } = await supabase
      .from('invoices')
      .select('invoice_number, due_date, total_cents, client_id, job_id, public_token, view_token, view_count, viewed_at, last_viewed_at')
      .eq('id', entityId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (inv) {
      // Variables du déclencheur « Facture consultée par le client », même
      // forme que celles de la soumission. `facture.lien` part du jeton que la
      // page publique lit VRAIMENT (`view_token`) ; `[invoice_link]`, lui,
      // lit `public_token` (toujours vide) — laissé tel quel pour ne rien
      // changer aux règles existantes, voir le rapport de phase 0 (bug 3).
      // « Paiement échoué » : le dernier échec de cette facture (hors litige),
      // la raison en mots de client, et le lien pour payer. Drapeau seulement,
      // pour la même raison que plus bas (charge du webhook).
      if (await drapeauActif(supabase, orgId, DRAPEAUX_AUTOMATISATIONS.paiementEchoue)) {
        const [{ data: echec }, { data: demande }] = await Promise.all([
          supabase.from('payments')
            .select('amount_cents, failure_reason')
            .eq('org_id', orgId).eq('invoice_id', entityId).eq('status', 'failed')
            .is('deleted_at', null)
            .order('created_at', { ascending: false }).limit(5),
          supabase.from('payment_requests')
            .select('public_token')
            .eq('org_id', orgId).eq('invoice_id', entityId).in('status', ['pending', 'sent'])
            .is('deleted_at', null)
            .order('created_at', { ascending: false }).limit(1).maybeSingle(),
        ]);
        const dernier = ((echec ?? []) as Array<{ amount_cents: number | null; failure_reason: string | null }>)
          .find((p) => !String(p.failure_reason ?? '').startsWith('dispute'));
        vars['paiement.montant'] = dernier ? argent(dernier.amount_cents ?? 0) : '';
        vars['paiement.raison'] = dernier ? raisonLisible(dernier.failure_reason, locale === 'en-CA' ? 'en' : 'fr') : '';
        vars['paiement.facture'] = inv.invoice_number || '';
        const jetonPaiement = (demande as { public_token?: string } | null)?.public_token;
        vars['paiement.lien'] = jetonPaiement
          ? `${resolvePublicBaseUrl()}/pay/${jetonPaiement}`
          : (inv.view_token ? `${resolvePublicBaseUrl()}/invoice/${inv.view_token}` : '');
      }
      // Drapeau seulement : l'action « webhook » envoie TOUTES les variables,
      // en ajouter changerait sa charge utile chez les entreprises sans drapeau.
      if (await drapeauActif(supabase, orgId, DRAPEAUX_AUTOMATISATIONS.consultationDocuments)) {
        vars['facture.numero'] = inv.invoice_number || '';
        vars['facture.total'] = argent(inv.total_cents);
        vars['facture.lien'] = inv.view_token ? `${resolvePublicBaseUrl()}/invoice/${inv.view_token}` : '';
        vars['facture.lien_interne'] = `/invoices/${entityId}`;
        vars['facture.nb_vues'] = String(inv.view_count ?? 0);
        vars['facture.consultee_le'] = inv.viewed_at
          ? new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium', timeStyle: 'short', timeZone: company?.timezone || 'America/Montreal',
          }).format(new Date(inv.viewed_at))
          : '';
      }
      vars.invoice_number = inv.invoice_number || '';
      vars.invoice_due_date = inv.due_date || '';
      vars.invoice_total = argent(inv.total_cents);
      // `invoices` utilise `public_token` la ou `quotes` utilise
      // `view_token` — deux noms pour la meme idee, verifie dans le schema
      // de production. La page servie est `/invoice/:token`.
      if (inv.public_token) {
        vars.invoice_link = `${resolvePublicBaseUrl()}/invoice/${inv.public_token}`;
      }
      if (inv.client_id) {
        const { data: c } = await supabase.from('clients').select('first_name, last_name, email, phone, company').eq('id', inv.client_id).eq('org_id', orgId).maybeSingle();
        if (c) {
          setClientVars(c);
        }
      }
      if (inv.job_id) {
        const { data: j } = await supabase.from('jobs').select('title').eq('id', inv.job_id).eq('org_id', orgId).maybeSingle();
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
      .eq('org_id', orgId)
      .maybeSingle() as any;
    if (evt) {
      const startField = evt.start_at || evt.start_time;
      if (startField) {
        const d = new Date(startField);
        /**
         * Le fuseau est OBLIGATOIRE ici. Sans lui, `toLocale*` prend celui du
         * SERVEUR — et Railway tourne en UTC, sans `TZ` défini.
         *
         * Mesuré : un rendez-vous de 9 h à Montréal était annoncé au client
         * « 13 h 00 », et un rendez-vous de 22 h le 13 septembre était annoncé
         * « le 14 ». Toutes les confirmations et tous les rappels portaient
         * donc la mauvaise heure, et parfois le mauvais jour — invisible en
         * développement (machine à l'heure locale), systématique en production.
         */
        /*
         * Le fuseau de l'ENTREPRISE, pas un fuseau figé. `company_settings.
         * timezone` est NOT NULL avec DEFAULT 'America/Toronto' : une org qui
         * n'y a jamais touché garde donc exactement le comportement d'avant,
         * et une org ailleurs qu'à l'Est cesse d'annoncer la mauvaise heure.
         * Le repli ne sert que si la ligne de réglages n'existe pas encore.
         */
        const fuseau = (company?.timezone as string | undefined) || FUSEAU_CLIENT;
        vars.appointment_date = d.toLocaleDateString('fr-CA', { timeZone: fuseau });
        vars.appointment_time = d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', timeZone: fuseau });
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
      if (evt.job_id) Object.assign(vars, await resolveContractVars(supabase, evt.job_id, orgId));
    }
  }

  /**
   * Champs personnalisés : {client_cf_<clé>}, {deal_cf_<clé>}, {job_cf_<clé>},
   * {quote_cf_<clé>}, {invoice_cf_<clé>} — formatés (montant, date) dans la
   * langue de l'entreprise. On relit les liens de l'entité (client, job,
   * devis) pour qu'une automatisation sur une facture puisse citer un champ
   * du client. Un échec ici n'empêche jamais le message de partir : les
   * variables manquantes deviennent vides, comme toute variable inconnue.
   */
  try {
    const refs: Partial<Record<'client' | 'deal' | 'job' | 'quote' | 'invoice', string | null>> = {};
    if (entityType === 'client' || entityType === 'lead') refs.client = entityId;
    const liens: Record<string, { table: string; colonnes: string; objet: 'deal' | 'job' | 'quote' | 'invoice' }> = {
      deal: { table: 'deals', colonnes: 'client_id, job_id, quote_id', objet: 'deal' },
      job: { table: 'jobs', colonnes: 'client_id', objet: 'job' },
      quote: { table: 'quotes', colonnes: 'client_id, lead_id, job_id', objet: 'quote' },
      invoice: { table: 'invoices', colonnes: 'client_id, job_id', objet: 'invoice' },
    };
    const lien = liens[entityType];
    if (lien) {
      refs[lien.objet] = entityId;
      const { data: l } = await supabase.from(lien.table).select(lien.colonnes).eq('id', entityId).eq('org_id', orgId).maybeSingle();
      const r = (l ?? {}) as unknown as Record<string, string | null>;
      refs.client = r.client_id ?? r.lead_id ?? null;
      if (r.job_id) refs.job = r.job_id;
      if (r.quote_id) refs.quote = r.quote_id;
    }
    // {{deal.cle}} depuis un devis, une job ou un client : le deal LIÉ.
    if (!refs.deal) refs.deal = await dealLie(supabase, orgId, entityType, entityId, refs.client ?? null);
    Object.assign(vars, await variablesChamps(supabase, orgId, refs, company?.default_language === 'en' ? 'en' : 'fr'));
  } catch (err) {
    console.error('[resolveEntityVariables] champs personnalisés illisibles :', err instanceof Error ? err.message : err);
  }
  if (vars.client_name && vars['client.nom'] === undefined) vars['client.nom'] = vars.client_name;

  return vars;
}

/**
 * Le deal LIÉ à l'entité d'un événement, pour que {{deal.cle}} (et les
 * variables système du deal) marchent aussi depuis un devis, une job ou un
 * client — pas seulement depuis une automatisation qui part du deal.
 *
 *   · devis : le deal qui le porte (`deals.quote_id`, quel que soit son
 *     stade), sinon le deal OUVERT le plus récent de son client — même règle
 *     que `dealDeLaSoumission` ;
 *   · job : le deal qui la porte (`deals.job_id`) ;
 *   · client : son deal OUVERT le plus récent.
 *
 * UNE requête, toujours bornée à l'org (client service_role : pas de RLS).
 * `null` = aucun deal, jamais une erreur : les variables restent vides.
 */
export async function dealLie(
  supabase: SupabaseClient, orgId: string, entityType: string, entityId: string, clientId: string | null,
): Promise<string | null> {
  const estUuid = (x: string | null): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x);
  let filtre: string;
  if (entityType === 'quote' && estUuid(entityId)) {
    filtre = estUuid(clientId) ? `quote_id.eq.${entityId},client_id.eq.${clientId}` : `quote_id.eq.${entityId}`;
  } else if (entityType === 'job' && estUuid(entityId)) {
    filtre = `job_id.eq.${entityId}`;
  } else if ((entityType === 'client' || entityType === 'lead') && estUuid(entityId)) {
    filtre = `client_id.eq.${entityId}`;
  } else {
    return null;
  }
  let data: unknown[] | null = null;
  try {
    const r = await supabase
      .from('deals')
      .select('id, quote_id, job_id, pipeline_stages!deals_stage_same_org(kind)')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .or(filtre)
      .order('created_at', { ascending: false })
      .limit(20);
    if (r.error) throw new Error(r.error.message);
    data = r.data;
  } catch (err) {
    // Jamais au point de priver le message des AUTRES variables de champs.
    console.error('[dealLie] deal lié illisible :', err instanceof Error ? err.message : err);
    return null;
  }
  type Ligne = { id: string; quote_id: string | null; job_id: string | null; pipeline_stages: { kind?: string } | Array<{ kind?: string }> | null };
  const lignes = (data ?? []) as unknown as Ligne[];
  const ouvert = (l: Ligne) => (Array.isArray(l.pipeline_stages) ? l.pipeline_stages[0]?.kind : l.pipeline_stages?.kind) === 'open';
  if (entityType === 'quote') {
    return lignes.find((l) => l.quote_id === entityId)?.id ?? lignes.find(ouvert)?.id ?? null;
  }
  if (entityType === 'job') return lignes.find((l) => l.job_id === entityId)?.id ?? null;
  return lignes.find(ouvert)?.id ?? null;
}

// ── Action: Send Email ──────────────────────────────────────

export async function executeSendEmail(
  config: {
    to?: string; subject: string; body: string;
    from_name?: string; reply_to?: string; preheader?: string;
  },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  // Le destinataire vient TOUJOURS de l'entité, jamais de la règle.
  // Voir `DESTINATAIRE_IMPOSE` plus haut : `config.to` permettait d'envoyer les
  // données d'un client (nom, montants, adresse) vers une adresse arbitraire.
  const to = vars.client_email;
  if (!to) return { success: false, error: 'No recipient email' };

  vars = await avecLienReservation(ctx, vars, champLocalise(config, 'subject', ctx.langue), champLocalise(config, 'body', ctx.langue));
  const subject = resolveTemplate(champLocalise(config, 'subject', ctx.langue), vars);
  const body = resolveTemplate(champLocalise(config, 'body', ctx.langue), vars);

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
      // Désabonnement par canal : le marketing est sauté (le parcours
      // continue), le transactionnel part quand même.
      if (ctx.parCanal) {
        if (ctx.commercial) return saute(motifSaut('courriel'));
      } else {
        return { success: false, error: `Recipient ${to} has unsubscribed from marketing emails` };
      }
    }

    // Consentement (F7) : le retrait ci-dessus traite ceux qui se sont
    // désabonnés ; ici on vérifie qu'une base légale existe — un consentement
    // exprès, ou la relation d'affaires elle-même (LCAP).
    const consentement = await consentementCommercial(ctx, 'email', to);
    if (!consentement.autorise) {
      if (ctx.parCanal && consentement.desabonne) return saute(motifSaut('courriel'));
      return { success: false, error: `Consentement manquant pour ${to} : ${consentement.motif}` };
    }
    // La preuve, pas seulement l'autorisation : le CRTC demande à l'expéditeur
    // de démontrer POURQUOI il avait le droit. N'échoue jamais l'envoi.
    if (ctx.commercial) void journaliserBaseLegale(ctx, 'email', consentement.clientId ?? null, consentement.base);

    // Plafond anti-spam, tous canaux confondus par destinataire.
    if (await depassePlafondFrequence(ctx, 'email', to)) {
      return { success: false, error: `Frequency cap reached for ${to} (max ${PLAFOND_MSG_COMMERCIAUX_24H} commercial messages / 24h) — skipped to avoid spamming` };
    }

    const { getCompanySettings, buildEmailLayout, senderForOrg, langueEntreprise } = await import('../../routes/emails');
    const { boutonPourEntite } = await import('../courriels/bouton-automatisation');
    const company = await getCompanySettings(ctx.orgId);
    /* Le lien de désabonnement n'a de sens que sur un message COMMERCIAL.
       Il était posé sur tout, y compris l'accusé de réception d'un formulaire :
       quelqu'un qui vient de demander une soumission n'est sur aucune liste de
       diffusion, et s'il clique il cesse aussi de recevoir ses factures.
       `ctx.commercial` fait déjà cette distinction pour le plafond de
       fréquence et la base légale — le pied de page la suit. */
    const unsubUrl = ctx.commercial ? await getUnsubscribeUrl(ctx.supabase, ctx.orgId, to) : null;

    /* Le bouton vers la page publique de l'entité concernée.
       Les 26 relances automatiques partaient sans aucun bouton : toutes
       demandaient de « répondre à ce courriel ». Une relance de soumission
       sans bouton « Accepter » oblige le client à écrire un message au lieu de
       cliquer une fois, et la plupart n'écrivent jamais.
       `null` dès que le lien ne serait pas sûr (entité sans page publique,
       jeton absent) : le courriel part alors comme avant. */
    // La langue de l'ENTREPRISE, calculée une fois : elle habille le bouton
    // ET le pied de page. Les deux doivent parler la même langue — un
    // courriel anglais terminé par « Se désabonner » est un défaut visible.
    const langueRelance = langueEntreprise(company);

    const bouton = await boutonPourEntite(
      ctx.supabase,
      ctx.orgId,
      ctx.entityType,
      ctx.entityId,
      langueRelance,
    );

    // Lien visible en pied de page + en-têtes standards : Gmail et Outlook
    // affichent alors leur bouton natif « Se désabonner », ce qui améliore
    // aussi nettement la délivrabilité.
    const pied = unsubUrl
      ? `<p style="margin:24px 0 0;font-size:12px;color:#9ca3af;text-align:center;">
           <a href="${unsubUrl}" style="color:#9ca3af;text-decoration:underline;">${langueRelance === 'fr' ? 'Se désabonner de ces communications' : 'Unsubscribe from these emails'}</a>
         </p>`
      : '';

    /* Nom d'expediteur et « repondre a » choisis dans l'action.
       Seuls le NOM AFFICHE et le Reply-To sont surchargeables : l'adresse
       d'envoi reste celle, verifiee SPF/DKIM, que `senderFor` compose —
       la remplacer par une adresse quelconque ferait tomber le courriel
       en indesirable chez tout le monde. C'est aussi ce que fait GHL, dont
       le « From Email » selectionne un expediteur verifie, pas une adresse
       libre. */
    // `senderForOrg` : si l'entreprise a fait verifier SON domaine (PR #524),
    // le courriel part de sa propre adresse ; sinon celle, verifiee, de la
    // plateforme. Dans les deux cas on ne surcharge que le NOM affiche.
    const expediteur = { ...(await senderForOrg(ctx.orgId, company)) };
    const nomChoisi = resolveTemplate(champLocalise(config, 'from_name', ctx.langue), vars).trim();
    if (nomChoisi) {
      const adresse = expediteur.from.match(/<([^>]+)>/)?.[1] || expediteur.from;
      // Les chevrons et guillemets casseraient l'en-tete From.
      expediteur.from = `${nomChoisi.replace(/[<>"]/g, '')} <${adresse}>`;
    }
    const repondreA = resolveTemplate(config.reply_to || '', vars).trim();
    // Une adresse invalide ferait rejeter le message entier par le serveur
    // SMTP : on ignore la surcharge plutot que de perdre l'envoi.
    if (repondreA && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(repondreA)) {
      expediteur.replyTo = repondreA;
    }

    /* L'apercu (« Pre-Header ») : la ligne que la boite de reception affiche
       apres l'objet. Masquee dans le corps du message — c'est la technique
       standard, et la seule qui marche sans champ d'en-tete dedie. */
    const apercuTexte = resolveTemplate(champLocalise(config, 'preheader', ctx.langue), vars).trim();
    const apercu = apercuTexte
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${apercuTexte.replace(/[<>]/g, '')}</div>`
      : '';

    const result = await sendEmail({
      ...expediteur,
      to,
      subject,
      html: buildEmailLayout(company, apercu + body + pied, bouton),
      /* Sans `suivi`, la ligne `email_deliveries` part sans entity_type, et la
         fonction de suivi en base REFUSE alors d'enregistrer l'ouverture
         (`and d.entity_type is not null`, exclusion Loi 25 des courriels de
         compte). Les relances automatiques — rappels de rendez-vous, factures
         en retard, demandes d'avis — étaient donc les seuls courriels vraiment
         commerciaux de Lume, et les seuls dont on ignorait s'ils étaient lus.
         Les trois valeurs étaient déjà là, servant à `activity_log` juste en
         dessous. */
      suivi: { orgId: ctx.orgId, entityType: ctx.entityType, entityId: ctx.entityId },
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

  // Même règle que pour le courriel : le numéro vient de l'entité, pas de la
  // règle. Voir `DESTINATAIRE_IMPOSE`.
  const to = vars.client_phone;
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
    // Désabonnement par canal : seul le marketing est sauté. Un texto
    // transactionnel est tenté — si l'opérateur le bloque (STOP géré par
    // Twilio, erreur 21610), il est sauté plus bas avec le même motif.
    if (!ctx.parCanal) return { success: false, error: `Recipient ${optOutPhone} has opted out of SMS (STOP)` };
    if (ctx.commercial) return saute(motifSaut('texto'));
  }

  // Consentement (F7) : le STOP ci-dessus traite le retrait ; ici on vérifie
  // qu'une base légale existe — exprès, ou la relation d'affaires (LCAP).
  const consentementSms = await consentementCommercial(ctx, 'sms', to);
  if (!consentementSms.autorise) {
    return { success: false, error: `Consentement manquant pour ${optOutPhone} : ${consentementSms.motif}` };
  }
  // Même raison que pour le courriel : la base retenue doit être démontrable.
  if (ctx.commercial) void journaliserBaseLegale(ctx, 'sms', consentementSms.clientId ?? null, consentementSms.base);

  // Plafond anti-spam : pas plus de N messages commerciaux / client / 24h.
  if (await depassePlafondFrequence(ctx, 'sms', to)) {
    return { success: false, error: `Frequency cap reached for ${optOutPhone} (max ${PLAFOND_MSG_COMMERCIAUX_24H} commercial messages / 24h) — skipped to avoid spamming` };
  }

  vars = await avecLienReservation(ctx, vars, champLocalise(config, 'body', ctx.langue));
  const body = resolveTemplate(champLocalise(config, 'body', ctx.langue), vars);

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

  {
    const { destinataireGele, journaliserBlocage, MESSAGE_GEL } = await import('../migration/gel-communications');
    const { getServiceClient } = await import('../supabase');
    const orgGelee = await destinataireGele(getServiceClient(), { phone: to }, ctx.orgId);
    if (orgGelee) { journaliserBlocage('sms', orgGelee, to, 'automatisation'); return { success: false, error: MESSAGE_GEL }; }
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
    // 21610 : le destinataire a répondu STOP au numéro, et Twilio bloque
    // tout envoi vers lui. Ce n'est pas une panne à reprendre.
    if (ctx.parCanal && Number(err?.code) === 21610) return saute(`${motifSaut('texto')} — bloqué par l'opérateur`);
    return { success: false, error: err.message };
  }
}

// ── Action: Create Notification ─────────────────────────────

/**
 * « Pour qui » d'une notification d'automatisation.
 *
 * L'éditeur proposait ce choix (propriétaire / responsable / un membre) mais
 * le serveur l'IGNORAIT : chaque notification partait à toute l'entreprise,
 * sans push ciblé (constaté le 2026-09-28). Désormais :
 *   · membre       → ce membre (s'il est actif) ;
 *   · responsable  → le responsable de l'entité (soumission : vendeur, sinon
 *                    créateur ; deal : assigné ; client : responsable) ;
 *   · proprietaire → les propriétaires.
 * Personne de résolu → repli sur les propriétaires, jamais le vide.
 */
async function destinatairesNotification(
  config: { destinataire?: string; membre_id?: string },
  ctx: ActionContext,
): Promise<Map<string, 'fr' | 'en'>> {
  const { data: membres } = await ctx.supabase
    .from('memberships')
    .select('user_id, role, status, language')
    .eq('org_id', ctx.orgId);
  const actifs = ((membres ?? []) as Array<{ user_id: string; role: string | null; status: string | null; language: string | null }>)
    .filter((m) => m.user_id && (!m.status || m.status === 'active'));
  const langue = (m: { language: string | null }) => (m.language === 'en' ? 'en' : 'fr') as 'fr' | 'en';
  const pour = (ids: Array<string | null | undefined>) => {
    const out = new Map<string, 'fr' | 'en'>();
    for (const m of actifs) if (ids.includes(m.user_id)) out.set(m.user_id, langue(m));
    return out;
  };
  const proprietaires = () => {
    const out = new Map<string, 'fr' | 'en'>();
    for (const m of actifs) if (m.role === 'owner') out.set(m.user_id, langue(m));
    return out;
  };

  let choisis = new Map<string, 'fr' | 'en'>();
  if (config.destinataire === 'equipe_du_deal') {
    /*
     * « Le rep assigné + propriétaires et admins » (décidé par Rafba le
     * 2026-09-28) :
     *   · le rep assigné au DEAL lié (sinon le vendeur du devis, sinon son
     *     créateur) — seulement s'il a accès au pipeline ;
     *   · les propriétaires, toujours ;
     *   · les administrateurs, sauf ceux exclus de CE pipeline (Gérer les
     *     permissions) : prévenir quelqu'un d'un deal qu'il ne peut pas
     *     ouvrir ne sert à rien.
     * La visibilité passe par `peut_voir_pipeline`, la même règle que la
     * page Permissions et la RLS.
     */
    type DealLie = { pipeline_id: string; assigned_user_id: string | null };
    let deal: DealLie | null = null;
    let rep: string | null = null;
    if (ctx.entityType === 'deal') {
      const { data } = await ctx.supabase.from('deals').select('pipeline_id, assigned_user_id')
        .eq('id', ctx.entityId).eq('org_id', ctx.orgId).maybeSingle();
      deal = data as DealLie | null;
    } else if (ctx.entityType === 'quote') {
      const lie = await dealDeLaSoumission(ctx);
      if (lie) {
        const { data } = await ctx.supabase.from('deals').select('pipeline_id, assigned_user_id')
          .eq('id', lie.id).maybeSingle();
        deal = data as DealLie | null;
      }
      const { data: q } = await ctx.supabase.from('quotes').select('salesperson_id, created_by')
        .eq('id', ctx.entityId).eq('org_id', ctx.orgId).maybeSingle();
      rep = (q?.salesperson_id as string | null) ?? (q?.created_by as string | null) ?? null;
    }
    rep = deal?.assigned_user_id ?? rep;

    const voit = async (uid: string): Promise<boolean> => {
      if (!deal?.pipeline_id) return true; // aucun deal : rien à restreindre
      const { data, error } = await ctx.supabase.rpc('peut_voir_pipeline', { p_user: uid, p_pipeline: deal.pipeline_id });
      if (error) {
        console.error('[actions/notification] visibilité du pipeline illisible', error.message);
        return false;
      }
      return data === true;
    };
    for (const m of actifs) {
      if (m.role === 'owner') choisis.set(m.user_id, langue(m));
      else if ((m.role === 'admin' || m.user_id === rep) && await voit(m.user_id)) choisis.set(m.user_id, langue(m));
    }
  } else if (config.destinataire === 'membre' && config.membre_id) {
    choisis = pour([config.membre_id]);
  } else if (config.destinataire === 'responsable') {
    let responsable: string | null = null;
    if (ctx.entityType === 'quote') {
      const { data } = await ctx.supabase.from('quotes').select('salesperson_id, created_by')
        .eq('id', ctx.entityId).eq('org_id', ctx.orgId).maybeSingle();
      responsable = (data?.salesperson_id as string | null) ?? (data?.created_by as string | null) ?? null;
    } else if (ctx.entityType === 'deal') {
      const { data } = await ctx.supabase.from('deals').select('assigned_user_id')
        .eq('id', ctx.entityId).eq('org_id', ctx.orgId).maybeSingle();
      responsable = (data?.assigned_user_id as string | null) ?? null;
    } else {
      const clientId = await clientDeLEntite(ctx);
      if (clientId) {
        const { data } = await ctx.supabase.from('clients').select('assigned_to')
          .eq('id', clientId).eq('org_id', ctx.orgId).maybeSingle();
        responsable = (data as { assigned_to?: string | null } | null)?.assigned_to ?? null;
      }
    }
    choisis = pour([responsable]);
  }
  return choisis.size > 0 ? choisis : proprietaires();
}

export async function executeCreateNotification(
  config: { title: string; body: string; reference_id?: string; destinataire?: string; membre_id?: string; lien?: string; par_courriel?: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const title = resolveTemplate(config.title, vars);
  const body = resolveTemplate(config.body ?? '', vars);
  const lien = config.lien ? resolveTemplate(config.lien, vars) : null;
  const entityId = config.reference_id || ctx.entityId;
  // « Aussi par courriel » : les mêmes personnes que la cloche, à leur adresse
  // de connexion. Le téléphone, lui, suit la notification (relais push web).
  const parCourriel = async (destinataires: Map<string, 'fr' | 'en'>): Promise<number> => {
    if (config.par_courriel !== 'true' || destinataires.size === 0) return 0;
    const { getServiceClient } = await import('../supabase');
    const { envoyerNotificationParCourriel } = await import('../notificationCourriel');
    return envoyerNotificationParCourriel(getServiceClient(), ctx.orgId, destinataires, { title, body, lien },
      { entityType: ctx.entityType, entityId });
  };

  // « Pour qui » laissé vide : comportement HISTORIQUE, inchangé — une
  // notification pour toute l'équipe. Les règles existantes sans
  // destinataire (« Nouveau prospect »…) continuent de prévenir les mêmes
  // personnes qu'avant.
  if (!config.destinataire) {
    const { error } = await ctx.supabase.from('notifications').insert({
      org_id: ctx.orgId,
      type: 'automation',
      title,
      body,
      reference_id: config.reference_id || ctx.entityId,
      link: lien,
    });
    if (error) return { success: false, error: error.message };
    let courriels = 0;
    if (config.par_courriel === 'true') {
      const { data: membres } = await ctx.supabase.from('memberships')
        .select('user_id, status, language').eq('org_id', ctx.orgId);
      const equipe = new Map<string, 'fr' | 'en'>();
      for (const m of (membres ?? []) as Array<{ user_id: string; status: string | null; language: string | null }>) {
        if (m.user_id && (!m.status || m.status === 'active')) equipe.set(m.user_id, m.language === 'en' ? 'en' : 'fr');
      }
      courriels = await parCourriel(equipe);
    }
    return { success: true, data: { title, destinataires: 'equipe', courriels } };
  }

  const destinataires = await destinatairesNotification(config, ctx);
  // Une ligne PAR destinataire : chacun son non-lu, la RLS ne montre la ligne
  // qu'à lui, et le déclencheur fn_push_on_notification pousse sur SES
  // appareils — c'est ce qui fait le push ciblé.
  await insertTargetedNotifications(
    ctx.supabase,
    ctx.orgId,
    destinataires,
    () => ({ title, body }),
    {
      type: 'automation',
      entityType: ctx.entityType,
      entityId,
      link: lien,
      icon: ctx.entityType === 'quote' ? 'eye' : null,
    },
  );
  const courriels = await parCourriel(destinataires);
  return { success: true, data: { title, destinataires: destinataires.size, courriels } };
}

// ── Action: Create Task ─────────────────────────────────────

export async function executeCreateTask(
  config: {
    title: string; description?: string; due_date?: string;
    // Le catalogue nomme le detail `body` (comme les autres actions) ;
    // `description` reste accepte pour les 35 prereglages deja enregistres.
    body?: string;
    priorite?: string; echeance_jours?: string; membre_id?: string;
  },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const title = resolveTemplate(config.title, vars);
  const brut = config.body ?? config.description ?? '';
  const description = brut ? resolveTemplate(brut, vars) : '';

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
        .eq('org_id', ctx.orgId)
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

  /* La priorite : `tasks_priority_check` n'admet que low/medium/high. Une
     autre valeur ferait echouer l'INSERT ENTIER — la tache ne serait pas
     creee du tout. On retombe donc sur le defaut plutot que de tout perdre. */
  const PRIORITES = new Set(['low', 'medium', 'high']);
  const priorite = PRIORITES.has(config.priorite || '') ? config.priorite : 'medium';

  /* L'echeance, en jours a partir d'aujourd'hui (le « Due In » de GHL).
     `tasks.due_date` est une DATE, pas un timestamp : on envoie AAAA-MM-JJ,
     sinon Postgres tronque et l'heure se perd en silence. */
  let echeance: string | null = config.due_date || null;
  const jours = Number(config.echeance_jours);
  if (Number.isFinite(jours) && jours >= 0 && config.echeance_jours) {
    const d = new Date(Date.now() + jours * 86400_000);
    echeance = d.toISOString().slice(0, 10);
  }

  /* Le responsable. Verifie contre `memberships` : assigner une tache a
     quelqu'un d'une autre organisation la ferait apparaitre dans sa liste. */
  let assignee: string | null = null;
  const membreId = (config.membre_id || '').trim();
  if (membreId) {
    const { data: membre } = await ctx.supabase
      .from('memberships')
      .select('user_id')
      .eq('org_id', ctx.orgId)
      .eq('user_id', membreId)
      .maybeSingle();
    if (!membre) return { success: false, error: "Ce membre n'appartient pas a l'organisation." };
    assignee = membreId;
  }

  // Column names verified against prod: linked_entity_* (not entity_*),
  // status enum uses 'open' (not 'pending').
  const { error } = await ctx.supabase.from('tasks').insert({
    org_id: ctx.orgId,
    title,
    description: description || null,
    status: 'open',
    priority: priorite,
    assignee_user_id: assignee,
    linked_entity_type: lienType,
    linked_entity_id: lienId,
    created_by: owner.user_id,
    due_date: echeance,
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
//
// Workflow « Avis clients » : envoyé DÈS que la job est terminée (règle
// google_review, délai 0). Le client reçoit le lien du sondage d'étoiles par
// courriel ET par SMS (selon ce qu'on a de lui). La suite (4-5 étoiles →
// Google/Facebook, 1-3 → commentaires internes) se joue sur /survey/:token.

export async function executeRequestReview(
  _config: Record<string, any>,
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  // 1. Réglages « Avis clients » : au moins une plateforme + interrupteur actif
  const { data: cs } = await ctx.supabase
    .from('company_settings')
    .select('review_enabled, google_review_url, facebook_review_url, review_sms_body, review_email_subject, review_email_body')
    .eq('org_id', ctx.orgId)
    .limit(1)
    .maybeSingle();
  if (cs && cs.review_enabled === false) {
    return { success: false, error: 'Review requests are disabled in Settings → Customer reviews.' };
  }
  if (reviewDestinations(cs).length === 0) {
    return { success: false, error: 'No Google or Facebook review link configured. Set one in Settings → Customer reviews.' };
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
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    clientId = job?.client_id || null;
  } else if (ctx.entityType === 'invoice') {
    const { data: inv } = await ctx.supabase
      .from('invoices')
      .select('client_id, job_id')
      .eq('id', ctx.entityId)
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    clientId = inv?.client_id || null;
    jobId = inv?.job_id || null;
  }

  // 3. Il faut au moins un canal
  if (!vars.client_email && !vars.client_phone) {
    return { success: false, error: 'Client has no email address or phone number.' };
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

  // 8. Textes : Réglages → Avis clients (company_settings.review_*), sinon
  // gabarit courriel « review_request » de l'org, sinon défauts de reviews.ts.
  const messageVars: Record<string, string> = {
    ...vars,
    client_first_name: clientGreeting,
    client_name: vars.client_name || clientGreeting,
    company_name: vars.company_name || 'notre équipe',
    job_name: vars.job_name || 'votre projet',
    survey_url: surveyUrl,
    review_link: surveyUrl,
  };

  let { subject, html: body } = reviewEmail(cs, messageVars);

  if (!String(cs?.review_email_body || '').trim()) {
    const { data: emailTemplate } = await ctx.supabase
      .from('email_templates')
      .select('subject, body')
      .eq('org_id', ctx.orgId)
      .eq('type', 'review_request')
      .eq('is_default', true)
      .eq('is_active', true)
      .maybeSingle();
    if (emailTemplate) {
      // Résolution via `resolveTemplate`, comme partout ailleurs : tous les
      // presets du produit utilisent [var], et un second résolveur maison ne
      // comprenait que {var}.
      subject = resolveTemplate(emailTemplate.subject, messageVars);
      body = resolveTemplate(emailTemplate.body, messageVars);
    }
  }

  // 9. Envoi : courriel si on a l'adresse, SMS si on a le numéro.
  const emailResult = vars.client_email
    ? await executeSendEmail({ subject, body }, vars, ctx)
    : { success: false, error: 'Client has no email address.' };

  const smsResult = vars.client_phone
    ? await executeSendSms({ body: reviewSmsBody(cs, messageVars) }, vars, ctx)
    : { success: false, error: 'Client has no phone number.' };

  // Avec le désabonnement par canal, un canal SAUTÉ n'est pas un envoi.
  const sent = ctx.parCanal
    ? estEnvoye(emailResult) || estEnvoye(smsResult)
    : emailResult.success || smsResult.success;
  const sautes = [emailResult, smsResult]
    .map((r) => (r.success && r.data && typeof r.data === 'object' ? (r.data as { saute?: string }).saute : undefined))
    .filter((m): m is string => !!m);

  // 10. Log review request for tracking — c'est aussi ce que lit l'anti-doublon
  // de l'étape 5 : si la ligne n'est pas écrite, la même demande peut repartir.
  const { error: trackError } = await ctx.supabase.from('review_requests').insert({
    org_id: ctx.orgId,
    client_id: clientId,
    job_id: jobId,
    survey_id: survey?.id || null,
    subject_sent: subject,
    status: sent ? 'sent' : 'failed',
    sent_at: sent ? new Date().toISOString() : null,
  });
  /**
   * DEMI-ÉTAT : le message est parti, mais sa trace n'a pas été écrite.
   *
   * `review_requests` est ce que lit l'anti-doublon de 7 jours (plus haut
   * dans cette fonction). Sans cette ligne, le prochain passage ne verra
   * aucun envoi récent et redemandera un avis au même client — qui l'a déjà
   * reçu. Rapporter « réussi » ferait fermer la tâche et perdrait
   * l'information.
   *
   * On rapporte donc l'échec : la reprise renverra peut-être un message de
   * trop, mais avec sa trace cette fois. Un doublon visible vaut mieux qu'un
   * doublon invisible qui se répétera à chaque exécution.
   */
  if (trackError) {
    console.error(`[actions/request_review] review_requests insert failed (org ${ctx.orgId}, client ${clientId || 'n/a'}):`, trackError.message);
    return {
      success: false,
      error: `Demande d'avis envoyée mais son suivi n'a pas été enregistré (${trackError.message}) — l'anti-doublon ne la verra pas`,
      data: { token, surveyUrl, emailSent: emailResult.success, smsSent: smsResult.success },
    };
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
      sms_sent: smsResult.success,
    },
  });
  if (activityError) {
    console.error(`[actions/request_review] activity_log insert failed (org ${ctx.orgId}, ${ctx.entityType} ${ctx.entityId}):`, activityError.message);
  }

  // Rien n'est parti parce que le client s'est désabonné de chaque canal
  // joignable : un saut, pas un échec — le parcours continue.
  if (!sent && ctx.parCanal && sautes.length > 0) {
    return saute(sautes.join(' · '));
  }

  // L'action ne vaut que par l'envoi : aucun canal parti = échec.
  if (!sent) {
    return {
      success: false,
      error: [emailResult.error, smsResult.error].filter(Boolean).join(' / ') || 'Review request could not be sent',
      data: { token, surveyUrl, emailSent: false, smsSent: false },
    };
  }

  return {
    success: true,
    data: { token, surveyUrl, emailSent: emailResult.success, smsSent: smsResult.success },
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


/**
 * Déplacer un deal vers une étape du pipeline.
 *
 * C'est l'action qui manquait pour qu'une automatisation agisse SUR le
 * pipeline, et pas seulement à partir de lui : « sans nouvelle depuis 14
 * jours → remettre en Relance », « devis accepté → passer en Gagné ».
 *
 * Trois garde-fous, tous nécessaires :
 *
 *  1. l'étape visée doit appartenir au MÊME pipeline que le deal. Sans cette
 *     vérification, une règle mal configurée expédierait le deal dans le
 *     pipeline d'à côté, où il disparaîtrait du tableau de son équipe ;
 *  2. une étape archivée est refusée : on n'envoie pas un deal dans une
 *     colonne que plus personne ne regarde ;
 *  3. déplacer vers l'étape où le deal se trouve DÉJÀ ne réécrit rien. Le
 *     trigger remettrait `stage_entered_at` à maintenant, ce qui effacerait
 *     l'ancienneté — et une règle « sans activité depuis 7 jours » qui se
 *     redéclenche remettrait éternellement le compteur à zéro.
 *
 * Le déplacement passe par un UPDATE ordinaire : les triggers de `deals`
 * s'occupent de l'horodatage, de l'historique et des événements. Une
 * automatisation produit donc exactement le même résultat qu'un
 * glisser-déposer à l'écran.
 */
/**
 * Le deal LIÉ à une soumission : celui qui la porte (`deals.quote_id`),
 * sinon le deal ouvert le plus récent de son client. `null` = aucun — pas
 * une erreur : une soumission faite hors pipeline n'a rien à déplacer.
 */
async function dealDeLaSoumission(ctx: ActionContext): Promise<{ id: string; pipeline_id: string; stage_id: string } | null> {
  const { data: direct } = await ctx.supabase
    .from('deals').select('id, pipeline_id, stage_id')
    .eq('org_id', ctx.orgId).eq('quote_id', ctx.entityId).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (direct) return direct as { id: string; pipeline_id: string; stage_id: string };

  const { data: q } = await ctx.supabase.from('quotes').select('client_id, lead_id')
    .eq('id', ctx.entityId).eq('org_id', ctx.orgId).maybeSingle();
  const client = (q?.client_id as string | null) ?? (q?.lead_id as string | null) ?? null;
  if (!client) return null;
  const { data: ouverts } = await ctx.supabase
    .from('deals').select('id, pipeline_id, stage_id, pipeline_stages!deals_stage_same_org!inner(kind)')
    .eq('org_id', ctx.orgId).eq('client_id', client).is('deleted_at', null)
    .eq('pipeline_stages.kind', 'open')
    .order('created_at', { ascending: false }).limit(1);
  const d = (ouverts ?? [])[0] as { id: string; pipeline_id: string; stage_id: string } | undefined;
  return d ?? null;
}

export async function executeMoveDealStage(
  config: { stage_id?: string; depuis_role?: string; vers_role?: string; cible?: string },
  _vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  // « Vers : l'étape Soumission ouverte » choisi dans l'éditeur.
  if (config?.cible === 'role') {
    config = { ...config, depuis_role: 'soumission_envoyee', vers_role: 'soumission_ouverte' };
  }
  // « Vers : l'étape Soumission envoyée » — depuis n'importe quelle étape
  // ouverte PLUS TÔT dans le pipeline (garde « jamais en arrière » plus bas).
  if (config?.cible === 'role_envoyee') {
    config = { ...config, depuis_role: undefined, vers_role: 'soumission_envoyee' };
  }
  if (ctx.entityType !== 'deal' && ctx.entityType !== 'quote') {
    return { success: false, error: `move_deal_stage s'applique à un deal ou à une soumission (reçu : ${ctx.entityType}).` };
  }
  if (!config?.stage_id && !config?.vers_role) {
    return { success: false, error: 'move_deal_stage : stage_id (ou vers_role) manquant.' };
  }

  let deal: { id: string; pipeline_id: string; stage_id: string } | null;
  if (ctx.entityType === 'quote') {
    deal = await dealDeLaSoumission(ctx);
    // Aucune opportunité liée : rien à déplacer, et ce n'est pas un échec.
    if (!deal) return { success: true, data: { aucun_deal: true } };
  } else {
    const { data, error: dealErr } = await ctx.supabase
      .from('deals')
      .select('id, pipeline_id, stage_id')
      .eq('id', ctx.entityId)
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (dealErr) return { success: false, error: dealErr.message };
    deal = data as typeof deal;
  }
  if (!deal) return { success: false, error: 'Deal introuvable dans cette organisation.' };

  // Étapes repérées par RÔLE, dans le pipeline DU DEAL : l'entreprise peut
  // les renommer ou les réordonner, la règle suit.
  if (config.vers_role) {
    const { data: roles } = await ctx.supabase
      .from('pipeline_stages').select('id, role_systeme, position')
      .eq('pipeline_id', deal.pipeline_id).eq('org_id', ctx.orgId).is('archived_at', null)
      .in('role_systeme', [config.vers_role, config.depuis_role].filter(Boolean) as string[]);
    const vers = (roles ?? []).find((r) => r.role_systeme === config.vers_role);
    if (!vers) return { success: true, data: { pas_d_etape_cible: true } };
    if (config.depuis_role) {
      const depuis = (roles ?? []).find((r) => r.role_systeme === config.depuis_role);
      // Seulement depuis l'étape prévue : un deal déjà plus loin (ou
      // ailleurs) ne recule JAMAIS.
      if (!depuis || deal.stage_id !== depuis.id) {
        return { success: true, data: { deja_ailleurs: true } };
      }
    } else {
      // Sans étape de départ imposée : seulement vers l'AVANT, et jamais un
      // deal gagné ou perdu (un devis révisé et renvoyé ne rouvre rien).
      const { data: actuelle } = await ctx.supabase
        .from('pipeline_stages').select('position, kind')
        .eq('id', deal.stage_id).eq('org_id', ctx.orgId).maybeSingle();
      if (!actuelle || actuelle.kind !== 'open' || Number(actuelle.position) >= Number(vers.position)) {
        return { success: true, data: { deja_ailleurs: true } };
      }
    }
    config = { ...config, stage_id: vers.id as string };
  }
  const cible = config.stage_id as string;

  if (deal.stage_id === cible) {
    // Pas une erreur : la règle a déjà produit son effet.
    return { success: true, data: { deja_dans_l_etape: true, stage_id: cible } };
  }

  const { data: etape, error: etapeErr } = await ctx.supabase
    .from('pipeline_stages')
    .select('id, pipeline_id, archived_at, name_fr')
    .eq('id', cible)
    .eq('org_id', ctx.orgId)
    .maybeSingle();

  if (etapeErr) return { success: false, error: etapeErr.message };
  if (!etape) return { success: false, error: 'Étape introuvable dans cette organisation.' };
  if (etape.pipeline_id !== deal.pipeline_id) {
    return { success: false, error: "L'étape visée appartient à un autre pipeline." };
  }
  if (etape.archived_at) {
    return { success: false, error: `L'étape « ${etape.name_fr} » est archivée.` };
  }

  const { data, error } = await ctx.supabase
    .from('deals')
    .update({ stage_id: cible })
    .eq('id', deal.id)
    .eq('org_id', ctx.orgId)
    .select('id');

  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) {
    return { success: false, error: "Aucun deal touché — l'écriture a été refusée." };
  }

  // L'historique dit QUI et POURQUOI : sans ça, le déplacement apparaît
  // comme « Système », sans explication. Le déclencheur d'historique vient
  // d'écrire la ligne ; on la complète.
  const motif = config.cible === 'role'
    ? 'Déplacée automatiquement — le client a ouvert la soumission'
    : 'Déplacée automatiquement par une automatisation';
  const { data: derniere } = await ctx.supabase
    .from('deal_stage_history').select('id')
    .eq('deal_id', deal.id).eq('to_stage_id', cible)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (derniere?.id) {
    const { error: eHist } = await ctx.supabase.from('deal_stage_history')
      .update({ actor_type: 'automation', motif }).eq('id', derniere.id);
    if (eHist) console.error('[actions/move_deal_stage] motif non écrit', eHist.message);
  }
  return { success: true, data: { stage_id: cible, etape: etape.name_fr } };
}

// ── Le client concerné, quelle que soit l'entité ────────────

/**
 * Remonte de l'entité déclenchante jusqu'à la fiche client.
 *
 * Presque toutes les actions « client » (étiquette, note, assignation) en ont
 * besoin, et chacune le refaisait à sa façon. Un seul endroit, donc, et une
 * carte des liens RÉELS — vérifiée dans le schéma de production le
 * 2026-09-24, pas devinée :
 *
 *   · `lead` EST une fiche `clients` (il n'existe pas de table `leads`) ;
 *   · `schedule_events` n'a PAS de `client_id` — on passe par son job ;
 *   · `quotes` porte deux liens, `client_id` et `lead_id`, et les deux
 *     pointent vers `clients` ;
 *   · `deals.client_id` est NOT NULL.
 *
 * Retourne `null` quand l'entité n'a pas de client (un paiement orphelin,
 * une visite sans job). L'appelant décide alors s'il échoue ou s'il passe.
 */
export async function clientDeLEntite(ctx: Pick<ActionContext, 'supabase' | 'orgId' | 'entityType' | 'entityId'>): Promise<string | null> {
  const { supabase, orgId, entityType, entityId } = ctx;

  // Un prospect est une fiche client : l'identifiant est déjà le bon.
  if (entityType === 'client' || entityType === 'lead') return entityId;

  const lire = async (table: string, colonnes: string) => {
    const { data } = await supabase
      .from(table)
      .select(colonnes)
      .eq('id', entityId)
      .eq('org_id', orgId)
      .maybeSingle();
    return data as Record<string, string | null> | null;
  };

  switch (entityType) {
    case 'job': {
      const j = await lire('jobs', 'client_id');
      return j?.client_id ?? null;
    }
    case 'invoice': {
      const i = await lire('invoices', 'client_id');
      return i?.client_id ?? null;
    }
    case 'quote': {
      const q = await lire('quotes', 'client_id, lead_id');
      return q?.client_id ?? q?.lead_id ?? null;
    }
    case 'deal': {
      const d = await lire('deals', 'client_id');
      return d?.client_id ?? null;
    }
    case 'schedule_event':
    case 'appointment': {
      // Une visite n'a pas de client : elle appartient à un job, qui en a un.
      const e = await lire('schedule_events', 'job_id');
      if (!e?.job_id) return null;
      const { data: job } = await supabase
        .from('jobs')
        .select('client_id')
        .eq('id', e.job_id)
        .eq('org_id', orgId)
        .maybeSingle();
      return (job as { client_id?: string | null } | null)?.client_id ?? null;
    }
    default:
      return null;
  }
}

/** Le membre visé appartient-il bien à cette organisation ? */
async function membreDeLOrg(ctx: ActionContext, userId: string): Promise<boolean> {
  const { data } = await ctx.supabase
    .from('memberships')
    .select('user_id')
    .eq('org_id', ctx.orgId)
    .eq('user_id', userId)
    .maybeSingle();
  return Boolean(data);
}

// ── Action : ajouter une étiquette ──────────────────────────

/** La chaîne à porter par l'événement qu'une action produit : la sienne + la règle courante. */
function chaineSuivante(ctx: ActionContext): string[] {
  return [...(ctx.chaine ?? []), ...(ctx.ruleId ? [ctx.ruleId] : [])];
}

/**
 * `client_tags` plutôt que `clients.tags`.
 *
 * Les deux existent en base. La COLONNE `clients.tags` (text[]) n'est écrite
 * nulle part dans le produit ; c'est la TABLE `client_tags` que l'interface
 * lit et écrit (ClientDetails, Clients, leads.ts). Écrire dans la colonne
 * aurait donné une étiquette invisible partout — le pire des résultats :
 * l'automatisation « réussit » et rien n'apparaît.
 */
export async function executeAjouterEtiquette(
  config: { etiquette?: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const etiquette = resolveTemplate(config.etiquette || '', vars).trim();
  if (!etiquette) return { success: false, error: 'Aucune étiquette à ajouter.' };

  const clientId = await clientDeLEntite(ctx);
  if (!clientId) return { success: false, error: 'Aucun client rattaché à cette entité.' };

  // `client_tags_client_id_tag_key` interdit le doublon : on l'absorbe au lieu
  // de faire échouer une action dont le résultat voulu est déjà atteint.
  // `ignoreDuplicates` + `select` : seule une étiquette NOUVELLE revient —
  // c'est elle, et elle seule, qu'on annonce (« Étiquette ajoutée »).
  const { data: posees, error } = await ctx.supabase
    .from('client_tags')
    .upsert({ client_id: clientId, tag: etiquette }, { onConflict: 'client_id,tag', ignoreDuplicates: true })
    .select('tag');

  if (error) return { success: false, error: error.message };
  if ((posees ?? []).length > 0) {
    await annoncerEtiquette(ctx.supabase, { orgId: ctx.orgId, clientId, tag: etiquette, sens: 'ajoutee', chaine: chaineSuivante(ctx) });
  }
  return { success: true, data: { etiquette, deja_posee: (posees ?? []).length === 0 } };
}

// ── Action : retirer une étiquette ──────────────────────────

export async function executeRetirerEtiquette(
  config: { etiquette?: string; toutes?: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const clientId = await clientDeLEntite(ctx);
  if (!clientId) return { success: false, error: 'Aucun client rattaché à cette entité.' };

  const toutes = config.toutes === 'true';
  if (!toutes) {
    const etiquette = resolveTemplate(config.etiquette || '', vars).trim();
    if (!etiquette) return { success: false, error: 'Aucune étiquette à retirer.' };
    const { data: retirees, error } = await ctx.supabase
      .from('client_tags')
      .delete()
      .eq('client_id', clientId)
      .eq('tag', etiquette)
      .select('tag');
    if (error) return { success: false, error: error.message };
    for (const r of (retirees ?? []) as Array<{ tag: string }>) {
      await annoncerEtiquette(ctx.supabase, { orgId: ctx.orgId, clientId, tag: r.tag, sens: 'retiree', chaine: chaineSuivante(ctx) });
    }
    return { success: true, data: { etiquette } };
  }

  const { data: retirees, error } = await ctx.supabase.from('client_tags').delete().eq('client_id', clientId).select('tag');
  if (error) return { success: false, error: error.message };
  for (const r of (retirees ?? []) as Array<{ tag: string }>) {
    await annoncerEtiquette(ctx.supabase, { orgId: ctx.orgId, clientId, tag: r.tag, sens: 'retiree', chaine: chaineSuivante(ctx) });
  }
  return { success: true, data: { toutes: true } };
}

// ── Action : modifier le client ─────────────────────────────

/** Les seuls statuts que `clients_status_check` accepte. */
const STATUTS_CLIENT = new Set(['active', 'inactive', 'lead']);

export async function executeModifierClient(
  config: { statut?: string; source?: string; valeur?: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const clientId = await clientDeLEntite(ctx);
  if (!clientId) return { success: false, error: 'Aucun client rattaché à cette entité.' };

  const patch: Record<string, string | number> = {};

  if (config.statut) {
    // Une valeur hors CHECK ferait échouer l'UPDATE ENTIER : la source et la
    // valeur seraient perdues avec elle. On refuse avant d'écrire.
    if (!STATUTS_CLIENT.has(config.statut)) {
      return { success: false, error: `Statut inconnu : ${config.statut}` };
    }
    patch.status = config.statut;
  }
  if (config.source) patch.source = resolveTemplate(config.source, vars).trim().slice(0, 60);
  if (config.valeur) {
    const n = Number(config.valeur);
    // `clients.value` est un numeric(12,2) : au-delà, Postgres refuse la
    // ligne entière.
    if (!Number.isFinite(n) || n < 0 || n > 9_999_999_999) {
      return { success: false, error: `Valeur invalide : ${config.valeur}` };
    }
    patch.value = n;
  }

  if (Object.keys(patch).length === 0) {
    return { success: false, error: 'Rien à modifier : tous les champs sont vides.' };
  }

  const { data, error } = await ctx.supabase
    .from('clients')
    .update(patch)
    .eq('id', clientId)
    .eq('org_id', ctx.orgId)
    .select('id');

  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) return { success: false, error: 'Client introuvable.' };
  return { success: true, data: patch };
}

// ── Action : assigner un responsable ────────────────────────

export async function executeAssignerResponsable(
  config: { membre_id?: string; seulement_si_vide?: string },
  _vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const clientId = await clientDeLEntite(ctx);
  if (!clientId) return { success: false, error: 'Aucun client rattaché à cette entité.' };

  const membreId = (config.membre_id || '').trim() || null;
  // Assigner à quelqu'un d'une AUTRE organisation ferait apparaître la fiche
  // dans sa liste : la vérification n'est pas du confort.
  if (membreId && !(await membreDeLOrg(ctx, membreId))) {
    return { success: false, error: "Ce membre n'appartient pas à l'organisation." };
  }

  let requete = ctx.supabase
    .from('clients')
    .update({ assigned_to: membreId })
    .eq('id', clientId)
    .eq('org_id', ctx.orgId);

  // « Seulement si personne n'est assigné » (le « Only Apply To Unassigned
  // Contacts » de GoHighLevel) : la condition est DANS la requête, pas dans
  // un lire-puis-écrire qui laisserait passer deux automatisations
  // simultanées.
  if (config.seulement_si_vide === 'true') requete = requete.is('assigned_to', null);

  const { data, error } = await requete.select('id');
  if (error) return { success: false, error: error.message };
  // Zéro ligne avec « seulement si vide » n'est pas une panne : quelqu'un
  // était déjà responsable, et c'est exactement ce qu'on voulait respecter.
  if (!data || data.length === 0) {
    if (config.seulement_si_vide === 'true') {
      return { success: true, data: { ignore: 'un responsable était déjà assigné' } };
    }
    return { success: false, error: 'Client introuvable.' };
  }
  return { success: true, data: { membre_id: membreId } };
}

// ── Action : ajouter une note ───────────────────────────────

/** Les `entity_type` que `notes_entity_type_check` accepte. */
const TYPES_NOTE = new Set(['client', 'job', 'lead', 'invoice', 'payment', 'team_member']);

export async function executeAjouterNote(
  config: { body?: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const contenu = resolveTemplate(config.body || '', vars).trim();
  if (!contenu) return { success: false, error: 'La note est vide.' };

  // `notes.entity_type` porte un CHECK à six valeurs. Le moteur émet aussi
  // `quote`, `deal`, `schedule_event`… : les écrire tels quels violerait la
  // contrainte et l'action échouerait en silence, réessayée trois fois pour
  // rien — le bug exact déjà corrigé sur `create_task`.
  let type: string | null = ctx.entityType;
  let cible: string | null = ctx.entityId;
  if (!TYPES_NOTE.has(ctx.entityType)) {
    const clientId = await clientDeLEntite(ctx);
    if (clientId) {
      type = 'client';
      cible = clientId;
    } else {
      // Note sans rattachement plutôt que pas de note du tout.
      type = null;
      cible = null;
    }
  }

  const { error } = await ctx.supabase.from('notes').insert({
    org_id: ctx.orgId,
    content: contenu,
    entity_type: type,
    entity_id: cible,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, data: { longueur: contenu.length } };
}

// ── Action : changer le statut d'un rendez-vous ─────────────

export async function executeStatutRendezVous(
  config: { statut?: string },
  _vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const statut = (config.statut || '').trim();
  if (!statut) return { success: false, error: 'Aucun statut choisi.' };

  if (ctx.entityType !== 'schedule_event' && ctx.entityType !== 'appointment') {
    return { success: false, error: "Cette action ne vaut que pour un rendez-vous." };
  }

  const { data, error } = await ctx.supabase
    .from('schedule_events')
    .update({ status: statut })
    .eq('id', ctx.entityId)
    .eq('org_id', ctx.orgId)
    .select('id');

  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) return { success: false, error: 'Rendez-vous introuvable.' };
  return { success: true, data: { statut } };
}

// ── Action : modifier l'opportunité ─────────────────────────

export async function executeModifierDeal(
  config: { source?: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  if (ctx.entityType !== 'deal') {
    return { success: false, error: "Cette action ne vaut que pour une opportunité." };
  }
  const source = resolveTemplate(config.source || '', vars).trim().slice(0, 60);
  if (!source) return { success: false, error: 'Rien à modifier.' };

  const { data, error } = await ctx.supabase
    .from('deals')
    .update({ source })
    .eq('id', ctx.entityId)
    .eq('org_id', ctx.orgId)
    .select('id');

  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) return { success: false, error: 'Opportunité introuvable.' };
  return { success: true, data: { source } };
}

// ── Action : assigner l'opportunité ─────────────────────────

export async function executeAssignerDeal(
  config: { membre_id?: string },
  _vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  if (ctx.entityType !== 'deal') {
    return { success: false, error: "Cette action ne vaut que pour une opportunité." };
  }
  const membreId = (config.membre_id || '').trim() || null;
  if (membreId && !(await membreDeLOrg(ctx, membreId))) {
    return { success: false, error: "Ce membre n'appartient pas à l'organisation." };
  }

  const { data, error } = await ctx.supabase
    .from('deals')
    .update({
      assigned_user_id: membreId,
      // `assigned_at` accompagne l'assignation partout ailleurs dans le
      // produit : ne pas la poser ferait mentir les rapports d'ancienneté.
      assigned_at: membreId ? new Date().toISOString() : null,
    })
    .eq('id', ctx.entityId)
    .eq('org_id', ctx.orgId)
    .select('id');

  if (error) return { success: false, error: error.message };
  if (!data || data.length === 0) return { success: false, error: 'Opportunité introuvable.' };
  return { success: true, data: { membre_id: membreId } };
}

// ── Action : envoyer dans Slack ─────────────────────────────

export async function executeEnvoyerSlack(
  config: { body?: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  /*
   * Aucune connexion Slack PAR ENTREPRISE n'existe encore. Le Slack configuré
   * sur ce serveur est celui du SUPPORT DE LUME : y publier enverrait les
   * messages d'un client (noms, suivis) dans notre canal interne, alors que
   * l'écran promet « le canal Slack de votre entreprise » (audit V2,
   * 2026-09-29). On ne publie donc nulle part, et on le dit. L'éditeur grise
   * l'action et la publication la refuse (catalogue : `indisponible`).
   */
  void config; void vars; void ctx;
  return {
    success: false,
    error: 'Envoyer dans Slack n’est pas encore disponible : la connexion à votre Slack n’existe pas. Rien n’a été publié.',
  };
}

// ── Action : webhook ────────────────────────────────────────

/**
 * Une adresse est-elle sûre à appeler ?
 *
 * Même garde que la validation à l'enregistrement — mais refaite ICI, au
 * moment de l'appel. Une règle peut avoir été écrite avant que la garde
 * existe, ou modifiée en base hors du serveur : vérifier deux fois coûte une
 * expression régulière et ferme un SSRF.
 */
function adresseSure(url: string): boolean {
  if (!/^https:\/\//i.test(url)) return false;
  try {
    const hote = new URL(url).hostname.toLowerCase();
    return !(
      hote === 'localhost'
      || hote === '169.254.169.254'
      || /^127\./.test(hote)
      || /^10\./.test(hote)
      || /^192\.168\./.test(hote)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(hote)
      || hote.endsWith('.local')
      || hote.endsWith('.internal')
    );
  } catch {
    return false;
  }
}

export async function executeWebhook(
  config: { url?: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const url = (config.url || '').trim();
  if (!adresseSure(url)) {
    return { success: false, error: 'Adresse refusée : https:// et publique seulement.' };
  }

  // Un délai borné : sans lui, un serveur distant qui ne répond jamais
  // immobiliserait le worker des tâches différées.
  const abandon = AbortSignal.timeout(10_000);
  try {
    const reponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Lume-Automations/1' },
      body: JSON.stringify({
        org_id: ctx.orgId,
        entity_type: ctx.entityType,
        entity_id: ctx.entityId,
        // Les variables déjà résolues : le destinataire reçoit le nom du
        // client et les montants, pas des identifiants à recroiser.
        data: vars,
        sent_at: new Date().toISOString(),
      }),
      signal: abandon,
    });
    if (!reponse.ok) {
      return { success: false, error: `Le serveur distant a répondu ${reponse.status}.` };
    }
    return { success: true, data: { status: reponse.status } };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Appel impossible : ${message}` };
  }
}

// ── Action : arrêter une automatisation ─────────────────────

export async function executeArreterAutomatisation(
  config: { portee?: string },
  _vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  // On annule les tâches PRÉVUES pour cette entité. Une tâche déjà exécutée
  // ne se rattrape pas ; une tâche en cours (`running`) est laissée finir,
  // sinon on la marquerait annulée alors que le message est parti.
  let requete = ctx.supabase
    .from('automation_scheduled_tasks')
    .update({ status: 'cancelled' })
    .eq('org_id', ctx.orgId)
    .eq('entity_id', ctx.entityId)
    .eq('status', 'pending');

  // « Celle-ci » (défaut) : seulement la règle en cours. `ruleId` est posé
  // par le moteur sur le contexte.
  if (config.portee !== 'toutes' && ctx.ruleId) {
    requete = requete.eq('automation_rule_id', ctx.ruleId);
  }

  const { data, error } = await requete.select('id');
  if (error) return { success: false, error: error.message };
  return { success: true, data: { annulees: data?.length ?? 0 } };
}

/**
 * Démarrer une AUTRE automatisation sur la même entité.
 *
 * L'équivalent du « Add to Workflow » de GoHighLevel : chaîner deux
 * parcours plutôt que d'en bâtir un seul, énorme et illisible. Un client
 * qui accepte une soumission entre dans le parcours d'accueil ; une
 * facture payée démarre la demande d'avis.
 *
 * ── Ce qu'on refuse, et pourquoi ───────────────────────────────
 * · SE démarrer soi-même : la règle se rappellerait indéfiniment. Le
 *   moteur a déjà trois gardes contre les boucles dans un parcours ; il
 *   faut la même chose entre parcours.
 * · une règle d'une AUTRE organisation : `org_id` est filtré, sinon une
 *   entreprise démarrerait les automatisations d'une autre.
 * · une règle à la corbeille ou en brouillon : la démarrer ferait partir
 *   des messages que personne n'a publiés.
 *
 * ── L'anti-doublon ─────────────────────────────────────────────
 * Même `execution_key` que le moteur (`règle:entité:index`), donc l'index
 * unique de `automation_scheduled_tasks` fait le travail : deux parcours
 * qui démarrent le même troisième sur le même client ne produisent qu'une
 * seule inscription.
 */
export async function executeDemarrerAutomatisation(
  config: { rule_id?: string },
  _vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const cible = String(config.rule_id ?? '').trim();
  if (!cible) return { success: false, error: 'Aucune automatisation choisie.' };

  if (ctx.ruleId && cible === ctx.ruleId) {
    return { success: false, error: 'Une automatisation ne peut pas se démarrer elle-même.' };
  }

  const { data: regle, error: errLecture } = await ctx.supabase
    .from('automation_rules')
    .select('id, name, actions, is_active, deleted_at')
    .eq('id', cible)
    .eq('org_id', ctx.orgId)
    .maybeSingle();

  if (errLecture) return { success: false, error: errLecture.message };
  if (!regle || regle.deleted_at) {
    return { success: false, error: 'Automatisation introuvable.' };
  }
  if (!regle.is_active) {
    // Un brouillon n'envoie rien : le dire est plus utile que de créer des
    // tâches pour une règle que personne n'a publiée.
    return { success: false, error: `« ${regle.name} » est en brouillon : rien à démarrer.` };
  }

  const actions = Array.isArray(regle.actions) ? regle.actions : [];
  if (actions.length === 0) {
    return { success: false, error: `« ${regle.name} » n'a aucune action.` };
  }

  const maintenant = new Date().toISOString();
  let inscrites = 0;
  for (let i = 0; i < actions.length; i++) {
    const { error } = await ctx.supabase.from('automation_scheduled_tasks').insert({
      org_id: ctx.orgId,
      automation_rule_id: regle.id,
      entity_type: ctx.entityType,
      entity_id: ctx.entityId,
      action_config: { ...actions[i], trigger_event: 'automation.started' },
      execute_at: maintenant,
      status: 'pending',
      execution_key: `${regle.id}:${ctx.entityId}:${i}`,
    });
    if (!error) { inscrites += 1; continue; }
    // 23505 = déjà inscrit. Ce n'est pas un échec : c'est l'anti-doublon
    // qui fait son travail.
    if (error.code !== '23505') return { success: false, error: error.message };
  }

  return { success: true, data: { automatisation: regle.name, inscrites } };
}

// ── Actions : envoyer la facture / la soumission ────────────

/**
 * Envoie le document lié par courriel.
 *
 * On réutilise `executeSendEmail` plutôt que de refaire un envoi : il porte
 * déjà le consentement (F7), le désabonnement, le plafond de fréquence, le
 * gabarit de l'organisation et la journalisation. Un second chemin d'envoi
 * qui oublierait l'un des quatre serait une faute de conformité, pas un
 * détail.
 */
async function envoyerDocument(
  type: 'invoice' | 'quote',
  config: { body?: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  const attendu = type === 'invoice' ? 'invoice' : 'quote';
  if (ctx.entityType !== attendu) {
    return {
      success: false,
      error: type === 'invoice'
        ? 'Cette action ne vaut que pour une facture.'
        : 'Cette action ne vaut que pour une soumission.',
    };
  }

  const lien = type === 'invoice' ? vars.invoice_link : vars.quote_link;
  if (!lien) {
    return { success: false, error: 'Aucun lien public pour ce document.' };
  }

  const numero = type === 'invoice' ? vars.invoice_number : vars.quote_number;
  const objet = type === 'invoice'
    ? `Facture ${numero || ''}`.trim()
    : `Soumission ${numero || ''}`.trim();

  const mot = (config.body || '').trim();
  const corps = mot
    ? `${mot}\n\n${lien}`
    : (type === 'invoice'
      ? `Bonjour [client_first_name],\n\nVoici votre facture ${numero || ''}.\n\n${lien}`
      : `Bonjour [client_first_name],\n\nVoici votre soumission ${numero || ''}.\n\n${lien}`);

  return executeSendEmail({ subject: objet, body: corps }, vars, ctx);
}

export async function executeEnvoyerFacture(
  config: { body?: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  return envoyerDocument('invoice', config, vars, ctx);
}

export async function executeEnvoyerSoumission(
  config: { body?: string },
  vars: Record<string, string>,
  ctx: ActionContext,
): Promise<ActionResult> {
  return envoyerDocument('quote', config, vars, ctx);
}

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
    case 'move_deal_stage':
      return executeMoveDealStage(config as any, vars, ctx);
    case 'request_review':
      return executeRequestReview(config, vars, ctx);
    case 'log_activity':
      return executeLogActivity(config as any, vars, ctx);

    case 'update_custom_field':
      return executerMajChamp(ctx.supabase, ctx, config as any);

    // ── Les actions ajoutees le 2026-09-24 ──
    case 'envoyer_slack':
      return executeEnvoyerSlack(config as any, vars, ctx);
    case 'ajouter_etiquette':
      return executeAjouterEtiquette(config as any, vars, ctx);
    case 'retirer_etiquette':
      return executeRetirerEtiquette(config as any, vars, ctx);
    case 'modifier_client':
      return executeModifierClient(config as any, vars, ctx);
    case 'assigner_responsable':
      return executeAssignerResponsable(config as any, vars, ctx);
    case 'ajouter_note':
      return executeAjouterNote(config as any, vars, ctx);
    case 'modifier_statut_rendezvous':
      return executeStatutRendezVous(config as any, vars, ctx);
    case 'modifier_deal':
      return executeModifierDeal(config as any, vars, ctx);
    case 'assigner_deal':
      return executeAssignerDeal(config as any, vars, ctx);
    case 'envoyer_facture':
      return executeEnvoyerFacture(config as any, vars, ctx);
    case 'envoyer_soumission':
      return executeEnvoyerSoumission(config as any, vars, ctx);
    case 'webhook':
      return executeWebhook(config as any, vars, ctx);
    case 'arreter_automatisation':
      return executeArreterAutomatisation(config as any, vars, ctx);

    case 'demarrer_automatisation':
      return executeDemarrerAutomatisation(config as any, vars, ctx);

    default:
      return { success: false, error: `Unknown action type: ${actionType}` };
  }
}
