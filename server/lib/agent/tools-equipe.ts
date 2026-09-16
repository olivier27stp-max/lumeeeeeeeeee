/* ═══════════════════════════════════════════════════════════════
   Lumi — outils ÉQUIPE : membres, invitations, rôles, équipes,
   feuilles de temps et paie.
   ─────────────────────────────────────────────────────────────
   Jusqu'ici Lumi ne faisait que LIRE l'équipe (get_team, get_timesheets,
   get_payroll_summary…). Ce module lui donne les gestes que l'utilisateur
   fait dans Lume › Membres, Rôles, Équipes, Feuilles de temps et Paie.

   Deux chemins, comme pour les envois de devis :
   - ce qui a une ROUTE (invitations, rôles, pointage, paie) passe par
     `appelInterne` : mêmes gardes admin, même moteur de courriel, même
     gate de sièges, jamais une copie qui dériverait ;
   - ce que l'app fait DIRECTEMENT en base (équipes, taux horaire,
     approbation des heures, réglages de paie — la route est en PUT et
     `appelInterne` ne parle que POST) passe par le client RLS de
     l'utilisateur, avec `org_id = ctx.orgId` sur chaque requête.

   Volontairement EXCLUS (conformité, team-compliance.ts) : déconnexion
   forcée, MFA obligatoire, demande d'effacement d'un compte. Exclu aussi
   l'effacement DÉFINITIF d'un membre (delete-member) : Lumi suspend
   (réversible), la suppression permanente reste un geste d'écran.
   ═══════════════════════════════════════════════════════════════ */

import { ROLE_PRESETS, PERMISSION_KEYS, type PermissionKey } from '../../../src/lib/permissions';
import { computePayPeriod, DEFAULT_PAYROLL_SETTINGS, type PayrollSettings, type PayPeriod } from '../payroll';
import type { IdTopic } from '../lumi/topics';
import type { AgentTool, ToolContext } from './tools';
import {
  executerIdempotent, champRequis, appelInterne, AppelInterneIncertain,
  traduireStatut, STATUT_ROLE,
} from './tools-etendus';

// ─────────────────────────────────────────────────────────────────
// Aides locales
// ─────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const COURRIEL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COULEUR_HEX = /^#[0-9a-fA-F]{6}$/;

const ROLES_ATTRIBUABLES = ['admin', 'sales_rep', 'technician'] as const;
const PORTEES = ['self', 'assigned', 'team', 'company'] as const;
const TYPES_PERIODE = ['weekly', 'biweekly', 'semimonthly', 'monthly'] as const;

/** Plafond d'un taux horaire : 1 000 $/h. Au-delà, c'est une faute de frappe. */
const TAUX_HORAIRE_MAX_CENTS = 100_000;
/** Même plafond que la route /payroll/adjustments : 100 000 $. */
const AJUSTEMENT_MAX_CENTS = 100_000_00;

/** Même politique que tools.ts : jamais d'erreur brute vers le modèle. */
function erreurLecture(scope: string, err: any): { error: string } {
  console.error(`[agent-tool:${scope}]`, err?.message || err);
  return { error: 'La consultation a échoué côté Lume. Dis-le simplement à l’utilisateur et propose de réessayer.' };
}

/** Un identifiant obligatoire, au format uuid (sinon Postgres répondrait en jargon). */
function identifiant(v: any, nom: string, source: string): string {
  const s = champRequis(v, nom);
  if (!UUID.test(s)) throw new Error(`${nom} n'est pas un identifiant valide — récupère-le via ${source} et réessaie.`);
  return s;
}

function identifiantOptionnel(v: any, nom: string, source: string): string | undefined {
  if (v == null || String(v).trim() === '') return undefined;
  return identifiant(v, nom, source);
}

function dateYmd(v: any, nom: string): string {
  const s = champRequis(v, nom);
  if (!YMD.test(s)) throw new Error(`${nom} doit être une date au format AAAA-MM-JJ.`);
  return s;
}

function dateYmdOptionnelle(v: any, nom: string): string | undefined {
  if (v == null || String(v).trim() === '') return undefined;
  return dateYmd(v, nom);
}

function roleAttribuable(v: any): (typeof ROLES_ATTRIBUABLES)[number] {
  const s = champRequis(v, 'role').toLowerCase();
  if (!(ROLES_ATTRIBUABLES as readonly string[]).includes(s)) {
    throw new Error(`role doit être admin, sales_rep ou technician (« propriétaire » ne s'attribue pas).`);
  }
  return s as (typeof ROLES_ATTRIBUABLES)[number];
}

function porteeOptionnelle(v: any): (typeof PORTEES)[number] | undefined {
  if (v == null || String(v).trim() === '') return undefined;
  const s = String(v).toLowerCase();
  if (!(PORTEES as readonly string[]).includes(s)) throw new Error('scope doit être self, assigned, team ou company.');
  return s as (typeof PORTEES)[number];
}

function texteOptionnel(v: any, max: number): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s ? s.slice(0, max) : undefined;
}

const dollars = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
const enDollars = (cents: number) => dollars.format(cents / 100);

/**
 * Rôle du demandeur dans l'org, lu avec SON client (sa propre ligne de
 * memberships est toujours visible). Sert aux gestes que l'app réserve aux
 * administrateurs mais que la base laisse passer à tout membre (réglages de
 * paie, approbation des heures).
 */
async function roleDuDemandeur(ctx: ToolContext): Promise<string> {
  const { data, error } = await ctx.client
    .from('memberships')
    .select('role')
    .eq('org_id', ctx.orgId)
    .eq('user_id', ctx.userId)
    .maybeSingle();
  if (error) throw error;
  return String(data?.role || '').toLowerCase();
}

async function exigerAdmin(ctx: ToolContext, capacite: string): Promise<void> {
  const role = await roleDuDemandeur(ctx);
  if (role !== 'owner' && role !== 'admin') {
    throw new Error(`Ton rôle dans Lume ne permet pas ${capacite} (réservé aux administrateurs et propriétaires).`);
  }
}

interface MembreOrg {
  user_id: string;
  role: string;
  status: string | null;
  full_name: string | null;
  permissions: Record<string, boolean> | null;
  team_id: string | null;
}

/** La fiche d'un membre DE CETTE ORG — ou une erreur lisible, jamais un undefined qui traîne. */
async function membreDeLOrg(ctx: ToolContext, userId: string): Promise<MembreOrg> {
  const { data, error } = await ctx.client
    .from('memberships')
    .select('user_id, role, status, full_name, permissions, team_id')
    .eq('org_id', ctx.orgId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Ce membre est introuvable dans cette entreprise — vérifie avec get_team.');
  return data as MembreOrg;
}

const nomMembre = (m: MembreOrg) => (m.full_name || '').trim() || 'ce membre';

/** Réglages de paie de l'org (mêmes défauts que l'écran Paie). */
async function reglagesPaie(ctx: ToolContext): Promise<PayrollSettings> {
  const { data, error } = await ctx.client
    .from('payroll_settings')
    .select('pay_period_type, anchor_date, pay_day_offset, timezone')
    .eq('org_id', ctx.orgId)
    .maybeSingle();
  if (error) throw error;
  return { org_id: ctx.orgId, ...(data || DEFAULT_PAYROLL_SETTINGS) } as PayrollSettings;
}

async function periodeDePaie(ctx: ToolContext, ref?: string): Promise<PayPeriod> {
  return computePayPeriod(await reglagesPaie(ctx), ref);
}

/**
 * Un objet { clé: vrai/faux } de l'écran des rôles. Les clés inconnues sont
 * refusées (le modèle en invente parfois) : une clé mal orthographiée
 * finirait sinon dans memberships.permissions sans jamais servir.
 */
function changementsPermissions(v: any): Partial<Record<PermissionKey, boolean>> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('permissions doit être un objet { clé: vrai/faux }.');
  const entrees = Object.entries(v);
  if (!entrees.length) throw new Error('Aucune permission à changer — précise au moins une clé (ex. jobs.update: true).');
  const inconnues = entrees.map(([k]) => k).filter((k) => !(PERMISSION_KEYS as readonly string[]).includes(k));
  if (inconnues.length) {
    throw new Error(`Permission(s) inconnue(s) : ${inconnues.join(', ')}. Les clés valides sont celles de l'écran des rôles (ex. jobs.update, invoices.read, timesheets.update).`);
  }
  const sortie: Partial<Record<PermissionKey, boolean>> = {};
  for (const [k, val] of entrees) {
    const b = val === 'true' ? true : val === 'false' ? false : val;
    if (typeof b !== 'boolean') throw new Error(`permissions.${k} doit être vrai ou faux.`);
    sortie[k as PermissionKey] = b;
  }
  return sortie;
}

