/* ═══════════════════════════════════════════════════════════════
   API — Automation Rules (event-driven engine presets)
   Reads the automation_rules table; the content of a rule is only ever
   WRITTEN through the server (messages: PATCH /api/automations/rules/:id/messages).
   These are the REAL working workflows powered by the automation engine.

   Presets are seeded via DB migration (idempotent upsert).
   The UI only reads — it never calls seed on page load.
   ═══════════════════════════════════════════════════════════════ */

import { supabase } from './supabase';
import { getCurrentOrgId } from './orgApi';
import { changerPublication } from './automationBuilderApi';
import { interfaceEnFrancais } from './champs/messages';
import { estPrereglageRetire } from './automationCatalogue';
import { appelServeur } from './appelServeur';
import { messageDuServeur } from './messageDuServeur';

export interface AutomationRule {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  trigger_event: string;
  conditions: Record<string, any>;
  delay_seconds: number;
  actions: Array<{ type: string; config: Record<string, any> }>;
  /**
   * Étapes d'une SÉQUENCE (null = règle simple, pilotée par `delay_seconds`
   * + `actions`). Forme décrite dans src/lib/sequenceTypes.ts.
   */
  steps?: unknown[] | null;
  /** La conversation avec Lumi qui a construit ce parcours. */
  lumi_conversation?: Array<{ role: 'user' | 'assistant'; content: string }> | null;
  /** Réglages propres à la règle (null = les défauts du moteur). */
  settings?: Record<string, unknown> | null;
  is_active: boolean;
  is_preset: boolean;
  preset_key: string | null;
  created_at: string;
  updated_at: string;  /** Dossier de rangement — `null` = à la racine. */
  folder_id?: string | null;
  /** Copie liée : l'automatisation modèle (autre bureau) qu'elle suit. */
  modele_id?: string | null;
  /** À la corbeille depuis. `null` = vivante. */
  deleted_at?: string | null;
}

export async function getAutomationRules(): Promise<AutomationRule[]> {
  // Resolve current org to avoid cross-org leakage when user has multiple memberships
  const orgId = await getCurrentOrgId();
  if (!orgId) return [];

  const { data, error } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('org_id', orgId)
    // Supprimée définitivement depuis la corbeille : n'apparaît plus nulle part.
    .is('purged_at', null)
    .order('name');
  if (error) throw error;
  // Un préréglage retiré (déclencheur que plus rien n'émet) n'est pas montré :
  // il s'afficherait « publié » sans jamais partir.
  return ((data || []) as AutomationRule[]).filter((r) => !estPrereglageRetire(r));
}

/**
 * Publier / dépublier. Passe par la route serveur de publication (audit M8) :
 * l'écriture directe dans PostgREST publiait un parcours cassé sans aucune
 * vérification. Conservé pour les pages Réglages (Messagerie, Avis).
 */
export async function toggleAutomationRule(id: string, isActive: boolean): Promise<void> {
  await changerPublication(id, isActive);
}

/* ── Les messages d'une automatisation ────────────────────────────
   Un texto ou un courriel vit à UN endroit, selon la règle :

     · `steps` posé (un tableau, MÊME VIDE) : la règle a un parcours. C'est la
       seule source de vérité — le moteur n'exécute que lui. `actions` n'en est
       qu'un reflet, réécrit à chaque écriture (les actions du parcours, dans
       l'ordre). On ne relit jamais `actions` d'une règle qui a un parcours.
     · `steps` nul : la règle est « à plat », ses messages sont dans `actions`.

   Une règle peut envoyer PLUSIEURS messages du même type (deux textos, deux
   courriels) : on en désigne toujours UN, jamais « tous ceux du type ». */

export type TypeMessage = 'send_sms' | 'send_email';

/** Un message, tel qu'un écran le liste. */
export interface MessageDeRegle {
  type: TypeMessage;
  /** Rang parmi les messages du MÊME type, dans l'ordre du parcours (0 = le premier). */
  rang: number;
  /** L'étape qui le porte, quand la règle a un parcours. */
  etapeId?: string;
  config: Record<string, any>;
}

/**
 * Désigne UN message d'une automatisation.
 *
 * Sans cible, l'écriture n'est acceptée que si la règle n'envoie qu'UN message
 * de ce type : deviner lequel recopiait le texte du premier dans tous les
 * autres (triage « modèles » du 2026-10-01, MSG-010 et MSG-036).
 */
