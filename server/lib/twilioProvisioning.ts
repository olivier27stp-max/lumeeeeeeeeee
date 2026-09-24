// Achat = client dédié (clé Restricted `TWILIO_PROVISIONING_API_KEY_*` si
// définie, sinon le client principal) — voir config.ts.
import { twilioProvisioningClient as twilioClient } from './config';
import { getServiceClient } from './supabase';
import { logger } from './logger';

/**
 * Levée quand Twilio a VENDU le numéro mais que son enregistrement en base a
 * échoué. Le numéro est payé et existe sur le compte : ne jamais en racheter un
 * autre — la relance doit seulement réenregistrer celui-ci (sid + numéro portés
 * par l'erreur, puis par la ligne `provisioning_events`).
 */
export class NumeroAcheteNonEnregistreError extends Error {
  constructor(
    public readonly twilioSid: string,
    public readonly phoneNumber: string,
    public readonly meta: Record<string, unknown>,
    cause: string,
  ) {
    super(`Numéro ${phoneNumber} acheté (${twilioSid}) mais non enregistré en base : ${cause}`);
    this.name = 'NumeroAcheteNonEnregistreError';
  }
}

/** Enregistre un numéro déjà acheté comme canal SMS de l'org (RPC idempotente côté org). */
async function enregistrerNumero(orgId: string, phoneNumber: string, meta: Record<string, unknown>): Promise<string> {
  const { data: channelId, error } = await getServiceClient().rpc('provision_sms_channel', {
    p_org_id: orgId,
    p_phone_number: phoneNumber,
    p_provider: 'twilio',
    p_metadata: meta,
  });
  if (error) throw error;
  return channelId as string;
}

/**
 * Purchase a Twilio phone number and provision it as the org's SMS channel.
 * Called server-side only — never from client.
 *
 * Auto-picks an area code from the org's address (city/region/postal) when possible.
 * Falls back from area code → country if no numbers are available locally.
 */
export async function provisionSmsNumber(orgId: string, options?: {
  areaCode?: string;
  country?: string;
}): Promise<{ channelId: string; phoneNumber: string }> {
  if (!twilioClient) {
    throw new Error('Twilio is not configured.');
  }

  const publicUrl = (process.env.PUBLIC_URL || process.env.TWILIO_WEBHOOK_BASE_URL || '').trim().replace(/\/$/, '');
  if (!publicUrl || !/^https?:\/\//.test(publicUrl) || publicUrl.includes('localhost')) {
    throw new Error('PUBLIC_URL must be set to a publicly reachable https:// URL before provisioning a Twilio number (got: ' + (publicUrl || 'empty') + ').');
  }

  // Resolve country + area code from org profile when not explicitly passed.
  const resolved = await resolveRegionForOrg(orgId);
  const country = (options?.country || resolved.country || 'CA').toUpperCase();
  const areaCode = options?.areaCode || resolved.areaCode || undefined;

  // Try with area code first, then without if nothing available
  let candidate = await findAvailableNumber(country, areaCode);
  if (!candidate && areaCode) {
    candidate = await findAvailableNumber(country, undefined);
  }
  if (!candidate) {
    throw new Error(`No SMS-capable numbers available for country=${country}${areaCode ? ` (tried area=${areaCode})` : ''}.`);
  }

  // Purchase the number with webhooks pre-wired. Voice volontairement non
  // configuré (SMS d'abord) : un numéro acheté par l'API n'a pas d'URL voix,
  // contrairement à un achat console qui pointe vers la démo Twilio.
  const purchased = await twilioClient.incomingPhoneNumbers.create({
    phoneNumber: candidate.phoneNumber,
    smsUrl: `${publicUrl}/api/messages/inbound`,
    smsMethod: 'POST',
    statusCallback: `${publicUrl}/api/messages/status`,
    statusCallbackMethod: 'POST',
    friendlyName: `Lume-${orgId.slice(0, 8)}`,
  });

  const meta = {
    twilio_sid: purchased.sid,
    friendly_name: purchased.friendlyName,
    country,
    area_code: areaCode || null,
  };
  try {
    const channelId = await enregistrerNumero(orgId, purchased.phoneNumber, meta);
    return { channelId, phoneNumber: purchased.phoneNumber };
  } catch (err: any) {
    throw new NumeroAcheteNonEnregistreError(purchased.sid, purchased.phoneNumber, meta, String(err?.message || err));
  }
}

// ─── Classement des échecs ─────────────────────────────────────────────
// Sert à l'alerte et au runbook, pas à décider s'il faut réessayer : tout
// échec est réessayé (un profil de conformité approuvé, une clé corrigée ou
// un stock renouvelé débloquent sans intervention sur le code).

export type NatureEchecProvisionnement =
  | 'conformite'      // Trust Hub / profil réglementaire non approuvé
  | 'permissions'     // clé API sans droit « Phone Numbers », jeton révoqué
  | 'inventaire'      // aucun numéro disponible
  | 'configuration'   // Twilio ou PUBLIC_URL absents côté serveur
  | 'enregistrement'  // numéro acheté, écriture en base échouée
  | 'autre';