// ── Appels de routes ─────────────────────────────────────────────

type ReponseRoute = { ok: true; json: any } | { ok: false; incertain: true };

/**
 * Phrase d'exploitant pour un refus de route. Les routes répondent en
 * anglais et avec des codes ; le modèle reçoit une phrase en français, et le
 * détail utile (plafond de sièges, membre pas suspendu) est traduit.
 */
function messageRefusRoute(status: number, json: any, contexte: string): string {
  const code = typeof json?.code === 'string' ? json.code : '';
  const detail = typeof json?.error === 'string' ? json.error.trim() : '';
  if (code === 'seat_limit_reached') {
    const cap = Number(json?.capacity);
    return `Plafond de sièges atteint${Number.isFinite(cap) ? ` (${cap} utilisés)` : ''} — il faut ajouter un siège au forfait dans Lume › Abonnement avant ${contexte}.`;
  }
  if (code === 'not_suspended') return 'Ce membre n’est pas suspendu : rien à réactiver.';
  if (status === 401) return 'Cette action exige votre session Lume — reconnectez le connecteur dans Claude.';
  if (status === 402) return `${contexte} exige un abonnement Lume actif.`;
  if (status === 403) return `Ton rôle dans Lume ne permet pas ${contexte}${detail ? ` (${detail})` : ''}.`;
  if (status === 404) return `Introuvable dans cette entreprise — ${contexte} n'a pas été fait. Vérifie l'identifiant et réessaie.`;
  if (status === 409 && detail) return `${contexte} : ${detail}`;
  return detail
    ? `${contexte} a été refusé par Lume : ${detail}`
    : `${contexte} n'a pas fonctionné côté Lume (${status}). Dis-le simplement et propose de réessayer.`;
}

/**
 * Appelle une route de l'app au nom de l'utilisateur. Un refus devient une
 * erreur en français (empreinte libérée : on peut corriger et réessayer). Une
 * réponse jamais revenue (timeout) est signalée `incertain` SANS lever :
 * l'empreinte est gardée, une retentative tombe sur `deja_fait` — jamais un
 * second courriel d'invitation ni un ajustement de paie en double.
 */
async function viaRoute(ctx: ToolContext, chemin: string, corps: Record<string, any>, contexte: string): Promise<ReponseRoute> {
  let r: { ok: boolean; status: number; json: any };
  try {
    r = await appelInterne(ctx, chemin, corps);
  } catch (e) {
    if (e instanceof AppelInterneIncertain) return { ok: false, incertain: true };
    throw e;
  }
  if (!r.ok) throw new Error(messageRefusRoute(r.status, r.json, contexte));
  return { ok: true, json: r.json ?? {} };
}

function resultatIncertain(contexte: string): Record<string, any> {
  return {
    incertain: true,
    note: `Je n'ai pas eu la confirmation que ${contexte} a abouti — c'est PEUT-ÊTRE fait. Vérifie dans Lume avant de recommencer ; ne refais pas le geste à l'aveugle.`,
  };
}

// ─────────────────────────────────────────────────────────────────
// LECTURES
// ─────────────────────────────────────────────────────────────────

const listTeamsTool: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_teams',
    description:
      'List the org\'s teams (crews) with their id, name, colour, active flag and the names of the members attached to each. '
      + 'Use the team id for create_job / update_member_role / punch_in.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const { data: equipes, error } = await ctx.client
      .from('teams')
      .select('id, name, color_hex, description, is_active')
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .order('name', { ascending: true })
      .limit(200);
    if (error) return erreurLecture('list_teams', error);

    const { data: membres, error: e2 } = await ctx.client
      .from('memberships')
      .select('user_id, full_name, team_id, status')
      .eq('org_id', ctx.orgId)
      .not('team_id', 'is', null)
      .limit(500);
    if (e2) return erreurLecture('list_teams', e2);

    const parEquipe = new Map<string, string[]>();
    for (const m of membres || []) {
      if (m.status && m.status !== 'active') continue;
      const liste = parEquipe.get(String(m.team_id)) || [];
      liste.push((m.full_name || '').trim() || 'membre sans nom');
      parEquipe.set(String(m.team_id), liste);
    }
    const teams = (equipes || []).map((t) => ({
      id: t.id,
      name: t.name,
      color_hex: t.color_hex,
      description: t.description,
      active: t.is_active !== false,
      members: parEquipe.get(String(t.id)) || [],
    }));
    return {
      count: teams.length,
      teams,
      ...(teams.length ? {} : { note: 'Aucune équipe pour l’instant — create_team en crée une.' }),
    };
  },
};

const STATUT_INVITATION: Record<string, string> = {
  pending: 'en attente', accepted: 'acceptée', expired: 'expirée', revoked: 'révoquée',
};

const listInvitationsTool: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_invitations',
    description:
      'List invitations sent to join the org (default: the pending ones). Returns the invitation id needed by resend_invitation / revoke_invitation.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'accepted', 'expired', 'revoked', 'all'], description: 'Filter (default pending).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const statut = String(args.status || 'pending');
    let q = ctx.client
      .from('invitations')
      .select('id, email, role, status, expires_at, created_at')
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (statut !== 'all') q = q.eq('status', statut);
    const { data, error } = await q;
    if (error) return erreurLecture('list_invitations', error);
    const maintenant = Date.now();
    return {
      count: data?.length || 0,
      invitations: (data || []).map((i) => ({
        id: i.id,
        email: i.email,
        role: traduireStatut(i.role, STATUT_ROLE),
        statut: i.status === 'pending' && i.expires_at && Date.parse(i.expires_at) < maintenant ? 'expirée (à renvoyer)' : traduireStatut(i.status, STATUT_INVITATION),
        expires_at: i.expires_at,
        created_at: i.created_at,
      })),
      ...(data?.length ? {} : { note: statut === 'pending' ? 'Aucune invitation en attente.' : 'Aucune invitation avec ce statut.' }),
    };
  },
};

// ─────────────────────────────────────────────────────────────────
// MEMBRES ET INVITATIONS (routes /invitations/*)
// ─────────────────────────────────────────────────────────────────

const inviteMemberTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'invite_member',
    description:
      'Invite someone to join the org by email — IT ACTUALLY SENDS the invitation email and uses a seat of the plan. '
      + 'Roles: admin, sales_rep, technician (owner cannot be granted). ALWAYS confirm the email and role with the user first.',
    parameters: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email address of the person to invite.' },
        role: { type: 'string', enum: ['admin', 'sales_rep', 'technician'], description: 'Role in Lume.' },
        team_id: { type: 'string', description: 'Optional team (crew) to attach the member to — from list_teams.' },
        scope: { type: 'string', enum: ['self', 'assigned', 'team', 'company'], description: 'Optional data scope (default depends on the role).' },
      },
      required: ['email', 'role'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'invite_member', args, async () => {
      const email = champRequis(args.email, 'email').toLowerCase();
      if (!COURRIEL.test(email)) throw new Error('email n’est pas une adresse courriel valide.');
      const role = roleAttribuable(args.role);
      const teamId = identifiantOptionnel(args.team_id, 'team_id', 'list_teams');
      const scope = porteeOptionnelle(args.scope);
      const contexte = `l'invitation de ${email}`;
      const r = await viaRoute(ctx, '/invitations/send', {
        email, role,
        team_id: teamId ?? null,
        ...(scope ? { scope } : {}),
      }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      const envoye = r.json.email_sent !== false;
      return {
        invited: true,
        invitation_id: r.json.invitation?.id ?? null,
        email,
        role: traduireStatut(role, STATUT_ROLE),
        email_sent: envoye,
        ...(envoye ? {} : { invite_link: r.json.invite_link ?? null }),
        note: envoye
          ? `Invitation envoyée à ${email} — valide 48 h, elle occupe un siège tant qu'elle est en attente (revoke_invitation la libère).`
          : `Invitation créée mais le courriel n'est pas parti (${r.json.email_skipped_reason || 'courriel non configuré'}) — transmets le lien d'invitation toi-même, il est valide 48 h.`,
      };
    }),
};

const resendInvitationTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'resend_invitation',
    description:
      'Resend a pending or expired invitation email with a fresh 48 h link. Get the invitation id from list_invitations.',
    parameters: {
      type: 'object',
      properties: { invitation_id: { type: 'string', description: 'Invitation id.' } },
      required: ['invitation_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'resend_invitation', args, async () => {
      const invitationId = identifiant(args.invitation_id, 'invitation_id', 'list_invitations');
      const contexte = "le renvoi de l'invitation";
      const r = await viaRoute(ctx, '/invitations/resend', { invitationId }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      return { resent: true, invitation_id: invitationId, note: 'Invitation renvoyée avec un nouveau lien, valide 48 h. L’ancien lien ne fonctionne plus.' };
    }),
};

const revokeInvitationTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'revoke_invitation',
    description:
      'Revoke a pending invitation: the link stops working and the seat is freed. Get the id from list_invitations.',
    parameters: {
      type: 'object',
      properties: { invitation_id: { type: 'string', description: 'Invitation id.' } },
      required: ['invitation_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'revoke_invitation', args, async () => {
      const invitationId = identifiant(args.invitation_id, 'invitation_id', 'list_invitations');
      const contexte = "la révocation de l'invitation";
      const r = await viaRoute(ctx, '/invitations/revoke', { invitationId }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      return { revoked: true, invitation_id: invitationId, note: 'Invitation révoquée : le lien est mort et le siège est libéré. resend_invitation la remet en attente au besoin.' };
    }),
};

const updateMemberRoleTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_member_role',
    description:
      'Change a team member\'s role (admin, sales_rep, technician), attach them to a team (crew) or change their data scope. '
      + 'Changing the role resets their permissions to the role preset. The owner\'s role cannot change; only the owner can demote an admin. '
      + 'Get user_id from get_team. ALWAYS confirm with the user first.',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Member user id (from get_team).' },
        role: { type: 'string', enum: ['admin', 'sales_rep', 'technician'], description: 'New role. Omit to keep the current role (e.g. only change the team).' },
        team_id: { type: 'string', description: 'Team (crew) to attach the member to — from list_teams.' },
        clear_team: { type: 'boolean', description: 'true = detach the member from their team.' },
        scope: { type: 'string', enum: ['self', 'assigned', 'team', 'company'], description: 'Data scope override.' },
      },
      required: ['user_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_member_role', args, async () => {
      const userId = identifiant(args.user_id, 'user_id', 'get_team');
      const nouveauRole = args.role == null || String(args.role).trim() === '' ? undefined : roleAttribuable(args.role);
      const teamId = identifiantOptionnel(args.team_id, 'team_id', 'list_teams');
      const detacher = args.clear_team === true;
      const scope = porteeOptionnelle(args.scope);
      if (!nouveauRole && !teamId && !detacher && !scope) {
        throw new Error('Rien à changer — précise role, team_id, clear_team ou scope.');
      }
      if (teamId && detacher) throw new Error('team_id et clear_team s’excluent : soit une équipe, soit aucune.');

      const membre = await membreDeLOrg(ctx, userId);
      const role = nouveauRole ?? String(membre.role).toLowerCase();
      const contexte = `la modification du rôle de ${nomMembre(membre)}`;
      const r = await viaRoute(ctx, '/invitations/update-role', {
        memberId: userId,
        role,
        ...(scope ? { scope } : {}),
        ...(teamId ? { team_id: teamId } : detacher ? { team_id: null } : {}),
      }, contexte);
      if (!r.ok) return resultatIncertain(contexte);

      const changements: string[] = [];
      if (nouveauRole && nouveauRole !== membre.role) changements.push(`rôle ${traduireStatut(membre.role, STATUT_ROLE)} → ${traduireStatut(nouveauRole, STATUT_ROLE)}`);
      if (teamId) changements.push('équipe changée');
      if (detacher) changements.push('détaché de son équipe');
      if (scope) changements.push(`portée ${scope}`);
      return {
        updated: true,
        user_id: userId,
        name: nomMembre(membre),
        role: traduireStatut(role, STATUT_ROLE),
        previous_role: traduireStatut(membre.role, STATUT_ROLE),
        ...(teamId ? { team_id: teamId } : detacher ? { team_id: null } : {}),
        note: changements.length
          ? `Fait pour ${nomMembre(membre)} : ${changements.join(', ')}. ${nouveauRole && nouveauRole !== membre.role ? 'Ses permissions repartent du modèle de ce rôle (set_member_permissions pour ajuster).' : ''}`.trim()
          : `Aucun changement effectif pour ${nomMembre(membre)} (déjà dans cet état).`,
      };
    }),
};

const removeMemberTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'remove_member',
    description:
      'Remove a member from the org: their access is SUSPENDED immediately (session ended), their data stays. Reversible with reactivate_member. '
      + 'Cannot remove yourself or the owner; only the owner can remove an admin. ALWAYS confirm with the user first.',
    parameters: {
      type: 'object',
      properties: { user_id: { type: 'string', description: 'Member user id (from get_team).' } },
      required: ['user_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'remove_member', args, async () => {
      const userId = identifiant(args.user_id, 'user_id', 'get_team');
      if (userId === ctx.userId) throw new Error('Tu ne peux pas te retirer toi-même de l’entreprise.');
      const membre = await membreDeLOrg(ctx, userId);
      if (String(membre.status || '').toLowerCase() === 'suspended') {
        return { removed: true, user_id: userId, name: nomMembre(membre), note: `${nomMembre(membre)} est déjà suspendu — rien à refaire.` };
      }
      const contexte = `le retrait de ${nomMembre(membre)}`;
      const r = await viaRoute(ctx, '/invitations/remove-member', { userId }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      return {
        removed: true,
        user_id: userId,
        name: nomMembre(membre),
        note: `${nomMembre(membre)} n'a plus accès à Lume (session fermée). Ses jobs, ventes et historique restent ; reactivate_member le rétablit, et la suppression définitive se fait dans Lume › Membres.`,
      };
    }),
};

const reactivateMemberTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'reactivate_member',
    description:
      'Restore a suspended member\'s access (uses a seat again — refused if the plan is full). Get user_id from get_team.',
    parameters: {
      type: 'object',
      properties: { user_id: { type: 'string', description: 'Member user id (from get_team).' } },
      required: ['user_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'reactivate_member', args, async () => {
      const userId = identifiant(args.user_id, 'user_id', 'get_team');
      const membre = await membreDeLOrg(ctx, userId);
      const contexte = `la réactivation de ${nomMembre(membre)}`;
      const r = await viaRoute(ctx, '/invitations/reactivate-member', { userId }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      return { reactivated: true, user_id: userId, name: nomMembre(membre), note: `${nomMembre(membre)} a de nouveau accès à Lume, avec son rôle d'avant (${traduireStatut(membre.role, STATUT_ROLE)}).` };
    }),
};