export interface CibleMessage {
  /** Parcours : l'identifiant de l'étape. */
  etapeId?: string;
  /** Rang parmi les messages du même type (0 = le premier). */
  rang?: number;
  /**
   * Le texte FRANÇAIS (`body`) — et l'objet (`subject`) — sur lequel l'écran a
   * été ouvert. Désigne le message quand ni l'étape ni le rang ne sont connus,
   * et protège d'une écriture sur un message qui a changé entre-temps.
   */
  corpsLu?: string;
  objetLu?: string;
}

/** Ce qu'on écrit dans un message. Un champ absent reste tel quel. */
export interface EcritureMessage {
  /** Le texte français. */
  body?: string;
  /** L'objet français (courriel seulement). */
  subject?: string;
  /**
   * La version anglaise : elle part À LA PLACE du français quand la langue du
   * bureau est l'anglais. Vide = retirée (le français part à tout le monde) —
   * jamais de `body_en: ""` en base.
   */
  body_en?: string;
  subject_en?: string;
}

/** Les étapes d'un parcours dans l'ordre où il les rencontre : le fil principal, puis les embranchements. */
function etapesDansLOrdre(steps: unknown): Array<Record<string, any>> {
  const etapes = (Array.isArray(steps) ? steps : []) as Array<Record<string, any> | null | undefined>;
  const parId = new Map<string, Record<string, any>>();
  for (const e of etapes) if (e && typeof e.id === 'string') parId.set(e.id, e);
  const ordre: Array<Record<string, any>> = [];
  const vues = new Set<string>();
  const pile: string[] = typeof etapes[0]?.id === 'string' ? [etapes[0].id] : [];
  while (pile.length) {
    const id = pile.pop() as string;
    const etape = parId.get(id);
    if (!etape || vues.has(id)) continue;
    vues.add(id);
    ordre.push(etape);
    const suites = etape.type === 'si'
      ? [etape.alors, etape.sinon]
      : etape.type === 'arreter' ? [] : [etape.suivant, etape.si_reponse, etape.si_depasse];
    for (const s of [...suites].reverse()) if (typeof s === 'string' && !vues.has(s)) pile.push(s);
  }
  // Une étape que rien n'atteint (brouillon en cours de câblage) : gardée, à la fin.
  for (const e of etapes) if (e && typeof e.id === 'string' && !vues.has(e.id)) ordre.push(e);
  return ordre;
}

/** Plafond du champ `actions` côté serveur (`corpsAutomatisation`, server/lib/validation.ts). */
const ACTIONS_REFLET_MAX = 20;

/**
 * `actions`, reflet d'un parcours : ses actions, dans l'ordre, sans attente ni
 * condition. Même parcours et même ordre que `actionsDuParcours`
 * (src/lib/publicationAutomatisation.ts), que l'éditeur écrit à chaque
 * enregistrement — les deux écritures doivent donner le même reflet.
 */
function refletDuParcours(steps: unknown): AutomationRule['actions'] {
  return etapesDansLOrdre(steps)
    .flatMap((e) => (e.type === 'action' && typeof e.action?.type === 'string' && e.action.type
      ? [{ type: e.action.type as string, config: { ...(e.action.config ?? {}) } as Record<string, any> }]
      : []))
    .slice(0, ACTIONS_REFLET_MAX);
}

/**
 * Les textos et courriels qu'une automatisation envoie, dans l'ordre.
 * `steps` posé (même vide) : ceux du parcours, jamais ceux d'`actions`.
 */
export function messagesDeRegle(
  rule: Pick<AutomationRule, 'actions' | 'steps'> | null | undefined,
  type?: TypeMessage,
): MessageDeRegle[] {
  const porteurs: Array<{ type: string; etapeId?: string; config: Record<string, any> }> = Array.isArray(rule?.steps)
    ? etapesDansLOrdre(rule?.steps)
      .filter((e) => e.type === 'action' && e.action)
      .map((e) => ({ type: String(e.action.type ?? ''), etapeId: String(e.id), config: e.action.config ?? {} }))
    : (rule?.actions || []).map((a) => ({ type: a.type, config: a.config ?? {} }));
  const rangs: Record<string, number> = {};
  const messages: MessageDeRegle[] = [];
  for (const p of porteurs) {
    if (p.type !== 'send_sms' && p.type !== 'send_email') continue;
    const rang = rangs[p.type] ?? 0;
    rangs[p.type] = rang + 1;
    if (!type || p.type === type) messages.push({ type: p.type, rang, etapeId: p.etapeId, config: p.config });
  }
  return messages;
}

