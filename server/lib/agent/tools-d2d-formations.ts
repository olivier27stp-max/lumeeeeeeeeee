/* ═══════════════════════════════════════════════════════════════
   Lumi — outils du porte-à-porte (ventes terrain) et des formations
   ─────────────────────────────────────────────────────────────
   Jusqu'ici l'agent ne faisait que LIRE ces deux modules (get_d2d_stats,
   list_courses). Ici, il exécute les gestes de l'utilisateur :

   - Les créations passent par les ROUTES de l'application (`appelInterne`,
     POST au nom de l'utilisateur) : dédoublonnage d'adresse, exclusivité de
     zone, consentement GPS (Loi 25), stats du jour, scoring IA… restent au
     même endroit, sans copie qui dériverait.
   - Les modifications (routes PUT/PATCH, hors de portée d'`appelInterne`)
     sont reflétées directement avec `ctx.client` — le client Supabase à
     l'IDENTITÉ de l'utilisateur (RLS) — et TOUJOURS filtrées sur
     `org_id = ctx.orgId`, même quand la RLS le ferait déjà.

   Toute écriture passe par `executerIdempotent` (une seule exécution par
   intention, mode à blanc, journal), exige l'identité, et ne renvoie jamais
   une erreur brute de la base : une phrase d'exploitant, en français.

   Manifestes exportés (à brancher par le registre central) :
   OUTILS_D2D_FORMATIONS, REGISTRE_D2D_FORMATIONS (attributs des écritures),
   PERMISSIONS_D2D_FORMATIONS (clé de la page Rôles par outil),
   TOPICS_D2D_FORMATIONS (tous dans « equipe »).
   ═══════════════════════════════════════════════════════════════ */
import type { PermissionKey } from '../../../src/lib/permissions';
import type { IdTopic } from '../lumi/topics';
import type { AgentTool, ToolContext } from './tools';
import { appelInterne, AppelInterneIncertain, champRequis, executerIdempotent } from './tools-etendus';

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Un identifiant destiné à un CHEMIN de route (`/houses/${id}/events`) doit
 * être un UUID : on refuse tout le reste avant de construire l'URL — jamais
 * une valeur libre du modèle interpolée dans un chemin.
 */
function identifiant(v: any, nomLisible: string): string {
  const s = champRequis(v, nomLisible);
  if (!UUID_RE.test(s)) throw new Error(`${nomLisible} n'est pas un identifiant valide — reprends-le dans la liste et réessaie.`);
  return s;
}

function dateYmd(v: any, nomLisible: string): string {
  const s = champRequis(v, nomLisible);
  if (!YMD_RE.test(s)) throw new Error(`${nomLisible} doit être une date AAAA-MM-JJ.`);
  return s;
}

function coordonnee(v: any, nomLisible: string, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > max) throw new Error(`${nomLisible} est requis (coordonnée GPS valide).`);
  return n;
}

const clamp = (n: any, def: number, max: number) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(Math.floor(v), max);
};

/** Même politique que tools.ts : jamais d'erreur brute de la base vers le modèle. */
function erreurLecture(scope: string, err: any): { error: string } {
  console.error(`[agent-tool:${scope}]`, err?.message || err);
  return { error: 'La consultation a échoué côté Lume. Dis-le simplement à l’utilisateur et propose de réessayer.' };
}

/**
 * Appelle une route POST de l'application au nom de l'utilisateur. Un refus
 * de la route (400/403/404…) devient une erreur lisible ; une réponse jamais
 * arrivée est signalée comme INCERTAINE (renvoyée, pas levée : l'empreinte
 * d'idempotence est gardée, une retentative ne recrée rien en double).
 */
async function viaRoute(
  ctx: ToolContext,
  chemin: string,
  corps: Record<string, any>,
  refus: string,
): Promise<{ json: any } | { incertain: true; note: string }> {
  let res: { ok: boolean; status: number; json: any };
  try {
    res = await appelInterne(ctx, chemin, corps);
  } catch (e) {
    if (e instanceof AppelInterneIncertain) {
      return {
        incertain: true,
        note: `Je n'ai pas eu la confirmation que ${refus} a été fait — c'est PEUT-ÊTRE le cas. Vérifie dans Lume avant de refaire le geste.`,
      };
    }
    throw e;
  }
  if (!res.ok) {
    const msg = typeof res.json?.error === 'string' && res.json.error.trim() ? res.json.error.trim() : '';
    throw new Error(msg ? `${refus} refusé : ${msg}` : `${refus} refusé (${res.status}).`);
  }
  return { json: res.json ?? {} };
}

const estIncertain = (r: { json: any } | { incertain: true; note: string }): r is { incertain: true; note: string } =>
  (r as any).incertain === true;

/**
 * Modification directe (miroir d'une route PUT/PATCH) : tout échec Supabase
 * est levé tel quel — `executerIdempotent` le journalise et le traduit en
 * phrase d'exploitant. Aucun texte brut n'atteint le modèle.
 */
function verifierEcriture<T>(error: any, data: T, introuvable: string): asserts data is NonNullable<T> {
  if (error) throw error;
  if (!data) throw new Error(introuvable);
}

/** Ne garde que les champs fournis (validerArgs a déjà retiré null/undefined). */
function champsFournis(args: Record<string, any>, cles: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of cles) if (args[k] !== undefined) out[k] = args[k];
  return out;
}

// Libellés français des statuts (CHECK de field_house_profiles.current_status).
const STATUTS_MAISON = ['unknown', 'no_answer', 'not_interested', 'lead', 'quote_sent', 'sale', 'callback', 'do_not_knock', 'revisit'] as const;
export const STATUT_MAISON: Record<string, string> = {
  unknown: 'inconnu',
  no_answer: 'pas de réponse',
  not_interested: 'pas intéressé',
  lead: 'prospect',
  quote_sent: 'devis envoyé',
  sale: 'vente',
  callback: 'à rappeler',
  do_not_knock: 'ne pas cogner',
  revisit: 'à revisiter',
};

// Types d'événements acceptés par POST /houses/:id/events (EVENT_STATUS_MAP + knock/note).
const TYPES_EVENEMENT = ['knock', 'no_answer', 'not_interested', 'callback', 'lead', 'quote_sent', 'revisit', 'sale', 'follow_up', 'note', 'cancel'] as const;

// Étapes canoniques (pipeline_deals_stage_check) et statut secondaire (D2D_STATUSES).
const ETAPES_PIPELINE = ['new_prospect', 'no_response', 'quote_sent', 'closed_won', 'closed_lost'] as const;
const STATUTS_D2D = ['pending', 'follow_up', 'hot', 'cold', 'no_answer'] as const;
const ETAPE_FR: Record<string, string> = {
  new_prospect: 'nouveau prospect', no_response: 'sans réponse', quote_sent: 'devis envoyé', closed_won: 'gagné', closed_lost: 'perdu',
};

