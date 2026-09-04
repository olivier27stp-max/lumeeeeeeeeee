/* ═══════════════════════════════════════════════════════════════
   Lume Agent — outils étendus (lecture large + écritures)
   ─────────────────────────────────────────────────────────────
   Complète le registre de tools.ts. Même contrat, mêmes règles :

   • Chaque outil de LECTURE interroge LA MÊME SOURCE que l'écran
     correspondant de l'application (la leçon du bug des jobs : deux
     sources = deux vérités, et l'agent passe pour un menteur).
   • `needsIdentity: true` = l'outil exige le client Supabase à
     l'identité de l'utilisateur (session OAuth). Pas de repli sur le
     service client : pour la paie, les finances ou les positions GPS,
     un repli contournerait les permissions par rôle. Mieux vaut une
     erreur claire qu'une fuite polie.
   • Chaque ÉCRITURE est idempotente : l'empreinte (outil + arguments)
     est posée dans `agent_actions` AVANT d'agir, et l'unicité est
     portée par un index de la base. Un agent qui retente reçoit le
     résultat de la première exécution — jamais un doublon, jamais un
     deuxième SMS.
   • Les montants écrits vont dans les colonnes *_cents UNIQUEMENT
     (total/subtotal/tax_total sont des projections par trigger) et
     sont plafonnés (MCP_MAX_AMOUNT_CENTS, défaut 10 000 $).
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'crypto';
import { getServiceClient } from '../supabase';
import { logSecurityEvent } from '../security';
import { twilioClient, getTwilioStatusCallbackUrl } from '../config';
import { normalizeE164, findOrCreateConversation } from '../helpers';
import { getOrgSmsFromNumber, SmsNumberNotProvisionedError, SmsNotInPlanError } from '../twilioProvisioning';
import {
  computePayPeriod, periodToIsoRange, computeEntryHours, DEFAULT_PAYROLL_SETTINGS,
  type PayrollSettings,
} from '../payroll';
import type { AgentTool, ToolContext } from './tools';

interface TaxLine { code: string; label: string; rate: number; enabled: boolean }

function calculerFinancesJob(
  items: Array<{ qty: number; unit_price_cents: number }>,
  taxLines: TaxLine[],
): { subtotal_cents: number; tax_cents: number; total_cents: number } {
  const subtotal_cents = items.reduce(
    (s, it) => s + Math.max(0, Math.round((Number(it.qty) || 0) * (Number(it.unit_price_cents) || 0))),
    0,
  );
  const tax_cents = taxLines
    .filter((t) => t.enabled && t.rate > 0)
    .reduce((s, t) => s + Math.round(subtotal_cents * (t.rate / 100)), 0);
  return { subtotal_cents, tax_cents, total_cents: subtotal_cents + tax_cents };
}

/* ── Garde-fous communs ────────────────────────────────────────── */

/** Plafond des montants qu'une écriture d'agent peut engager (cents). */
const PLAFOND_CENTS = (() => {
  const v = Number(process.env.MCP_MAX_AMOUNT_CENTS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 1_000_000; // 10 000 $
})();

function depassePlafond(totalCents: number): { error: string } | null {
  // Garde BILATÉRAL. Un total négatif trahit une quantité ou un prix négatif
  // (ex. quantity: -5) : on refuse plutôt que d'émettre un devis/facture à
  // montant négatif que le plafond haut ne voyait pas passer.
  if (totalCents < 0) {
    return {
      error: 'Le total est négatif — une quantité ou un prix est probablement négatif. '
        + 'Vérifie les articles (quantités et prix doivent être positifs) et recommence.',
    };
  }
  if (totalCents > PLAFOND_CENTS) {
    return {
      error: `Le montant (${(totalCents / 100).toFixed(2)} $) dépasse le plafond autorisé pour l'agent `
        + `(${(PLAFOND_CENTS / 100).toFixed(2)} $). Créez cette pièce dans Lume directement, `
        + `ou faites relever MCP_MAX_AMOUNT_CENTS par l'administrateur.`,
    };
  }
  return null;
}

/**
 * Quantité normalisée d'une ligne : un nombre fini STRICTEMENT positif, sinon
 * 1. Empêche une quantité négative (`-5`) ou zéro de produire un total
 * négatif/nul. À utiliser À LA FOIS pour le calcul du total (plafond) ET pour
 * l'insert, afin que les deux ne divergent jamais.
 */
function qtePositive(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Exige un champ texte non vide. Le schéma JSON-RPC déclare `required`, mais
 * il n'est PAS validé avant le handler : un client qui omet le champ ferait
 * `String(undefined)` = "undefined" inséré en base (donnée corrompue
 * silencieuse). On refuse proprement à la place. Renvoie la valeur nettoyée.
 */
function champRequis(v: any, nomLisible: string): string {
  const s = v == null ? '' : String(v).trim();
  if (!s) throw new Error(`${nomLisible} est requis — précise-le et réessaie.`);
  return s;
}

/**
 * Fuseau de l'entreprise. Le serveur (Railway) tourne en UTC : un
 * `new Date().toISOString().slice(0,10)` donne la date UTC, pas celle de
 * Québec. En soirée locale (déjà le lendemain en UTC), ça marquait des
 * factures « en retard » à tort et donnait le briefing du mauvais jour.
 * Même fuseau que le moteur d'automatisations (Intl, DST-safe, sans lib).
 */
const FUSEAU_ORG = 'America/Montreal';

/** Date du jour (YYYY-MM-DD) DANS le fuseau de l'entreprise, pas en UTC. */
function dateOrgAujourdhui(d: Date = new Date()): string {
  // en-CA + year/month/day → « 2026-09-03 » directement, en heure locale.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU_ORG, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/**
 * Décalage du fuseau de l'entreprise par rapport à UTC, en minutes, à un
 * instant donné (gère l'heure d'été). Ex. Montréal l'été = -240.
 */
function offsetOrgMinutes(d: Date): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: FUSEAU_ORG, timeZoneName: 'shortOffset',
  }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value || 'GMT-5';
  const m = s.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!m) return -300;
  const signe = m[1] === '-' ? -1 : 1;
  return signe * (Number(m[2]) * 60 + Number(m[3] || 0));
}

/**
 * Début et fin d'une journée LOCALE (fuseau org), exprimés en instants UTC
 * ISO — pour filtrer une colonne timestamptz sur « la journée d'aujourd'hui à
 * Québec » et non « la journée UTC ». jourYmd optionnel = un autre jour local.
 */
function bornesJourOrg(jourYmd?: string): { debut: string; fin: string; jour: string } {
  const jour = jourYmd || dateOrgAujourdhui();
  // Minuit local = minuit UTC de ce jour, moins l'offset local.
  const minuitUtcNaif = new Date(`${jour}T00:00:00Z`);
  const off = offsetOrgMinutes(minuitUtcNaif); // minutes (ex. -240)
  const debut = new Date(minuitUtcNaif.getTime() - off * 60_000);
  const fin = new Date(debut.getTime() + 86400_000 - 1000);
  return { debut: debut.toISOString(), fin: fin.toISOString(), jour };
}

/**
 * Plage de dates BORNÉE pour les lectures analytiques (feuilles de temps, paie,
 * stats terrain, finances). Sans borne, un `from` très ancien ramènerait des
 * années de lignes d'un coup. On rabote la fenêtre à `maxJours` (en reculant
 * le `from` depuis le `to`) et on renvoie un drapeau si on a dû tronquer, pour
 * que l'outil le signale honnêtement. Dates en `YYYY-MM-DD`.
 */
function plageBornee(
  fromArg: any,
  toArg: any,
  maxJours = 366,
): { from: string; to: string; tronquee: boolean } {
  const jour = (d: Date) => d.toISOString().slice(0, 10);
  // Défaut du `to` = aujourd'hui à Québec (colonnes de type `date`), pas la
  // date UTC — sinon « aujourd'hui » en soirée locale pointe le lendemain.
  const toD = new Date(`${String(toArg || dateOrgAujourdhui())}T12:00:00Z`);
  const to = Number.isNaN(toD.getTime()) ? new Date() : toD;
  const defautFrom = new Date(to.getTime() - 7 * 86400000);
  const fromD = fromArg ? new Date(`${String(fromArg)}T12:00:00Z`) : defautFrom;
  const from = Number.isNaN(fromD.getTime()) ? defautFrom : fromD;
  const planche = new Date(to.getTime() - maxJours * 86400000);
  const tronquee = from < planche;
  return { from: jour(tronquee ? planche : from), to: jour(to), tronquee };
}

const clamp = (n: any, def: number, max: number) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(Math.floor(v), max);
};

/** Même politique que tools.ts : jamais d'erreur brute vers le modèle. */
function erreurOutil(scope: string, err: any): { error: string } {
  console.error(`[agent-tool:${scope}]`, err?.message || err);
  // Message pour le MODÈLE, pas pour l'écran : il lui dit quoi raconter
  // (en langage d'exploitant) au lieu de le laisser broder sur le schéma.
  return { error: 'La consultation a échoué côté Lume. Dis-le simplement à l\u2019utilisateur, propose de réessayer, et s\u2019il y a un doute sur la connexion, suggère de reconnecter Lume dans les réglages de Claude.' };
}

/** JSON à clés triées : la même intention → la même empreinte, toujours. */
function stableStringify(v: any): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/**
 * Exécute une écriture UNE SEULE FOIS par (org, outil, arguments).
 *
 * L'empreinte est posée AVANT d'agir ; l'index unique de `agent_actions`
 * fait que deux requêtes identiques simultanées ne passent jamais toutes
 * les deux. Une retentative reçoit le résultat mémorisé de la première
 * exécution, marqué `deja_fait` pour que l'agent puisse le dire.
 * Si l'action échoue, l'empreinte est retirée : une vraie retentative
 * (après correction) reste possible.
 */
/**
 * À lever DEPUIS une action idempotente quand l'échec survient APRÈS qu'une
 * écriture en base a déjà eu lieu (point de non-retour franchi). Sans ça,
 * `executerIdempotent` libérerait l'empreinte et une retentative de Claude
 * recréerait les mêmes données → DOUBLON. Ici on GARDE l'empreinte : la
 * retentative tombe sur `deja_fait` et Claude explique la situation au lieu
 * de dupliquer. `message` décrit ce qui a été créé et ce qui reste à finir.
 */
class EffetPartiel extends Error {
  constructor(public resume: Record<string, any>) {
    super(String(resume.error || 'Action partiellement appliquée.'));
    this.name = 'EffetPartiel';
  }
}

/**
 * Traduit une erreur (souvent Postgres/Supabase, remontée par un `throw error`
 * de handler) en phrase d'EXPLOITANT. Le message brut — nom de contrainte,
 * « violates foreign key », code SQL — ne doit JAMAIS atteindre le modèle : les
 * instructions le lui interdisent d'affichage, mais mieux vaut ne pas le lui
 * donner du tout. Le détail reste dans les logs (appelant). On reconnaît les
 * cas courants ; tout le reste devient un message générique poli.
 */
function messageHumainErreur(e: any, contexte?: string): string {
  const brut = String(e?.message || e || '').toLowerCase();
  const code = String(e?.code || '');
  if (code === '23505' || brut.includes('duplicate key') || brut.includes('unique constraint')) {
    return 'Ça existe déjà — pas besoin de le recréer.';
  }
  if (code === '23503' || brut.includes('foreign key')) {
    return 'Un élément lié est introuvable (client, job ou pièce). Vérifie qu\'il existe encore et réessaie.';
  }
  if (code === '23502' || brut.includes('not-null') || brut.includes('violates not-null')) {
    return 'Il manque une information obligatoire. Précise-la et réessaie.';
  }
  if (code === '23514' || brut.includes('check constraint')) {
    return 'Une valeur n\'est pas dans les choix permis. Vérifie les entrées et réessaie.';
  }
  if (code === '42501' || brut.includes('permission denied') || brut.includes('not allowed') || brut.includes('row-level security') || brut.includes('rls')) {
    return 'Ton rôle dans Lume ne permet pas cette action.';
  }
  if (brut.includes('timeout') || brut.includes('timed out')) {
    return 'Ça a mis trop de temps à répondre. Réessaie dans un instant.';
  }
  // Rien de reconnu : message générique, JAMAIS le texte brut.
  return contexte
    ? `${contexte} n'a pas fonctionné côté Lume. Dis-le simplement et propose de réessayer.`
    : 'L\'action n\'a pas fonctionné côté Lume. Dis-le simplement et propose de réessayer.';
}