// ─────────────────────────────────────────────────────────────────
// ÉQUIPES (table teams, client RLS)
// ─────────────────────────────────────────────────────────────────

const createTeamTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_team',
    description: 'Create a team (crew) that jobs and members can be attached to.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Team name.' },
        color_hex: { type: 'string', description: 'Optional colour, e.g. #3B82F6.' },
        description: { type: 'string', description: 'Optional description.' },
      },
      required: ['name'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_team', args, async () => {
      const name = champRequis(args.name, 'name').slice(0, 120);
      const couleur = texteOptionnel(args.color_hex, 7);
      if (couleur && !COULEUR_HEX.test(couleur)) throw new Error('color_hex doit être une couleur au format #RRGGBB.');
      const { data: doublon, error: eDoublon } = await ctx.client
        .from('teams')
        .select('id')
        .eq('org_id', ctx.orgId)
        .is('deleted_at', null)
        .ilike('name', name)
        .limit(1);
      if (eDoublon) throw eDoublon;
      if (doublon?.length) throw new Error(`Une équipe « ${name} » existe déjà — pas besoin de la recréer.`);

      const { data, error } = await ctx.client
        .from('teams')
        .insert({
          org_id: ctx.orgId,
          name,
          color_hex: couleur || '#3B82F6',
          description: texteOptionnel(args.description, 500) ?? null,
          is_active: true,
        })
        .select('id, name, color_hex')
        .single();
      if (error) throw error;
      return { created: true, team_id: data.id, name: data.name, color_hex: data.color_hex, note: `Équipe « ${data.name} » créée — update_member_role y rattache des membres.` };
    }),
};

const updateTeamTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_team',
    description: 'Rename a team, change its colour or description, or deactivate/reactivate it. Get team_id from list_teams.',
    parameters: {
      type: 'object',
      properties: {
        team_id: { type: 'string', description: 'Team id.' },
        name: { type: 'string', description: 'New name.' },
        color_hex: { type: 'string', description: 'New colour #RRGGBB.' },
        description: { type: 'string', description: 'New description (empty string clears it).' },
        is_active: { type: 'boolean', description: 'false = deactivated (hidden from pickers), true = active.' },
      },
      required: ['team_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_team', args, async () => {
      const teamId = identifiant(args.team_id, 'team_id', 'list_teams');
      const charge: Record<string, any> = {};
      if (args.name != null && String(args.name).trim()) charge.name = String(args.name).trim().slice(0, 120);
      if (args.color_hex != null && String(args.color_hex).trim()) {
        const c = String(args.color_hex).trim();
        if (!COULEUR_HEX.test(c)) throw new Error('color_hex doit être une couleur au format #RRGGBB.');
        charge.color_hex = c;
      }
      if (args.description !== undefined && args.description !== null) charge.description = String(args.description).trim().slice(0, 500) || null;
      if (typeof args.is_active === 'boolean') charge.is_active = args.is_active;
      if (!Object.keys(charge).length) throw new Error('Rien à changer — précise name, color_hex, description ou is_active.');
      charge.updated_at = new Date().toISOString();

      const { data, error } = await ctx.client
        .from('teams')
        .update(charge)
        .eq('id', teamId)
        .eq('org_id', ctx.orgId)
        .is('deleted_at', null)
        .select('id, name, color_hex, is_active')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Cette équipe est introuvable dans cette entreprise — vérifie avec list_teams.');
      return { updated: true, team_id: data.id, name: data.name, color_hex: data.color_hex, active: data.is_active !== false, note: `Équipe « ${data.name} » mise à jour.` };
    }),
};

const deleteTeamTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_team',
    description:
      'Delete a team (crew): it disappears from Lume and its jobs, schedule events and members are detached from it (they are NOT deleted). '
      + 'Not reversible. ALWAYS confirm with the user first; prefer update_team with is_active=false to just hide it.',
    parameters: {
      type: 'object',
      properties: { team_id: { type: 'string', description: 'Team id (from list_teams).' } },
      required: ['team_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_team', args, async () => {
      const teamId = identifiant(args.team_id, 'team_id', 'list_teams');
      const { data: equipe, error: e0 } = await ctx.client
        .from('teams')
        .select('id, name')
        .eq('id', teamId)
        .eq('org_id', ctx.orgId)
        .is('deleted_at', null)
        .maybeSingle();
      if (e0) throw e0;
      if (!equipe) throw new Error('Cette équipe est introuvable (ou déjà supprimée) — vérifie avec list_teams.');

      // Même séquence que l'écran Équipes (teamsApi.softDeleteTeam) : soft
      // delete, puis détacher jobs, événements, membres et appartenances N→N.
      const maintenant = new Date().toISOString();
      const { error: e1 } = await ctx.client.from('teams')
        .update({ deleted_at: maintenant, updated_at: maintenant })
        .eq('id', teamId).eq('org_id', ctx.orgId);
      if (e1) throw e1;
      const { error: e2 } = await ctx.client.from('jobs')
        .update({ team_id: null, updated_at: maintenant })
        .eq('team_id', teamId).eq('org_id', ctx.orgId).is('deleted_at', null);
      if (e2) throw e2;
      const { error: e3 } = await ctx.client.from('schedule_events')
        .update({ team_id: null, updated_at: maintenant })
        .eq('team_id', teamId).eq('org_id', ctx.orgId).is('deleted_at', null);
      if (e3) throw e3;
      const { error: e4 } = await ctx.client.from('memberships')
        .update({ team_id: null, updated_at: maintenant })
        .eq('team_id', teamId).eq('org_id', ctx.orgId);
      if (e4) throw e4;
      const { error: e5 } = await ctx.client.from('team_assignments')
        .delete()
        .eq('team_id', teamId).eq('org_id', ctx.orgId);
      if (e5) throw e5;

      return { deleted: true, team_id: teamId, name: equipe.name, note: `Équipe « ${equipe.name} » supprimée ; ses jobs, événements et membres sont conservés mais plus rattachés à aucune équipe.` };
    }),
};

// ─────────────────────────────────────────────────────────────────
// TAUX HORAIRE (team_members, client RLS — l'update exige un rôle admin)
// ─────────────────────────────────────────────────────────────────

const setHourlyRateTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'set_hourly_rate',
    description:
      'Set a member\'s hourly wage (in cents) — the labour cost used by payroll and job profitability. '
      + 'Get user_id from get_team. ALWAYS confirm the amount with the user first.',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Member user id (from get_team).' },
        hourly_rate_cents: { type: 'integer', description: 'Hourly rate in cents (2500 = 25,00 $/h). 0 clears it.' },
      },
      required: ['user_id', 'hourly_rate_cents'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'set_hourly_rate', args, async () => {
      const userId = identifiant(args.user_id, 'user_id', 'get_team');
      const cents = Number(args.hourly_rate_cents);
      if (!Number.isInteger(cents) || cents < 0 || cents > TAUX_HORAIRE_MAX_CENTS) {
        throw new Error(`hourly_rate_cents doit être un entier en cents entre 0 et ${TAUX_HORAIRE_MAX_CENTS} (0 $ à ${enDollars(TAUX_HORAIRE_MAX_CENTS)} de l'heure).`);
      }
      const membre = await membreDeLOrg(ctx, userId);

      const { data: existant, error: eSel } = await ctx.client
        .from('team_members')
        .select('id, hourly_rate_cents')
        .eq('org_id', ctx.orgId)
        .eq('user_id', userId)
        .limit(1);
      if (eSel) throw eSel;

      let ancien: number | null = null;
      if (existant && existant.length) {
        ancien = Number(existant[0].hourly_rate_cents) || 0;
        const { error } = await ctx.client
          .from('team_members')
          .update({ hourly_rate_cents: cents, updated_at: new Date().toISOString() })
          .eq('id', existant[0].id)
          .eq('org_id', ctx.orgId);
        if (error) throw error;
      } else {
        // Comme l'écran Membres : la fiche team_members n'existe pas encore
        // pour un membre invité — on la crée avec le nom de sa membership.
        const morceaux = (membre.full_name || '').trim().split(/\s+/).filter(Boolean);
        const { error } = await ctx.client.from('team_members').insert({
          org_id: ctx.orgId,
          user_id: userId,
          email: '',
          first_name: morceaux[0] || '',
          last_name: morceaux.slice(1).join(' ') || '',
          phone: '',
          hourly_rate_cents: cents,
        });
        if (error) throw error;
      }
      return {
        user_id: userId,
        name: nomMembre(membre),
        hourly_rate_cents: cents,
        previous_hourly_rate_cents: ancien,
        note: `Taux horaire de ${nomMembre(membre)} : ${enDollars(cents)}/h${ancien != null && ancien !== cents ? ` (avant : ${enDollars(ancien)}/h)` : ''}. La paie et la rentabilité des jobs l'utilisent dès maintenant.`,
      };
    }),
};

// ─────────────────────────────────────────────────────────────────
// FEUILLES DE TEMPS (routes /timesheets/*, toujours SA propre entrée)
// ─────────────────────────────────────────────────────────────────

/** L'entrée de temps ouverte de l'utilisateur (sans punch_out), s'il y en a une. */
async function entreeActive(ctx: ToolContext): Promise<{ id: string; date: string; punch_in: string; breaks: any } | null> {
  const { data, error } = await ctx.client
    .from('time_entries')
    .select('id, date, punch_in, breaks')
    .eq('org_id', ctx.orgId)
    .eq('employee_id', ctx.userId)
    .is('punch_out', null)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const heures = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

const punchInTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'punch_in',
    description:
      'Punch in (start the user\'s OWN timesheet for now). Optionally link the entry to a job or a team. Refused if already punched in.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string', description: 'Optional job the time is worked on.' },
        team_id: { type: 'string', description: 'Optional team (crew).' },
        notes: { type: 'string', description: 'Optional note.' },
      },
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'punch_in', args, async () => {
      const contexte = 'le pointage d’entrée';
      const r = await viaRoute(ctx, '/timesheets/punch-in', {
        job_id: identifiantOptionnel(args.job_id, 'job_id', 'list_jobs') ?? null,
        team_id: identifiantOptionnel(args.team_id, 'team_id', 'list_teams') ?? null,
        notes: texteOptionnel(args.notes, 2000) ?? null,
      }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      const e = r.json.entry || {};
      return { punched_in: true, entry_id: e.id ?? null, date: e.date ?? null, punch_in: e.punch_in ?? null, note: 'Pointage d’entrée enregistré — le suivi GPS démarre si l’appareil le permet. punch_out pour terminer.' };
    }),
};

const punchOutTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'punch_out',
    description:
      'Punch out (close the user\'s OWN open timesheet now; an open break is closed too). Omit entry_id to close the active entry.',
    parameters: {
      type: 'object',
      properties: {
        entry_id: { type: 'string', description: 'Optional entry id (default: the active one).' },
        notes: { type: 'string', description: 'Optional note added to the entry.' },
      },
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'punch_out', args, async () => {
      const contexte = 'le pointage de sortie';
      const entryId = identifiantOptionnel(args.entry_id, 'entry_id', 'punch_in');
      const notes = texteOptionnel(args.notes, 2000);
      const r = await viaRoute(ctx, '/timesheets/punch-out', {
        ...(entryId ? { entry_id: entryId } : {}),
        ...(notes ? { notes } : {}),
      }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      const e = r.json.entry || {};
      return { punched_out: true, entry_id: e.id ?? null, date: e.date ?? null, punch_in: e.punch_in ?? null, punch_out: e.punch_out ?? null, note: 'Pointage de sortie enregistré ; la journée est fermée et le suivi GPS arrêté.' };
    }),
};

const startBreakTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'start_break',
    description: 'Start a break on the user\'s OWN open timesheet (break time is deducted from hours). Omit entry_id to use the active entry.',
    parameters: {
      type: 'object',
      properties: { entry_id: { type: 'string', description: 'Optional entry id (default: the active one).' } },
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'start_break', args, async () => {
      const contexte = 'le début de pause';
      let entryId = identifiantOptionnel(args.entry_id, 'entry_id', 'punch_in');
      if (!entryId) {
        const active = await entreeActive(ctx);
        if (!active) throw new Error('Aucun pointage en cours : il faut d’abord pointer (punch_in) avant de prendre une pause.');
        entryId = active.id;
      }
      const r = await viaRoute(ctx, '/timesheets/break/start', { entry_id: entryId }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      return { break_started: true, entry_id: entryId, note: 'Pause démarrée — end_break pour la terminer ; elle sera déduite des heures.' };
    }),
};

const endBreakTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'end_break',
    description: 'End the current break on the user\'s OWN open timesheet. Omit entry_id to use the active entry.',
    parameters: {
      type: 'object',
      properties: { entry_id: { type: 'string', description: 'Optional entry id (default: the active one).' } },
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'end_break', args, async () => {
      const contexte = 'la fin de pause';
      let entryId = identifiantOptionnel(args.entry_id, 'entry_id', 'punch_in');
      if (!entryId) {
        const active = await entreeActive(ctx);
        if (!active) throw new Error('Aucun pointage en cours, donc aucune pause à terminer.');
        entryId = active.id;
      }
      const r = await viaRoute(ctx, '/timesheets/break/end', { entry_id: entryId }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      return { break_ended: true, entry_id: entryId, note: 'Pause terminée, le temps de travail reprend.' };
    }),
};

const approveTimesheetTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'approve_timesheet',
    description:
      'Approve a member\'s completed time entries over a date range (same marker as the Timesheets screen\'s Approve button). '
      + 'Admin/owner only. Entries still open or already approved are skipped. Get user_id from get_team.',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Member user id (from get_team).' },
        from: { type: 'string', description: 'Start date YYYY-MM-DD (inclusive).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD (inclusive).' },
      },
      required: ['user_id', 'from', 'to'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'approve_timesheet', args, async () => {
      await exigerAdmin(ctx, "l'approbation des feuilles de temps");
      const userId = identifiant(args.user_id, 'user_id', 'get_team');
      const from = dateYmd(args.from, 'from');
      const to = dateYmd(args.to, 'to');
      if (from > to) throw new Error('from doit précéder to.');
      const membre = await membreDeLOrg(ctx, userId);

      const { data, error } = await ctx.client
        .from('time_entries')
        .select('id, date, notes, punch_out')
        .eq('org_id', ctx.orgId)
        .eq('employee_id', userId)
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true })
        .limit(500);
      if (error) throw error;

      const lignes = data || [];
      const dejaApprouvee = (e: any) => String(e.notes || '').startsWith('[APPROVED]');
      const aApprouver = lignes.filter((e) => e.punch_out && !dejaApprouvee(e));
      const deja = lignes.filter((e) => e.punch_out && dejaApprouvee(e)).length;
      const ouvertes = lignes.filter((e) => !e.punch_out).length;

      if (!aApprouver.length) {
        return {
          approved_count: 0, already_approved: deja, still_open: ouvertes, user_id: userId, name: nomMembre(membre), from, to,
          note: lignes.length
            ? `Rien à approuver pour ${nomMembre(membre)} du ${from} au ${to} : ${deja} déjà approuvée(s), ${ouvertes} encore ouverte(s).`
            : `Aucune entrée de temps pour ${nomMembre(membre)} du ${from} au ${to}.`,
        };
      }

      const maintenant = new Date().toISOString();
      for (const e of aApprouver) {
        // Même marqueur que l'écran (il lit le préfixe des notes) + les
        // colonnes prévues pour ça, que l'écran n'écrit pas encore.
        const { error: eu } = await ctx.client
          .from('time_entries')
          .update({ notes: '[APPROVED] ' + (e.notes || ''), approved_by: ctx.userId, approved_at: maintenant, updated_at: maintenant })
          .eq('id', e.id)
          .eq('org_id', ctx.orgId);
        if (eu) throw eu;
      }
      return {
        approved_count: aApprouver.length,
        already_approved: deja,
        still_open: ouvertes,
        user_id: userId,
        name: nomMembre(membre),
        from, to,
        dates: aApprouver.map((e) => e.date),
        note: `${aApprouver.length} entrée(s) de ${nomMembre(membre)} approuvée(s) du ${from} au ${to}${ouvertes ? ` ; ${ouvertes} encore ouverte(s), à approuver après le punch_out` : ''}.`,
      };
    }),
};