// Métriques comptées par le moteur de gamification (METRIC_EVENT_TYPES).
const METRIQUES = ['knocks', 'leads', 'sales', 'quotes_sent', 'callbacks'] as const;

const ETAT_COURS: Record<string, string> = { draft: 'brouillon', published: 'publié', archived: 'archivé' };

// ─────────────────────────────────────────────────────────────────
// PORTE-À-PORTE — lectures
// ─────────────────────────────────────────────────────────────────

const listHouses: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_houses',
    description:
      'List door-to-door houses (pins) of the org, most recently active first, optionally filtered by '
      + 'territory, status or address text. Returns total_matching and the houses with id, address, status, '
      + 'visit count. Use it to get a house id before logging an event or updating a house.',
    parameters: {
      type: 'object',
      properties: {
        territory_id: { type: 'string', description: 'Only houses in this territory (id from list_territories).' },
        status: { type: 'string', enum: [...STATUTS_MAISON], description: 'Only houses with this status.' },
        search: { type: 'string', description: 'Address text to search (partial match).' },
        limit: { type: 'integer', description: 'Max results (default 20, max 50).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const limit = clamp(args.limit, 20, 50);
    let q = ctx.client
      .from('field_house_profiles')
      .select('id, address, current_status, territory_id, assigned_user_id, visit_count, last_activity_at, next_action, next_action_date', { count: 'exact' })
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (args.territory_id) q = q.eq('territory_id', String(args.territory_id));
    if (args.status) q = q.eq('current_status', String(args.status));
    if (args.search) q = q.ilike('address_normalized', `%${String(args.search).toLowerCase().trim()}%`);
    const { data, error, count } = await q;
    if (error) return erreurLecture('list_houses', error);
    const shown = data?.length || 0;
    const total = count ?? shown;
    return {
      total_matching: total,
      shown,
      ...(total > shown ? { note: `Seulement ${shown} des ${total} maisons sont listées ; le total exact est ${total}.` } : {}),
      houses: (data || []).map((h: any) => ({
        id: h.id,
        adresse: h.address,
        statut: STATUT_MAISON[h.current_status] || h.current_status,
        territory_id: h.territory_id,
        assigned_user_id: h.assigned_user_id,
        visites: h.visit_count ?? 0,
        derniere_activite: h.last_activity_at,
        prochaine_action: h.next_action || null,
        prochaine_action_date: h.next_action_date || null,
      })),
    };
  },
};

const listTerritories: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_territories',
    description:
      'List the door-to-door territories (zones) of the org with their assignment, exclusivity and stats '
      + '(pins, knocks, leads, sales, coverage). Use it to get a territory id.',
    parameters: { type: 'object', properties: {} },
  },
  handler: async (_args, ctx) => {
    const { data, error } = await ctx.client
      .from('field_territories')
      .select('id, name, color, assigned_user_id, assigned_team_id, is_exclusive, is_active, total_pins, active_leads, stats_knocks, stats_leads, stats_sales, coverage_percent')
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .order('name', { ascending: true })
      .limit(100);
    if (error) return erreurLecture('list_territories', error);
    return {
      count: data?.length || 0,
      territories: (data || []).map((t: any) => ({
        id: t.id,
        nom: t.name,
        couleur: t.color,
        assigned_user_id: t.assigned_user_id,
        assigned_team_id: t.assigned_team_id,
        exclusif: !!t.is_exclusive,
        actif: t.is_active !== false,
        pins: t.total_pins ?? 0,
        prospects_actifs: t.active_leads ?? 0,
        portes: t.stats_knocks ?? 0,
        prospects: t.stats_leads ?? 0,
        ventes: t.stats_sales ?? 0,
        couverture_pct: Number(t.coverage_percent) || 0,
      })),
    };
  },
};

// ─────────────────────────────────────────────────────────────────
// PORTE-À-PORTE — maisons
// ─────────────────────────────────────────────────────────────────

const createHouse: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_house',
    description:
      'Drop a door-to-door pin: create a house at an address with GPS coordinates. Goes through the app '
      + '(duplicate detection within 50 m — an existing house is merged instead of duplicated; reserved-zone '
      + 'check; auto-creates a client only when customer name AND phone/email are given with a lead/sale/'
      + 'quote_sent status). Ask the user for the address; coordinates are required.',
    parameters: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Street address.' },
        lat: { type: 'number', description: 'Latitude.' },
        lng: { type: 'number', description: 'Longitude.' },
        status: { type: 'string', enum: [...STATUTS_MAISON], description: 'Initial status (default unknown).' },
        note_text: { type: 'string', description: 'Optional note.' },
        territory_id: { type: 'string', description: 'Territory id (optional).' },
        assigned_user_id: { type: 'string', description: 'Rep user id to assign (optional).' },
        customer_name: { type: 'string', description: 'Customer full name (optional).' },
        customer_phone: { type: 'string', description: 'Customer phone (optional).' },
        customer_email: { type: 'string', description: 'Customer email (optional).' },
      },
      required: ['address', 'lat', 'lng'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_house', args, async () => {
      const address = champRequis(args.address, "L'adresse");
      const lat = coordonnee(args.lat, 'La latitude', 90);
      const lng = coordonnee(args.lng, 'La longitude', 180);
      const r = await viaRoute(ctx, '/field-sales/houses', {
        address, lat, lng,
        ...champsFournis(args, ['status', 'note_text', 'territory_id', 'assigned_user_id', 'customer_name', 'customer_phone', 'customer_email']),
      }, "L'ajout de la maison");
      if (estIncertain(r)) return r;
      const merged = r.json?.merged === true;
      return {
        house_id: r.json?.id ?? null,
        client_id: r.json?.client_id ?? null,
        statut: STATUT_MAISON[r.json?.current_status] || r.json?.current_status || null,
        merged,
        note: merged
          ? 'Une maison existait déjà à cette adresse : rien n’a été créé en double, le pin a été fusionné avec elle.'
          : 'La maison est créée et son pin est placé sur la carte.',
      };
    }),
};