export function classerEchecProvisionnement(err: unknown): NatureEchecProvisionnement {
  if (err instanceof NumeroAcheteNonEnregistreError) return 'enregistrement';
  const e = (err ?? {}) as { message?: unknown; code?: unknown; status?: unknown };
  const message = String(e.message ?? err ?? '');
  const code = Number(e.code);
  const status = Number(e.status);
  if (/^Twilio is not configured|^PUBLIC_URL must be set/.test(message)) return 'configuration';
  // Heuristique : Twilio ne documente pas un code unique pour « profil en
  // brouillon ». Le message brut est conservé dans provisioning_events pour
  // affiner ce motif au premier refus réel.
  if (/bundle|regulat|complian|customer profile|trust ?hub|end.?user|address.*required|identity/i.test(message)) {
    return 'conformite';
  }
  if (code === 20003 || code === 20403 || status === 401 || status === 403) return 'permissions';
  if (/^No SMS-capable numbers/.test(message) || code === 21422) return 'inventaire';
  return 'autre';
}

/**
 * Provisionne le numéro SMS d'une org qui vient de s'abonner, en journalisant
 * l'issue dans `provisioning_events`.
 *
 * Vivait auparavant dans `routes/payments.ts`, donc appelable UNIQUEMENT depuis
 * le webhook Stripe `checkout.session.completed`. Or le parcours d'abonnement
 * réellement emprunté en production est `POST /api/billing/subscribe`, qui ne
 * l'appelait jamais : mesuré en prod, les 5 orgs dont le forfait inclut les SMS
 * avaient toutes `stripe_checkout_session_id = NULL` et aucun numéro, et la
 * table `provisioning_events` était vide — non pas « en échec », mais jamais
 * atteinte. D'où l'extraction ici, pour que les deux chemins d'abonnement
 * partagent la même logique et la même observabilité.
 *
 * Ne lève jamais : l'échec est journalisé et signalé par la valeur de retour.
 * Un problème de numéro ne doit pas faire échouer un paiement déjà encaissé
 * (côté webhook, un throw ferait rejouer Stripe et doublerait le provisioning).
 *
 * Idempotent : ne fait rien si l'org a déjà un canal SMS actif, ni si une
 * demande est déjà en file pour elle (rejeu du webhook, double parcours).
 *
 * Un échec ne fait PAS échouer l'abonnement : la demande passe en `retrying`
 * (= org « phone_provisioning_pending ») et `relancerProvisionnementsEnAttente`
 * la reprend avec un délai croissant. L'achat est OBLIGATOIRE par défaut ; seul
 * l'arrêt d'urgence `TWILIO_AUTO_PROVISION=false` le suspend : la demande est
 * alors mise en file et servie dès qu'on le retire — aucun abonné n'est perdu.
 */
export async function provisionSmsForNewSubscription(params: {
  orgId: string;
  subscriptionId: string;
}): Promise<{ provisioned: boolean; phoneNumber?: string; skipped?: string; error?: string; nature?: NatureEchecProvisionnement }> {
  const { orgId, subscriptionId } = params;
  const admin = getServiceClient();

  // Numéro encore en attente de libération (ré-abonnement pendant le délai de
  // grâce) : on le réactive au lieu d'en acheter un second.
  try {
    const { cancelSmsNumberRelease } = await import('./twilioRelease');
    if (await cancelSmsNumberRelease(orgId)) {
      logger.info(`[provisioning] Org ${orgId} re-subscribed — restored its existing number`);
      return { provisioned: false, skipped: 'restored_pending_release' };
    }
  } catch (err: any) {
    console.error('[provisioning] Failed to check pending release:', err?.message);
  }

  const { data: existingChannel } = await admin
    .from('communication_channels')
    .select('id, phone_number')
    .eq('org_id', orgId)
    .eq('channel_type', 'sms')
    .eq('status', 'active')
    .maybeSingle();

  if (existingChannel) {
    logger.info(`[provisioning] Org ${orgId} already has SMS channel, skipping`, { phone: existingChannel.phone_number });
    return { provisioned: false, skipped: 'already_has_channel', phoneNumber: existingChannel.phone_number };
  }

  const { data: enFile } = await admin
    .from('provisioning_events')
    .select('id')
    .eq('org_id', orgId)
    .eq('event_type', TYPE_EVENEMENT)
    .in('status', ['pending', 'retrying'])
    .limit(1)
    .maybeSingle();
  if (enFile) {
    logger.info(`[provisioning] Org ${orgId} already has a queued number request, skipping`);
    return { provisioned: false, skipped: 'already_queued' };
  }

  const actif = autoProvisionActif();

  // Journalise l'intention AVANT l'achat : un échec Twilio laisse ainsi une
  // ligne exploitable, au lieu de disparaître.
  const { data: eventRow, error: logErr } = await admin
    .from('provisioning_events')
    .insert({
      org_id: orgId,
      subscription_id: subscriptionId,
      event_type: TYPE_EVENEMENT,
      status: actif ? 'pending' : 'retrying',
      // attempt_count = achats réellement TENTÉS ; une mise en file n'en est pas un.
      attempt_count: actif ? 1 : 0,
      metadata: { source: 'abonnement', ...(actif ? {} : { nature: 'desactive' }) },
    })
    .select(COLONNES_EVENEMENT)
    .single();

  // L'erreur d'insert n'était pas testée auparavant : si l'écriture échouait,
  // tout le provisionnement se déroulait sans laisser la moindre trace.
  if (logErr) {
    console.error('[provisioning] provisioning_events insert failed (l’issue ne sera pas tracée):', logErr.message);
  }

  if (!actif) {
    await alerterEquipe(
      `abonnement avec SMS en attente de numéro (achat coupé : TWILIO_AUTO_PROVISION=false) — ${await libelleOrg(orgId)}`,
      { orgId, subscriptionId },
    );
    return { provisioned: false, skipped: 'auto_provision_off' };
  }

  return tenterProvisionnement(admin, (eventRow as EvenementProvisionnement | null) ?? null, orgId, subscriptionId);
}