async function executerIdempotent(
  ctx: ToolContext,
  outil: string,
  args: Record<string, any>,
  action: () => Promise<Record<string, any>>,
): Promise<Record<string, any>> {
  const admin = getServiceClient();
  const argsHash = crypto.createHash('sha256').update(stableStringify(args)).digest('hex');

  const { data: posee, error: insErr } = await admin
    .from('agent_actions')
    .insert({ org_id: ctx.orgId, user_id: ctx.userId, outil, args_hash: argsHash })
    .select('id')
    .maybeSingle();

  if (insErr) {
    // 23505 = l'empreinte existe déjà : on renvoie le résultat mémorisé.
    if ((insErr as any).code === '23505') {
      const { data: existante } = await admin
        .from('agent_actions')
        .select('resultat, created_at')
        .eq('org_id', ctx.orgId).eq('outil', outil).eq('args_hash', argsHash)
        .maybeSingle();
      return {
        deja_fait: true,
        note: 'Cette action identique a déjà été tentée récemment — voici son résultat, rien n\'a été refait en double.',
        ...(existante?.resultat || {}),
      };
    }
    return erreurOutil(`${outil}:dedup`, insErr);
  }

  try {
    const resultat = await action();
    await admin.from('agent_actions').update({ resultat }).eq('id', posee!.id);
    logSecurityEvent({
      org_id: ctx.orgId, user_id: ctx.userId,
      event_type: 'agent_write_executed', severity: 'info', source: 'api',
      details: { outil, resultat: JSON.stringify(resultat).slice(0, 300) },
    });
    return resultat;
  } catch (e: any) {
    if (e instanceof EffetPartiel) {
      // Point de non-retour franchi : on NE libère PAS l'empreinte (sinon
      // doublon à la retentative). On mémorise ce qui a été fait pour que
      // `deja_fait` le rejoue.
      await admin.from('agent_actions').update({ resultat: e.resume }).eq('id', posee!.id);
      logSecurityEvent({
        org_id: ctx.orgId, user_id: ctx.userId,
        event_type: 'agent_write_partial', severity: 'medium', source: 'api',
        details: { outil, resume: JSON.stringify(e.resume).slice(0, 300) },
      });
      return e.resume;
    }
    // Échec "propre" (avant toute écriture) : libérer l'empreinte, une vraie
    // retentative après correction reste possible.
    await admin.from('agent_actions').delete().eq('id', posee!.id);
    // Le message BRUT (Postgres, contrainte, code) reste dans les logs pour le
    // diagnostic ; le modèle, lui, ne reçoit qu'une phrase d'exploitant.
    console.error(`[agent-tool:${outil}] org=${ctx.orgId}`, e?.code || '', e?.message || e);
    // Une erreur déjà rédigée en français par un handler (throw new Error(...))
    // est humaine : on la garde. Une erreur Supabase/Postgres (avec .code ou du
    // jargon SQL) passe par la traduction.
    const dejaHumaine = e instanceof Error && !(e as any)?.code
      && !/constraint|violates|postgres|sql|null value|rls|row-level|permission denied/i.test(String(e.message || ''));
    return { error: dejaHumaine ? String(e.message).slice(0, 200) : messageHumainErreur(e) };
  }
}

/**
 * Étiquettes du statut CALCULÉ des jobs (jobs_active.derived_status) — le
 * statut que l'écran affiche. Partagée entre list_jobs (tools.ts) et le
 * profil client : une seule table, une seule vérité.
 */
// Libellés en FRANÇAIS : l'agent parle à un francophone, autant lui donner le
// mot juste plutôt que l'anglais brut qu'il devrait traduire. (Isolé au
// connecteur MCP ; le frontend a ses propres libellés dans StatusBadge.)
export const ETIQUETTES_DERIVED: Record<string, string> = {
  upcoming: 'à venir',
  late: 'en retard',
  action_required: 'action requise',
  archived: 'archivé',
  requires_invoicing: 'à facturer',
  scheduled: 'planifié',
  completed: 'terminé',
  in_progress: 'en cours',
  cancelled: 'annulé',
  draft: 'brouillon',
};

// Statuts traduits DANS le résultat, pour que l'agent n'ait rien à deviner.
export const STATUT_DEVIS: Record<string, string> = {
  draft: 'brouillon', awaiting_response: 'en attente de réponse',
  changes_requested: 'modifications demandées', approved: 'accepté',
  declined: 'refusé', expired: 'expiré', converted: 'converti en job',
  archived: 'archivé', sent: 'envoyé',
};
export const STATUT_FACTURE: Record<string, string> = {
  draft: 'brouillon', sent: 'envoyée', sent_not_due: 'envoyée (pas encore due)',
  past_due: 'en retard', overdue: 'en retard', paid: 'payée',
  partial: 'partiellement payée', partially_paid: 'partiellement payée',
  void: 'annulée', cancelled: 'annulée', uncollectible: 'irrécouvrable',
};
export const STATUT_ROLE: Record<string, string> = {
  owner: 'propriétaire', admin: 'administrateur',
  sales_rep: 'représentant', technician: 'technicien', manager: 'gestionnaire',
};
export const STATUT_LEAD: Record<string, string> = {
  new: 'nouveau', contacted: 'contacté', qualified: 'qualifié',
  proposal: 'proposition envoyée', won: 'gagné', closed_won: 'gagné',
  lost: 'perdu', closed_lost: 'perdu', unqualified: 'non qualifié',
};
export const STATUT_CLIENT: Record<string, string> = {
  active: 'client actif', inactive: 'inactif', lead: 'prospect',
  prospect: 'prospect', archived: 'archivé',
};
/** Traduit une valeur via un dictionnaire, en repli lisible si inconnue. */
export function traduireStatut(v: any, dico: Record<string, string>): string | null {
  if (v == null) return null;
  const s = String(v);
  return dico[s.toLowerCase()] || s.replace(/_/g, ' ');
}

/**
 * Taxes actives de l'org, mappées au format tax_lines des jobs — la même
 * source que l'écran Réglages › Taxes (table tax_configs). Le calcul des
 * montants passe ensuite par calculerFinancesJob (copie du calculateur de
 * l'app (module pur importé tel quel) : mêmes arrondis au cent.
 */