const updateHouse: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_house',
    description:
      'Update a door-to-door house (pin): address, coordinates, status, territory or assigned rep. To record a '
      + 'visit outcome (knock, no answer, sale…) use log_house_event instead — it also updates the daily stats.',
    parameters: {
      type: 'object',
      properties: {
        house_id: { type: 'string', description: 'House id (from list_houses).' },
        address: { type: 'string', description: 'New address.' },
        lat: { type: 'number', description: 'New latitude.' },
        lng: { type: 'number', description: 'New longitude.' },
        status: { type: 'string', enum: [...STATUTS_MAISON], description: 'New status.' },
        territory_id: { type: 'string', description: 'Territory id.' },
        assigned_user_id: { type: 'string', description: 'Rep user id.' },
      },
      required: ['house_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_house', args, async () => {
      const id = identifiant(args.house_id, "L'identifiant de la maison");
      const updates: Record<string, any> = champsFournis(args, ['lat', 'lng', 'territory_id', 'assigned_user_id']);
      if (args.address !== undefined) {
        updates.address = champRequis(args.address, "L'adresse");
        updates.address_normalized = String(updates.address).toLowerCase().trim();
      }
      if (args.status !== undefined) updates.current_status = String(args.status);
      if (!Object.keys(updates).length) throw new Error('Rien à modifier : précise au moins un champ.');
      updates.updated_at = new Date().toISOString();
      const { data, error } = await ctx.client
        .from('field_house_profiles')
        .update(updates)
        .eq('id', id)
        .eq('org_id', ctx.orgId)
        .is('deleted_at', null)
        .select('id, current_status')
        .maybeSingle();
      verifierEcriture(error, data, 'Cette maison est introuvable dans l’entreprise.');
      return {
        house_id: data.id,
        statut: STATUT_MAISON[data.current_status] || data.current_status,
        champs_modifies: Object.keys(updates).filter((k) => k !== 'updated_at' && k !== 'address_normalized'),
        note: 'La maison est mise à jour.',
      };
    }),
};

const logHouseEvent: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'log_house_event',
    description:
      'Record a door-to-door visit outcome on a house: knock, no_answer, not_interested, callback, lead, '
      + 'quote_sent, revisit, sale, follow_up, note or cancel. Goes through the app: the house status, the pin '
      + 'colour and the rep’s daily stats are updated; a sale is attributed to the current user.',
    parameters: {
      type: 'object',
      properties: {
        house_id: { type: 'string', description: 'House id (from list_houses).' },
        event_type: { type: 'string', enum: [...TYPES_EVENEMENT], description: 'What happened at the door.' },
        note_text: { type: 'string', description: 'Optional note.' },
      },
      required: ['house_id', 'event_type'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'log_house_event', args, async () => {
      const id = identifiant(args.house_id, "L'identifiant de la maison");
      const eventType = champRequis(args.event_type, 'Le type d’événement');
      const r = await viaRoute(ctx, `/field-sales/houses/${id}/events`, {
        event_type: eventType,
        ...(args.note_text ? { note_text: String(args.note_text) } : {}),
      }, 'L’enregistrement de la visite');
      if (estIncertain(r)) return r;
      return {
        event_id: r.json?.id ?? null,
        house_id: id,
        event_type: eventType,
        note: 'La visite est enregistrée : statut de la maison, couleur du pin et statistiques du jour sont à jour.',
      };
    }),
};

// ─────────────────────────────────────────────────────────────────
// PORTE-À-PORTE — territoires
// ─────────────────────────────────────────────────────────────────

const createTerritory: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_territory',
    description:
      'Create a door-to-door territory (zone) from a polygon of [lng, lat] points (at least 3; the ring is '
      + 'closed automatically). Optional colour and assignment to a rep or a field team.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Territory name.' },
        polygon: {
          type: 'array',
          description: 'Ring of [lng, lat] pairs, e.g. [[-71.2, 46.8], [-71.1, 46.8], [-71.1, 46.9]].',
          items: { type: 'array', items: { type: 'number' } },
        },
        color: { type: 'string', description: 'Hex colour (default #3B82F6).' },
        assigned_user_id: { type: 'string', description: 'Rep user id (optional).' },
        assigned_team_id: { type: 'string', description: 'Field team id (optional).' },
      },
      required: ['name', 'polygon'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_territory', args, async () => {
      const name = champRequis(args.name, 'Le nom du territoire');
      const pts: any[] = Array.isArray(args.polygon) ? args.polygon : [];
      const ring = pts.map((p) => [coordonnee(p?.[0], 'La longitude d’un point', 180), coordonnee(p?.[1], 'La latitude d’un point', 90)]);
      if (ring.length < 3) throw new Error('Le polygone doit avoir au moins 3 points [lng, lat].');
      const [f, l] = [ring[0], ring[ring.length - 1]];
      if (f[0] !== l[0] || f[1] !== l[1]) ring.push([f[0], f[1]]);
      const r = await viaRoute(ctx, '/field-sales/territories', {
        name,
        geojson: { type: 'Polygon', coordinates: [ring] },
        ...champsFournis(args, ['color', 'assigned_user_id', 'assigned_team_id']),
      }, 'La création du territoire');
      if (estIncertain(r)) return r;
      return { territory_id: r.json?.id ?? null, nom: name, note: 'Le territoire est créé et visible sur la carte.' };
    }),
};

const updateTerritory: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_territory',
    description: 'Update a door-to-door territory: name, colour, assigned rep or field team, exclusivity.',
    parameters: {
      type: 'object',
      properties: {
        territory_id: { type: 'string', description: 'Territory id (from list_territories).' },
        name: { type: 'string', description: 'New name.' },
        color: { type: 'string', description: 'Hex colour.' },
        assigned_user_id: { type: 'string', description: 'Rep user id.' },
        assigned_team_id: { type: 'string', description: 'Field team id.' },
        is_exclusive: { type: 'boolean', description: 'Only the assigned rep may drop pins inside.' },
      },
      required: ['territory_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_territory', args, async () => {
      const id = identifiant(args.territory_id, "L'identifiant du territoire");
      const updates = champsFournis(args, ['name', 'color', 'assigned_user_id', 'assigned_team_id', 'is_exclusive']);
      if (updates.name !== undefined) updates.name = champRequis(updates.name, 'Le nom du territoire');
      if (!Object.keys(updates).length) throw new Error('Rien à modifier : précise au moins un champ.');
      updates.updated_at = new Date().toISOString();
      const { data, error } = await ctx.client
        .from('field_territories')
        .update(updates)
        .eq('id', id)
        .eq('org_id', ctx.orgId)
        .is('deleted_at', null)
        .select('id, name')
        .maybeSingle();
      verifierEcriture(error, data, 'Ce territoire est introuvable dans l’entreprise.');
      return { territory_id: data.id, nom: data.name, note: 'Le territoire est mis à jour.' };
    }),
};

// ─────────────────────────────────────────────────────────────────
// PORTE-À-PORTE — représentants et équipes terrain
// ─────────────────────────────────────────────────────────────────