/**
 * Le texte d'un champ (`body`, `subject`) tel que le moteur l'ENVOIE dans une
 * langue : la version anglaise si le bureau écrit en anglais et qu'elle est
 * renseignée, sinon le français (`champLocalise`, server/lib/actions).
 */
export function texteQuiPart(config: Record<string, any> | null | undefined, champ: 'body' | 'subject', langue: 'fr' | 'en' = 'fr'): string {
  if (langue === 'en') {
    const en = config?.[`${champ}_en`];
    if (typeof en === 'string' && en.trim()) return en;
  }
  return String(config?.[champ] ?? '');
}

/** Le message désigné par `cible` — lève, avec une phrase claire, s'il n'y en a pas exactement un. */
function messageVise(messages: MessageDeRegle[], cible: CibleMessage, fr: boolean): MessageDeRegle {
  const modifieAilleurs = () => new Error(fr
    ? 'Ce message a été modifié ailleurs depuis l’ouverture de cet écran. Rechargez la page avant de le modifier — rien n’a été enregistré.'
    : 'This message was changed elsewhere since this screen was opened. Reload the page before editing it — nothing was saved.');
  const memeTexte = (m: MessageDeRegle) => (cible.corpsLu === undefined || String(m.config.body ?? '') === cible.corpsLu)
    && (cible.objetLu === undefined || String(m.config.subject ?? '') === cible.objetLu);
  const lu = cible.corpsLu !== undefined || cible.objetLu !== undefined;

  if (cible.etapeId !== undefined) {
    const m = messages.find((x) => x.etapeId === cible.etapeId);
    if (!m || !memeTexte(m)) throw modifieAilleurs();
    return m;
  }
  if (cible.rang !== undefined) {
    const m = messages.find((x) => x.rang === cible.rang);
    if (m && memeTexte(m)) return m;
    // Le rang ne désigne plus le même texte (un message ajouté ou retiré
    // ailleurs) : on ne retombe sur le texte lu que s'il désigne un seul message.
    const memes = lu ? messages.filter(memeTexte) : [];
    if (memes.length === 1) return memes[0];
    throw modifieAilleurs();
  }
  if (lu) {
    // Deux messages au texte identique : le premier — les deux se valent.
    const m = messages.find(memeTexte);
    if (!m) throw modifieAilleurs();
    return m;
  }
  if (messages.length === 1) return messages[0];
  if (messages.length === 0) {
    throw new Error(fr
      ? 'Cette automatisation n’envoie aucun message de ce type. Rien n’a été enregistré.'
      : 'This automation sends no message of this kind. Nothing was saved.');
  }
  throw new Error(fr
    ? `Cette automatisation envoie ${messages.length} messages de ce type : modifiez celui que vous voulez dans Automatisations.`
    : `This automation sends ${messages.length} messages of this kind: edit the one you want in Automations.`);
}

const texteVisible = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').trim();

/**
 * Réécrit le corps d'UN message d'une automatisation — texto ou courriel.
 *
 * Remplace `updateRuleSmsBody`, qui ne couvrait que les SMS : le texte des
 * courriels n'était modifiable NULLE PART, alors que 35 automatisations
 * écrivent aux clients au nom de l'entreprise.
 *
 * `subject` n'a de sens que pour un courriel ; il est ignoré pour un SMS.
 * `cible` désigne le message (voir `CibleMessage`) ; `cible.langue = 'en'`
 * écrit la version anglaise (`body_en`, `subject_en`) — celle qui part quand
 * le bureau écrit en anglais — au lieu du texte français.
 */
export async function updateRuleMessage(
  id: string,
  actionType: 'send_sms' | 'send_email',
  body: string,
  subject?: string,
  cible: CibleMessage & { langue?: 'fr' | 'en' } = {},
): Promise<void> {
  /*
   * UN MESSAGE VIDE NE PART PAS (audit V2, A-06).
   *
   * Cette écriture passe par PostgREST, donc sans la validation Zod du
   * serveur : vider le texto d'une règle PUBLIÉE depuis la liste écrivait
   * `body = ""` et affichait « Message enregistré ». Le serveur, lui, refuse
   * un message vide — on refuse pareil, ici, pour tous les écrans qui
   * passent par cette fonction (liste, Réglages › Messagerie et Avis).
   */
  const fr = interfaceEnFrancais();
  if (!texteVisible(body)) {
    throw new Error(fr ? 'Le message ne peut pas être vide.' : 'The message cannot be empty.');
  }
  if (actionType === 'send_email' && subject !== undefined && !subject.trim()) {
    throw new Error(fr ? 'L’objet du courriel ne peut pas être vide.' : 'The email subject cannot be empty.');
  }
  const objet = actionType === 'send_email' && subject !== undefined ? subject : undefined;
  const { langue, ...message } = cible;
  await ecrireMessageDeRegle(
    id,
    actionType,
    langue === 'en' ? { body_en: body, subject_en: objet } : { body, subject: objet },
    message,
  );
}