async function taxesParDefaut(ctx: ToolContext): Promise<TaxLine[]> {
  const { data } = await ctx.client
    .from('tax_configs')
    .select('id, name, rate, is_active, sort_order')
    .eq('org_id', ctx.orgId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(4);
  // tax_configs peut contenir des DOUBLONS (deux TPS, deux TVQ actives) —
  // l'app les évite en passant par les GROUPES de taxes ; nous, on lit la
  // table brute, donc on déduplique par (nom, taux). Sans ça : chaque taxe
  // comptée deux fois, total sur-taxé du double (bug remonté le 2026-09-03).
  const vues = new Set<string>();
  const taxes: TaxLine[] = [];
  for (const t of (data || [])) {
    const rate = Number(t.rate) || 0;
    const nom = String(t.name).trim();
    const cle = `${nom.toLowerCase()}|${rate}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    taxes.push({
      code: /tps|gst/i.test(nom) ? 'tps' : /tvq|qst|pst/i.test(nom) ? 'tvq' : String(t.id),
      label: nom,
      rate,
      enabled: true,
    });
  }
  return taxes;
}

/** Nom affichable d'un client (même logique que l'app). */
function nomClient(r: any): string {
  if (!r) return '';
  if (r.display_as_company && r.company) return String(r.company);
  return `${r.first_name || ''} ${r.last_name || ''}`.trim() || String(r.company || '');
}

/* ════════════════════════════════════════════════════════════════
   LECTURE — nouveaux domaines
   ════════════════════════════════════════════════════════════════ */

const getConversations: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_conversations',
    description:
      'List recent SMS conversations with clients: who, last message, when, unread count. '
      + 'Use get_conversation_messages to read a full thread.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Max conversations (default 15, max 30).' } },
    },
  },
  handler: async (args, ctx) => {
    const { data, error, count } = await ctx.client
      .from('conversations')
      .select('id, client_id, client_name, phone_number, last_message_text, last_message_at, unread_count', { count: 'exact' })
      .eq('org_id', ctx.orgId)
      .order('last_message_at', { ascending: false })
      .limit(clamp(args.limit, 15, 30));
    if (error) return erreurOutil('conversations', error);
    return {
      total_matching: count ?? data?.length ?? 0,
      returned: data?.length || 0,
      conversations: (data || []).map((c: any) => ({
        client_id: c.client_id, // interne : pour get_client_profile / get_conversation_messages
        client_name: c.client_name,
        phone_number: c.phone_number,
        last_message_text: c.last_message_text,
        last_message_at: c.last_message_at,
        unread_count: c.unread_count,
      })),
    };
  },
};

const getConversationMessages: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_conversation_messages',
    description:
      'Read the SMS thread with one client. Provide client_id (preferred) or phone_number. '
      + 'Returns the most recent messages with direction (inbound = the client wrote).',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client id (from search_clients).' },
        phone_number: { type: 'string', description: 'Phone number if no client_id.' },
        limit: { type: 'integer', description: 'Max messages (default 20, max 50).' },
      },
    },
  },
  handler: async (args, ctx) => {
    let conv = ctx.client
      .from('conversations')
      .select('id, client_name, phone_number')
      .eq('org_id', ctx.orgId)
      .limit(1);
    if (args.client_id) conv = conv.eq('client_id', String(args.client_id));
    else if (args.phone_number) conv = conv.eq('phone_number', normalizeE164(String(args.phone_number)));
    else return { error: 'Provide client_id or phone_number.' };

    const { data: c, error: e1 } = await conv.maybeSingle();
    if (e1) return erreurOutil('conversation', e1);
    if (!c) return { count: 0, messages: [], note: 'No conversation found for this client.' };

    const { data, error } = await ctx.client
      .from('messages')
      .select('direction, message_text, status, created_at')
      .eq('org_id', ctx.orgId)
      .eq('conversation_id', c.id)
      .order('created_at', { ascending: false })
      .limit(clamp(args.limit, 20, 50));
    if (error) return erreurOutil('messages', error);
    return {
      client_name: c.client_name, phone_number: c.phone_number,
      count: data?.length || 0,
      // Antichronologique en base → remis dans l'ordre de lecture.
      messages: (data || []).reverse(),
    };
  },
};

const getTeam: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_team',
    description:
      'List the team members: name, email, role, status. Returns the user_id needed by assign_job.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const { data, error } = await ctx.client
      .from('team_members')
      .select('user_id, first_name, last_name, email, role, status')
      .eq('org_id', ctx.orgId)
      .order('first_name', { ascending: true })
      .limit(200); // borne de sûreté — aucune équipe réaliste ne l'atteint
    if (error) return erreurOutil('team', error);
    return {
      count: data?.length || 0,
      members: (data || []).map((m) => ({
        user_id: m.user_id, // interne : pour assign_job / create_task
        name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
        email: m.email,
        role: traduireStatut(m.role, STATUT_ROLE),
        statut: m.status === 'active' ? 'actif' : (m.status === 'invited' ? 'invité' : m.status),
      })),
    };
  },
};

const getTimesheets: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_timesheets',
    description:
      'Hours worked per employee over a date range (default: last 7 days). '
      + 'Computed from punch-in/punch-out entries, breaks deducted — the same math as the Timesheets screen.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD (default: 7 days ago).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (default: today).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const { from, to, tronquee } = plageBornee(args.from, args.to, 366);
    const { data, error } = await ctx.client
      .from('time_entries')
      .select('employee_id, employee_name, date, punch_in, punch_out, breaks')
      .eq('org_id', ctx.orgId)
      .gte('date', from).lte('date', to)
      .order('date', { ascending: true })
      .limit(20000); // borne dure — au-delà, la plage est de toute façon trop large
    if (error) return erreurOutil('timesheets', error);

    const parEmploye = new Map<string, { name: string; hours: number; entries: number }>();
    for (const e of data || []) {
      const cle = String(e.employee_id || e.employee_name || '?');
      const cur = parEmploye.get(cle) || { name: e.employee_name || cle, hours: 0, entries: 0 };
      cur.hours += computeEntryHours(e as any);
      cur.entries += 1;
      parEmploye.set(cle, cur);
    }
    return {
      from, to,
      ...(tronquee ? { note: 'Plage limitée à 1 an ; précise from/to pour une période plus ancienne.' } : {}),
      employees: [...parEmploye.values()].map((v) => ({ ...v, hours: Math.round(v.hours * 100) / 100 })),
      total_hours: Math.round([...parEmploye.values()].reduce((s, v) => s + v.hours, 0) * 100) / 100,
    };
  },
};

const listTasks: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_tasks',
    description:
      "List the org's tasks (to-dos), optionally filtered by status ('open' or 'done'). Ordered by due date.",
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "Optional: 'open' (default) or 'done' or 'all'." },
        limit: { type: 'integer', description: 'Max tasks (default 20, max 40).' },
      },
    },
  },
  handler: async (args, ctx) => {
    let q = ctx.client
      .from('tasks_active')
      .select('id, title, description, status, priority, due_date, assignee_user_id, created_at', { count: 'exact' })
      .eq('org_id', ctx.orgId)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(clamp(args.limit, 20, 40));
    const statut = String(args.status || 'open');
    if (statut === 'open' || statut === 'done') q = q.eq('status', statut);
    const { data, error, count } = await q;
    if (error) return erreurOutil('tasks', error);

    // Résoudre les assignés en NOMS (l'UUID nu ne dit rien à l'utilisateur).
    const idsAssignes = [...new Set((data || []).map((t: any) => t.assignee_user_id).filter(Boolean))];
    const nomsAssignes = new Map<string, string>();
    if (idsAssignes.length) {
      const { data: membres } = await ctx.client
        .from('team_members').select('user_id, first_name, last_name')
        .eq('org_id', ctx.orgId).in('user_id', idsAssignes);
      for (const m of membres || []) {
        nomsAssignes.set(m.user_id, `${m.first_name || ''} ${m.last_name || ''}`.trim() || '—');
      }
    }
    const PRIO = { low: 'basse', medium: 'moyenne', high: 'haute' } as Record<string, string>;
    return {
      total_matching: count ?? data?.length ?? 0,
      returned: data?.length || 0,
      tasks: (data || []).map((t: any) => ({
        id: t.id, // interne : pour update_task_status
        title: t.title,
        description: t.description,
        statut: t.status === 'done' ? 'terminée' : 'à faire',
        priorite: PRIO[t.priority] || t.priority,
        echeance: t.due_date,
        assignee: t.assignee_user_id ? (nomsAssignes.get(t.assignee_user_id) || '—') : null,
      })),
    };
  },
};

const listRequestSubmissions: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_request_submissions',
    description:
      'Incoming request-form submissions (leads from the public form): who asked, contact info, when.',
    parameters: {
      type: 'object',
      properties: { limit: { type: 'integer', description: 'Max submissions (default 15, max 30).' } },
    },
  },
  handler: async (args, ctx) => {
    const { data, error } = await ctx.client
      .from('form_submissions')
      .select('id, first_name, last_name, company, email, phone, city, created_at')
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(clamp(args.limit, 15, 30));
    if (error) return erreurOutil('requests', error);
    return { count: data?.length || 0, submissions: data || [] };
  },
};

const getD2dStats: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_d2d_stats',
    description:
      'Door-to-door field sales stats over a period (default: last 30 days): knocks, leads, sales, '
      + 'revenue — total and per rep.',
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD (default: 30 days ago).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (default: today).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const { from, to } = plageBornee(args.from, args.to, 366);
    const { data, error } = await ctx.client
      .from('field_daily_stats')
      .select('user_id, date, knocks, leads, quotes_sent, sales, revenue_cents')
      .eq('org_id', ctx.orgId)
      .gte('date', from).lte('date', to)
      .limit(20000);
    if (error) return erreurOutil('d2d', error);

    const parRep = new Map<string, { knocks: number; leads: number; quotes_sent: number; sales: number; revenue_cents: number }>();
    const total = { knocks: 0, leads: 0, quotes_sent: 0, sales: 0, revenue_cents: 0 };
    for (const r of data || []) {
      const cur = parRep.get(r.user_id) || { knocks: 0, leads: 0, quotes_sent: 0, sales: 0, revenue_cents: 0 };
      for (const k of ['knocks', 'leads', 'quotes_sent', 'sales', 'revenue_cents'] as const) {
        cur[k] += Number((r as any)[k]) || 0;
        total[k] += Number((r as any)[k]) || 0;
      }
      parRep.set(r.user_id, cur);
    }
    // Noms depuis team_members — même source que l'écran terrain.
    const ids = [...parRep.keys()];
    const noms = new Map<string, string>();
    if (ids.length) {
      const { data: tm } = await ctx.client
        .from('team_members')
        .select('user_id, first_name, last_name')
        .eq('org_id', ctx.orgId)
        .in('user_id', ids);
      for (const m of tm || []) noms.set(m.user_id, `${m.first_name || ''} ${m.last_name || ''}`.trim());
    }
    return {
      from, to, total,
      per_rep: [...parRep.entries()].map(([uid, s]) => ({ user_id: uid, name: noms.get(uid) || null, ...s })),
    };
  },
};

const listCourses: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_courses',
    description: 'List the training courses of the org: title, category, status.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const { data, error } = await ctx.client
      .from('courses')
      .select('id, title, category, status, created_at')
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) return erreurOutil('courses', error);
    const ETAT: Record<string, string> = { draft: 'brouillon', published: 'publié', archived: 'archivé' };
    return {
      count: data?.length || 0,
      courses: (data || []).map((c: any) => ({
        title: c.title,
        categorie: c.category,
        statut: ETAT[c.status] || c.status,
      })),
    };
  },
};

const listAutomations: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_automations',
    description: 'List the automation rules: name, trigger event, active or not.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const { data, error } = await ctx.client
      .from('automation_rules')
      .select('id, name, trigger_event, is_active, is_preset')
      .eq('org_id', ctx.orgId)
      .order('name', { ascending: true })
      .limit(50);
    if (error) return erreurOutil('automations', error);
    return { count: data?.length || 0, automations: data || [] };
  },
};

/* ── Lecture SENSIBLE : identité obligatoire ─────────────────────
   Ces trois-là ne se replient JAMAIS sur le service client : les
   permissions par rôle de l'utilisateur (RLS) doivent s'appliquer.  */

const getPayrollSummary: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_payroll_summary',
    description:
      'Current pay period: dates, pay day, and hours per employee. Requires the caller to have '
      + 'payroll access in Lume — a member without it gets nothing, same as in the app.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const { data: reglages, error: e1 } = await ctx.client
      .from('payroll_settings')
      .select('pay_period_type, anchor_date, pay_day_offset, timezone')
      .eq('org_id', ctx.orgId)
      .maybeSingle();
    if (e1) return erreurOutil('payroll', e1);

    const settings: PayrollSettings = {
      org_id: ctx.orgId,
      ...(reglages || DEFAULT_PAYROLL_SETTINGS),
    } as PayrollSettings;
    const periode = computePayPeriod(settings);
    const { fromIso, toIso } = periodToIsoRange(periode);

    const { data: entrees, error: e2 } = await ctx.client
      .from('time_entries')
      .select('employee_id, employee_name, date, punch_in, punch_out, breaks')
      .eq('org_id', ctx.orgId)
      .gte('date', fromIso.slice(0, 10)).lte('date', toIso.slice(0, 10));
    if (e2) return erreurOutil('payroll', e2);

    const parEmploye = new Map<string, { name: string; hours: number }>();
    for (const e of entrees || []) {
      const cle = String(e.employee_id || e.employee_name || '?');
      const cur = parEmploye.get(cle) || { name: e.employee_name || cle, hours: 0 };
      cur.hours += computeEntryHours(e as any);
      parEmploye.set(cle, cur);
    }
    return {
      period: periode,
      employees: [...parEmploye.values()].map((v) => ({ ...v, hours: Math.round(v.hours * 100) / 100 })),
      note: 'Heures seulement — les commissions et ajustements se consultent dans Lume › Paie.',
    };
  },
};

const getFinancialOverview: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_financial_overview',
    description:
      'Financial overview: invoice KPIs (30 days), revenue collected this month, and job margins '
      + '(revenue vs recorded expenses) for completed jobs this month. Requires financial access in Lume.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    // Bornes du mois courant DANS le fuseau de l'entreprise : un « 1er du
    // mois » calculé en UTC peut tomber le dernier jour du mois précédent à
    // Québec, et fausser le mois affiché en début/fin de mois.
    const to = dateOrgAujourdhui();
    const from = `${to.slice(0, 7)}-01`;

    const [kpisR, serieR, jobsR] = await Promise.all([
      ctx.client.rpc('rpc_invoices_kpis_30d', { p_org: ctx.orgId }),
      ctx.client.rpc('rpc_insights_revenue_series', { p_org: ctx.orgId, p_from: from, p_to: to, p_granularity: 'month' }),
      ctx.client
        .from('jobs_active')
        .select('total_cents, expenses_cents')
        .eq('org_id', ctx.orgId)
        .eq('status', 'completed')
        .gte('completed_at', `${from}T00:00:00Z`),
    ]);
    if (kpisR.error) return erreurOutil('finances', kpisR.error);
    if (serieR.error) return erreurOutil('finances', serieR.error);
    if (jobsR.error) return erreurOutil('finances', jobsR.error);

    const kpis = Array.isArray(kpisR.data) ? kpisR.data[0] : kpisR.data;
    const revenus = (Array.isArray(serieR.data) ? serieR.data : [])
      .reduce((s: number, r: any) => s + (Number(r.revenue_cents) || 0), 0);
    const jobs = jobsR.data || [];
    const ca = jobs.reduce((s, j: any) => s + (Number(j.total_cents) || 0), 0);
    const depenses = jobs.reduce((s, j: any) => s + (Number(j.expenses_cents) || 0), 0);

    return {
      invoices_30d: kpis || {},
      revenue_this_month_cents: revenus,
      completed_jobs_this_month: {
        count: jobs.length,
        revenue_cents: ca,
        expenses_cents: depenses,
        margin_cents: ca - depenses,
        margin_pct: ca > 0 ? Math.round(((ca - depenses) / ca) * 1000) / 10 : null,
      },
    };
  },
};

const getTeamLocations: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_team_locations',
    description:
      'Last known GPS positions of team members currently tracked (fresh within 20 minutes). '
      + 'Only members who consented to tracking in Lume appear — the same consent rules as the live map.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const fraicheur = new Date(Date.now() - 20 * 60_000).toISOString();
    const { data, error } = await ctx.client
      .from('tracking_live_locations')
      .select('user_id, latitude, longitude, is_moving, tracking_status, job_id, updated_at')
      .eq('org_id', ctx.orgId)
      .gte('updated_at', fraicheur);
    if (error) return erreurOutil('gps', error);

    const ids = [...new Set((data || []).map((d) => d.user_id))];
    const noms = new Map<string, string>();
    if (ids.length) {
      const { data: tm } = await ctx.client
        .from('team_members')
        .select('user_id, first_name, last_name')
        .eq('org_id', ctx.orgId)
        .in('user_id', ids);
      for (const m of tm || []) noms.set(m.user_id, `${m.first_name || ''} ${m.last_name || ''}`.trim());
    }
    return {
      count: data?.length || 0,
      members: (data || []).map((d) => ({
        name: noms.get(d.user_id) || null,
        latitude: d.latitude, longitude: d.longitude,
        is_moving: d.is_moving, status: d.tracking_status,
        job_id: d.job_id, updated_at: d.updated_at,
      })),
      note: 'Positions récentes seulement (20 min). Un membre sans consentement de localisation n\'apparaît jamais.',
    };
  },
};

/* ════════════════════════════════════════════════════════════════
   ÉCRITURE — handlers
   Tous idempotents, tous à identité obligatoire, tous audités.
   Les quatre déclarations historiques (create_quote, create_invoice,
   create_job, send_sms) vivent dans tools.ts : leurs handlers sont
   exportés d'ici et attachés là-bas.
   ════════════════════════════════════════════════════════════════ */

export const handlerCreateJob = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'create_job', args, async () => {
    // LE pipeline complet de l'application (jobsApi.createJob), fidèlement :
    //   1. rpc_create_job_with_optional_schedule — job + première visite en
    //      un appel (numéro, statut, calendrier gérés par la base) ;
    //   2. file de géocodage — sans elle, le job n'apparaît pas sur la carte ;
    //   3. VRAIES lignes d'items dans job_line_items — pas un résumé en note ;
    //   4. finances par calculerFinancesJob (copie du calculateur de l'app) avec
    //      les taxes actives de l'org — cents uniquement, projections par
    //      trigger.
    const items: any[] = (Array.isArray(args.line_items) ? args.line_items : [])
      .filter((it) => String(it?.name || '').trim())
      .map((it) => ({
        name: String(it.name).trim().slice(0, 200),
        qty: Number.isFinite(Number(it.qty)) && Number(it.qty) > 0 ? Number(it.qty) : 1,
        unit_price_cents: Math.max(0, Math.round(Number(it.unit_price_cents) || 0)),
      }));

    const taxes: TaxLine[] = args.no_taxes ? [] : await taxesParDefaut(ctx);
    const finances = calculerFinancesJob(
      items.map((it) => ({ qty: it.qty, unit_price_cents: it.unit_price_cents })),
      taxes,
    );
    const cap = depassePlafond(finances.total_cents);
    if (cap) throw new Error(cap.error);

    // Nom et adresse du client, comme le fait l'application.
    let clientName: string | null = null;
    let clientAddress: string | null = null;
    if (args.client_id) {
      const { data: c, error } = await ctx.client
        .from('clients')
        .select('id, first_name, last_name, company, display_as_company, address')
        .eq('org_id', ctx.orgId).eq('id', String(args.client_id))
        .is('deleted_at', null).single();
      if (error || !c) throw new Error('Client introuvable — vérifiez le client_id avec search_clients.');
      clientName = nomClient(c) || null;
      clientAddress = c.address || null;
    }

    let debutISO: string | null = null;
    let finISO: string | null = null;
    if (args.scheduled_at) {
      const debut = new Date(String(args.scheduled_at));
      if (Number.isNaN(debut.getTime())) throw new Error('scheduled_at invalide (ISO attendu).');
      const fin_ = args.end_at ? new Date(String(args.end_at)) : new Date(debut.getTime() + 60 * 60_000);
      debutISO = debut.toISOString();
      finISO = fin_.toISOString();
    }

    // Adresse : celle fournie, sinon celle du client. Si elle semble
    // incomplète (ni virgule, ni chiffre de code postal) et qu'on a une
    // adresse client plus riche, on ne l'écrase pas mais on le SIGNALE —
    // un géocodage sur « 88 rue des Érables » sans ville tombe n'importe où.
    const adresse = String(args.property_address || clientAddress || '-');
    const adresseIncomplete = adresse !== '-'
      && args.property_address
      && !/,/.test(adresse)
      && !/\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/i.test(adresse)
      && !/\b(québec|montréal|laval|drummond|sherbrooke|gatineau|longueuil)\b/i.test(adresse);

    // 1. Création par LA RPC de l'app — job + visite éventuelle d'un coup.
    const { data: rpcData, error: rpcError } = await ctx.client.rpc('rpc_create_job_with_optional_schedule', {
      p_lead_id: args.lead_id || null,
      p_client_id: args.client_id || null,
      p_team_id: null,
      p_title: champRequis(args.title, 'Le titre').slice(0, 200),
      p_job_number: null,
      p_job_type: args.job_type ? String(args.job_type).slice(0, 80) : null,
      p_status: null,
      p_address: adresse,
      p_notes: args.description ? String(args.description).slice(0, 5000) : null,
      p_scheduled_at: debutISO,
      p_end_at: finISO,
      p_timezone: 'America/Montreal',
    });
    if (rpcError) throw rpcError;
    const jobId = String((rpcData as any)?.job_id || '');
    if (!jobId) throw new Error('Le job a été créé mais son id est introuvable.');

    // ── POINT DE NON-RETOUR ──────────────────────────────────────────────
    // Le job existe désormais en base. Les étapes 2-4 sont des ENRICHISSEMENTS
    // (géocodage, items, finances) sur ce même job : elles ne doivent JAMAIS
    // `throw`. Un throw ferait échouer l'action, libérerait l'empreinte
    // d'idempotence, et une retentative de Claude créerait un SECOND job. On
    // collecte plutôt les ratés dans `avertissements` et on renvoie le job
    // comme créé. (Pas de transaction possible : RPC + 3 updates séparés.)
    const avertissements: string[] = [];

    // 2. File de géocodage + nom du client. La RPC de création ne remplit
    //    pas jobs.client_name (l'app le passe à part) : on l'estampille ici.
    const patchApres: Record<string, any> = {};
    if (clientName) patchApres.client_name = clientName;
    if (adresse && adresse !== '-') {
      patchApres.geocode_status = 'pending';
      patchApres.geocoded_at = null;
      patchApres.latitude = null;
      patchApres.longitude = null;
    }
    if (Object.keys(patchApres).length) {
      const { error: geoErr } = await ctx.client.from('jobs').update(patchApres).eq('id', jobId).eq('org_id', ctx.orgId);
      if (geoErr) avertissements.push('le job n’apparaîtra peut-être pas tout de suite sur la carte (géocodage à relancer)');
    }

    // 3. Les vraies lignes d'items.
    let itemsPoses = items.length;
    if (items.length) {
      const lignes = items.map((it) => ({
        job_id: jobId,
        org_id: ctx.orgId,
        name: it.name,
        qty: it.qty,
        unit_price_cents: it.unit_price_cents,
        total_cents: Math.max(0, Math.round(it.qty * it.unit_price_cents)),
        included: true,
      }));
      const { error: itemsErr } = await ctx.client.from('job_line_items').insert(lignes);
      if (itemsErr) { itemsPoses = 0; avertissements.push('les articles n’ont pas pu être ajoutés — à saisir dans le job'); }
    }

    // 4. Finances — cents uniquement, projections par trigger.
    const { error: finErr } = await ctx.client.from('jobs')
      .update({
        subtotal_cents: finances.subtotal_cents,
        tax_cents: finances.tax_cents,
        total_cents: finances.total_cents,
        tax_lines: taxes,
      })
      .eq('id', jobId).eq('org_id', ctx.orgId);
    if (finErr) avertissements.push('le total et les taxes ne sont pas encore posés sur le job');

    const { data: final } = await ctx.client
      .from('jobs_active')
      .select('id, job_number, title, status, scheduled_at, property_address, derived_status')
      .eq('id', jobId).maybeSingle();

    const resume: Record<string, any> = {
      created: true,
      job: {
        id: jobId,
        job_number: final?.job_number,
        title: final?.title,
        display_status: ETIQUETTES_DERIVED[final?.derived_status] || final?.derived_status || final?.status,
        client: clientName,
        address: adresse !== '-' ? adresse : null,
      },
      visit: debutISO ? { start_at: debutISO, end_at: finISO } : null,
      items_count: itemsPoses,
      subtotal_cents: finances.subtotal_cents,
      tax_cents: finances.tax_cents,
      total_cents: finances.total_cents,
      taxes_appliquees: taxes.map((t) => `${t.label} ${t.rate} %`),
      address_warning: adresseIncomplete
        ? 'L\u2019adresse n\u2019a ni ville ni code postal — la carte risque de mal la situer. Demande à l\u2019utilisateur la ville pour un repérage fiable.'
        : undefined,
    };

    if (avertissements.length) {
      // Le job EST cree mais incomplet. On passe par EffetPartiel pour
      // VERROUILLER l'idempotence (aucun doublon si Claude reessaie) tout en
      // renvoyant un resultat exploitable et honnete.
      resume.incomplet = true;
      resume.note = `Job cree (n° ${final?.job_number || jobId.slice(0, 8)}), mais : ${avertissements.join(' ; ')}. `
        + 'Le job existe — ne le recree pas ; complete-le ou demande a l’utilisateur de le faire.'
        + (adresseIncomplete ? ' ' + resume.address_warning : '');
      throw new EffetPartiel(resume);
    }

    resume.note = (adresseIncomplete ? 'Adresse incomplète (voir address_warning). ' : '')
        + (debutISO
          ? 'Job complet : items, taxes, calendrier — et il apparaîtra sur la carte une fois géocodé.'
          : 'Job complet en brouillon (sans visite). Items et taxes posés ; planifie-le pour le mettre au calendrier.');
    return resume;
  });

export const handlerCreateClient = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'create_client', args, async () => {
    // Même RPC que l'application : validation et gestion des doublons
    // vivent en base, on ne les réinvente pas.
    const { data, error } = await ctx.client.rpc('create_client_with_duplicate_handling', {
      p_org_id: ctx.orgId,
      p_mode: 'add',
      p_payload: {
        first_name: String(args.first_name || '').trim(),
        last_name: String(args.last_name || '').trim(),
        company: args.company ? String(args.company).trim() : null,
        email: args.email ? String(args.email).trim() : null,
        email_label: 'main',
        phone: args.phone ? String(args.phone).trim() : null,
        phones: [],
        address: args.address ? String(args.address).trim() : null,
        billing_same_as_service: true,
        city: args.city ? String(args.city).trim() : null,
        status: 'active',
        display_as_company: Boolean(args.company && !args.first_name),
        lead_source: 'agent',
      },
      p_merge_duplicates: true,
    });
    if (error) throw error;
    const row: any = Array.isArray(data) ? data[0] : data;
    return { created: true, client: { id: row?.id, name: nomClient(row) } };
  });

export const handlerCreateTask = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'create_task', args, async () => {
    const priorite = ['low', 'medium', 'high'].includes(String(args.priority)) ? String(args.priority) : 'medium';
    const { data, error } = await ctx.client
      .from('tasks')
      .insert({
        org_id: ctx.orgId,
        created_by: ctx.userId,
        title: champRequis(args.title, 'Le titre').slice(0, 200),
        description: args.description ? String(args.description).slice(0, 5000) : null,
        status: 'open',
        priority: priorite,
        due_date: args.due_date || null,
        assignee_user_id: args.assignee_user_id || null,
      })
      .select('id, title, status, priority, due_date')
      .single();
    if (error) throw error;
    return { created: true, task: data };
  });

export const handlerUpdateJobStatus = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'update_job_status', args, async () => {
    const valides = ['draft', 'scheduled', 'in_progress', 'completed', 'cancelled'];
    const statut = String(args.status || '');
    if (!valides.includes(statut)) {
      throw new Error(`Statut invalide. Valeurs acceptées : ${valides.join(', ')}.`);
    }
    const patch: Record<string, any> = { status: statut };
    if (statut === 'completed') patch.completed_at = new Date().toISOString();
    const { data, error } = await ctx.client
      .from('jobs')
      .update(patch)
      .eq('org_id', ctx.orgId).eq('id', String(args.job_id))
      .is('deleted_at', null)
      .select('id, job_number, title, status')
      .single();
    if (error) throw error;
    return { updated: true, job: data };
  });

export const handlerAssignJob = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'assign_job', args, async () => {
    // Le destinataire doit être un membre réel de CETTE org.
    const { data: membre } = await ctx.client
      .from('team_members')
      .select('user_id, first_name, last_name')
      .eq('org_id', ctx.orgId).eq('user_id', String(args.assignee_user_id))
      .maybeSingle();
    if (!membre) throw new Error('Ce user_id n\'est pas membre de l\'équipe — vérifiez avec get_team.');

    const { data, error } = await ctx.client
      .from('jobs')
      .update({ assigned_user_id: membre.user_id })
      .eq('org_id', ctx.orgId).eq('id', String(args.job_id))
      .is('deleted_at', null)
      .select('id, job_number, title')
      .single();
    if (error) throw error;
    return {
      updated: true,
      job: data,
      assigned_to: `${membre.first_name || ''} ${membre.last_name || ''}`.trim(),
    };
  });

export const handlerCreateQuote = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'create_quote', args, async () => {
    const items: any[] = Array.isArray(args.line_items) ? args.line_items : [];
    if (!items.length) throw new Error('line_items est requis.');
    const totalCents = items.reduce(
      (s, it) => s + Math.round(qtePositive(it.quantity) * Math.max(0, Number(it.unit_price_cents) || 0)), 0);
    const cap = depassePlafond(totalCents);
    if (cap) throw new Error(cap.error);

    // Même RPC que l'écran « Nouveau devis » : numérotation et défauts en base.
    const { data: rpcResult, error: rpcError } = await ctx.client.rpc('rpc_create_quote', {
      p_lead_id: args.lead_id || null,
      p_client_id: args.client_id || null,
      p_title: champRequis(args.title, 'Le titre').slice(0, 200),
      p_salesperson_id: null,
      p_context_type: args.client_id ? 'client' : 'lead',
      p_currency: 'CAD',
      p_valid_days: clamp(args.valid_days, 30, 365),
      p_notes: args.notes ? String(args.notes) : null,
      p_contract: null,
      p_deposit_required: false,
      p_require_payment_method: false,
    });
    if (rpcError) throw rpcError;
    const quoteId = String((rpcResult as any)?.quote_id || '');
    if (!quoteId) throw new Error('Le devis a été créé mais son id est introuvable.');

    const lignes = items.map((it, i) => ({
      quote_id: quoteId,
      name: String(it.name).trim(),
      description: it.description ? String(it.description).slice(0, 2000) : null,
      quantity: qtePositive(it.quantity),
      unit_price_cents: Math.max(0, Math.round(Number(it.unit_price_cents) || 0)),
      total_cents: Math.round(qtePositive(it.quantity) * Math.max(0, Number(it.unit_price_cents) || 0)),
      sort_order: i,
      item_type: 'service',
      is_optional: false,
      discount_value: 0,
    }));
    const { error: itemsError } = await ctx.client.from('quote_line_items').insert(lignes);
    if (itemsError) throw itemsError;

    // Les totaux du devis sont recalculés PAR LA BASE, jamais à la main.
    const { error: recalcErr } = await ctx.client.rpc('rpc_recalculate_quote', { p_quote_id: quoteId });
    if (recalcErr) throw recalcErr;

    return { created: true, quote_id: quoteId, total_cents: totalCents, statut: 'brouillon' };
  });

export const handlerCreateInvoice = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'create_invoice', args, async () => {
    const items: any[] = Array.isArray(args.items) ? args.items : [];
    if (!items.length) throw new Error('items est requis.');
    // On calcule le total sur les MÊMES lignes que celles réellement insérées
    // (description non vide, qty > 0, prix >= 0) pour que le plafond vérifié et
    // le montant enregistré ne divergent jamais.
    const lignesRetenues = items
      .map((it) => ({
        description: String(it.description || '').trim(),
        qty: qtePositive(it.qty),
        unit_price_cents: Math.max(0, Math.round(Number(it.unit_price_cents) || 0)),
      }))
      .filter((it) => it.description && it.qty > 0 && it.unit_price_cents >= 0);
    if (!lignesRetenues.length) throw new Error('Aucune ligne valide (description, quantité > 0 et prix requis).');
    const totalCents = lignesRetenues.reduce(
      (s, it) => s + Math.round(it.qty * it.unit_price_cents), 0)
      + Math.max(0, Math.round(Number(args.tax_cents) || 0));
    const cap = depassePlafond(totalCents);
    if (cap) throw new Error(cap.error);

    // Mêmes RPC que l'écran « Nouvelle facture ». La facture reste en
    // BROUILLON : rien ne part chez le client — l'envoi se fait dans Lume.
    const { data: creation, error: e1 } = await ctx.client.rpc('rpc_create_invoice_draft', {
      p_client_id: String(args.client_id),
      p_subject: args.subject ? String(args.subject) : null,
      p_due_date: args.due_date || null,
    });
    if (e1) throw e1;
    const row: any = Array.isArray(creation) ? creation[0] : creation;
    const invoiceId = String(row?.id || '');
    if (!invoiceId) throw new Error('La facture a été créée mais son id est introuvable.');

    const { error: e2 } = await ctx.client.rpc('rpc_save_invoice_draft', {
      p_invoice_id: invoiceId,
      p_subject: args.subject ? String(args.subject) : null,
      p_due_date: args.due_date || null,
      p_tax_cents: Math.max(0, Math.round(Number(args.tax_cents) || 0)),
      p_discount_cents: 0,
      p_notes: null,
      p_internal_notes: 'Créée par l\'agent (MCP).',
      p_items: lignesRetenues,
    });
    if (e2) throw e2;

    return {
      created: true, invoice_id: invoiceId, statut: 'brouillon', total_cents: totalCents,
      note: 'Facture en BROUILLON — elle ne part pas chez le client. L\'envoi se fait depuis Lume.',
    };
  });

/**
 * Envoie UN SMS via le moteur de l'app (opt-out STOP, numéro de l'org, plan,
 * conversation, journalisation). Cœur partagé entre l'envoi solo et le lot
 * de relances — une seule copie des garde-fous, jamais deux.
 * Lève si l'envoi échoue ; renvoie l'id du message sinon.
 */
async function envoyerUnSms(
  ctx: ToolContext,
  telephoneBrut: string,
  texte: string,
  clientId?: string | null,
  clientNom?: string | null,
): Promise<{ message_id?: string; provider_sid: string }> {
  if (!twilioClient) throw new Error('Twilio n\u2019est pas configuré sur ce serveur.');
  const message = String(texte || '').trim();
  if (!message) throw new Error('message vide.');
  if (message.length > 1000) throw new Error('message trop long (max 1000).');
  const telephone = normalizeE164(String(telephoneBrut || ''));
  if (!telephone) throw new Error('numéro de téléphone invalide.');
  const admin = getServiceClient();

  const { data: optOut } = await admin
    .from('sms_opt_outs').select('id')
    .eq('org_id', ctx.orgId).eq('phone', telephone).maybeSingle();
  if (optOut) throw new Error('destinataire STOP — ne pas contacter.');

  let fromNumber: string;
  try {
    fromNumber = await getOrgSmsFromNumber(ctx.orgId);
  } catch (e) {
    if (e instanceof SmsNumberNotProvisionedError) throw new Error('Aucun numéro SMS pour cette organisation.');
    if (e instanceof SmsNotInPlanError) throw new Error('Le forfait n\u2019inclut pas les SMS.');
    throw e;
  }

  const conversation = await findOrCreateConversation(admin, ctx.orgId, telephone, clientId || undefined, clientNom || undefined);
  const statusCallback = getTwilioStatusCallbackUrl();
  const twilioMessage = await twilioClient.messages.create({
    body: message, from: fromNumber, to: telephone,
    ...(statusCallback ? { statusCallback } : {}),
  });
  const { data: msg } = await admin.from('messages').insert({
    conversation_id: conversation.id, org_id: ctx.orgId,
    client_id: conversation.client_id || clientId || null,
    phone_number: telephone, direction: 'outbound', message_text: message,
    status: 'sent', provider_message_id: twilioMessage.sid, sender_user_id: ctx.userId,
  }).select('id').single();
  return { message_id: msg?.id, provider_sid: twilioMessage.sid };
}

export const handlerSendSms = async (args: Record<string, any>, ctx: ToolContext) =>
  executerIdempotent(ctx, 'send_sms', args, async () => {
    // Tout passe par le noyau partagé (mêmes garde-fous que le lot de
    // relances) : opt-out STOP, numéro de l'org, plan, conversation, journal.
    const { message_id, provider_sid } = await envoyerUnSms(
      ctx,
      String(args.phone_number || ''),
      String(args.message_text || ''),
      args.client_id || null,
      args.client_name || null,
    );
    return { sent: true, to: normalizeE164(String(args.phone_number || '')), message_id, provider_sid };
  });

/* ── Nouvelles déclarations d'écriture ───────────────────────────── */

const createClientTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_client',
    description:
      'Create a client in the CRM. Duplicates are detected and merged by the same rule as the app. '
      + 'If several existing clients share the name the user gave, ask which one BEFORE creating.',
    parameters: {
      type: 'object',
      properties: {
        first_name: { type: 'string', description: 'First name.' },
        last_name: { type: 'string', description: 'Last name.' },
        company: { type: 'string', description: 'Company name (optional).' },
        email: { type: 'string', description: 'Email (optional).' },
        phone: { type: 'string', description: 'Phone (optional).' },
        address: { type: 'string', description: 'Service address (optional).' },
        city: { type: 'string', description: 'City (optional).' },
      },
      required: ['first_name', 'last_name'],
    },
  },
  handler: handlerCreateClient,
};

const createTaskTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_task',
    description: 'Create a task (to-do), optionally assigned to a team member (user_id from get_team).',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title.' },
        description: { type: 'string', description: 'Details (optional).' },
        due_date: { type: 'string', description: 'Due date YYYY-MM-DD (optional).' },
        priority: { type: 'string', description: "'low', 'medium' (default) or 'high'." },
        assignee_user_id: { type: 'string', description: 'Team member user_id (optional).' },
      },
      required: ['title'],
    },
  },
  handler: handlerCreateTask,
};

const updateJobStatusTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_job_status',
    description:
      "Change a job's status. Valid: draft, scheduled, in_progress, completed, cancelled. "
      + 'Get the job id from list_jobs first.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        status: { type: 'string', description: 'New status.' },
      },
      required: ['job_id', 'status'],
    },
  },
  handler: handlerUpdateJobStatus,
};

const assignJobTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'assign_job',
    description: 'Assign a job to a team member. Use get_team for the user_id, list_jobs for the job id.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        assignee_user_id: { type: 'string', description: 'Team member user_id.' },
      },
      required: ['job_id', 'assignee_user_id'],
    },
  },
  handler: handlerAssignJob,
};


/* ════════════════════════════════════════════════════════════════
   ASSISTANT — ce qui sépare « répond aux questions » de « assiste »
   ════════════════════════════════════════════════════════════════ */

/**
 * Rappelle une ROUTE de l'application au nom de l'utilisateur, avec sa
 * propre session. C'est ainsi que les envois (devis, facture) empruntent
 * le moteur existant — modèles de courriel, liens de partage, relances
 * automatiques, journalisation — au lieu d'en maintenir une copie qui
 * finirait par dériver.
 */
/**
 * Signale un appel interne dont la requête est partie mais dont la RÉPONSE
 * n'est jamais arrivée (timeout, connexion coupée). L'effet — un courriel
 * déjà envoyé, par exemple — est INCERTAIN : ni « fait » ni « pas fait ». Les
 * handlers d'envoi le convertissent en EffetPartiel pour NE PAS retenter (donc
 * ne jamais dupliquer un envoi au client).
 */
class AppelInterneIncertain extends Error {
  constructor(public cause: string) {
    super(cause);
    this.name = 'AppelInterneIncertain';
  }
}

/**
 * Construit l'EffetPartiel d'un envoi dont le résultat est incertain (la
 * requête est partie, la réponse n'est pas revenue). On GARDE l'empreinte
 * d'idempotence : Claude ne doit pas retenter — un second envoi au client est
 * irrattrapable. Message honnête : « peut-être parti, vérifie dans Lume ».
 */
function envoiIncertain(quoi: string): EffetPartiel {
  return new EffetPartiel({
    incertain: true,
    sent: null,
    note: `Je n'ai pas eu la confirmation que ${quoi} est bien parti — il a PEUT-ÊTRE été envoyé. `
      + `Ne le renvoie pas d'ici là : vérifie dans Lume si le client l'a reçu, et ne relance que si ce n'est pas le cas.`,
  });
}