const createRep: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_rep',
    description:
      'Register a team member as a door-to-door sales rep (field profile). Needs the member’s user id '
      + '(from get_team) and a display name.',
    parameters: {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Team member user id.' },
        display_name: { type: 'string', description: 'Name shown on the field leaderboard.' },
        role: { type: 'string', enum: ['sales_rep', 'team_leader', 'manager', 'admin'], description: 'Field role (default sales_rep).' },
      },
      required: ['user_id', 'display_name'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_rep', args, async () => {
      const userId = identifiant(args.user_id, "L'identifiant du membre");
      const displayName = champRequis(args.display_name, 'Le nom affiché');
      const r = await viaRoute(ctx, '/field-sales/reps', {
        user_id: userId, display_name: displayName, ...champsFournis(args, ['role']),
      }, 'L’ajout du représentant');
      if (estIncertain(r)) return r;
      return { rep_id: r.json?.id ?? null, nom: displayName, note: 'Le représentant terrain est créé.' };
    }),
};

const createD2dTeam: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_d2d_team',
    description:
      'Create a door-to-door field team with an optional leader, colour and members (field rep ids from '
      + 'create_rep / the reps list — not user ids).',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Team name.' },
        leader_id: { type: 'string', description: 'Leader field rep id (optional).' },
        color: { type: 'string', description: 'Hex colour (default #6366f1).' },
        member_ids: { type: 'array', items: { type: 'string' }, description: 'Field rep ids to add.' },
      },
      required: ['name'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_d2d_team', args, async () => {
      const name = champRequis(args.name, 'Le nom de l’équipe');
      const memberIds = (Array.isArray(args.member_ids) ? args.member_ids : []).map((m: any) => identifiant(m, "L'identifiant d'un membre"));
      const r = await viaRoute(ctx, '/field-sales/teams', {
        name, ...champsFournis(args, ['leader_id', 'color']), ...(memberIds.length ? { member_ids: memberIds } : {}),
      }, 'La création de l’équipe');
      if (estIncertain(r)) return r;
      return { team_id: r.json?.id ?? null, nom: name, membres: memberIds.length, note: 'L’équipe terrain est créée.' };
    }),
};

// ─────────────────────────────────────────────────────────────────
// PORTE-À-PORTE — pipeline et réglages
// ─────────────────────────────────────────────────────────────────

const updateD2dPipelineItem: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_d2d_pipeline_item',
    description:
      'Move or update a door-to-door pipeline deal: stage (new_prospect, no_response, quote_sent, closed_won, '
      + 'closed_lost), secondary status (pending, follow_up, hot, cold, no_answer), lost reason, or the rep in '
      + 'charge. Non-admins can only touch their own deals.',
    parameters: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'Pipeline deal id.' },
        stage: { type: 'string', enum: [...ETAPES_PIPELINE], description: 'New stage.' },
        d2d_status: { type: 'string', enum: [...STATUTS_D2D], description: 'Secondary status.' },
        lost_reason: { type: 'string', description: 'Why it was lost (with closed_lost).' },
        rep_id: { type: 'string', description: 'User id of the rep in charge.' },
      },
      required: ['deal_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_d2d_pipeline_item', args, async () => {
      const id = identifiant(args.deal_id, "L'identifiant du deal");
      const now = new Date().toISOString();
      const updates: Record<string, any> = champsFournis(args, ['d2d_status', 'lost_reason', 'rep_id']);
      if (args.stage !== undefined) {
        updates.stage = String(args.stage);
        if (updates.stage === 'closed_lost') updates.lost_at = now;
        if (updates.stage === 'closed_won') updates.won_at = now;
      }
      if (!Object.keys(updates).length) throw new Error('Rien à modifier : précise une étape, un statut, une raison ou un représentant.');
      updates.updated_at = now;
      const { data, error } = await ctx.client
        .from('pipeline_deals')
        .update(updates)
        .eq('id', id)
        .eq('org_id', ctx.orgId)
        .is('deleted_at', null)
        .select('id, title, stage, d2d_status')
        .maybeSingle();
      verifierEcriture(error, data, 'Ce deal est introuvable dans l’entreprise (ou il ne t’appartient pas).');
      return {
        deal_id: data.id,
        titre: data.title,
        etape: ETAPE_FR[data.stage] || data.stage,
        statut: data.d2d_status,
        note: 'Le deal est mis à jour dans le pipeline.',
      };
    }),
};

const updateD2dSettings: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_d2d_settings',
    description:
      'Update the org’s door-to-door settings: module enabled, territory restriction, automatic revisit / '
      + 'follow-up delays (days), voice notes, AI summaries, peer payouts visibility.',
    parameters: {
      type: 'object',
      properties: {
        feature_enabled: { type: 'boolean', description: 'Door-to-door module on/off.' },
        territory_restriction_enabled: { type: 'boolean', description: 'Reps limited to their territories.' },
        auto_revisit_days: { type: 'integer', description: 'Days before an automatic revisit.' },
        auto_followup_days: { type: 'integer', description: 'Days before an automatic follow-up.' },
        voice_notes_enabled: { type: 'boolean', description: 'Allow voice notes on pins.' },
        ai_summaries_enabled: { type: 'boolean', description: 'AI summaries of notes.' },
        show_peer_payouts: { type: 'boolean', description: 'Reps see each other’s payouts.' },
      },
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_d2d_settings', args, async () => {
      const updates = champsFournis(args, ['feature_enabled', 'territory_restriction_enabled', 'auto_revisit_days', 'auto_followup_days', 'voice_notes_enabled', 'ai_summaries_enabled', 'show_peer_payouts']);
      for (const k of ['auto_revisit_days', 'auto_followup_days']) {
        if (updates[k] !== undefined && (updates[k] < 0 || updates[k] > 365)) throw new Error('Un délai doit être entre 0 et 365 jours.');
      }
      if (!Object.keys(updates).length) throw new Error('Rien à modifier : précise au moins un réglage.');
      const { data, error } = await ctx.client
        .from('field_settings')
        .upsert({ org_id: ctx.orgId, ...updates, updated_at: new Date().toISOString() }, { onConflict: 'org_id' })
        .select('id')
        .maybeSingle();
      verifierEcriture(error, data, 'Les réglages n’ont pas pu être enregistrés.');
      return { champs_modifies: Object.keys(updates), note: 'Les réglages du porte-à-porte sont enregistrés.' };
    }),
};

// ─────────────────────────────────────────────────────────────────
// SESSIONS TERRAIN
// ─────────────────────────────────────────────────────────────────