// ─────────────────────────────────────────────────────────────────
// PAIE (routes /payroll/*, sauf les réglages — route en PUT)
// ─────────────────────────────────────────────────────────────────

const addPayrollAdjustmentTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'add_payroll_adjustment',
    description:
      'Add a payroll adjustment (bonus or deduction, in cents; negative = deduction) to a member for a pay period. '
      + 'Default period: the one containing today, or period_ref. Admin/owner only. ALWAYS confirm the amount with the user first.',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Member user id (from get_team).' },
        amount_cents: { type: 'integer', description: 'Amount in cents, non-zero; negative for a deduction (e.g. -5000 = -50,00 $).' },
        note: { type: 'string', description: 'Reason shown on the pay stub (recommended).' },
        period_ref: { type: 'string', description: 'Optional date YYYY-MM-DD inside the target pay period (default today).' },
        period_start: { type: 'string', description: 'Optional explicit period start YYYY-MM-DD (with period_end).' },
        period_end: { type: 'string', description: 'Optional explicit period end YYYY-MM-DD (with period_start).' },
      },
      required: ['user_id', 'amount_cents'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'add_payroll_adjustment', args, async () => {
      const userId = identifiant(args.user_id, 'user_id', 'get_team');
      const montant = Number(args.amount_cents);
      if (!Number.isInteger(montant) || montant === 0 || Math.abs(montant) > AJUSTEMENT_MAX_CENTS) {
        throw new Error('amount_cents doit être un entier non nul en cents (négatif pour une retenue), sous 100 000 $.');
      }
      let debut = dateYmdOptionnelle(args.period_start, 'period_start');
      let fin = dateYmdOptionnelle(args.period_end, 'period_end');
      if ((debut && !fin) || (!debut && fin)) throw new Error('period_start et period_end vont ensemble — donne les deux, ou aucun.');
      if (!debut || !fin) {
        const p = await periodeDePaie(ctx, dateYmdOptionnelle(args.period_ref, 'period_ref'));
        debut = p.start; fin = p.end;
      }
      if (debut > fin) throw new Error('period_start doit précéder period_end.');
      const membre = await membreDeLOrg(ctx, userId);
      const note = texteOptionnel(args.note, 500);
      const contexte = `l'ajustement de paie de ${nomMembre(membre)}`;
      const r = await viaRoute(ctx, '/payroll/adjustments', {
        user_id: userId, period_start: debut, period_end: fin, amount_cents: montant, ...(note ? { note } : {}),
      }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      return {
        adjustment_id: r.json.id ?? null,
        user_id: userId,
        name: nomMembre(membre),
        amount_cents: montant,
        period: { start: debut, end: fin },
        note: `${montant > 0 ? 'Prime' : 'Retenue'} de ${enDollars(Math.abs(montant))} ajoutée à la paie de ${nomMembre(membre)} (période du ${debut} au ${fin})${note ? ` — « ${note} »` : ''}. Se retire dans Lume › Paie au besoin.`,
      };
    }),
};

const markPayrollPeriodPaidTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'mark_payroll_period_paid',
    description:
      'Mark a member\'s pay period as PAID: Lume snapshots hours, gross, commissions and adjustments as of now. '
      + 'Default period: the one containing today, or period_ref. Admin/owner only. Reversible with unmark_payroll_period_paid. ALWAYS confirm first.',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Member user id (from get_team).' },
        period_ref: { type: 'string', description: 'Optional date YYYY-MM-DD inside the target pay period (default today).' },
        note: { type: 'string', description: 'Optional note (cheque number, transfer reference…).' },
      },
      required: ['user_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'mark_payroll_period_paid', args, async () => {
      const userId = identifiant(args.user_id, 'user_id', 'get_team');
      const ref = dateYmdOptionnelle(args.period_ref, 'period_ref');
      const note = texteOptionnel(args.note, 500);
      const membre = await membreDeLOrg(ctx, userId);
      const periode = await periodeDePaie(ctx, ref);
      const contexte = `le marquage « payé » de la paie de ${nomMembre(membre)}`;
      const r = await viaRoute(ctx, '/payroll/mark-paid', { user_id: userId, ...(ref ? { ref } : {}), ...(note ? { note } : {}) }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      const total = Number(r.json.total_cents);
      return {
        paid: true,
        user_id: userId,
        name: nomMembre(membre),
        period: { start: periode.start, end: periode.end, pay_date: periode.payDate },
        total_cents: Number.isFinite(total) ? total : null,
        paid_at: r.json.paid_at ?? null,
        note: `Paie de ${nomMembre(membre)} marquée payée pour la période du ${periode.start} au ${periode.end}${Number.isFinite(total) ? ` (${enDollars(total)})` : ''}. unmark_payroll_period_paid annule si c'était une erreur.`,
      };
    }),
};

const unmarkPayrollPeriodPaidTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'unmark_payroll_period_paid',
    description:
      'Undo mark_payroll_period_paid for a member\'s pay period (removes the payment record; the hours and adjustments stay). Admin/owner only.',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Member user id (from get_team).' },
        period_ref: { type: 'string', description: 'Optional date YYYY-MM-DD inside the target pay period (default today).' },
      },
      required: ['user_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'unmark_payroll_period_paid', args, async () => {
      const userId = identifiant(args.user_id, 'user_id', 'get_team');
      const ref = dateYmdOptionnelle(args.period_ref, 'period_ref');
      const membre = await membreDeLOrg(ctx, userId);
      const periode = await periodeDePaie(ctx, ref);
      const contexte = `l'annulation du « payé » de la paie de ${nomMembre(membre)}`;
      const r = await viaRoute(ctx, '/payroll/unmark-paid', { user_id: userId, ...(ref ? { ref } : {}) }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      return {
        unpaid: true,
        user_id: userId,
        name: nomMembre(membre),
        period: { start: periode.start, end: periode.end },
        note: `La paie de ${nomMembre(membre)} pour la période du ${periode.start} au ${periode.end} n'est plus marquée payée.`,
      };
    }),
};

const updatePayrollSettingsTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_payroll_settings',
    description:
      'Change the org\'s pay cycle: period type (weekly, biweekly, semimonthly, monthly), anchor date (a period start), pay-day offset (days after period end) or timezone. '
      + 'Unspecified fields keep their current value. Admin/owner only. Changing the cycle shifts every future period — confirm first.',
    parameters: {
      type: 'object',
      properties: {
        pay_period_type: { type: 'string', enum: ['weekly', 'biweekly', 'semimonthly', 'monthly'], description: 'Pay period type.' },
        anchor_date: { type: 'string', description: 'A period start date YYYY-MM-DD the cycle is computed from.' },
        pay_day_offset: { type: 'integer', description: 'Days after the period end when wages are paid (0–31).' },
        timezone: { type: 'string', description: 'IANA timezone, e.g. America/Toronto.' },
      },
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_payroll_settings', args, async () => {
      await exigerAdmin(ctx, 'la modification des réglages de paie');
      const courant = await reglagesPaie(ctx);
      const charge: Record<string, any> = {};
      if (args.pay_period_type != null && String(args.pay_period_type).trim()) {
        const t = String(args.pay_period_type).toLowerCase();
        if (!(TYPES_PERIODE as readonly string[]).includes(t)) throw new Error('pay_period_type doit être weekly, biweekly, semimonthly ou monthly.');
        charge.pay_period_type = t;
      }
      const ancre = dateYmdOptionnelle(args.anchor_date, 'anchor_date');
      if (ancre) charge.anchor_date = ancre;
      if (args.pay_day_offset != null && String(args.pay_day_offset).trim() !== '') {
        const n = Number(args.pay_day_offset);
        if (!Number.isInteger(n) || n < 0 || n > 31) throw new Error('pay_day_offset doit être un entier entre 0 et 31 (jours après la fin de période).');
        charge.pay_day_offset = n;
      }
      const fuseau = texteOptionnel(args.timezone, 64);
      if (fuseau) {
        try { new Intl.DateTimeFormat('en-CA', { timeZone: fuseau }); } catch { throw new Error(`timezone « ${fuseau} » est inconnu — utilise un fuseau IANA comme America/Toronto.`); }
        charge.timezone = fuseau;
      }
      if (!Object.keys(charge).length) throw new Error('Rien à changer — précise pay_period_type, anchor_date, pay_day_offset ou timezone.');

      const nouveau = {
        org_id: ctx.orgId,
        pay_period_type: charge.pay_period_type ?? courant.pay_period_type,
        anchor_date: charge.anchor_date ?? courant.anchor_date,
        pay_day_offset: charge.pay_day_offset ?? courant.pay_day_offset,
        timezone: charge.timezone ?? courant.timezone,
        created_by: ctx.userId,
        updated_at: new Date().toISOString(),
      };
      const { error } = await ctx.client
        .from('payroll_settings')
        .upsert(nouveau, { onConflict: 'org_id' });
      if (error) throw error;
      const periode = computePayPeriod(nouveau);
      return {
        updated: true,
        settings: { pay_period_type: nouveau.pay_period_type, anchor_date: nouveau.anchor_date, pay_day_offset: nouveau.pay_day_offset, timezone: nouveau.timezone },
        current_period: periode,
        note: `Réglages de paie enregistrés (${Object.keys(charge).join(', ')}). Période courante : du ${periode.start} au ${periode.end}, payée le ${periode.payDate}.`,
      };
    }),
};

// ─────────────────────────────────────────────────────────────────
// RÔLES ET PERMISSIONS (routes /roles/*)
// ─────────────────────────────────────────────────────────────────

const updateRolePresetTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_role_preset',
    description:
      'Change what a ROLE can do in this org (same as the Roles screen): pass only the permission keys to change, e.g. {"timesheets.update": false}. '
      + 'Applies immediately to every member of that role (except members with custom permissions). Technicians can never gain financial keys. Admin/owner only. Confirm first.',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', enum: ['admin', 'sales_rep', 'technician'], description: 'Role to edit.' },
        permissions: { type: 'object', description: 'Keys to change → true/false (keys as in the Roles screen: jobs.update, invoices.read, timesheets.update…).' },
      },
      required: ['role', 'permissions'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_role_preset', args, async () => {
      const role = roleAttribuable(args.role);
      const changements = changementsPermissions(args.permissions);

      // Base = le modèle courant de l'org, sinon le préréglage de l'app. La
      // route REMPLACE la carte entière et la propage : un objet partiel
      // envoyé tel quel retirerait toutes les autres permissions du rôle.
      const { data: modele, error } = await ctx.client
        .from('role_templates')
        .select('permissions')
        .eq('org_id', ctx.orgId)
        .eq('slug', role)
        .maybeSingle();
      if (error) throw error;
      const base: Record<string, boolean> = modele?.permissions && typeof modele.permissions === 'object'
        ? { ...(modele.permissions as Record<string, boolean>) }
        : { ...ROLE_PRESETS[role] };
      const effectifs = Object.entries(changements).filter(([k, v]) => base[k] !== v);
      if (!effectifs.length) {
        return { updated: false, role: traduireStatut(role, STATUT_ROLE), note: `Le rôle ${traduireStatut(role, STATUT_ROLE)} a déjà ces permissions — rien à changer.` };
      }
      const carte = { ...base, ...changements };
      const contexte = `la modification des permissions du rôle ${traduireStatut(role, STATUT_ROLE)}`;
      const r = await viaRoute(ctx, '/roles/update-preset', { role, permissions: carte }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      return {
        updated: true,
        role: traduireStatut(role, STATUT_ROLE),
        changes: effectifs.map(([key, value]) => ({ key, value })),
        affected_members: Number(r.json.affected_members) || 0,
        note: `Permissions du rôle ${traduireStatut(role, STATUT_ROLE)} mises à jour (${effectifs.map(([k, v]) => `${k} ${v ? 'activée' : 'retirée'}`).join(', ')}) — appliquées à ${Number(r.json.affected_members) || 0} membre(s).`,
      };
    }),
};

const setMemberPermissionsTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'set_member_permissions',
    description:
      'Override ONE member\'s permissions (pass only the keys to change, e.g. {"financial.view_pricing": true}); marks them as custom so role changes stop overwriting them. '
      + 'The owner always has full access; technicians can never gain financial keys. Admin/owner only. Confirm first.',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Member user id (from get_team).' },
        permissions: { type: 'object', description: 'Keys to change → true/false.' },
      },
      required: ['user_id', 'permissions'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'set_member_permissions', args, async () => {
      const userId = identifiant(args.user_id, 'user_id', 'get_team');
      const changements = changementsPermissions(args.permissions);
      const membre = await membreDeLOrg(ctx, userId);
      if (String(membre.role).toLowerCase() === 'owner') throw new Error('Le propriétaire a toujours tous les accès — rien à ajuster.');
      const base: Record<string, boolean> = membre.permissions && typeof membre.permissions === 'object'
        ? { ...membre.permissions }
        : { ...(ROLE_PRESETS[String(membre.role).toLowerCase() as keyof typeof ROLE_PRESETS] ?? {}) };
      const effectifs = Object.entries(changements).filter(([k, v]) => base[k] !== v);
      if (!effectifs.length) {
        return { updated: false, user_id: userId, name: nomMembre(membre), note: `${nomMembre(membre)} a déjà ces permissions — rien à changer.` };
      }
      const carte = { ...base, ...changements };
      const contexte = `la modification des permissions de ${nomMembre(membre)}`;
      const r = await viaRoute(ctx, '/roles/member-permissions', { user_id: userId, permissions: carte }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      // La route blanchit les clés financières d'un technicien : on rapporte ce qui a VRAIMENT été appliqué.
      const appliquees: Record<string, boolean> = r.json.permissions && typeof r.json.permissions === 'object' ? r.json.permissions : carte;
      const refusees = effectifs.filter(([k, v]) => appliquees[k] !== v).map(([k]) => k);
      return {
        updated: true,
        user_id: userId,
        name: nomMembre(membre),
        changes: effectifs.filter(([k]) => !refusees.includes(k)).map(([key, value]) => ({ key, value })),
        ...(refusees.length ? { refused: refusees } : {}),
        note: `Permissions de ${nomMembre(membre)} ajustées${refusees.length ? ` — sauf ${refusees.join(', ')} (un technicien ne peut pas voir les montants)` : ''}. Elles sont maintenant personnalisées : un changement du rôle ne les écrasera plus (reset_member_permissions pour revenir au modèle).`,
      };
    }),
};

const resetMemberPermissionsTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'reset_member_permissions',
    description: 'Drop a member\'s custom permissions and put them back on their role\'s preset. Admin/owner only.',
    parameters: {
      type: 'object',
      properties: { user_id: { type: 'string', description: 'Member user id (from get_team).' } },
      required: ['user_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'reset_member_permissions', args, async () => {
      const userId = identifiant(args.user_id, 'user_id', 'get_team');
      const membre = await membreDeLOrg(ctx, userId);
      if (String(membre.role).toLowerCase() === 'owner') throw new Error('Le propriétaire a toujours tous les accès — rien à réinitialiser.');
      const contexte = `la réinitialisation des permissions de ${nomMembre(membre)}`;
      const r = await viaRoute(ctx, '/roles/member-permissions/reset', { user_id: userId }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      return {
        reset: true,
        user_id: userId,
        name: nomMembre(membre),
        role: traduireStatut(membre.role, STATUT_ROLE),
        note: `${nomMembre(membre)} est de retour sur le modèle du rôle ${traduireStatut(membre.role, STATUT_ROLE)}${r.json.template_found === false ? ' (aucun modèle personnalisé dans cette entreprise : ce sont les permissions par défaut de Lume)' : ''}.`,
      };
    }),
};

// ─────────────────────────────────────────────────────────────────
// Exports — à brancher dans tools.ts (AGENT_TOOLS), garde.ts
// (PERMISSION_PAR_OUTIL), registre.ts (REGISTRE_ECRITURES) et topics.ts.
// ─────────────────────────────────────────────────────────────────

export const OUTILS_EQUIPE: AgentTool[] = [
  // lectures
  listTeamsTool,
  listInvitationsTool,
  // membres et invitations
  inviteMemberTool,
  resendInvitationTool,
  revokeInvitationTool,
  updateMemberRoleTool,
  removeMemberTool,
  reactivateMemberTool,
  // équipes
  createTeamTool,
  updateTeamTool,
  deleteTeamTool,
  // taux horaire
  setHourlyRateTool,
  // feuilles de temps
  punchInTool,
  punchOutTool,
  startBreakTool,
  endBreakTool,
  approveTimesheetTool,
  // paie
  addPayrollAdjustmentTool,
  markPayrollPeriodPaidTool,
  unmarkPayrollPeriodPaidTool,
  updatePayrollSettingsTool,
  // rôles
  updateRolePresetTool,
  setMemberPermissionsTool,
  resetMemberPermissionsTool,
];

/** Attributs des ÉCRITURES (mêmes sens que registre.ts : sensible / réversible / vers le client). */
export const REGISTRE_EQUIPE: Record<string, { sensible: boolean; reversible: boolean; vers_client: boolean }> = {
  invite_member:              { sensible: true,  reversible: true,  vers_client: false }, // révocable
  resend_invitation:          { sensible: false, reversible: false, vers_client: false }, // un courriel ne se rappelle pas
  revoke_invitation:          { sensible: true,  reversible: true,  vers_client: false }, // resend la remet en attente
  update_member_role:         { sensible: true,  reversible: true,  vers_client: false },
  remove_member:              { sensible: true,  reversible: true,  vers_client: false }, // suspension, pas effacement
  reactivate_member:          { sensible: true,  reversible: true,  vers_client: false },
  create_team:                { sensible: false, reversible: true,  vers_client: false },
  update_team:                { sensible: false, reversible: true,  vers_client: false },
  delete_team:                { sensible: true,  reversible: false, vers_client: false }, // détache jobs et membres
  set_hourly_rate:            { sensible: true,  reversible: true,  vers_client: false },
  punch_in:                   { sensible: false, reversible: true,  vers_client: false },
  punch_out:                  { sensible: false, reversible: false, vers_client: false }, // ferme la journée et le GPS
  start_break:                { sensible: false, reversible: true,  vers_client: false },
  end_break:                  { sensible: false, reversible: true,  vers_client: false },
  approve_timesheet:          { sensible: true,  reversible: true,  vers_client: false },
  add_payroll_adjustment:     { sensible: true,  reversible: true,  vers_client: false }, // se retire dans Lume › Paie
  mark_payroll_period_paid:   { sensible: true,  reversible: true,  vers_client: false }, // unmark existe
  unmark_payroll_period_paid: { sensible: true,  reversible: true,  vers_client: false },
  update_payroll_settings:    { sensible: true,  reversible: true,  vers_client: false },
  update_role_preset:         { sensible: true,  reversible: true,  vers_client: false },
  set_member_permissions:     { sensible: true,  reversible: true,  vers_client: false },
  reset_member_permissions:   { sensible: true,  reversible: true,  vers_client: false },
};

/** Permission de la page Rôles exigée par chaque outil (même forme que garde.ts). */
export const PERMISSIONS_EQUIPE: Record<string, { cle: PermissionKey; capacite: string }> = {
  list_teams:                 { cle: 'team.read',              capacite: 'la consultation des équipes' },
  list_invitations:           { cle: 'users.invite',           capacite: 'la consultation des invitations' },
  invite_member:              { cle: 'users.invite',           capacite: "l'invitation de membres" },
  resend_invitation:          { cle: 'users.invite',           capacite: "le renvoi d'invitations" },
  revoke_invitation:          { cle: 'users.invite',           capacite: "la révocation d'invitations" },
  update_member_role:         { cle: 'users.update_role',      capacite: 'la modification des rôles' },
  remove_member:              { cle: 'users.disable',          capacite: 'le retrait de membres' },
  reactivate_member:          { cle: 'users.disable',          capacite: 'la réactivation de membres' },
  create_team:                { cle: 'team.update',            capacite: 'la gestion des équipes' },
  update_team:                { cle: 'team.update',            capacite: 'la gestion des équipes' },
  delete_team:                { cle: 'team.update',            capacite: 'la gestion des équipes' },
  set_hourly_rate:            { cle: 'financial.view_reports', capacite: 'la paie (taux horaires)' },
  punch_in:                   { cle: 'timesheets.update',      capacite: 'le pointage' },
  punch_out:                  { cle: 'timesheets.update',      capacite: 'le pointage' },
  start_break:                { cle: 'timesheets.update',      capacite: 'le pointage' },
  end_break:                  { cle: 'timesheets.update',      capacite: 'le pointage' },
  approve_timesheet:          { cle: 'timesheets.update',      capacite: "l'approbation des feuilles de temps" },
  add_payroll_adjustment:     { cle: 'financial.view_reports', capacite: 'la paie' },
  mark_payroll_period_paid:   { cle: 'financial.view_reports', capacite: 'la paie' },
  unmark_payroll_period_paid: { cle: 'financial.view_reports', capacite: 'la paie' },
  update_payroll_settings:    { cle: 'settings.update',        capacite: 'les réglages de paie' },
  update_role_preset:         { cle: 'users.update_role',      capacite: 'la modification des rôles' },
  set_member_permissions:     { cle: 'users.update_role',      capacite: 'la modification des permissions' },
  reset_member_permissions:   { cle: 'users.update_role',      capacite: 'la modification des permissions' },
};

/** Topic « equipe » du routeur : tous les outils de ce module. */
export const TOPICS_EQUIPE: Partial<Record<IdTopic, string[]>> = {
  equipe: OUTILS_EQUIPE.map((t) => t.declaration.name),
};