/** Délai au-delà duquel un appel interne est abandonné (ms). */
const TIMEOUT_APPEL_INTERNE_MS = Number(process.env.MCP_INTERNAL_TIMEOUT_MS) || 20_000;

async function appelInterne(
  ctx: ToolContext,
  chemin: string,
  corps: Record<string, any>,
): Promise<{ ok: boolean; status: number; json: any }> {
  if (!ctx.accessToken) {
    throw new Error('Cette action exige votre session Lume — reconnectez le connecteur dans Claude.');
  }
  const port = Number(process.env.PORT || process.env.API_PORT || 3002);
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), TIMEOUT_APPEL_INTERNE_MS);
  let r: Response;
  try {
    r = await fetch(`http://127.0.0.1:${port}/api${chemin}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.accessToken}`,
        'x-org-id': ctx.orgId,
      },
      body: JSON.stringify(corps),
      signal: ctrl.signal,
    });
  } catch (e: any) {
    // Requête partie, pas de réponse : l'effet côté route interne est
    // INCERTAIN. On loggue (l'audit prod notait l'absence de trace ici) et on
    // remonte un échec typé — surtout PAS un throw ordinaire qui libérerait
    // l'idempotence et autoriserait un second envoi.
    console.error(`[appelInterne:${chemin}] pas de réponse (org ${ctx.orgId}) :`, e?.name === 'AbortError' ? 'timeout' : e?.message || e);
    throw new AppelInterneIncertain(e?.name === 'AbortError' ? 'timeout' : 'connexion interrompue');
  } finally {
    clearTimeout(minuteur);
  }
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