/**
 * Lit UN message d'une automatisation, avec ses deux versions (`body`,
 * `body_en`…). Les écrans qui ne reçoivent que le texte français s'en servent
 * pour montrer aussi la version anglaise.
 */
export async function lireMessageDeRegle(id: string, actionType: TypeMessage, cible: CibleMessage = {}): Promise<MessageDeRegle> {
  const { data: rule, error } = await supabase
    .from('automation_rules')
    .select('actions, steps')
    .eq('id', id)
    .single();
  if (error) throw error;
  return messageVise(messagesDeRegle(rule, actionType), cible, interfaceEnFrancais());
}

/**
 * Les en-têtes d'un appel au serveur. `x-org-id` : sans lui, le serveur
 * retomberait sur le premier bureau de la personne. `Accept-Language` : il
 * répond dans la langue de l'interface.
 */
async function entetesServeur(): Promise<HeadersInit> {
  const fr = interfaceEnFrancais();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error(fr ? 'Session expirée — reconnectez-vous. Rien n’a été modifié.' : 'Session expired — sign in again. Nothing was changed.');
  const orgId = await getCurrentOrgId();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'Accept-Language': fr ? 'fr' : 'en',
    ...(orgId ? { 'x-org-id': orgId } : {}),
  };
}

/**
 * Écrit dans UN message d'une automatisation — et seulement dans celui-là.
 *
 * PAR LE SERVEUR (`PATCH /api/automations/rules/:id/messages`,
 * server/routes/automation-messages.ts), plus jamais par une écriture directe
 * dans la table : c'est lui qui désigne le message visé, valide (texte non
 * vide, 1 600 caractères pour un texto), refuse une règle à la corbeille ou un
 * message changé ailleurs, écrit le parcours ET son reflet `actions`, et rend
 * l'état enregistré. Ses refus arrivent en phrases, dans la langue de
 * l'interface.
 *
 * Rend les variables écrites que le serveur ne saura pas remplir.
 */
export async function ecrireMessageDeRegle(
  id: string,
  actionType: TypeMessage,
  ecriture: EcritureMessage,
  cible: CibleMessage = {},
): Promise<{ variablesInconnues: string[] }> {
  const fr = interfaceEnFrancais();
  const estCourriel = actionType === 'send_email';

  // Les deux refus qu'on peut dire sans aller-retour, avec les mots du serveur.
  // Le français ne se vide pas : c'est le texte qui part quand il n'y a pas
  // d'autre version. La version anglaise, elle, se retire en la vidant.
  if (ecriture.body !== undefined && !texteVisible(ecriture.body)) {
    throw new Error(fr ? 'Le message ne peut pas être vide.' : 'The message cannot be empty.');
  }
  if (estCourriel && ecriture.subject !== undefined && !ecriture.subject.trim()) {
    throw new Error(fr ? 'L’objet du courriel ne peut pas être vide.' : 'The email subject cannot be empty.');
  }

  const francais = ecriture.body !== undefined || ecriture.subject !== undefined;
  const anglais = ecriture.body_en !== undefined || ecriture.subject_en !== undefined;
  const corps = {
    canal: actionType,
    etape_id: cible.etapeId,
    rang: cible.rang,
    corps_lu: cible.corpsLu,
    objet_lu: cible.objetLu,
    ...(francais
      ? {
        langue: 'fr',
        texte: ecriture.body,
        objet: ecriture.subject,
        ...(anglais ? { version_en: { texte: ecriture.body_en, objet: ecriture.subject_en } } : {}),
      }
      : { langue: 'en', texte: ecriture.body_en, objet: ecriture.subject_en }),
  };

  const reponse = await appelServeur(`/api/automations/rules/${id}/messages`, {
    method: 'PATCH',
    headers: await entetesServeur(),
    body: JSON.stringify(corps),
  });
  const rendu: unknown = await reponse.json().catch(() => null);
  if (!reponse.ok) {
    // La phrase du serveur ; sans elle (panne d'un relais, réponse sans JSON),
    // une phrase qui dit quoi faire — jamais un texte technique.
    throw new Error(messageDuServeur(rendu) ?? (fr
      ? 'Enregistrement impossible pour le moment : rien n’a été modifié. Réessayez dans un instant.'
      : 'Could not save right now: nothing was changed. Try again in a moment.'));
  }
  const inconnues = (rendu as { variables_inconnues?: unknown } | null)?.variables_inconnues;
  return { variablesInconnues: Array.isArray(inconnues) ? inconnues.map(String) : [] };
}