/** La session ouverte (active ou en pause) de l'utilisateur, dans SON org. */
async function sessionOuverte(ctx: ToolContext, sessionId: unknown): Promise<{ id: string; status: string }> {
  if (sessionId !== undefined && sessionId !== null && sessionId !== '') {
    return { id: identifiant(sessionId, "L'identifiant de la session"), status: 'unknown' };
  }
  const { data, error } = await ctx.client
    .from('fs_field_sessions')
    .select('id, status')
    .eq('org_id', ctx.orgId)
    .eq('user_id', ctx.userId)
    .in('status', ['active', 'paused'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Aucune session terrain ouverte pour toi en ce moment.');
  return { id: data.id, status: data.status };
}

const startFieldSession: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'start_field_session',
    description:
      'Start the current user’s door-to-door field session (check-in) at their GPS position, optionally in a '
      + 'territory. Requires location-tracking consent; refuses if a session is already open.',
    parameters: {
      type: 'object',
      properties: {
        latitude: { type: 'number', description: 'Current latitude.' },
        longitude: { type: 'number', description: 'Current longitude.' },
        territory_id: { type: 'string', description: 'Territory worked (optional).' },
      },
      required: ['latitude', 'longitude'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'start_field_session', args, async () => {
      const latitude = coordonnee(args.latitude, 'La latitude', 90);
      const longitude = coordonnee(args.longitude, 'La longitude', 180);
      const r = await viaRoute(ctx, '/field-sessions/start', {
        latitude, longitude, ...(args.territory_id ? { territoryId: identifiant(args.territory_id, "L'identifiant du territoire") } : {}),
      }, 'Le démarrage de la session');
      if (estIncertain(r)) return r;
      return { session_id: r.json?.id ?? null, started_at: r.json?.started_at ?? null, note: 'La session terrain est démarrée.' };
    }),
};

const endFieldSession: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'end_field_session',
    description:
      'End (check-out) the current user’s field session at their GPS position. Omit session_id to close their '
      + 'open session. Irreversible: the session is completed and its duration computed.',
    parameters: {
      type: 'object',
      properties: {
        latitude: { type: 'number', description: 'Current latitude.' },
        longitude: { type: 'number', description: 'Current longitude.' },
        session_id: { type: 'string', description: 'Session id (default: the user’s open session).' },
      },
      required: ['latitude', 'longitude'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'end_field_session', args, async () => {
      const latitude = coordonnee(args.latitude, 'La latitude', 90);
      const longitude = coordonnee(args.longitude, 'La longitude', 180);
      const s = await sessionOuverte(ctx, args.session_id);
      const r = await viaRoute(ctx, `/field-sessions/${s.id}/end`, { latitude, longitude }, 'La fin de la session');
      if (estIncertain(r)) return r;
      return {
        session_id: s.id,
        duree_minutes: r.json?.total_duration_minutes ?? null,
        portes_cognees: r.json?.doors_knocked ?? null,
        note: 'La session terrain est terminée.',
      };
    }),
};

const pauseFieldSession: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'pause_field_session',
    description: 'Pause the current user’s active field session. Omit session_id to use their open session.',
    parameters: {
      type: 'object',
      properties: { session_id: { type: 'string', description: 'Session id (default: the user’s open session).' } },
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'pause_field_session', args, async () => {
      const s = await sessionOuverte(ctx, args.session_id);
      if (s.status === 'paused') throw new Error('La session est déjà en pause.');
      const r = await viaRoute(ctx, `/field-sessions/${s.id}/pause`, {}, 'La mise en pause');
      if (estIncertain(r)) return r;
      return { session_id: s.id, note: 'La session terrain est en pause.' };
    }),
};

const resumeFieldSession: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'resume_field_session',
    description: 'Resume the current user’s paused field session. Omit session_id to use their open session.',
    parameters: {
      type: 'object',
      properties: { session_id: { type: 'string', description: 'Session id (default: the user’s open session).' } },
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'resume_field_session', args, async () => {
      const s = await sessionOuverte(ctx, args.session_id);
      if (s.status === 'active') throw new Error('La session est déjà active.');
      const r = await viaRoute(ctx, `/field-sessions/${s.id}/resume`, {}, 'La reprise de la session');
      if (estIncertain(r)) return r;
      return { session_id: s.id, note: 'La session terrain a repris — bonne tournée.' };
    }),
};

// ─────────────────────────────────────────────────────────────────
// GAMIFICATION
// ─────────────────────────────────────────────────────────────────

const createBadge: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_badge',
    description: 'Create a field-sales badge (slug + bilingual name; optional descriptions, icon, colour, category).',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Unique slug, e.g. first_sale.' },
        name_fr: { type: 'string', description: 'French name.' },
        name_en: { type: 'string', description: 'English name (default: same as French).' },
        description_fr: { type: 'string', description: 'French description.' },
        description_en: { type: 'string', description: 'English description.' },
        icon: { type: 'string', description: 'Icon name or emoji.' },
        color: { type: 'string', description: 'Hex colour.' },
        category: { type: 'string', description: 'Category label.' },
      },
      required: ['slug', 'name_fr'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_badge', args, async () => {
      const slug = champRequis(args.slug, 'Le slug du badge').toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
      const nameFr = champRequis(args.name_fr, 'Le nom du badge');
      const r = await viaRoute(ctx, '/gamification/badges', {
        slug, name_fr: nameFr, name_en: args.name_en ? String(args.name_en) : nameFr,
        ...champsFournis(args, ['description_fr', 'description_en', 'icon', 'color', 'category']),
      }, 'La création du badge');
      if (estIncertain(r)) return r;
      return { badge_id: r.json?.id ?? null, slug, nom: nameFr, note: 'Le badge est créé.' };
    }),
};

const createChallenge: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_challenge',
    description:
      'Create a daily or weekly field-sales challenge on a metric (knocks, leads, sales, quotes_sent, callbacks) '
      + 'with an optional target and prize, between two dates. Without a target or prize, propose the card as an open challenge — do not ask.',
    parameters: {
      type: 'object',
      properties: {
        name_fr: { type: 'string', description: 'French name.' },
        name_en: { type: 'string', description: 'English name (default: same as French).' },
        type: { type: 'string', enum: ['daily', 'weekly'], description: 'Challenge cadence.' },
        metric_slug: { type: 'string', enum: [...METRIQUES], description: 'Metric counted.' },
        start_date: { type: 'string', description: 'Start YYYY-MM-DD.' },
        end_date: { type: 'string', description: 'End YYYY-MM-DD.' },
        target_value: { type: 'number', description: 'Target to reach (optional).' },
        description_fr: { type: 'string', description: 'French description.' },
        description_en: { type: 'string', description: 'English description.' },
        prize_description: { type: 'string', description: 'Prize (optional).' },
      },
      required: ['name_fr', 'type', 'metric_slug', 'start_date', 'end_date'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_challenge', args, async () => {
      const nameFr = champRequis(args.name_fr, 'Le nom du défi');
      const startDate = dateYmd(args.start_date, 'La date de début');
      const endDate = dateYmd(args.end_date, 'La date de fin');
      if (endDate < startDate) throw new Error('La date de fin doit suivre la date de début.');
      const r = await viaRoute(ctx, '/gamification/challenges', {
        name_fr: nameFr, name_en: args.name_en ? String(args.name_en) : nameFr,
        type: champRequis(args.type, 'Le type de défi'),
        metric_slug: champRequis(args.metric_slug, 'La métrique'),
        start_date: startDate, end_date: endDate,
        ...champsFournis(args, ['target_value', 'description_fr', 'description_en', 'prize_description']),
      }, 'La création du défi');
      if (estIncertain(r)) return r;
      return { challenge_id: r.json?.id ?? null, nom: nameFr, du: startDate, au: endDate, note: 'Le défi est créé et actif.' };
    }),
};