// ─── File d'attente et relance ─────────────────────────────────────────

const TYPE_EVENEMENT = 'sms_number_purchase';
const COLONNES_EVENEMENT = 'id, org_id, subscription_id, status, attempt_count, twilio_sid, twilio_number, metadata, created_at, updated_at';

/** Au-delà (depuis le 1er essai réel), la relance s'arrête : statut terminal `failed` + alerte. */
export const PROVISIONNEMENT_ABANDON_JOURS = 14;
/** Une ligne `pending` plus vieille que ça vient d'un processus mort en plein achat. */
const PENDING_ORPHELIN_MS = 30 * 60_000;

type EvenementProvisionnement = {
  id: string;
  org_id: string;
  subscription_id: string | null;
  status: string;
  attempt_count: number;
  twilio_sid: string | null;
  twilio_number: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
  updated_at: string;
};

/**
 * Achat automatique : ACTIF par défaut (tout forfait avec SMS reçoit son numéro).
 * `TWILIO_AUTO_PROVISION=false` est un arrêt d'urgence : les demandes sont alors
 * mises en file et servies dès qu'on le retire.
 */
export function autoProvisionActif(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.TWILIO_AUTO_PROVISION || '').trim().toLowerCase() !== 'false';
}

/** Délai avant l'essai suivant le n-ième : 15 min, 1 h, 4 h, 16 h, puis 24 h. */
export function delaiAvantRelanceMs(tentatives: number): number {
  return Math.min(24 * 3600_000, 15 * 60_000 * 4 ** Math.max(0, tentatives - 1));
}

async function libelleOrg(orgId: string): Promise<string> {
  const { data } = await getServiceClient().from('orgs').select('name').eq('id', orgId).maybeSingle();
  return data?.name ? `« ${data.name} » (${orgId})` : `org ${orgId}`;
}

/** Journal + canal #support Slack s'il est configuré. N'échoue jamais. */
async function alerterEquipe(texte: string, contexte: Record<string, unknown>): Promise<void> {
  logger.warn(`[provisioning] ${texte}`, contexte);
  try {
    const { isSlackConfigured, canalSupport, envoyerMessageSlack } = await import('./slack');
    if (isSlackConfigured()) {
      await envoyerMessageSlack({ channel: canalSupport(), text: `:telephone_receiver: Numéro SMS — ${texte}` });
    }
  } catch (err: any) {
    console.error('[provisioning] alerte Slack non envoyée:', err?.message);
  }
}

async function tenterProvisionnement(
  admin: ReturnType<typeof getServiceClient>,
  evt: EvenementProvisionnement | null,
  orgId: string,
  subscriptionId: string | null,
): Promise<{ provisioned: boolean; phoneNumber?: string; error?: string; nature?: NatureEchecProvisionnement }> {
  const tentatives = evt?.attempt_count || 1;
  const premierEssai: string = evt?.metadata?.premier_essai || new Date().toISOString();

  try {
    let phoneNumber: string;
    if (evt?.twilio_sid && evt.twilio_number) {
      // Numéro déjà PAYÉ lors d'un essai précédent (écriture en base échouée) :
      // on l'enregistre, on n'en rachète surtout pas un second.
      await enregistrerNumero(orgId, evt.twilio_number, {
        ...(evt.metadata?.numero_achete || {}),
        twilio_sid: evt.twilio_sid,
      });
      phoneNumber = evt.twilio_number;
    } else {
      phoneNumber = (await provisionSmsNumber(orgId)).phoneNumber;
    }

    if (evt) {
      const { error } = await admin
        .from('provisioning_events')
        .update({ status: 'success', twilio_number: phoneNumber, error_message: null })
        .eq('id', evt.id);
      if (error) console.error('[provisioning] succès non tracé dans provisioning_events:', error.message);
    }
    logger.info(`[provisioning] SMS number assigned to org ${orgId}`, { phone: phoneNumber, tentatives });
    if (tentatives > 1) {
      await alerterEquipe(`numéro ${phoneNumber} attribué après ${tentatives} essais — ${await libelleOrg(orgId)}`, { orgId });
    }
    return { provisioned: true, phoneNumber };
  } catch (err: any) {
    const message = String(err?.message || err).slice(0, 500);
    const nature = classerEchecProvisionnement(err);
    const achete = err instanceof NumeroAcheteNonEnregistreError ? err : null;
    const abandon = Date.now() - new Date(premierEssai).getTime() > PROVISIONNEMENT_ABANDON_JOURS * 86400_000;

    if (evt) {
      const { error } = await admin
        .from('provisioning_events')
        .update({
          status: abandon ? 'failed' : 'retrying',
          error_message: message,
          ...(achete ? { twilio_sid: achete.twilioSid, twilio_number: achete.phoneNumber } : {}),
          metadata: {
            ...(evt.metadata || {}),
            nature,
            premier_essai: premierEssai,
            prochain_essai: abandon ? null : new Date(Date.now() + delaiAvantRelanceMs(tentatives)).toISOString(),
            ...(achete ? { numero_achete: achete.meta } : {}),
          },
        })
        .eq('id', evt.id);
      if (error) {
        console.error('[provisioning] échec non tracé dans provisioning_events:', error.message);
        // Sans cette trace, la relance rachèterait un numéro déjà payé.
        if (achete) {
          await alerterEquipe(
            `CRITIQUE — ${achete.phoneNumber} (${achete.twilioSid}) acheté mais ni enregistré ni tracé : à rattacher à la main — ${await libelleOrg(orgId)}`,
            { orgId },
          );
        }
      }
    }

    console.error(`[provisioning] SMS provisioning failed for org ${orgId} (${nature}, essai ${tentatives}):`, message);
    // Remonté à Sentry : un client vient de payer un forfait avec SMS et
    // n'obtient pas son numéro. C'est exactement le genre d'échec qui est
    // resté invisible pendant des mois — 4 orgs payantes sans numéro, sans
    // aucune alerte.
    try {
      const { captureException } = await import('./sentry');
      captureException(err, { kind: 'sms_provisioning_failed', orgId, subscriptionId, nature, tentatives });
    } catch { /* no-op */ }

    // Une alerte au premier échec et à l'abandon — pas à chaque relance.
    if (tentatives === 1 || abandon || achete) {
      const suite = abandon ? 'ABANDON après ' + PROVISIONNEMENT_ABANDON_JOURS + ' jours, action manuelle requise' : 'relance automatique prévue';
      await alerterEquipe(`échec (${nature}) — ${await libelleOrg(orgId)} — ${suite}. Twilio : ${message}`, { orgId, nature });
    }
    return { provisioned: false, error: message, nature };
  }
}