/**
 * Le texte que le moteur ENVERRA pour ce type d'envoi (le premier message de
 * ce type) : celui du parcours quand la règle en a un (le moteur ne lit alors
 * plus `actions`), sinon celui de l'action d'origine ; dans la langue donnée,
 * la version anglaise si elle existe. Ce que les écrans affichent doit être ce
 * qui part.
 */
export function texteDuMessage(
  rule: Pick<AutomationRule, 'actions' | 'steps'>,
  actionType: 'send_sms' | 'send_email',
  langue: 'fr' | 'en' = 'fr',
): string {
  return texteQuiPart(messagesDeRegle(rule, actionType)[0]?.config, 'body', langue);
}

/**
 * La règle telle qu'après `updateRuleMessage` sur son premier message de ce
 * type (mise à jour locale d'un écran). `cle` : le champ écrit — `body_en`
 * quand l'écran a modifié la version anglaise.
 */
export function avecTexteDuMessage<T extends Pick<AutomationRule, 'actions' | 'steps'>>(
  rule: T,
  actionType: 'send_sms' | 'send_email',
  body: string,
  cle: 'body' | 'body_en' = 'body',
): T {
  const vise = messagesDeRegle(rule, actionType)[0];
  if (!vise) return rule;
  if (Array.isArray(rule.steps)) {
    const steps = (rule.steps as Array<Record<string, any>>).map((e) => (e && e.id === vise.etapeId
      ? { ...e, action: { ...e.action, config: { ...e.action?.config, [cle]: body } } }
      : e));
    return { ...rule, steps, actions: refletDuParcours(steps) };
  }
  let rang = -1;
  return {
    ...rule,
    actions: (rule.actions || []).map((a) => {
      if (a.type !== actionType) return a;
      rang += 1;
      return rang === vise.rang ? { ...a, config: { ...a.config, [cle]: body } } : a;
    }),
  };
}

/** @deprecated Utiliser `updateRuleMessage`. Conservé le temps de migrer les appelants. */
export async function updateRuleSmsBody(id: string, body: string): Promise<void> {
  return updateRuleMessage(id, 'send_sms', body);
}

// seedDefaultPresets() a été retiré (audit 2026-07-31).
//
// Il appelait seed_automation_presets(), dont le droit d'exécution a été retiré
// à `authenticated` le 2026-05-13 par 20260513020000_security_p0_fixes.sql —
// délibérément, la fonction étant réservée aux admins. L'appel restait donc
// branché dans le vide depuis deux mois et demi, échouant en 42501 avalé par un
// console.warn.
//
// Aucun composant ne l'appelait, et surtout il était REDONDANT : le trigger
// `trg_org_created_seed_automations` sur la table `orgs` sème déjà les presets
// à la création de l'organisation, en SECURITY DEFINER. La fonctionnalité
// marche donc sans ce chemin manuel.
//
// Si un ensemencement manuel redevient nécessaire, le passer par une route
// serveur avec contrôle admin explicite — ne PAS re-accorder le droit à
// `authenticated`.

/* ── Échecs d'automatisation ──────────────────────────────────────
   Le moteur journalise chaque exécution dans `automation_execution_logs`,
   mais AUCUNE page ne lisait cette table : une automatisation cassée restait
   affichée « active » avec un badge vert, et l'utilisateur n'apprenait jamais
   que ses clients n'avaient rien reçu. */

export interface AutomationFailure {
  id: string;
  automation_rule_id: string | null;
  action_type: string;
  result_error: string | null;
  entity_type: string | null;
  created_at: string;
}

/**
 * Échecs d'exécution des 7 derniers jours, les plus récents d'abord.
 *
 * Lecture seule, cloisonnée par l'org courante et par la RLS de la table.
 */
export async function getRecentAutomationFailures(limit = 50): Promise<AutomationFailure[]> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return [];

  const depuis = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('automation_execution_logs')
    .select('id, automation_rule_id, action_type, result_error, entity_type, created_at')
    .eq('org_id', orgId)
    .eq('result_success', false)
    .gte('created_at', depuis)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []) as AutomationFailure[];
}