const sommeCents = (rows: any[] | null | undefined, champ = 'total_cents') =>
  (rows || []).reduce((s, r) => s + (Number(r?.[champ]) || 0), 0);

const getClientProfile: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_client_profile',
    description:
      'The 360° view of ONE client before a call or a visit: contact info, job history and totals, '
      + 'what they owe (unpaid invoices), quotes, and the last SMS exchange. '
      + 'Use client_id from search_clients. This is THE tool for "tell me about X".',
    parameters: {
      type: 'object',
      properties: { client_id: { type: 'string', description: 'Client id (from search_clients).' } },
      required: ['client_id'],
    },
  },
  handler: async (args, ctx) => {
    const clientId = String(args.client_id || '');
    const { data: c, error } = await ctx.client
      .from('clients')
      .select('id, first_name, last_name, company, display_as_company, email, phone, address, city, status, lead_source, created_at')
      .eq('org_id', ctx.orgId).eq('id', clientId)
      .is('deleted_at', null).maybeSingle();
    if (error) return erreurOutil('profil', error);
    if (!c) return { error: 'Client introuvable — vérifiez avec search_clients.' };

    const [jobsR, facturesR, devisR, convR] = await Promise.all([
      ctx.client.from('jobs_active')
        .select('job_number, title, scheduled_at, derived_status, status, total_cents', { count: 'exact' })
        .eq('org_id', ctx.orgId).eq('client_id', clientId)
        .order('scheduled_at', { ascending: false, nullsFirst: false }).limit(5),
      ctx.client.from('invoices')
        .select('status, total_cents, due_date', { count: 'exact' })
        .eq('org_id', ctx.orgId).eq('client_id', clientId).is('deleted_at', null),
      ctx.client.from('quotes')
        .select('title, status, total_cents, created_at', { count: 'exact' })
        .eq('org_id', ctx.orgId).eq('client_id', clientId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(3),
      ctx.client.from('conversations')
        .select('last_message_text, last_message_at, unread_count')
        .eq('org_id', ctx.orgId).eq('client_id', clientId)
        .order('last_message_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    for (const r of [jobsR, facturesR, devisR]) if (r.error) return erreurOutil('profil', r.error);

    const factures = facturesR.data || [];
    const impayees = factures.filter((f: any) => ['sent', 'partial', 'overdue'].includes(f.status));
    const aujourdHui = dateOrgAujourdhui(); // date de Québec, pas UTC

    return {
      client: {
        name: nomClient(c), company: c.company, email: c.email, phone: c.phone,
        address: c.address, city: c.city, statut: traduireStatut(c.status, STATUT_CLIENT), since: c.created_at,
      },
      jobs: {
        total: jobsR.count ?? 0,
        lifetime_value_cents: sommeCents(jobsR.data),
        recent: (jobsR.data || []).map((j: any) => ({
          job_number: j.job_number, title: j.title, date: j.scheduled_at,
          display_status: ETIQUETTES_DERIVED[j.derived_status] || j.derived_status || j.status,
          total_cents: j.total_cents,
        })),
      },
      billing: {
        invoices_total: facturesR.count ?? 0,
        unpaid_count: impayees.length,
        unpaid_cents: sommeCents(impayees),
        overdue_cents: sommeCents(impayees.filter((f: any) => f.due_date && f.due_date < aujourdHui)),
      },
      quotes: {
        total: devisR.count ?? 0,
        recent: (devisR.data || []).map((q: any) => ({ title: q.title, statut: traduireStatut(q.status, STATUT_DEVIS), total_cents: q.total_cents })),
      },
      last_sms: convR.data
        ? { text: convR.data.last_message_text, at: convR.data.last_message_at, unread: convR.data.unread_count }
        : null,
    };
  },
};

const getMorningBriefing: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'get_morning_briefing',
    description:
      "What deserves the user's attention RIGHT NOW, in one call: overdue invoices (who and how much), "
      + "today's jobs, tasks due by tomorrow, request-form submissions from the last 48 h, and unread SMS. "
      + 'Use it whenever the user asks for their brief, their day, or "quoi de neuf".',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const maintenant = new Date();
    // Journée d'AUJOURD'HUI à Québec (pas la journée UTC) : sinon, en soirée
    // locale — déjà demain en UTC — le brief affichait les visites du lendemain
    // et ratait celles du soir même.
    const { debut: debutJour, fin: finJour, jour: aujourdHui } = bornesJourOrg();
    const demain = dateOrgAujourdhui(new Date(maintenant.getTime() + 86400000));
    const il48h = new Date(maintenant.getTime() - 48 * 3600_000).toISOString();

    const [impayesR, jobsR, tachesR, demandesR, nonLusR] = await Promise.all([
      ctx.client.from('invoices')
        .select('client_id, balance_cents, total_cents, due_date, status', { count: 'exact' })
        .eq('org_id', ctx.orgId).is('deleted_at', null)
        .in('status', ['sent', 'partial', 'overdue']).lt('due_date', aujourdHui)
        .order('due_date', { ascending: true }).limit(5),
      // Le calendrier de l'app lit les VISITES (schedule_events), pas
      // jobs.scheduled_at — même source ici, sinon le brief rate les
      // visites multiples et les jobs planifiés autrement.
      ctx.client.from('schedule_events')
        .select('start_at, end_at, job:jobs!schedule_events_job_id_fkey(job_number, title, client_name, property_address)', { count: 'exact' })
        .eq('org_id', ctx.orgId).is('deleted_at', null)
        .gte('start_at', debutJour).lte('start_at', finJour)
        .order('start_at', { ascending: true }).limit(10),
      ctx.client.from('tasks_active')
        .select('title, priority, due_date', { count: 'exact' })
        .eq('org_id', ctx.orgId).eq('status', 'open').lte('due_date', demain)
        .order('due_date', { ascending: true }).limit(10),
      ctx.client.from('form_submissions')
        .select('first_name, last_name, phone, email, city, created_at', { count: 'exact' })
        .eq('org_id', ctx.orgId).is('deleted_at', null).is('archived_at', null)
        .gte('created_at', il48h).order('created_at', { ascending: false }).limit(5),
      ctx.client.from('conversations')
        .select('client_name, phone_number, last_message_text, unread_count', { count: 'exact' })
        .eq('org_id', ctx.orgId).gt('unread_count', 0)
        .order('last_message_at', { ascending: false }).limit(5),
    ]);
    for (const r of [impayesR, jobsR, tachesR, demandesR, nonLusR]) {
      if (r.error) return erreurOutil('briefing', r.error);
    }

    // Noms des clients qui doivent de l'argent — un briefing dit QUI.
    const idsImpayes = [...new Set((impayesR.data || []).map((f: any) => f.client_id).filter(Boolean))];
    const noms = new Map<string, string>();
    if (idsImpayes.length) {
      const { data: cs } = await ctx.client
        .from('clients')
        .select('id, first_name, last_name, company, display_as_company')
        .eq('org_id', ctx.orgId).in('id', idsImpayes);
      for (const c of cs || []) noms.set(c.id, nomClient(c));
    }

    return {
      date: aujourdHui,
      overdue_invoices: {
        total_matching: impayesR.count ?? 0,
        // Le SOLDE dû (balance_cents), pas le total facturé : c'est le montant
        // qui reste à collecter, celui qui compte le matin. Repli sur total
        // pour une facture jamais entamée (balance non renseignée).
        total_cents: (impayesR.data || []).reduce((s2: number, f: any) =>
          s2 + (f.balance_cents != null ? Number(f.balance_cents) : Number(f.total_cents) || 0), 0),
        worst: (impayesR.data || []).map((f: any) => ({
          client: noms.get(f.client_id) || 'client supprimé',
          balance_cents: f.balance_cents != null ? f.balance_cents : f.total_cents,
          due_date: f.due_date,
        })),
      },
      todays_visits: {
        total_matching: jobsR.count ?? 0,
        visits: (jobsR.data || []).map((v: any) => ({
          start_at: v.start_at, end_at: v.end_at,
          job_number: v.job?.job_number, title: v.job?.title,
          client: v.job?.client_name, address: v.job?.property_address,
        })),
      },
      tasks_due: {
        total_matching: tachesR.count ?? 0,
        tasks: (tachesR.data || []).map((t: any) => ({
          title: t.title,
          priorite: ({ low: 'basse', medium: 'moyenne', high: 'haute' } as Record<string, string>)[t.priority] || t.priority,
          echeance: t.due_date,
        })),
      },
      new_requests_48h: {
        total_matching: demandesR.count ?? 0,
        requests: (demandesR.data || []).map((r: any) => ({
          nom: `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.phone || r.email || 'demande',
          ville: r.city || null,
          quand: r.created_at,
        })),
      },
      unread_sms: {
        total_matching: nonLusR.count ?? 0,
        conversations: (nonLusR.data || []).map((c: any) => ({
          client: c.client_name || c.phone_number,
          dernier_message: c.last_message_text,
          non_lus: c.unread_count,
        })),
      },
    };
  },
};

const rememberThis: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'remember_this',
    description:
      'Persist a preference or standing instruction from the user ("retiens que je facture le vendredi") '
      + 'so future conversations honor it. Give it a short stable key (kebab-case) and the note.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: "Short stable identifier, e.g. 'jour-de-facturation'." },
        note: { type: 'string', description: 'The preference or instruction, in plain words.' },
      },
      required: ['key', 'note'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'remember_this', args, async () => {
      // Même table et même forme que Réglages › Connaissances de l'org
      // (server/routes/org-knowledge.ts) : la fiche est visible et
      // modifiable dans l'application, pas enfermée chez l'agent.
      const admin = getServiceClient();
      const cle = champRequis(args.key, 'La clé du souvenir')
        .toLowerCase().replace(/[^a-z0-9à-ÿ-]+/g, '-').slice(0, 80);
      const { error } = await admin
        .from('org_knowledge')
        .upsert({
          org_id: ctx.orgId,
          category: 'assistant',
          key: cle,
          value: champRequis(args.note, 'La note à retenir').slice(0, 2000),
          importance: 3,
          is_active: true,
        }, { onConflict: 'org_id,category,key' });
      if (error) throw error;
      return { remembered: true, key: cle };
    }),
};

const recallNotes: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'recall_notes',
    description:
      "The user's standing preferences and instructions saved with remember_this. "
      + 'Check them when starting a relevant task (invoicing, scheduling, messaging) to honor them.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const admin = getServiceClient();
    const { data, error } = await admin
      .from('org_knowledge')
      .select('key, value, updated_at')
      .eq('org_id', ctx.orgId).eq('category', 'assistant').eq('is_active', true)
      .order('updated_at', { ascending: false }).limit(30);
    if (error) return erreurOutil('notes', error);
    return { count: data?.length || 0, notes: data || [] };
  },
};

const getRecentAgentActions: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_recent_agent_actions',
    description:
      'What the assistant itself did recently (last 24 h): tasks created, jobs, quotes, messages sent. '
      + 'Use it for continuity ("what did you do yesterday?") and to avoid redoing done work.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const { data, error } = await ctx.client
      .from('agent_actions')
      .select('outil, resultat, created_at')
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false }).limit(20);
    if (error) return erreurOutil('actions', error);
    // Le journal brut est du jargon (noms d'outils, cents, UUID, dates UTC).
    // On le rend LISIBLE : chaque ligne devient une phrase et une heure locale.
    const LIBELLE: Record<string, string> = {
      create_job: 'job créé', update_job: 'job modifié', update_job_status: 'statut de job changé',
      assign_job: 'job assigné', archive_job: 'job archivé', reschedule_job: 'visite déplacée',
      add_visit: 'visite ajoutée', cancel_visit: 'visite annulée',
      create_client: 'client créé', update_client: 'client modifié', convert_lead_to_client: 'prospect converti en client',
      create_task: 'tâche créée', update_task: 'tâche modifiée', update_task_status: 'tâche mise à jour', delete_task: 'tâche supprimée',
      create_quote: 'devis créé', send_quote: 'devis envoyé', cancel_quote: 'devis annulé', convert_quote_to_job: 'devis converti en job',
      create_invoice: 'facture créée', create_invoice_from_job: 'facture préparée depuis un job',
      send_invoice: 'facture envoyée', mark_invoice_paid: 'facture marquée payée',
      send_sms: 'SMS envoyé', send_payment_reminders: 'rappels de paiement envoyés',
      add_note: 'note ajoutée', remember_this: 'préférence mémorisée',
    };
    const heureLocale = (iso: string) => {
      try {
        return new Intl.DateTimeFormat('fr-CA', {
          timeZone: FUSEAU_ORG, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
        }).format(new Date(iso));
      } catch { return iso; }
    };
    const actions = (data || []).map((a: any) => {
      const r = a.resultat || {};
      // Un repère lisible SANS jargon : numéro de pièce, nom, titre — jamais d'id.
      const quoi = r.job?.job_number ? `job n° ${r.job.job_number}`
        : r.invoice?.invoice_number ? `facture n° ${r.invoice.invoice_number}`
        : r.quote?.quote_number ? `devis n° ${r.quote.quote_number}`
        : r.client?.name || r.job?.title || r.task?.title || null;
      return {
        action: LIBELLE[a.outil] || String(a.outil).replace(/_/g, ' '),
        ...(quoi ? { cible: quoi } : {}),
        quand: heureLocale(a.created_at),
      };
    });
    return { count: actions.length, actions };
  },
};

const sendQuoteTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'send_quote',
    description:
      "Email a quote to its client — IT ACTUALLY SENDS through the app's own engine (share link, "
      + 'templates, tracking). ALWAYS show the user which quote goes to whom and get their explicit OK '
      + 'first. Get quote ids from list_quotes or create_quote.',
    parameters: {
      type: 'object',
      properties: {
        quote_id: { type: 'string', description: 'Quote id.' },
        subject: { type: 'string', description: 'Optional email subject override.' },
        message: { type: 'string', description: 'Optional email body override.' },
      },
      required: ['quote_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'send_quote', args, async () => {
      let res;
      try {
        res = await appelInterne(ctx, '/quotes/send-email', {
          quoteId: String(args.quote_id),
          ...(args.subject ? { emailSubject: String(args.subject) } : {}),
          ...(args.message ? { emailBody: String(args.message) } : {}),
        });
      } catch (e) {
        if (e instanceof AppelInterneIncertain) throw envoiIncertain('le devis');
        throw e;
      }
      const { ok, status, json } = res;
      if (!ok) throw new Error(json?.error || `Envoi refusé (${status}).`);
      return { sent: true, channel: 'email', note: 'Le devis est parti par le moteur d\u2019envoi de Lume — suivi d\u2019ouverture et relances habituels.' };
    }),
};

const sendInvoiceTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'send_invoice',
    description:
      "Email an invoice to its client — IT ACTUALLY SENDS through the app's own engine and moves the "
      + 'invoice out of draft (payment reminders may follow automatically). ALWAYS show the user which '
      + 'invoice goes to whom and get their explicit OK first.',
    parameters: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'Invoice id (from create_invoice or list_invoices).' },
        subject: { type: 'string', description: 'Optional email subject override.' },
        message: { type: 'string', description: 'Optional email body override.' },
      },
      required: ['invoice_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'send_invoice', args, async () => {
      let res;
      try {
        res = await appelInterne(ctx, '/emails/send-invoice', {
          invoiceId: String(args.invoice_id),
          ...(args.subject ? { subject: String(args.subject) } : {}),
          ...(args.message ? { body: String(args.message) } : {}),
        });
      } catch (e) {
        if (e instanceof AppelInterneIncertain) throw envoiIncertain('la facture');
        throw e;
      }
      const { ok, status, json } = res;
      if (!ok) throw new Error(json?.error || `Envoi refusé (${status}).`);
      return { sent: true, channel: 'email', note: 'La facture est partie — elle n\u2019est plus un brouillon, et les rappels de paiement de Lume prennent le relais.' };
    }),
};


/* ── Gestion : modifier, déplacer, classer ─────────────────────── */

const rescheduleJobTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'reschedule_job',
    description:
      "Move a job's calendar visit to a new date/time — the same engine as dragging it on the Lume "
      + 'calendar. If the job has several visits, the NEXT upcoming one moves (or the most recent if all '
      + 'are past). Get the job id from list_jobs.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        start_at: { type: 'string', description: 'New ISO start datetime.' },
        end_at: { type: 'string', description: 'New ISO end (default: start + previous duration, else 1 h).' },
      },
      required: ['job_id', 'start_at'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'reschedule_job', args, async () => {
      const { data: visites, error } = await ctx.client
        .from('schedule_events')
        .select('id, start_at, end_at')
        .eq('org_id', ctx.orgId).eq('job_id', String(args.job_id))
        .is('deleted_at', null)
        .order('start_at', { ascending: true });
      if (error) throw error;
      if (!visites?.length) throw new Error('Ce job n\u2019a aucune visite au calendrier — utilisez create_job ou planifiez-le dans Lume d\u2019abord.');
      const maintenant = Date.now();
      const cible = visites.find((v: any) => new Date(v.start_at).getTime() >= maintenant) || visites[visites.length - 1];

      const debut = new Date(String(args.start_at));
      if (Number.isNaN(debut.getTime())) throw new Error('start_at invalide (ISO attendu).');
      const dureePrec = new Date(cible.end_at).getTime() - new Date(cible.start_at).getTime();
      const fin = args.end_at
        ? new Date(String(args.end_at))
        : new Date(debut.getTime() + (dureePrec > 0 ? dureePrec : 60 * 60_000));

      // La RPC du calendrier : recalcule jobs.scheduled_at et signale les
      // chevauchements, exactement comme un glisser-déposer dans l'app.
      const { data: res, error: rpcErr } = await ctx.client.rpc('rpc_reschedule_event', {
        p_event_id: cible.id,
        p_start_at: debut.toISOString(),
        p_end_at: fin.toISOString(),
        p_team_id: null,
        p_timezone: 'America/Montreal',
      });
      if (rpcErr) throw rpcErr;
      const chevauchements = Number((res as any)?.overlaps ?? 0);
      return {
        rescheduled: true,
        new_start: debut.toISOString(),
        new_end: fin.toISOString(),
        overlaps: chevauchements,
        ...(chevauchements > 0 ? { warning: `${chevauchements} visite(s) se chevauchent sur ce créneau — à signaler à l'utilisateur.` } : {}),
      };
    }),
};

const cancelVisitTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'cancel_visit',
    description:
      "Cancel a job's calendar visit — same as deleting it on the Lume calendar. Removes the NEXT "
      + 'upcoming visit (or the most recent if all are past). If it was the job\'s only visit, the job '
      + 'goes back to unscheduled. Get the job id from list_jobs. Confirm with the user first.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
      },
      required: ['job_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'cancel_visit', args, async () => {
      const jobId = champRequis(args.job_id, 'Le job');
      const { data: visites, error } = await ctx.client
        .from('schedule_events')
        .select('id, start_at')
        .eq('org_id', ctx.orgId).eq('job_id', jobId)
        .is('deleted_at', null)
        .order('start_at', { ascending: true });
      if (error) throw error;
      if (!visites?.length) throw new Error('Ce job n’a aucune visite au calendrier à annuler.');
      const maintenant = Date.now();
      const cible = visites.find((v: any) => new Date(v.start_at).getTime() >= maintenant) || visites[visites.length - 1];

      // Même RPC que « supprimer la visite » dans l'app : soft-delete de
      // l'event + recompute_job_schedule (repasse le job en brouillon si
      // c'était sa dernière visite) + hook d'annulation d'automatisation.
      const { error: rpcErr } = await ctx.client.rpc('rpc_unschedule_job', {
        p_job_id: jobId,
        p_event_id: cible.id,
      });
      if (rpcErr) throw rpcErr;
      const restantes = visites.length - 1;
      return {
        cancelled: true,
        visite_annulee: { start_at: cible.start_at },
        visites_restantes: restantes,
        note: restantes > 0
          ? `Visite annulée ; il reste ${restantes} visite(s) planifiée(s) sur ce job.`
          : 'Visite annulée ; le job n’a plus de visite et repasse en brouillon — planifie-le à nouveau si besoin.',
      };
    }),
};

const updateClientTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_client',
    description:
      "Correct a client's contact info: phone, email, address, city, name or company. "
      + 'Only the provided fields change. Get the client id from search_clients.',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client id.' },
        phone: { type: 'string' }, email: { type: 'string' },
        address: { type: 'string' }, city: { type: 'string' },
        first_name: { type: 'string' }, last_name: { type: 'string' },
        company: { type: 'string' },
      },
      required: ['client_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_client', args, async () => {
      // Mêmes règles que updateClient de l'app : champs explicites, trim,
      // et validation du courriel avant d'écrire quoi que ce soit.
      const patch: Record<string, any> = {};
      if (args.email !== undefined) {
        const email = String(args.email).trim();
        if (email && !/^[^@\s]+@[^@\s]+[.][^@\s]+$/.test(email)) throw new Error('Adresse courriel invalide.');
        patch.email = email || null;
      }
      for (const champ of ['phone', 'address', 'city', 'first_name', 'last_name', 'company'] as const) {
        if (args[champ] !== undefined) patch[champ] = String(args[champ]).trim() || null;
      }
      if (!Object.keys(patch).length) throw new Error('Aucun champ à modifier.');
      const { data, error } = await ctx.client
        .from('clients')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', String(args.client_id))
        .is('deleted_at', null)
        .select('id, first_name, last_name, company, display_as_company, phone, email, address, city')
        .single();
      if (error) throw error;
      return { updated: true, client: { name: nomClient(data), phone: data.phone, email: data.email, address: data.address, city: data.city } };
    }),
};

const updateTaskStatusTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_task_status',
    description: "Mark a task done, or reopen it. Get task ids from list_tasks. Valid: 'done', 'open'.",
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task id.' },
        status: { type: 'string', description: "'done' or 'open'." },
      },
      required: ['task_id', 'status'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_task_status', args, async () => {
      const statut = String(args.status);
      if (!['done', 'open'].includes(statut)) throw new Error("Statut invalide : 'done' ou 'open'.");
      // Même logique que l'app : completed_at suit le statut.
      const { data, error } = await ctx.client
        .from('tasks')
        .update({ status: statut, completed_at: statut === 'done' ? new Date().toISOString() : null })
        .eq('org_id', ctx.orgId).eq('id', String(args.task_id))
        .is('deleted_at', null)
        .select('id, title, status')
        .single();
      if (error) throw error;
      return { updated: true, task: data };
    }),
};

const updateTaskTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_task',
    description:
      "Edit a task's content: title, description, due date, priority, or who it's assigned to. "
      + 'Only the provided fields change. Get task ids from list_tasks and member ids from get_team.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task id (from list_tasks).' },
        title: { type: 'string', description: 'New title.' },
        description: { type: 'string', description: 'New description.' },
        due_date: { type: 'string', description: 'New due date YYYY-MM-DD (or ISO).' },
        priority: { type: 'string', description: "'low', 'medium' or 'high'." },
        assignee_user_id: { type: 'string', description: 'Team member user_id from get_team (or null to unassign).' },
      },
      required: ['task_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_task', args, async () => {
      const taskId = champRequis(args.task_id, 'La tâche');
      const patch: Record<string, any> = {};
      if (args.title !== undefined) patch.title = champRequis(args.title, 'Le titre').slice(0, 200);
      if (args.description !== undefined) patch.description = args.description ? String(args.description).slice(0, 5000) : null;
      if (args.due_date !== undefined) {
        if (args.due_date === null || args.due_date === '') patch.due_date = null;
        else {
          const d = new Date(String(args.due_date));
          if (Number.isNaN(d.getTime())) throw new Error('La date d’échéance est invalide.');
          patch.due_date = String(args.due_date);
        }
      }
      if (args.priority !== undefined) {
        const p = String(args.priority).toLowerCase();
        if (!['low', 'medium', 'high'].includes(p)) throw new Error('La priorité doit être basse, moyenne ou haute.');
        patch.priority = p;
      }
      if (args.assignee_user_id !== undefined) {
        patch.assignee_user_id = args.assignee_user_id ? String(args.assignee_user_id) : null;
      }
      if (!Object.keys(patch).length) throw new Error('Rien à modifier — précise ce que tu veux changer.');

      const PRIO = { low: 'basse', medium: 'moyenne', high: 'haute' } as Record<string, string>;
      const { data, error } = await ctx.client
        .from('tasks')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', taskId)
        .is('deleted_at', null)
        .select('id, title, priority, due_date, status')
        .single();
      if (error) throw error;
      return {
        updated: true,
        task: {
          title: data.title,
          priorite: PRIO[data.priority] || data.priority,
          echeance: data.due_date,
          statut: data.status === 'done' ? 'terminée' : 'à faire',
        },
      };
    }),
};

const deleteTaskTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_task',
    description:
      'Delete a task (it disappears from the list). Get the task id from list_tasks. This is a soft '
      + 'delete, like in Lume. Confirm with the user first.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'Task id (from list_tasks).' },
      },
      required: ['task_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_task', args, async () => {
      const taskId = champRequis(args.task_id, 'La tâche');
      // Soft-delete, comme deleteTask dans l'app (jamais de hard delete).
      const { data, error } = await ctx.client
        .from('tasks')
        .update({ deleted_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', taskId)
        .is('deleted_at', null)
        .select('id, title')
        .single();
      if (error) throw error;
      return { deleted: true, task: { title: data.title }, note: 'Tâche supprimée.' };
    }),
};

const cancelQuoteTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'cancel_quote',
    description:
      'Cancel a quote — mark it declined (the client said no) or archived (set aside). Same as changing '
      + 'its status in Lume. Get the quote id from list_quotes. Confirm with the user first.',
    parameters: {
      type: 'object',
      properties: {
        quote_id: { type: 'string', description: 'Quote id (from list_quotes).' },
        reason: { type: 'string', description: "'declined' (client refused) or 'archived' (set aside). Default: archived." },
      },
      required: ['quote_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'cancel_quote', args, async () => {
      const quoteId = champRequis(args.quote_id, 'Le devis');
      const nouveau = String(args.reason || 'archived') === 'declined' ? 'declined' : 'archived';
      // Miroir de updateQuoteStatus dans l'app : statut + son horodatage.
      const patch: Record<string, any> = { status: nouveau, updated_at: new Date().toISOString() };
      patch[`${nouveau}_at`] = new Date().toISOString();
      const { data, error } = await ctx.client
        .from('quotes')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', quoteId)
        .is('deleted_at', null)
        .select('id, quote_number, title, status')
        .single();
      if (error) throw error;
      return {
        cancelled: true,
        quote: { quote_number: data.quote_number, title: data.title, statut: traduireStatut(data.status, STATUT_DEVIS) },
        note: nouveau === 'declined' ? 'Devis marqué refusé.' : 'Devis archivé.',
      };
    }),
};

const markInvoicePaidTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'mark_invoice_paid',
    description:
      'Mark an invoice as fully PAID — records a full manual payment (cash, e-transfer, cheque…) and '
      + 'stops payment reminders, exactly like "Mark as paid" in Lume. Use for money received OUTSIDE '
      + 'Stripe/PayPal. This does NOT charge anyone. Get the invoice id from list_invoices or '
      + 'get_overdue_payments. ALWAYS confirm the invoice and amount with the user first.',
    parameters: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'Invoice id (from list_invoices / get_overdue_payments).' },
        method: { type: 'string', description: "How it was paid: 'cash', 'e-transfer', 'check' or 'card'. Optional." },
      },
      required: ['invoice_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'mark_invoice_paid', args, async () => {
      const invoiceId = champRequis(args.invoice_id, 'La facture');
      // On lit la facture À L'IDENTITÉ (RLS garantit l'appartenance à l'org).
      const { data: inv, error: eInv } = await ctx.client
        .from('invoices')
        .select('id, invoice_number, total_cents, balance_cents, status, client_id')
        .eq('org_id', ctx.orgId).eq('id', invoiceId)
        .is('deleted_at', null).maybeSingle();
      if (eInv) throw eInv;
      if (!inv) throw new Error('Facture introuvable — vérifie avec list_invoices.');
      if (inv.status === 'paid' || Number(inv.balance_cents) <= 0) {
        return { already_paid: true, invoice: { invoice_number: inv.invoice_number }, note: 'Cette facture est déjà payée — rien à faire.' };
      }
      // On ne « paie » pas un BROUILLON. apply_invoice_payment mettrait la
      // balance à 0 mais laisserait le statut à « brouillon » : la facture
      // deviendrait payée-invisible (absente du filtre « payées », son montant
      // hors du revenu collecté). Il faut d'abord l'envoyer au client.
      if (inv.status === 'draft') {
        throw new Error('Cette facture est encore un brouillon — envoie-la d’abord au client (send_invoice), ensuite je pourrai la marquer payée.');
      }
      const reste = Number(inv.balance_cents) > 0 ? Number(inv.balance_cents) : Number(inv.total_cents);
      const methode = ['cash', 'e-transfer', 'check', 'card'].includes(String(args.method)) ? String(args.method) : null;

      // On passe par la RPC dédiée apply_invoice_payment (service_role) : elle
      // met paid_cents/balance/status/paid_at à jour atomiquement, filtrée par
      // org_id. C'est la SEULE voie propre — un insert direct dans `payments`
      // est bloqué (pas de GRANT à authenticated ; et le service client
      // déclenche une cascade webhook qui exige un contexte auth). Testé en
      // staging : balance → 0, statut → payée.
      const admin = getServiceClient();
      const { error: eApply } = await admin.rpc('apply_invoice_payment', {
        p_invoice_id: invoiceId,
        p_org_id: ctx.orgId,
        p_amount_cents: reste,
      });
      if (eApply) throw eApply;

      const { data: apres } = await admin
        .from('invoices').select('invoice_number, balance_cents, status')
        .eq('id', invoiceId).maybeSingle();
      return {
        paid: true,
        invoice: {
          invoice_number: apres?.invoice_number || inv.invoice_number,
          statut: traduireStatut(apres?.status, STATUT_FACTURE),
        },
        amount_cents: reste,
        methode_paiement: methode,
        note: 'Paiement enregistré : la facture est payée et les rappels s’arrêtent. Rien n’a été prélevé — c’est un paiement reçu à part (comptant, virement ou chèque).',
      };
    }),
};

const addNoteTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'add_note',
    description:
      "Add a note to a client's or a job's activity feed — visible in the Lume timeline. "
      + "entity_type is 'client' or 'job'.",
    parameters: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', description: "'client' or 'job'." },
        entity_id: { type: 'string', description: 'Client or job id.' },
        note: { type: 'string', description: 'The note text.' },
      },
      required: ['entity_type', 'entity_id', 'note'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'add_note', args, async () => {
      const type = String(args.entity_type);
      if (!['client', 'job'].includes(type)) throw new Error("entity_type : 'client' ou 'job'.");
      // Même insertion que la route activity-notes : la note porte l'auteur
      // réel (actor_id) — le fil d'activité de l'app dit QUI a écrit quoi.
      const admin = getServiceClient();
      const { data, error } = await admin
        .from('activity_notes')
        .insert({
          org_id: ctx.orgId,
          entity_type: type,
          entity_id: champRequis(args.entity_id, "L'élément à annoter"),
          body: champRequis(args.note, 'La note').slice(0, 4000),
          actor_id: ctx.userId,
        })
        .select('id, created_at')
        .single();
      if (error) throw error;
      return { added: true, at: data.created_at };
    }),
};

const archiveJobTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'archive_job',
    description:
      'Archive a job (reversible — restore: true brings it back). Archived jobs leave the late/upcoming '
      + 'counts. The right tool for cleaning up demo or stale jobs the user confirms are dead.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        restore: { type: 'boolean', description: 'true to UN-archive instead.' },
      },
      required: ['job_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'archive_job', args, async () => {
      const restaurer = Boolean(args.restore);
      const { data, error } = await ctx.client
        .from('jobs')
        .update(restaurer
          ? { archived_at: null, archived_by: null }
          : { archived_at: new Date().toISOString(), archived_by: ctx.userId })
        .eq('org_id', ctx.orgId).eq('id', String(args.job_id))
        .is('deleted_at', null)
        .select('id, job_number, title, archived_at')
        .single();
      if (error) throw error;
      return { [restaurer ? 'restored' : 'archived']: true, job: { job_number: data.job_number, title: data.title } };
    }),
};

const createInvoiceFromJobTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_invoice_from_job',
    description:
      "Close out a completed job into a DRAFT invoice — the app's own finish-and-prepare flow "
      + '(line items carried over, job marked invoiced). Nothing is sent. THE tool for '
      + '\u00ab facture le job #X \u00bb. Get the job id from list_jobs.',
    parameters: {
      type: 'object',
      properties: { job_id: { type: 'string', description: 'Job id.' } },
      required: ['job_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_invoice_from_job', args, async () => {
      // La RPC de l'app fait tout : clôture, report des items, numérotation.
      // Un job sans montants produit une facture à 0 $ : mieux vaut le
      // savoir AVANT et le dire, que de surprendre l'utilisateur après.
      const { data: jobAvant } = await ctx.client
        .from('jobs')
        .select('total_cents, title, job_number')
        .eq('org_id', ctx.orgId).eq('id', String(args.job_id))
        .is('deleted_at', null).maybeSingle();
      if (!jobAvant) throw new Error('Job introuvable — vérifiez avec list_jobs.');
      const sansMontant = !Number(jobAvant.total_cents);

      const { data, error } = await ctx.client.rpc('finish_job_and_prepare_invoice', {
        p_org_id: ctx.orgId,
        p_job_id: String(args.job_id),
      });
      if (error) throw error;
      const row: any = Array.isArray(data) ? data[0] : data;
      const invoiceId = String(row?.invoice_id || '');
      if (!invoiceId) throw new Error('La préparation a réussi mais la facture est introuvable.');
      return {
        created: true, invoice_id: invoiceId, statut: 'brouillon',
        note: sansMontant
          ? 'Facture préparée en BROUILLON, mais le job n\u2019avait AUCUN montant : elle est à 0 $. Demande à l\u2019utilisateur les items et montants à y mettre (ou qu\u2019il la complète dans Lume) AVANT tout envoi.'
          : 'Facture préparée depuis le job, en BROUILLON — rien n\u2019est parti chez le client. send_invoice pour l\u2019envoyer, avec confirmation.',
      };
    }),
};


const updateJobTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_job',
    description:
      "Edit a job completely: title, description, type, address (re-geocoded for the map), and/or "
      + 'REPLACE its line items (amounts and taxes recomputed by the app\u2019s own calculator). '
      + 'Only provided fields change. Use reschedule_job for dates.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        title: { type: 'string' },
        description: { type: 'string' },
        job_type: { type: 'string' },
        property_address: { type: 'string', description: 'New address (queues re-geocoding).' },
        line_items: {
          type: 'array',
          description: 'REPLACES all items when provided.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' }, qty: { type: 'number' },
              unit_price_cents: { type: 'integer', description: 'Unit price in CENTS.' },
            },
            required: ['name', 'unit_price_cents'],
          },
        },
        no_taxes: { type: 'boolean', description: 'true = recompute without taxes.' },
      },
      required: ['job_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_job', args, async () => {
      const jobId = String(args.job_id);
      const { data: job, error: eJob } = await ctx.client
        .from('jobs')
        .select('id, property_address, tax_lines')
        .eq('org_id', ctx.orgId).eq('id', jobId)
        .is('deleted_at', null).maybeSingle();
      if (eJob) throw eJob;
      if (!job) throw new Error('Job introuvable — vérifiez avec list_jobs.');

      const patch: Record<string, any> = { updated_at: new Date().toISOString() };
      if (args.title !== undefined) patch.title = champRequis(args.title, 'Le titre').slice(0, 200);
      if (args.description !== undefined) patch.notes = String(args.description).slice(0, 5000) || null;
      if (args.job_type !== undefined) patch.job_type = String(args.job_type).slice(0, 80) || null;
      if (args.property_address !== undefined) {
        // Même règle que l'app : nouvelle adresse = re-géocodage pour la carte.
        patch.property_address = String(args.property_address);
        patch.address = patch.property_address;
        patch.geocode_status = 'pending';
        patch.geocoded_at = null;
        patch.latitude = null;
        patch.longitude = null;
      }

      let finances: any = null;
      if (Array.isArray(args.line_items)) {
        const items = args.line_items
          .filter((it: any) => String(it?.name || '').trim())
          .map((it: any) => ({
            name: String(it.name).trim().slice(0, 200),
            qty: Number.isFinite(Number(it.qty)) && Number(it.qty) > 0 ? Number(it.qty) : 1,
            unit_price_cents: Math.max(0, Math.round(Number(it.unit_price_cents) || 0)),
          }));
        const taxes: TaxLine[] = args.no_taxes
          ? []
          : ((job.tax_lines as TaxLine[])?.length ? (job.tax_lines as TaxLine[]) : await taxesParDefaut(ctx));
        finances = calculerFinancesJob(
          items.map((it: any) => ({ qty: it.qty, unit_price_cents: it.unit_price_cents })),
          taxes,
        );
        const cap = depassePlafond(finances.total_cents);
        if (cap) throw new Error(cap.error);

        // Remplacement complet, comme l'édition de l'app : delete puis insert.
        const { error: delErr } = await ctx.client.from('job_line_items').delete().eq('job_id', jobId);
        if (delErr) throw delErr;
        if (items.length) {
          const { error: insErr } = await ctx.client.from('job_line_items').insert(items.map((it: any) => ({
            job_id: jobId, org_id: ctx.orgId, name: it.name, qty: it.qty,
            unit_price_cents: it.unit_price_cents,
            total_cents: Math.max(0, Math.round(it.qty * it.unit_price_cents)),
            included: true,
          })));
          // Le delete a réussi juste avant : le job a déjà PERDU ses anciens
          // articles. Un throw ici libérerait l'empreinte et la retentative
          // referait un delete inutile. EffetPartiel verrouille l'idempotence
          // et dit clairement que les articles sont à ressaisir.
          if (insErr) {
            throw new EffetPartiel({
              updated: true,
              incomplet: true,
              job: { id: jobId },
              note: 'Les anciens articles du job ont été retirés mais les nouveaux n’ont pas pu être enregistrés. '
                + 'Le job n’a temporairement plus d’articles — ne relance pas la modification à l’identique ; '
                + 'ressaisis les articles dans le job ou dis à l’utilisateur de le faire.',
            });
          }
        }
        patch.subtotal_cents = finances.subtotal_cents;
        patch.tax_cents = finances.tax_cents;
        patch.total_cents = finances.total_cents;
        patch.tax_lines = taxes;
      }

      if (Object.keys(patch).length === 1 && !finances) throw new Error('Aucun champ à modifier.');

      const { data: maj, error } = await ctx.client
        .from('jobs')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', jobId)
        .select('id, job_number, title, property_address')
        .single();
      if (error) throw error;
      return {
        updated: true,
        job: { job_number: maj.job_number, title: maj.title, address: maj.property_address },
        ...(finances ? { subtotal_cents: finances.subtotal_cents, tax_cents: finances.tax_cents, total_cents: finances.total_cents } : {}),
        ...(args.property_address !== undefined ? { note: 'Adresse changée — le job sera re-géocodé pour la carte.' } : {}),
      };
    }),
};

/* ── Conversions et visites ────────────────────────────────────── */

const convertQuoteToJobTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'convert_quote_to_job',
    description:
      "The client accepted a quote → turn it into a job, through the app's own conversion route "
      + '(line items carried, quote marked converted). Get the quote id from list_quotes.',
    parameters: {
      type: 'object',
      properties: { quote_id: { type: 'string', description: 'Quote id.' } },
      required: ['quote_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'convert_quote_to_job', args, async () => {
      // La route de l'app fait foi : items, statut du devis, création du job.
      const { ok, status, json } = await appelInterne(ctx, '/quotes/convert-to-job', {
        quoteId: String(args.quote_id),
      });
      if (!ok) throw new Error(json?.error || `Conversion refusée (${status}).`);
      return {
        converted: true,
        job: json?.job ? { id: json.job.id, job_number: json.job.job_number, title: json.job.title } : null,
        note: 'Devis converti en job par le flux de l\u2019application. Sans visite planifiée, le job est en brouillon — propose de le planifier.',
      };
    }),
};

const convertLeadToClientTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'convert_lead_to_client',
    description:
      'Promote a lead to an active client — same effect as the app\u2019s convert action '
      + '(status active, pipeline closed-won). Get the lead id from search_leads.',
    parameters: {
      type: 'object',
      properties: { lead_id: { type: 'string', description: 'Lead id (from search_leads).' } },
      required: ['lead_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'convert_lead_to_client', args, async () => {
      // Miroir exact de convertLeadToClient (leadsApi) : les leads vivent
      // dans la table clients — la conversion est un changement de statut.
      const { data, error } = await ctx.client
        .from('clients')
        .update({ status: 'active', lead_status: 'closed_won', updated_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', String(args.lead_id))
        .is('deleted_at', null)
        .select('id, first_name, last_name, company, display_as_company')
        .single();
      if (error) throw error;
      return { converted: true, client: { id: data.id, name: nomClient(data) } };
    }),
};

const addVisitTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'add_visit',
    description:
      'Add an ADDITIONAL calendar visit to a job (a job can hold several). Same engine as the '
      + 'app\u2019s calendar. Use reschedule_job to MOVE an existing visit instead.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Job id.' },
        start_at: { type: 'string', description: 'ISO start datetime.' },
        end_at: { type: 'string', description: 'ISO end (default: start + 1 h).' },
      },
      required: ['job_id', 'start_at'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'add_visit', args, async () => {
      const debut = new Date(String(args.start_at));
      if (Number.isNaN(debut.getTime())) throw new Error('start_at invalide (ISO attendu).');
      const fin = args.end_at ? new Date(String(args.end_at)) : new Date(debut.getTime() + 60 * 60_000);
      // La RPC du calendrier de l'app — mêmes défauts, même recalcul.
      const { data, error } = await ctx.client.rpc('rpc_add_visit', {
        p_job_id: String(args.job_id),
        p_start_at: debut.toISOString(),
        p_end_at: fin.toISOString(),
        p_team_id: null,
        p_timezone: 'America/Montreal',
        p_notes: null,
      });
      if (error) throw error;
      const ev: any = (data as any)?.event || data || {};
      return { added: true, visit: { start_at: ev.start_at || debut.toISOString(), end_at: ev.end_at || fin.toISOString() } };
    }),
};


/* ── Relancer les impayés, sur mesure et en lot ─────────────────── */

const sendPaymentReminders: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'send_payment_reminders',
    description:
      'Send a personalized payment-reminder SMS to several overdue clients at once — the automations '
      + 'handle the standard cadence; THIS is for a custom reminder you send now, in your own words. '
      + 'Build the list from get_overdue_payments. For each recipient give client_id and the exact '
      + 'message. ALWAYS show the user every message and recipient and get one clear OK before calling. '
      + 'Opt-outs (STOP) and clients without a phone are skipped and reported, never a hard failure.',
    parameters: {
      type: 'object',
      properties: {
        reminders: {
          type: 'array',
          description: 'One entry per client to remind.',
          items: {
            type: 'object',
            properties: {
              client_id: { type: 'string', description: 'Client id (from get_overdue_payments).' },
              message: { type: 'string', description: 'The exact SMS text for THIS client (personalize it).' },
            },
            required: ['client_id', 'message'],
          },
        },
      },
      required: ['reminders'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'send_payment_reminders', args, async () => {
      const liste: any[] = Array.isArray(args.reminders) ? args.reminders : [];
      if (!liste.length) throw new Error('Aucun rappel à envoyer.');
      if (liste.length > 30) throw new Error('Trop de rappels d\u2019un coup (max 30) — fractionne.');

      // Téléphones et noms, en une requête (jamais un client d'une autre org).
      const ids = [...new Set(liste.map((r) => String(r.client_id)).filter(Boolean))];
      const { data: clients } = await ctx.client
        .from('clients')
        .select('id, first_name, last_name, company, display_as_company, phone')
        .eq('org_id', ctx.orgId).in('id', ids).is('deleted_at', null);
      const parId = new Map((clients || []).map((c: any) => [c.id, c]));

      const envoyes: any[] = [];
      const ignores: any[] = [];
      for (const r of liste) {
        const c = parId.get(String(r.client_id));
        const nom = c ? nomClient(c) : 'client inconnu';
        if (!c) { ignores.push({ client: nom, raison: 'client introuvable dans votre CRM' }); continue; }
        if (!c.phone) { ignores.push({ client: nom, raison: 'aucun numéro de téléphone' }); continue; }
        try {
          await envoyerUnSms(ctx, c.phone, String(r.message), c.id, nom);
          envoyes.push({ client: nom });
        } catch (e: any) {
          // Un destinataire STOP ou en échec ne fait pas capoter le lot :
          // les autres partent, celui-ci est reporté clairement.
          ignores.push({ client: nom, raison: e?.message || 'envoi refusé' });
        }
      }

      return {
        sent_count: envoyes.length,
        skipped_count: ignores.length,
        sent: envoyes,
        skipped: ignores,
        note: `Rappels envoyés à ${envoyes.length} client(s)`
          + (ignores.length ? `, ${ignores.length} ignoré(s) — explique-les à l\u2019utilisateur.` : '.'),
      };
    }),
};

/** Lecture ajoutée par ce module. */
export const OUTILS_LECTURE_ETENDUS: AgentTool[] = [
  getConversations,
  getConversationMessages,
  getTeam,
  getTimesheets,
  listTasks,
  listRequestSubmissions,
  getD2dStats,
  listCourses,
  listAutomations,
  getPayrollSummary,
  getFinancialOverview,
  getTeamLocations,
  getClientProfile,
  getMorningBriefing,
  recallNotes,
  getRecentAgentActions,
];

/** Écriture ajoutée par ce module (les 4 historiques restent dans tools.ts). */
export const OUTILS_ECRITURE_ETENDUS: AgentTool[] = [
  createClientTool,
  createTaskTool,
  updateJobStatusTool,
  assignJobTool,
  rememberThis,
  sendQuoteTool,
  sendInvoiceTool,
  sendPaymentReminders,
  rescheduleJobTool,
  updateClientTool,
  updateTaskStatusTool,
  addNoteTool,
  archiveJobTool,
  createInvoiceFromJobTool,
  convertQuoteToJobTool,
  convertLeadToClientTool,
  addVisitTool,
  updateJobTool,
  cancelVisitTool,
  updateTaskTool,
  deleteTaskTool,
  cancelQuoteTool,
  markInvoicePaidTool,
];