const createBattle: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_battle',
    description:
      'Create a head-to-head field-sales battle between two reps (user ids) on a metric, between two dates. '
      + 'The challenger defaults to the current user.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Battle name.' },
        metric_slug: { type: 'string', enum: [...METRIQUES], description: 'Metric counted.' },
        opponent_user_id: { type: 'string', description: 'Opponent user id.' },
        challenger_user_id: { type: 'string', description: 'Challenger user id (default: current user).' },
        start_date: { type: 'string', description: 'Start YYYY-MM-DD.' },
        end_date: { type: 'string', description: 'End YYYY-MM-DD.' },
        prize_description: { type: 'string', description: 'Prize (optional).' },
      },
      required: ['name', 'metric_slug', 'opponent_user_id', 'start_date', 'end_date'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_battle', args, async () => {
      const name = champRequis(args.name, 'Le nom du duel');
      const startDate = dateYmd(args.start_date, 'La date de début');
      const endDate = dateYmd(args.end_date, 'La date de fin');
      if (endDate < startDate) throw new Error('La date de fin doit suivre la date de début.');
      const opponent = identifiant(args.opponent_user_id, "L'identifiant de l'adversaire");
      const challenger = args.challenger_user_id ? identifiant(args.challenger_user_id, "L'identifiant du challenger") : ctx.userId;
      if (opponent === challenger) throw new Error('Un duel oppose deux personnes différentes.');
      const r = await viaRoute(ctx, '/gamification/battles', {
        name, type: 'rep_vs_rep',
        metric_slug: champRequis(args.metric_slug, 'La métrique'),
        challenger_user_id: challenger, opponent_user_id: opponent,
        start_date: startDate, end_date: endDate,
        ...champsFournis(args, ['prize_description']),
      }, 'La création du duel');
      if (estIncertain(r)) return r;
      return { battle_id: r.json?.id ?? null, nom: name, du: startDate, au: endDate, note: 'Le duel est créé.' };
    }),
};

// ─────────────────────────────────────────────────────────────────
// FORMATIONS (cours)
// ─────────────────────────────────────────────────────────────────

const createCourse: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_course',
    description:
      'Create a training course (draft by default) with an optional description and audience targeting (roles '
      + 'or user ids). Admin/owner only. Add content with create_course_module then create_course_lesson; make '
      + 'it visible with publish_course.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Course title.' },
        description: { type: 'string', description: 'Description (optional).' },
        status: { type: 'string', enum: ['draft', 'published'], description: 'Initial status (default draft).' },
        target_roles: { type: 'array', items: { type: 'string' }, description: 'Roles targeted (owner, admin, sales_rep, technician).' },
        target_user_ids: { type: 'array', items: { type: 'string' }, description: 'User ids targeted.' },
      },
      required: ['title'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_course', args, async () => {
      const title = champRequis(args.title, 'Le titre de la formation');
      const r = await viaRoute(ctx, '/courses', {
        title, ...champsFournis(args, ['description', 'status', 'target_roles', 'target_user_ids']),
      }, 'La création de la formation');
      if (estIncertain(r)) return r;
      const statut = r.json?.status || 'draft';
      return {
        course_id: r.json?.id ?? null,
        titre: title,
        statut: ETAT_COURS[statut] || statut,
        note: statut === 'published'
          ? 'La formation est créée et déjà publiée pour l’équipe.'
          : 'La formation est créée en brouillon : ajoute des modules et des leçons, puis publie-la.',
      };
    }),
};

const CHAMPS_COURS = ['title', 'description', 'category', 'visibility', 'status', 'target_roles', 'target_user_ids'];

const updateCourse: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_course',
    description: 'Update a training course: title, description, category, visibility (all/assigned), status, audience targeting.',
    parameters: {
      type: 'object',
      properties: {
        course_id: { type: 'string', description: 'Course id (from list_courses).' },
        title: { type: 'string', description: 'New title.' },
        description: { type: 'string', description: 'New description.' },
        category: { type: 'string', description: 'Category label.' },
        visibility: { type: 'string', enum: ['all', 'assigned'], description: 'Who can see it.' },
        status: { type: 'string', enum: ['draft', 'published'], description: 'Status.' },
        target_roles: { type: 'array', items: { type: 'string' }, description: 'Roles targeted.' },
        target_user_ids: { type: 'array', items: { type: 'string' }, description: 'User ids targeted.' },
      },
      required: ['course_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_course', args, async () => {
      const id = identifiant(args.course_id, "L'identifiant de la formation");
      const updates = champsFournis(args, CHAMPS_COURS);
      if (updates.title !== undefined) updates.title = champRequis(updates.title, 'Le titre');
      if (!Object.keys(updates).length) throw new Error('Rien à modifier : précise au moins un champ.');
      updates.updated_at = new Date().toISOString();
      const { data, error } = await ctx.client
        .from('courses')
        .update(updates)
        .eq('id', id)
        .eq('org_id', ctx.orgId)
        .is('deleted_at', null)
        .select('id, title, status')
        .maybeSingle();
      verifierEcriture(error, data, 'Cette formation est introuvable dans l’entreprise.');
      return { course_id: data.id, titre: data.title, statut: ETAT_COURS[data.status] || data.status, note: 'La formation est mise à jour.' };
    }),
};

const publishCourse: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'publish_course',
    description: 'Publish a training course (makes it visible to its audience), or put it back to draft with publish=false.',
    parameters: {
      type: 'object',
      properties: {
        course_id: { type: 'string', description: 'Course id (from list_courses).' },
        publish: { type: 'boolean', description: 'true = publish (default), false = back to draft.' },
      },
      required: ['course_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'publish_course', args, async () => {
      const id = identifiant(args.course_id, "L'identifiant de la formation");
      const status = args.publish === false ? 'draft' : 'published';
      const { data, error } = await ctx.client
        .from('courses')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('org_id', ctx.orgId)
        .is('deleted_at', null)
        .select('id, title, status')
        .maybeSingle();
      verifierEcriture(error, data, 'Cette formation est introuvable dans l’entreprise.');
      return {
        course_id: data.id,
        titre: data.title,
        statut: ETAT_COURS[data.status] || data.status,
        note: status === 'published' ? 'La formation est publiée : l’équipe ciblée la voit maintenant.' : 'La formation est repassée en brouillon.',
      };
    }),
};