/**
 * Reprend les demandes en file (`retrying`, ou `pending` orphelines) dont le
 * délai est échu. Appelée périodiquement sous verrou consultatif (index.ts).
 * Ne fait rien si `TWILIO_AUTO_PROVISION=false` (arrêt d'urgence).
 */
export async function relancerProvisionnementsEnAttente(): Promise<{
  desactive?: boolean;
  essayes: number;
  reussis: number;
  resolus: number;
  abandonnes: number;
  ignores: number;
}> {
  const bilan = { essayes: 0, reussis: 0, resolus: 0, abandonnes: 0, ignores: 0 };
  if (!autoProvisionActif()) return { desactive: true, ...bilan };

  const admin = getServiceClient();
  const { data, error } = await admin
    .from('provisioning_events')
    .select(COLONNES_EVENEMENT)
    .eq('event_type', TYPE_EVENEMENT)
    .in('status', ['retrying', 'pending'])
    .order('created_at', { ascending: true })
    .limit(25);
  if (error) throw new Error(`provisioning_events illisible : ${error.message}`);

  const maintenant = Date.now();
  for (const evt of (data || []) as EvenementProvisionnement[]) {
    if (evt.status === 'pending' && maintenant - new Date(evt.updated_at).getTime() < PENDING_ORPHELIN_MS) {
      bilan.ignores++; // achat en cours dans un autre appel
      continue;
    }
    const prochain = evt.metadata?.prochain_essai;
    if (prochain && new Date(prochain).getTime() > maintenant) {
      bilan.ignores++;
      continue;
    }

    // Numéro obtenu entre-temps (bouton Réglages, support, restauration) : rien à acheter.
    const { data: canal } = await admin
      .from('communication_channels')
      .select('phone_number')
      .eq('org_id', evt.org_id)
      .eq('channel_type', 'sms')
      .eq('status', 'active')
      .maybeSingle();
    if (canal) {
      await admin
        .from('provisioning_events')
        .update({ status: 'success', twilio_number: canal.phone_number, metadata: { ...(evt.metadata || {}), resolu_par: 'canal_existant' } })
        .eq('id', evt.id);
      bilan.resolus++;
      continue;
    }

    // Plus de forfait avec SMS (annulation, rétrogradation) : on n'achète pas.
    // Sauf si un numéro a déjà été payé — il reste en file pour être rattaché.
    if (!evt.twilio_sid && !(await orgPlanIncludesSms(evt.org_id))) {
      await admin
        .from('provisioning_events')
        .update({ status: 'abandoned', metadata: { ...(evt.metadata || {}), resolu_par: 'forfait_sans_sms' } })
        .eq('id', evt.id);
      bilan.abandonnes++;
      continue;
    }

    // Prise de la ligne par comparaison-échange : deux passes concurrentes ne
    // peuvent pas acheter deux fois pour la même demande.
    const { data: pris } = await admin
      .from('provisioning_events')
      .update({ status: 'pending', attempt_count: (evt.attempt_count || 0) + 1 })
      .eq('id', evt.id)
      .eq('status', evt.status)
      .eq('attempt_count', evt.attempt_count)
      .select(COLONNES_EVENEMENT)
      .maybeSingle();
    if (!pris) {
      bilan.ignores++;
      continue;
    }

    bilan.essayes++;
    const r = await tenterProvisionnement(admin, pris as EvenementProvisionnement, evt.org_id, evt.subscription_id);
    if (r.provisioned) bilan.reussis++;
  }
  return bilan;
}

/**
 * État du numéro pour l'affichage (Réglages → Messagerie) : `en_attente` tant
 * qu'une demande est en file (= « phone_provisioning_pending »), `echec` si la
 * relance a abandonné. `null` s'il n'y a rien en cours.
 */