/** Nombre d'échecs par règle sur 7 jours — pour le badge d'alerte de la liste. */
export async function getFailureCountsByRule(): Promise<Record<string, number>> {
  const failures = await getRecentAutomationFailures(200);
  const counts: Record<string, number> = {};
  for (const f of failures) {
    if (!f.automation_rule_id) continue;
    counts[f.automation_rule_id] = (counts[f.automation_rule_id] || 0) + 1;
  }
  return counts;
}

/**
 * Identité de l'entreprise, pour l'aperçu des courriels d'automatisation.
 *
 * Le serveur enveloppe chaque envoi dans `buildEmailLayout` (logo, en-tête,
 * pied de page) — exactement comme pour une facture ou un devis. Sans ces
 * données, l'éditeur montrerait un message « nu » alors qu'il arrivera habillé
 * chez le client.
 */
export interface ApercuEntreprise {
  company_name: string | null;
  company_logo_url: string | null;
  company_phone: string | null;
  /** Le pied du courriel affiche le téléphone ET le courriel, cliquables. */
  company_email: string | null;
}

export async function getCompanyBranding(): Promise<ApercuEntreprise> {
  const vide = { company_name: null, company_logo_url: null, company_phone: null, company_email: null };
  const orgId = await getCurrentOrgId();
  if (!orgId) return vide;

  const { data, error } = await supabase
    .from('company_settings')
    .select('company_name, logo_url, phone, email')
    .eq('org_id', orgId)
    .maybeSingle();

  // Un aperçu sans logo reste utile : on ne bloque pas l'éditeur pour ça.
  if (error || !data) return vide;
  return {
    company_name: data.company_name ?? null,
    company_logo_url: data.logo_url ?? null,
    company_phone: data.phone ?? null,
    company_email: data.email ?? null,
  };
}

/**
 * Langue des communications automatiques de l'org (company_settings.
 * default_language). Détermine si les SMS/courriels d'automatisation partent
 * en français ou en anglais chez les clients. Défaut 'fr'.
 */
export async function getAutomationLanguage(): Promise<'fr' | 'en'> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return 'fr';
  const { data, error } = await supabase
    .from('company_settings')
    .select('default_language')
    .eq('org_id', orgId)
    .maybeSingle();
  // Une lecture RATÉE n'est pas « français » : l'erreur était ignorée, et un
  // bureau anglophone voyait « FR » surligné pendant une panne (audit du
  // 2026-10-01). Les écrans attrapent l'erreur et disent qu'ils ne savent pas.
  if (error) throw new Error(error.message);
  return data?.default_language === 'en' ? 'en' : 'fr';
}

export async function setAutomationLanguage(lang: 'fr' | 'en'): Promise<void> {
  const orgId = await getCurrentOrgId();
  if (!orgId) throw new Error('No organization');
  /*
   * `.select()` : un rôle sans droit sur `company_settings` (membre avec
   * seulement `automations.update`) voyait sa mise à jour filtrée par la RLS
   * — 0 ligne, aucune erreur — et l'écran affichait « Messages en anglais »
   * alors que rien n'avait changé (audit V2, A-07).
   */
  const { data, error } = await supabase
    .from('company_settings')
    .update({ default_language: lang })
    .eq('org_id', orgId)
    .select('org_id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error(interfaceEnFrancais()
      ? 'Seul un administrateur peut changer la langue des messages. Rien n’a été modifié.'
      : 'Only an administrator can change the message language. Nothing was changed.');
  }
}

/**
 * Les demandes d'avis sont-elles ACTIVÉES pour ce bureau ?
 *
 * `company_settings.review_enabled` vaut FAUX par défaut, alors que le
 * préréglage « Demander un avis » est actif par défaut. Mesuré en prod le
 * 2026-09-25 : 6 entreprises sur 7 avaient une règle d'avis « Publiée »
 * qui échouait à CHAQUE exécution, sans que rien ne le montre.
 *
 * `null` = inconnu (lecture impossible) : l'appelant n'affiche alors rien,
 * plutôt qu'un avertissement peut-être faux.
 */
export async function avisActives(): Promise<boolean | null> {
  const orgId = await getCurrentOrgId();
  if (!orgId) return null;
  const { data, error } = await supabase
    .from('company_settings')
    .select('review_enabled')
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) {
    console.error('[automatisations] réglage des avis illisible', error.message);
    return null;
  }
  return data?.review_enabled === true;
}