const assignCourse: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'assign_course',
    description:
      'Assign a training course to team members (user ids) and/or teams (team ids). Admin/owner only; ids '
      + 'outside the org are ignored by the app.',
    parameters: {
      type: 'object',
      properties: {
        course_id: { type: 'string', description: 'Course id (from list_courses).' },
        user_ids: { type: 'array', items: { type: 'string' }, description: 'User ids.' },
        team_ids: { type: 'array', items: { type: 'string' }, description: 'Team ids.' },
      },
      required: ['course_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'assign_course', args, async () => {
      const id = identifiant(args.course_id, "L'identifiant de la formation");
      const userIds = (Array.isArray(args.user_ids) ? args.user_ids : []).map((u: any) => identifiant(u, "L'identifiant d'un membre"));
      const teamIds = (Array.isArray(args.team_ids) ? args.team_ids : []).map((t: any) => identifiant(t, "L'identifiant d'une équipe"));
      if (!userIds.length && !teamIds.length) throw new Error('Précise au moins un membre ou une équipe à qui assigner la formation.');
      const r = await viaRoute(ctx, `/courses/${id}/assign`, {
        ...(userIds.length ? { user_ids: userIds } : {}), ...(teamIds.length ? { team_ids: teamIds } : {}),
      }, 'L’assignation de la formation');
      if (estIncertain(r)) return r;
      return { course_id: id, membres: userIds.length, equipes: teamIds.length, note: 'La formation est assignée.' };
    }),
};

const createCourseModule: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_course_module',
    description: 'Add a module (chapter) at the end of a training course. Returns the module id to use with create_course_lesson.',
    parameters: {
      type: 'object',
      properties: {
        course_id: { type: 'string', description: 'Course id (from list_courses).' },
        title: { type: 'string', description: 'Module title.' },
      },
      required: ['course_id', 'title'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_course_module', args, async () => {
      const id = identifiant(args.course_id, "L'identifiant de la formation");
      const title = champRequis(args.title, 'Le titre du module');
      const r = await viaRoute(ctx, `/courses/${id}/modules`, { title }, 'L’ajout du module');
      if (estIncertain(r)) return r;
      return { module_id: r.json?.id ?? null, course_id: id, titre: title, note: 'Le module est ajouté à la fin de la formation.' };
    }),
};

const TYPES_LECON = ['video', 'embed', 'text', 'pdf', 'link'] as const;

const createCourseLesson: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_course_lesson',
    description:
      'Add a lesson at the end of a course module: video (video_url), embed (embed_url), text (text_content), '
      + 'pdf or link. Duration in minutes is optional.',
    parameters: {
      type: 'object',
      properties: {
        module_id: { type: 'string', description: 'Module id (from create_course_module).' },
        title: { type: 'string', description: 'Lesson title.' },
        content_type: { type: 'string', enum: [...TYPES_LECON], description: 'Content type (default video).' },
        video_url: { type: 'string', description: 'Video URL.' },
        embed_url: { type: 'string', description: 'Embed URL.' },
        text_content: { type: 'string', description: 'Text body.' },
        duration_min: { type: 'integer', description: 'Duration in minutes.' },
      },
      required: ['module_id', 'title'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_course_lesson', args, async () => {
      const id = identifiant(args.module_id, "L'identifiant du module");
      const title = champRequis(args.title, 'Le titre de la leçon');
      const r = await viaRoute(ctx, `/courses/modules/${id}/lessons`, {
        title, ...champsFournis(args, ['content_type', 'video_url', 'embed_url', 'text_content', 'duration_min']),
      }, 'L’ajout de la leçon');
      if (estIncertain(r)) return r;
      return { lesson_id: r.json?.id ?? null, module_id: id, titre: title, note: 'La leçon est ajoutée à la fin du module.' };
    }),
};

const CHAMPS_LECON = ['title', 'content_type', 'video_url', 'embed_url', 'text_content', 'duration_min', 'sort_order'];

const updateCourseLesson: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_course_lesson',
    description: 'Update a course lesson: title, content type, video/embed URL, text, duration, position.',
    parameters: {
      type: 'object',
      properties: {
        lesson_id: { type: 'string', description: 'Lesson id.' },
        title: { type: 'string', description: 'New title.' },
        content_type: { type: 'string', enum: [...TYPES_LECON], description: 'Content type.' },
        video_url: { type: 'string', description: 'Video URL.' },
        embed_url: { type: 'string', description: 'Embed URL.' },
        text_content: { type: 'string', description: 'Text body.' },
        duration_min: { type: 'integer', description: 'Duration in minutes.' },
        sort_order: { type: 'integer', description: 'Position in the module (0-based).' },
      },
      required: ['lesson_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_course_lesson', args, async () => {
      const id = identifiant(args.lesson_id, "L'identifiant de la leçon");
      const updates = champsFournis(args, CHAMPS_LECON);
      if (updates.title !== undefined) updates.title = champRequis(updates.title, 'Le titre');
      if (!Object.keys(updates).length) throw new Error('Rien à modifier : précise au moins un champ.');

      // course_lessons ne porte pas d'org_id : on remonte leçon → module → cours
      // et on exige que le COURS appartienne à l'org avant toute écriture.
      const { data: lecon, error: lErr } = await ctx.client
        .from('course_lessons').select('id, module_id').eq('id', id).maybeSingle();
      if (lErr) throw lErr;
      const { data: mod, error: mErr } = lecon
        ? await ctx.client.from('course_modules').select('id, course_id').eq('id', lecon.module_id).maybeSingle()
        : { data: null, error: null };
      if (mErr) throw mErr;
      const { data: cours, error: cErr } = mod
        ? await ctx.client.from('courses').select('id').eq('id', mod.course_id).eq('org_id', ctx.orgId).is('deleted_at', null).maybeSingle()
        : { data: null, error: null };
      if (cErr) throw cErr;
      if (!lecon || !mod || !cours) throw new Error('Cette leçon est introuvable dans l’entreprise.');

      updates.updated_at = new Date().toISOString();
      const { data, error } = await ctx.client
        .from('course_lessons')
        .update(updates)
        .eq('id', id)
        .eq('module_id', mod.id)
        .select('id, title')
        .maybeSingle();
      verifierEcriture(error, data, 'Cette leçon est introuvable dans l’entreprise.');
      return { lesson_id: data.id, titre: data.title, note: 'La leçon est mise à jour.' };
    }),
};