export async function etatProvisionnementSms(orgId: string): Promise<{
  statut: 'en_attente' | 'echec';
  nature: string | null;
  depuis: string;
} | null> {
  const { data } = await getServiceClient()
    .from('provisioning_events')
    .select('status, metadata, created_at')
    .eq('org_id', orgId)
    .eq('event_type', TYPE_EVENEMENT)
    .in('status', ['pending', 'retrying', 'failed'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    statut: data.status === 'failed' ? 'echec' : 'en_attente',
    nature: (data.metadata as any)?.nature ?? null,
    depuis: data.created_at,
  };
}

async function findAvailableNumber(country: string, areaCode?: string) {
  const params: Record<string, any> = { limit: 1, smsEnabled: true };
  if (areaCode) params.areaCode = areaCode;
  const list = await twilioClient!.availablePhoneNumbers(country).local.list(params);
  return list[0] || null;
}

/**
 * Get the active SMS channel for an org.
 */
export async function getOrgSmsChannel(orgId: string) {
  const serviceClient = getServiceClient();
  const { data } = await serviceClient
    .from('communication_channels')
    .select('id, phone_number, status, metadata')
    .eq('org_id', orgId)
    .eq('channel_type', 'sms')
    .eq('is_default', true)
    .eq('status', 'active')
    .maybeSingle();
  return data;
}

/**
 * Return the org's E.164 sending number, or throw a typed error if missing.
 * Multi-tenant model: every org has its OWN Twilio number — no shared fallback.
 * Callers should catch SmsNumberNotProvisionedError and return HTTP 409 with code.
 */
export class SmsNumberNotProvisionedError extends Error {
  code = 'sms_not_provisioned' as const;
  constructor(orgId: string) {
    super(`Organization ${orgId} has no active Twilio SMS number. Provision one before sending.`);
    this.name = 'SmsNumberNotProvisionedError';
  }
}

/**
 * Thrown when the org still owns a number but its current plan no longer
 * includes SMS (e.g. downgraded to Minimum). Callers return HTTP 403.
 */
export class SmsNotInPlanError extends Error {
  code = 'plan_excludes_sms' as const;
  constructor(orgId: string) {
    super(`Organization ${orgId} is on a plan that does not include SMS.`);
    this.name = 'SmsNotInPlanError';
  }
}

/**
 * True when at least one live subscription for the org is on a plan with SMS.
 * An org can briefly hold two live subscriptions mid-upgrade, so ANY match wins.
 */
export async function orgPlanIncludesSms(orgId: string): Promise<boolean> {
  const serviceClient = getServiceClient();

  // NOTE: `subscriptions.plan_id` has NO foreign key to `plans` (only
  // `scheduled_plan_id` does), so a PostgREST embed like `plans(includes_sms)`
  // silently resolves to null and would deny every paying org. Read the ids and
  // resolve the plans in a second query instead.
  const { data: subs, error: subErr } = await serviceClient
    .from('subscriptions')
    .select('plan_id')
    .eq('org_id', orgId)
    .in('status', ['active', 'trialing']);

  if (subErr) {
    // Fail closed on a lookup we cannot verify — never send on a guess.
    console.error(`[sms] Subscription lookup failed for org ${orgId}:`, subErr.message);
    return false;
  }

  const planIds = (subs || []).map((s: any) => s.plan_id).filter(Boolean);
  if (!planIds.length) return false;

  const { data: plans, error: planErr } = await serviceClient
    .from('plans')
    .select('id, includes_sms')
    .in('id', planIds);

  if (planErr) {
    console.error(`[sms] Plan lookup failed for org ${orgId}:`, planErr.message);
    return false;
  }

  return (plans || []).some((p: any) => p.includes_sms === true);
}

export async function getOrgSmsFromNumber(orgId: string): Promise<string> {
  const channel = await getOrgSmsChannel(orgId);
  if (!channel?.phone_number) throw new SmsNumberNotProvisionedError(orgId);

  // Owning a number is not enough — the plan must still include SMS. Without
  // this the front-end gate alone lets a downgraded org keep sending
  // (reminders, quotes, agreements) on a plan it no longer pays for.
  if (!(await orgPlanIncludesSms(orgId))) throw new SmsNotInPlanError(orgId);

  return channel.phone_number;
}

// ─── Region resolution ─────────────────────────────────────────────────
// Map the org's address (city/region/postal) to a Twilio country + area code.
// Conservative: if we can't confidently pick an area code, return country only.

async function resolveRegionForOrg(orgId: string): Promise<{ country: string | null; areaCode: string | null }> {
  const serviceClient = getServiceClient();
  // The org address lives in company_settings — `orgs` has no address columns.
  // Note the column is `province` (not `region`).
  const { data: settings, error } = await serviceClient
    .from('company_settings')
    .select('country, province, city, postal_code')
    .eq('org_id', orgId)
    .maybeSingle();

  if (error) {
    console.error(`[provisioning] Failed to read company_settings for org ${orgId}:`, error.message);
    return { country: null, areaCode: null };
  }
  if (!settings) return { country: null, areaCode: null };

  const country = normalizeCountry(settings.country);
  const areaCode = pickAreaCode({
    country,
    region: settings.province || null,
    city: settings.city || null,
    postal: settings.postal_code || null,
  });

  return { country, areaCode };
}

function normalizeCountry(raw: string | null | undefined): string {
  const v = String(raw || '').trim().toUpperCase();
  if (v === 'CA' || v === 'CAN' || v === 'CANADA') return 'CA';
  if (v === 'US' || v === 'USA' || v === 'UNITED STATES') return 'US';
  return v || 'CA';
}

/** Strip accents + collapse whitespace so "Montréal" and "Montreal" both match. */
function foldKey(raw: string | null): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickAreaCode(input: {
  country: string;
  region: string | null;
  city: string | null;
  postal: string | null;
}): string | null {
  const { country, city, region, postal } = input;

  if (country === 'CA') {
    // Canadian postal codes start with a letter-digit-letter triplet; first 3 chars = FSA
    const fsa = (postal || '').replace(/\s+/g, '').toUpperCase().slice(0, 3);
    if (fsa && CA_FSA_TO_AREA[fsa]) return CA_FSA_TO_AREA[fsa];

    const cityKey = foldKey(city).toLowerCase();
    if (cityKey && CA_CITY_TO_AREA[cityKey]) return CA_CITY_TO_AREA[cityKey];

    const regionKey = foldKey(region).toUpperCase();
    if (regionKey && CA_REGION_TO_AREA[regionKey]) return CA_REGION_TO_AREA[regionKey];
    return null;
  }

  if (country === 'US') {
    const zip3 = (postal || '').replace(/\D/g, '').slice(0, 3);
    if (zip3 && US_ZIP3_TO_AREA[zip3]) return US_ZIP3_TO_AREA[zip3];

    const cityKey = foldKey(city).toLowerCase();
    if (cityKey && US_CITY_TO_AREA[cityKey]) return US_CITY_TO_AREA[cityKey];

    const regionKey = foldKey(region).toUpperCase();
    if (regionKey && US_REGION_TO_AREA[regionKey]) return US_REGION_TO_AREA[regionKey];
    return null;
  }

  return null;
}

// ─── Canada area-code maps ─────────────────────────────────────────────
// Not exhaustive: covers major metro postal prefixes, cities, and province fallbacks.
// Twilio will fall back to country-wide search if the chosen area code has no inventory.

const CA_FSA_TO_AREA: Record<string, string> = {
  // Montréal (514/438)
  H1A: '514', H1B: '514', H1C: '514', H1E: '514', H1G: '514', H1H: '514', H1J: '514',
  H1K: '514', H1L: '514', H1M: '514', H1N: '514', H1P: '514', H1R: '514', H1S: '514',
  H1T: '514', H1V: '514', H1W: '514', H1X: '514', H1Y: '514', H1Z: '514',
  H2A: '514', H2B: '514', H2C: '514', H2E: '514', H2G: '514', H2H: '514', H2J: '514',
  H2K: '514', H2L: '514', H2M: '514', H2N: '514', H2P: '514', H2R: '514', H2S: '514',
  H2T: '514', H2V: '514', H2W: '514', H2X: '514', H2Y: '514', H2Z: '514',
  H3A: '514', H3B: '514', H3C: '514', H3E: '514', H3G: '514', H3H: '514', H3J: '514',
  H3K: '514', H3L: '514', H3M: '514', H3N: '514', H3P: '514', H3R: '514', H3S: '514',
  H3T: '514', H3V: '514', H3W: '514', H3X: '514', H3Y: '514', H3Z: '514',
  H4A: '514', H4B: '514', H4C: '514', H4E: '514', H4G: '514', H4H: '514', H4J: '514',
  // Laval (450/579)
  H7A: '450', H7B: '450', H7C: '450', H7E: '450', H7G: '450', H7H: '450', H7J: '450',
  // Montérégie / couronne sud — Longueuil, Brossard, Saint-Hubert, Saint-Bruno,
  // Mont-Saint-Hilaire, Beloeil, Saint-Hyacinthe, Granby, Sorel (450/579)
  J3A: '450', J3B: '450', J3E: '450', J3G: '450', J3H: '450', J3L: '450',
  J3M: '450', J3N: '450', J3P: '450', J3R: '450', J3V: '450', J3X: '450', J3Y: '450', J3Z: '450',
  J2A: '450', J2B: '450', J2C: '450', J2E: '450', J2G: '450', J2H: '450',
  J2J: '450', J2K: '450', J2L: '450', J2M: '450', J2N: '450', J2R: '450', J2S: '450', J2T: '450', J2W: '450', J2X: '450', J2Y: '450',
  J4B: '450', J4G: '450', J4H: '450', J4J: '450', J4K: '450', J4L: '450', J4M: '450',
  J4N: '450', J4P: '450', J4R: '450', J4S: '450', J4T: '450', J4V: '450', J4W: '450',
  J4X: '450', J4Y: '450', J4Z: '450',
  J5A: '450', J5B: '450', J5C: '450', J5J: '450', J5K: '450', J5L: '450', J5M: '450',
  J5R: '450', J5T: '450', J5V: '450', J5W: '450', J5X: '450', J5Y: '450', J5Z: '450',
  J6A: '450', J6E: '450', J6J: '450', J6K: '450', J6N: '450', J6R: '450', J6S: '450',
  J6T: '450', J6V: '450', J6W: '450', J6X: '450', J6Y: '450', J6Z: '450',
  J7A: '450', J7B: '450', J7C: '450', J7E: '450', J7G: '450', J7H: '450', J7J: '450',
  J7K: '450', J7L: '450', J7M: '450', J7N: '450', J7P: '450', J7R: '450', J7T: '450',
  J7V: '450', J7W: '450', J7X: '450', J7Y: '450', J7Z: '450',
  J0L: '450', J0J: '450',
  // Québec City (418/581)
  G1A: '418', G1B: '418', G1C: '418', G1E: '418', G1G: '418', G1H: '418', G1J: '418',
  G1K: '418', G1L: '418', G1M: '418', G1N: '418', G1P: '418', G1R: '418', G1S: '418',
  G1T: '418', G1V: '418', G1W: '418', G1X: '418', G1Y: '418',
  G2A: '418', G2B: '418', G2C: '418', G2E: '418', G2G: '418', G2J: '418', G2K: '418',
  G2L: '418', G2M: '418', G2N: '418',
  // Gatineau (819/873)
  J8P: '819', J8R: '819', J8T: '819', J8V: '819', J8X: '819', J8Y: '819', J8Z: '819',
  J9A: '819', J9B: '819', J9H: '819', J9J: '819',
  // Sherbrooke (819)
  J1E: '819', J1G: '819', J1H: '819', J1J: '819', J1K: '819', J1L: '819', J1M: '819', J1N: '819',
  // Toronto (416/647/437)
  M4A: '416', M4B: '416', M4C: '416', M4E: '416', M4G: '416', M4H: '416', M4J: '416',
  M4K: '416', M4L: '416', M4M: '416', M4N: '416', M4P: '416', M4R: '416', M4S: '416',
  M4T: '416', M4V: '416', M4W: '416', M4X: '416', M4Y: '416',
  M5A: '416', M5B: '416', M5C: '416', M5E: '416', M5G: '416', M5H: '416', M5J: '416',
  M5K: '416', M5L: '416', M5M: '416', M5N: '416', M5P: '416', M5R: '416', M5S: '416',
  M5T: '416', M5V: '416', M5W: '416', M5X: '416',
  // Vancouver (604/778/236)
  V5K: '604', V5L: '604', V5M: '604', V5N: '604', V5P: '604', V5R: '604', V5S: '604',
  V5T: '604', V5V: '604', V5W: '604', V5X: '604', V5Y: '604', V5Z: '604',
  V6A: '604', V6B: '604', V6C: '604', V6E: '604', V6G: '604', V6H: '604', V6J: '604',
  V6K: '604', V6L: '604', V6M: '604', V6N: '604', V6P: '604', V6R: '604', V6S: '604',
  V6T: '604', V6V: '604', V6W: '604', V6X: '604', V6Y: '604', V6Z: '604',
  // Calgary (403/587)
  T2A: '403', T2B: '403', T2C: '403', T2E: '403', T2G: '403', T2H: '403', T2J: '403',
  T2K: '403', T2L: '403', T2M: '403', T2N: '403', T2P: '403', T2R: '403', T2S: '403',
  T2T: '403', T2V: '403', T2W: '403', T2X: '403', T2Y: '403', T2Z: '403',
  T3A: '403', T3B: '403', T3C: '403', T3E: '403', T3G: '403', T3H: '403', T3J: '403',
  T3K: '403', T3L: '403', T3M: '403', T3N: '403', T3P: '403', T3R: '403',
};

const CA_CITY_TO_AREA: Record<string, string> = {
  'montreal': '514', 'montréal': '514',
  'laval': '450',
  'longueuil': '450',
  'brossard': '450',
  'saint-hubert': '450',
  'saint-bruno-de-montarville': '450',
  'mont-saint-hilaire': '450',
  'beloeil': '450',
  'chambly': '450',
  'saint-jean-sur-richelieu': '450',
  'saint-hyacinthe': '450',
  'granby': '450',
  'sorel-tracy': '450',
  'terrebonne': '450',
  'repentigny': '450',
  'blainville': '450',
  'mirabel': '450',
  'saint-jerome': '450',
  'salaberry-de-valleyfield': '450',
  'vaudreuil-dorion': '450',
  'quebec': '418', 'québec': '418', 'quebec city': '418',
  'gatineau': '819',
  'sherbrooke': '819',
  'trois-rivieres': '819', 'trois-rivières': '819',
  'saguenay': '418',
  'toronto': '416',
  'ottawa': '613',
  'mississauga': '905',
  'brampton': '905',
  'hamilton': '905',
  'london': '519',
  'kitchener': '519',
  'windsor': '519',
  'vancouver': '604',
  'surrey': '604',
  'burnaby': '604',
  'victoria': '250',
  'calgary': '403',
  'edmonton': '780',
  'winnipeg': '204',
  'regina': '306',
  'saskatoon': '306',
  'halifax': '902',
  'st. john\'s': '709',
};

const CA_REGION_TO_AREA: Record<string, string> = {
  QC: '514', QUEBEC: '514', 'QUÉBEC': '514',
  ON: '416', ONTARIO: '416',
  BC: '604', 'BRITISH COLUMBIA': '604',
  AB: '403', ALBERTA: '403',
  MB: '204', MANITOBA: '204',
  SK: '306', SASKATCHEWAN: '306',
  NS: '902', 'NOVA SCOTIA': '902',
  NB: '506', 'NEW BRUNSWICK': '506',
  NL: '709', 'NEWFOUNDLAND AND LABRADOR': '709',
  PE: '902', 'PRINCE EDWARD ISLAND': '902',
  YT: '867', YUKON: '867',
  NT: '867', 'NORTHWEST TERRITORIES': '867',
  NU: '867', NUNAVUT: '867',
};

// ─── US area-code maps ─────────────────────────────────────────────────
// ZIP3 prefix → major metro area code. Covers top US metros only.

const US_ZIP3_TO_AREA: Record<string, string> = {
  // NYC (212/646/917/718)
  '100': '212', '101': '212', '102': '212', '103': '212', '104': '212',
  // Brooklyn / Queens / Bronx
  '112': '718', '113': '718', '114': '718', '110': '718',
  // Los Angeles (213/323/310)
  '900': '213', '901': '213', '902': '310', '903': '310', '904': '310',
  // Chicago (312/773/872)
  '606': '312', '607': '312', '608': '312',
  // Houston (713/281/832)
  '770': '713', '771': '713', '772': '713',
  // Phoenix (602)
  '850': '602', '851': '602', '852': '602', '853': '602',
  // San Francisco (415)
  '941': '415', '940': '415',
  // Boston (617)
  '021': '617', '022': '617',
  // Miami (305/786)
  '331': '305', '332': '305', '333': '305',
  // Seattle (206)
  '980': '206', '981': '206', '982': '206',
  // Atlanta (404)
  '303': '404', '301': '404',
  // Dallas (214/469/972)
  '752': '214', '753': '214',
};

const US_CITY_TO_AREA: Record<string, string> = {
  'new york': '212', 'nyc': '212', 'manhattan': '212',
  'brooklyn': '718', 'queens': '718', 'bronx': '718',
  'los angeles': '213', 'la': '213',
  'chicago': '312',
  'houston': '713',
  'phoenix': '602',
  'philadelphia': '215',
  'san antonio': '210',
  'san diego': '619',
  'dallas': '214',
  'san jose': '408',
  'austin': '512',
  'jacksonville': '904',
  'fort worth': '817',
  'columbus': '614',
  'san francisco': '415', 'sf': '415',
  'indianapolis': '317',
  'seattle': '206',
  'denver': '303',
  'washington': '202', 'dc': '202',
  'boston': '617',
  'nashville': '615',
  'detroit': '313',
  'portland': '503',
  'memphis': '901',
  'oklahoma city': '405',
  'las vegas': '702',
  'louisville': '502',
  'baltimore': '410',
  'milwaukee': '414',
  'albuquerque': '505',
  'tucson': '520',
  'fresno': '559',
  'sacramento': '916',
  'atlanta': '404',
  'miami': '305',
  'minneapolis': '612',
  'kansas city': '816',
  'st louis': '314', 'saint louis': '314',
  'pittsburgh': '412',
  'cincinnati': '513',
  'cleveland': '216',
  'tampa': '813',
  'orlando': '407',
  'new orleans': '504',
};

const US_REGION_TO_AREA: Record<string, string> = {
  NY: '212', 'NEW YORK': '212',
  CA: '213', CALIFORNIA: '213',
  TX: '713', TEXAS: '713',
  FL: '305', FLORIDA: '305',
  IL: '312', ILLINOIS: '312',
  PA: '215', PENNSYLVANIA: '215',
  OH: '216', OHIO: '216',
  GA: '404', GEORGIA: '404',
  NC: '704', 'NORTH CAROLINA': '704',
  MI: '313', MICHIGAN: '313',
  NJ: '201', 'NEW JERSEY': '201',
  VA: '703', VIRGINIA: '703',
  WA: '206', WASHINGTON: '206',
  AZ: '602', ARIZONA: '602',
  MA: '617', MASSACHUSETTS: '617',
  TN: '615', TENNESSEE: '615',
  IN: '317', INDIANA: '317',
  MO: '314', MISSOURI: '314',
  MD: '410', MARYLAND: '410',
  WI: '414', WISCONSIN: '414',
  CO: '303', COLORADO: '303',
  MN: '612', MINNESOTA: '612',
  SC: '803', 'SOUTH CAROLINA': '803',
  AL: '205', ALABAMA: '205',
  LA: '504', LOUISIANA: '504',
  KY: '502', KENTUCKY: '502',
  OR: '503', OREGON: '503',
  OK: '405', OKLAHOMA: '405',
  CT: '203', CONNECTICUT: '203',
  IA: '515', IOWA: '515',
  MS: '601', MISSISSIPPI: '601',
  AR: '501', ARKANSAS: '501',
  KS: '316', KANSAS: '316',
  NV: '702', NEVADA: '702',
  UT: '801', UTAH: '801',
  NM: '505', 'NEW MEXICO': '505',
  NE: '402', NEBRASKA: '402',
  WV: '304', 'WEST VIRGINIA': '304',
  ID: '208', IDAHO: '208',
  HI: '808', HAWAII: '808',
  NH: '603', 'NEW HAMPSHIRE': '603',
  ME: '207', MAINE: '207',
  MT: '406', MONTANA: '406',
  RI: '401', 'RHODE ISLAND': '401',
  DE: '302', DELAWARE: '302',
  SD: '605', 'SOUTH DAKOTA': '605',
  ND: '701', 'NORTH DAKOTA': '701',
  AK: '907', ALASKA: '907',
  VT: '802', VERMONT: '802',
  WY: '307', WYOMING: '307',
  DC: '202',
};