// ─────────────────────────────────────────────────────────────────
// Manifestes
// ─────────────────────────────────────────────────────────────────

export const OUTILS_D2D_FORMATIONS: AgentTool[] = [
  // Porte-à-porte — lectures
  listHouses,
  listTerritories,
  // Porte-à-porte — écritures
  createHouse,
  updateHouse,
  logHouseEvent,
  createTerritory,
  updateTerritory,
  createRep,
  createD2dTeam,
  updateD2dPipelineItem,
  updateD2dSettings,
  // Sessions terrain
  startFieldSession,
  endFieldSession,
  pauseFieldSession,
  resumeFieldSession,
  // Gamification
  createBadge,
  createChallenge,
  createBattle,
  // Formations
  createCourse,
  updateCourse,
  publishCourse,
  assignCourse,
  createCourseModule,
  createCourseLesson,
  updateCourseLesson,
];

/**
 * Attributs des ÉCRITURES (même sens que server/lib/agent/registre.ts) :
 * rien ici ne touche à l'argent ni n'atteint un client. Seule la fin d'une
 * session terrain est irréversible (durée figée) — elle est donc sensible.
 * Une visite enregistrée n'est pas défaite proprement non plus (stats du
 * jour, attribution d'une vente) : irréversible, mais pas sensible — sinon
 * chaque porte cognée exigerait une carte de confirmation.
 */
export const REGISTRE_D2D_FORMATIONS: Record<string, { sensible: boolean; reversible: boolean; vers_client: boolean }> = {
  create_house:             { sensible: false, reversible: true,  vers_client: false },
  update_house:             { sensible: false, reversible: true,  vers_client: false },
  log_house_event:          { sensible: false, reversible: false, vers_client: false },
  create_territory:         { sensible: false, reversible: true,  vers_client: false },
  update_territory:         { sensible: false, reversible: true,  vers_client: false },
  create_rep:               { sensible: false, reversible: true,  vers_client: false },
  create_d2d_team:          { sensible: false, reversible: true,  vers_client: false },
  update_d2d_pipeline_item: { sensible: false, reversible: true,  vers_client: false },
  update_d2d_settings:      { sensible: false, reversible: true,  vers_client: false },
  start_field_session:      { sensible: false, reversible: true,  vers_client: false },
  end_field_session:        { sensible: true,  reversible: false, vers_client: false },
  pause_field_session:      { sensible: false, reversible: true,  vers_client: false },
  resume_field_session:     { sensible: false, reversible: true,  vers_client: false },
  create_badge:             { sensible: false, reversible: true,  vers_client: false },
  create_challenge:         { sensible: false, reversible: true,  vers_client: false },
  create_battle:            { sensible: false, reversible: true,  vers_client: false },
  create_course:            { sensible: false, reversible: true,  vers_client: false },
  update_course:            { sensible: false, reversible: true,  vers_client: false },
  publish_course:           { sensible: false, reversible: true,  vers_client: false },
  assign_course:            { sensible: false, reversible: true,  vers_client: false },
  create_course_module:     { sensible: false, reversible: true,  vers_client: false },
  create_course_lesson:     { sensible: false, reversible: true,  vers_client: false },
  update_course_lesson:     { sensible: false, reversible: true,  vers_client: false },
};

/**
 * Clé de la page Rôles par outil (même forme que PERMISSION_PAR_OUTIL).
 * Porte-à-porte : `door_to_door.access` pour lire et pour SA propre session
 * terrain ; `door_to_door.edit` pour les pins, territoires et réglages du
 * module ; `door_to_door.convert` pour faire avancer un deal du pipeline.
 * Représentants, équipes terrain et gamification = gestion d'équipe
 * (`team.update`). Formations : il n'existe AUCUNE clé « courses » dans
 * src/lib/permissions.ts — les routes exigent owner/admin (ou le créateur) ;
 * on retient `team.update` pour toutes les écritures de cours.
 */
export const PERMISSIONS_D2D_FORMATIONS: Record<string, { cle: PermissionKey; capacite: string }> = {
  list_houses:              { cle: 'door_to_door.access',  capacite: 'la consultation du porte-à-porte' },
  list_territories:         { cle: 'door_to_door.access',  capacite: 'la consultation des territoires' },
  create_house:             { cle: 'door_to_door.edit',    capacite: 'l’ajout de pins de vente' },
  update_house:             { cle: 'door_to_door.edit',    capacite: 'la modification des pins de vente' },
  log_house_event:          { cle: 'door_to_door.edit',    capacite: 'l’enregistrement des visites terrain' },
  create_territory:         { cle: 'door_to_door.edit',    capacite: 'la création de territoires' },
  update_territory:         { cle: 'door_to_door.edit',    capacite: 'la modification des territoires' },
  create_rep:               { cle: 'team.update',          capacite: 'la gestion des représentants terrain' },
  create_d2d_team:          { cle: 'team.update',          capacite: 'la gestion des équipes terrain' },
  update_d2d_pipeline_item: { cle: 'door_to_door.convert', capacite: 'l’avancement du pipeline de vente' },
  update_d2d_settings:      { cle: 'door_to_door.edit',    capacite: 'les réglages du porte-à-porte' },
  start_field_session:      { cle: 'door_to_door.access',  capacite: 'les sessions terrain' },
  end_field_session:        { cle: 'door_to_door.access',  capacite: 'les sessions terrain' },
  pause_field_session:      { cle: 'door_to_door.access',  capacite: 'les sessions terrain' },
  resume_field_session:     { cle: 'door_to_door.access',  capacite: 'les sessions terrain' },
  create_badge:             { cle: 'team.update',          capacite: 'la gamification de l’équipe' },
  create_challenge:         { cle: 'team.update',          capacite: 'la gamification de l’équipe' },
  create_battle:            { cle: 'team.update',          capacite: 'la gamification de l’équipe' },
  create_course:            { cle: 'team.update',          capacite: 'la gestion des formations' },
  update_course:            { cle: 'team.update',          capacite: 'la gestion des formations' },
  publish_course:           { cle: 'team.update',          capacite: 'la publication des formations' },
  assign_course:            { cle: 'team.update',          capacite: 'l’assignation des formations' },
  create_course_module:     { cle: 'team.update',          capacite: 'la gestion des formations' },
  create_course_lesson:     { cle: 'team.update',          capacite: 'la gestion des formations' },
  update_course_lesson:     { cle: 'team.update',          capacite: 'la gestion des formations' },
};

/** Tous dans « equipe » (porte-à-porte, formations), chacun une seule fois. */
export const TOPICS_D2D_FORMATIONS: Partial<Record<IdTopic, string[]>> = {
  equipe: OUTILS_D2D_FORMATIONS.map((t) => t.declaration.name),
};
