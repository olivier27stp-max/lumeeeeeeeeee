/* ═══════════════════════════════════════════════════════════════
   Lumi — lot ENTREPRISE, AUTOMATISATIONS et STATISTIQUES
   ─────────────────────────────────────────────────────────────
   Ce que l'écran permet et que Lumi ne savait pas faire (audit des
   outils) : les taxes perçues, la fiche de l'entreprise et son objectif
   de revenus, la gestion des automatisations (supprimer, dupliquer,
   renommer, tout arrêter, partir d'un modèle) et quatre cartes de la
   page Statistiques / Paiements.

   Mêmes règles que tools-reglages.ts et tools-equipe.ts :

   • Une écriture = `kind: 'write'`, `needsIdentity: true`, handler dans
     `executerIdempotent`. Quand l'écran passe par une ROUTE, l'outil
     passe par la même (POST/PATCH via `appelInterne`, DELETE et GET via
     l'appel local ci-dessous, qui porte la même session) : gardes,
     validations et effets de bord restent ceux de l'app. La fiche de
     l'entreprise, que l'écran écrit directement en base, passe par le
     client RLS de l'utilisateur, filtrée par `org_id = ctx.orgId`.
   • JAMAIS le client service_role ici : la RLS reste la garde de fond.
   • Une automatisation créée ou dupliquée par Lumi finit EN BROUILLON.
     Les routes le garantissent déjà ; l'outil le revérifie sur la réponse
     et éteint lui-même la règle si ce n'était pas le cas.
   • Les montants portent un nom en `_cents` (masquage par rôle, garde.ts).
   ═══════════════════════════════════════════════════════════════ */

import type { PermissionKey } from '../../../src/lib/permissions';
import { CATEGORIES_MODELES, normaliser, type CategorieModele } from '../../../src/lib/automationTemplates';
import type { IdTopic } from '../lumi/topics';
import type { AgentTool, ToolContext } from './tools';
import {
  executerIdempotent, champRequis, appelInterne, AppelInterneIncertain,
  dateOrgAujourdhui, bornesJourOrg,
} from './tools-etendus';

/* ── Aides locales ─────────────────────────────────────────────── */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const SESSION_REQUISE = 'Cette action exige votre session Lume — reconnectez le connecteur dans Claude.';

/** Même politique que tools.ts : jamais d'erreur brute vers le modèle (lectures). */
function erreurLecture(scope: string, err: unknown): { error: string } {
  const message = err instanceof Error ? err.message : (err as { message?: unknown } | null)?.message ?? err;
  console.error(`[agent-tool:${scope}]`, message);
  return { error: 'La consultation a échoué côté Lume. Dis-le simplement à l’utilisateur et propose de réessayer.' };
}

/** Un identifiant obligatoire, au format uuid (il part dans un CHEMIN de route : jamais de texte libre). */
function identifiant(v: unknown, nom: string, source: string): string {
  const s = champRequis(v, nom);
  if (!UUID.test(s)) throw new Error(`${nom} n'est pas un identifiant valide — récupère-le via ${source} et réessaie.`);
  return s;
}

/** Un vrai jour du calendrier (« 2026-02-31 » est refusé). */
function jourValide(s: string): boolean {
  if (!YMD.test(s)) return false;
  const [a, m, j] = s.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

interface Periode { du: string; au: string }

/**
 * Période des lectures, comme compare_revenue / get_top_services / build_report :
 * `from` / `to` en AAAA-MM-JJ, par défaut du 1er du mois à aujourd'hui (jour de
 * l'ENTREPRISE, pas d'UTC). Une date mal écrite est refusée au lieu d'être
 * remplacée en silence par le mois courant.
 */
function periodeDemandee(args: Record<string, any>): Periode | { error: string } {
  const brutDu = args.from == null ? '' : String(args.from).trim();
  const brutAu = args.to == null ? '' : String(args.to).trim();
  if (brutDu && !jourValide(brutDu)) return { error: 'La date de début doit être une date réelle au format AAAA-MM-JJ.' };
  if (brutAu && !jourValide(brutAu)) return { error: 'La date de fin doit être une date réelle au format AAAA-MM-JJ.' };
  const au = brutAu || dateOrgAujourdhui();
  const du = brutDu || `${au.slice(0, 7)}-01`;
  return du <= au ? { du, au } : { du: au, au: du };
}

/** Personne n'a choisi de dates : la période est « le mois en cours » par défaut, pas par demande. */
const periodeImplicite = (args: Record<string, any>): boolean => !String(args.from ?? '').trim() && !String(args.to ?? '').trim();

/**
 * Les 12 mois qui finissent le même jour — le repli des statistiques quand le mois en cours est
 * encore vide. Passe en prod du 2026-10-02 : « mes clients me paient surtout comment ? », posée
 * le 2 du mois, recevait « aucun paiement depuis le début d'octobre » ; la question porte sur une
 * habitude, pas sur deux jours. Le repli ne joue JAMAIS quand une date a été demandée.
 */
function douzeDerniersMois(p: Periode): Periode {
  const [annee, mois, jour] = p.au.split('-').map(Number);
  return { du: new Date(Date.UTC(annee - 1, mois - 1, jour + 1)).toISOString().slice(0, 10), au: p.au };
}
const NOTE_PERIODE_ELARGIE = 'Rien depuis le début du mois : ces chiffres portent sur les 12 derniers mois — dis la période dans ta réponse.';

const PARAMETRES_PERIODE = {
  from: { type: 'string', description: 'Start date YYYY-MM-DD (default: 1st of the month).' },
  to: { type: 'string', description: 'End date YYYY-MM-DD (default: today).' },
};

const entier = (v: unknown): number => Math.round(Number(v) || 0);
/** Pourcentage à une décimale ; null quand il n'y a rien à diviser (jamais « 0 % » inventé). */
const pourcentage = (partie: number, total: number): number | null => (total > 0 ? Math.round((partie / total) * 1000) / 10 : null);

/* ── Appels de routes ──────────────────────────────────────────── */

interface ReponseBrute { ok: boolean; status: number; json: any }
type ReponseRoute = { ok: true; json: any } | { ok: false; incertain: true };

const TIMEOUT_ROUTE_MS = Number(process.env.MCP_INTERNAL_TIMEOUT_MS) || 20_000;

/**
 * GET et DELETE d'une route de l'app au nom de l'utilisateur. `appelInterne`
 * (tools-etendus) ne parle que POST/PUT/PATCH ; même adresse, mêmes en-têtes,
 * même délai ici. Une réponse jamais revenue lève `AppelInterneIncertain` :
 * pour un DELETE, l'effet est incertain et ne doit pas être rejoué à l'aveugle.
 */
async function appelSansCorps(ctx: ToolContext, methode: 'GET' | 'DELETE', chemin: string): Promise<ReponseBrute> {
  if (!ctx.accessToken) throw new Error(SESSION_REQUISE);
  const port = Number(process.env.PORT || process.env.API_PORT || 3002);
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), TIMEOUT_ROUTE_MS);
  let r: Response;
  try {
    r = await fetch(`http://127.0.0.1:${port}/api${chemin}`, {
      method: methode,
      headers: { Authorization: `Bearer ${ctx.accessToken}`, 'x-org-id': ctx.orgId },
      signal: ctrl.signal,
    });
  } catch (e) {
    const cause = e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'connexion interrompue';
    console.error(`[lot-entreprise:${methode} ${chemin.split('?')[0]}] pas de réponse (org ${ctx.orgId}) :`, cause);
    throw new AppelInterneIncertain(cause);
  } finally {
    clearTimeout(minuteur);
  }
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}

/** Phrase d'exploitant pour un refus de route (les routes répondent avec des codes). */
function messageRefusRoute(status: number, json: any, contexte: string): string {
  const detail = typeof json?.error === 'string' ? json.error.trim().slice(0, 200) : '';
  if (status === 401) return SESSION_REQUISE;
  if (status === 402) return `Un abonnement Lume actif est requis pour ${contexte}.`;
  if (status === 403) return `Ton rôle dans Lume ne permet pas ${contexte}${detail ? ` (${detail})` : ''}.`;
  if (status === 404) return `Introuvable dans cette entreprise : ${contexte} n'a pas été fait. Vérifie l'identifiant et réessaie.`;
  return detail
    ? `Lume a refusé ${contexte} : ${detail}`
    : `${contexte} n'a pas fonctionné côté Lume (${status}). Dis-le simplement et propose de réessayer.`;
}

/**
 * Écriture par une route. Un refus devient une erreur en français (empreinte
 * libérée : on corrige et on réessaie). Une réponse jamais revenue est rendue
 * `incertain` SANS lever : l'empreinte est gardée, une retentative tombe sur
 * « déjà fait » — jamais deux copies d'une automatisation.
 */
async function viaRoute(
  ctx: ToolContext,
  methode: 'POST' | 'PATCH' | 'DELETE',
  chemin: string,
  corps: Record<string, any>,
  contexte: string,
): Promise<ReponseRoute> {
  let r: ReponseBrute;
  try {
    r = methode === 'DELETE' ? await appelSansCorps(ctx, 'DELETE', chemin) : await appelInterne(ctx, chemin, corps, methode);
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

/** Lecture par une route : toute panne devient une phrase, jamais une exception ni un chiffre inventé. */
async function lireRoute(
  ctx: ToolContext,
  scope: string,
  chemin: string,
  params: Record<string, string>,
): Promise<ReponseBrute | { error: string }> {
  if (!ctx.accessToken) return { error: SESSION_REQUISE };
  const qs = new URLSearchParams(params).toString();
  try {
    return await appelSansCorps(ctx, 'GET', qs ? `${chemin}?${qs}` : chemin);
  } catch (e) {
    if (e instanceof AppelInterneIncertain) return { error: 'Lume n’a pas répondu à temps. Dis-le simplement à l’utilisateur et propose de réessayer.' };
    return erreurLecture(scope, e);
  }
}

function refusLecture(scope: string, r: ReponseBrute, quoi: string): { error: string } {
  if (r.status === 401) return { error: SESSION_REQUISE };
  if (r.status === 402) return { error: `Un abonnement Lume actif est requis pour consulter ${quoi}.` };
  if (r.status === 403) return { error: `Ton rôle dans Lume ne permet pas de consulter ${quoi}.` };
  return erreurLecture(scope, typeof r.json?.error === 'string' ? `${r.status} ${r.json.error}` : r.status);
}

/** Les fonctions de statistiques refusent par 42501 (« Not allowed ») : on le dit en clair. */
function erreurStatistique(scope: string, err: { code?: string; message?: string }): { error: string } {
  if (err.code === '42501') return { error: 'Ton rôle dans Lume ne donne pas accès aux statistiques de l’entreprise.' };
  return erreurLecture(scope, err);
}

/* ════════════════════════════════════════════════════════════════
   TAXES PERÇUES
   ════════════════════════════════════════════════════════════════ */

const getTaxesCollected: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_taxes_collected',
    description: 'Sales taxes collected over a period (invoices fully paid in the period), total and split per tax with registration numbers. Use for tax remittance questions; get_tax_config only shows the rates.',
    parameters: { type: 'object', properties: { ...PARAMETRES_PERIODE } },
  },
  handler: async (args, ctx) => {
    const p = periodeDemandee(args);
    if ('error' in p) return p;
    // La route de la carte « Taxes perçues » de Finances : mêmes chiffres que l'écran.
    const r = await lireRoute(ctx, 'taxes_collected', '/taxes/collected', { from: p.du, to: p.au });
    if ('error' in r) return r;
    if (!r.ok) return refusLecture('taxes_collected', r, 'les taxes perçues');
    const lignes: any[] = Array.isArray(r.json?.taxes) ? r.json.taxes : [];
    const configure = r.json?.configured === true && lignes.length > 0;
    return {
      periode: p,
      definition: 'taxes des factures entièrement payées dans la période',
      total_tax_cents: entier(r.json?.total_cents),
      taxes: lignes.map((t) => ({
        name: String(t?.name ?? ''),
        rate: Number(t?.rate) || 0,
        tax_cents: entier(t?.cents),
        registration_number: t?.registration_number || null,
      })),
      note: configure
        ? 'Répartition selon les taux du groupe de taxes par défaut : exacte si les factures portent toutes ces taxes, estimée sinon. À valider avec le comptable avant une déclaration.'
        : 'Aucun groupe de taxes par défaut : seul le total est connu, sans répartition par taxe.',
    };
  },
};

/* ════════════════════════════════════════════════════════════════
   FICHE DE L'ENTREPRISE
   ════════════════════════════════════════════════════════════════ */

/** Champs texte de Réglages › Entreprise : colonne → [longueur max (CHECK en base), libellé]. */
const CHAMPS_ENTREPRISE = {
  company_name: [200, 'le nom de l’entreprise'],
  phone: [50, 'le téléphone'],
  email: [320, 'le courriel'],
  website: [500, 'le site web'],
  street1: [500, 'l’adresse'],
  street2: [500, 'le complément d’adresse'],
  city: [200, 'la ville'],
  province: [200, 'la province'],
  postal_code: [20, 'le code postal'],
  country: [200, 'le pays'],
} as const;
type ChampEntreprise = keyof typeof CHAMPS_ENTREPRISE;
const COLONNES_ENTREPRISE = `${Object.keys(CHAMPS_ENTREPRISE).join(', ')}, revenue_goal_cents`;

/** integer en base : au-delà, Postgres refuse en jargon. */
const OBJECTIF_MAX_CENTS = 2_147_483_647;

/**
 * Les mêmes contrôles que l'écran (CompanySettings.handleSave) AVANT toute
 * écriture : courriel plausible, site web préfixé de https:// puis vérifié,
 * longueurs des CHECK de la table. Ces valeurs partent sur les devis, les
 * factures et les courriels : une adresse fausse y échoue en silence.
 */
function changementsEntreprise(args: Record<string, any>): Record<string, string | number> {
  const maj: Record<string, string | number> = {};
  for (const champ of Object.keys(CHAMPS_ENTREPRISE) as ChampEntreprise[]) {
    if (args[champ] === undefined || args[champ] === null) continue;
    const [max, libelle] = CHAMPS_ENTREPRISE[champ];
    let valeur = String(args[champ]).trim();
    if (champ === 'company_name' && !valeur) throw new Error('Le nom de l’entreprise ne peut pas être vide.');
    if (champ === 'email' && valeur && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valeur)) throw new Error('Adresse courriel invalide.');
    if (champ === 'website' && valeur) {
      if (!/^https?:\/\//i.test(valeur)) valeur = `https://${valeur}`;
      if (!/^https?:\/\/[^\s.]+\.\S{2,}/i.test(valeur)) throw new Error('Adresse du site web invalide.');
    }
    if (valeur.length > max) throw new Error(`C’est trop long pour ${libelle} (${max} caractères au plus).`);
    maj[champ] = valeur;
  }
  if (args.revenue_goal_cents !== undefined && args.revenue_goal_cents !== null) {
    const cents = Number(args.revenue_goal_cents);
    if (!Number.isInteger(cents) || cents < 0 || cents > OBJECTIF_MAX_CENTS) {
      throw new Error('L’objectif de revenus doit être un montant entier en cents, positif (ex. 50000000 pour 500 000 $).');
    }
    maj.revenue_goal_cents = cents;
  }
  if (Object.keys(maj).length === 0) throw new Error('Rien à modifier : précise au moins un champ (nom, téléphone, courriel, adresse, site web, objectif de revenus).');
  return maj;
}

const updateCompanySettings: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_company_settings',
    description: 'Change the company\'s own details (name, phone, email, website, address) or its ANNUAL revenue goal. Only the fields given change. These details appear on quotes, invoices and emails. Read them with get_company_info.',
    parameters: {
      type: 'object',
      properties: {
        company_name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        website: { type: 'string' },
        street1: { type: 'string', description: 'Street address.' },
        street2: { type: 'string', description: 'Suite, unit.' },
        city: { type: 'string' },
        province: { type: 'string' },
        postal_code: { type: 'string' },
        country: { type: 'string' },
        revenue_goal_cents: { type: 'integer', description: 'Annual revenue goal in CENTS (0 = none).' },
      },
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_company_settings', args, async () => {
      const maj = changementsEntreprise(args);
      const refusRole = 'Seuls le propriétaire ou un administrateur peuvent modifier les informations de l’entreprise.';

      const { data: existantes, error: lectureErr } = await ctx.client
        .from('company_settings')
        .select('id, city')
        .eq('org_id', ctx.orgId)
        .limit(1);
      if (lectureErr) throw lectureErr;
      const actuelle = (existantes ?? [])[0] as { id: string; city: string | null } | undefined;

      // Comme l'écran : une ville changée à la main perd ses coordonnées météo
      // (sinon l'accueil garderait la météo de l'ancienne ville).
      const villeChangee = typeof maj.city === 'string' && maj.city !== (actuelle?.city ?? '');
      const charge = {
        ...maj,
        ...(villeChangee ? { weather_lat: null, weather_lng: null } : {}),
        updated_at: new Date().toISOString(),
      };

      // Fiche existante : mise à jour ; sinon création sur org_id (jamais une 2e fiche pour la même entreprise).
      const { data, error } = actuelle
        ? await ctx.client.from('company_settings').update(charge).eq('org_id', ctx.orgId).select(COLONNES_ENTREPRISE)
        : await ctx.client.from('company_settings').upsert({ ...charge, org_id: ctx.orgId, created_by: ctx.userId }, { onConflict: 'org_id' }).select(COLONNES_ENTREPRISE);
      if (error) throw error;
      // La RLS filtre sans erreur : 0 ligne = rôle sans le droit, pas un succès.
      const ligne = ((data ?? []) as unknown as Array<Record<string, unknown>>)[0];
      if (!ligne) throw new Error(refusRole);

      // Le nom de l'espace suit le nom de l'entreprise, comme à l'écran. La fiche
      // est déjà enregistrée : un raté ici est un avertissement, pas une erreur.
      let avertissement: string | null = null;
      if (typeof maj.company_name === 'string') {
        const { data: orgs, error: orgErr } = await ctx.client.from('orgs').update({ name: maj.company_name }).eq('id', ctx.orgId).select('id');
        if (orgErr || !orgs?.length) {
          console.error('[agent-tool:update_company_settings] nom de l’espace non synchronisé', ctx.orgId, orgErr?.message ?? 'aucune ligne');
          avertissement = 'La fiche est à jour, mais le nom affiché dans le sélecteur d’entreprise n’a pas suivi : à corriger dans Réglages › Entreprise.';
        }
      }

      return {
        updated: true,
        champs_modifies: Object.keys(maj),
        entreprise: {
          company_name: ligne.company_name ?? null,
          phone: ligne.phone ?? null,
          email: ligne.email ?? null,
          website: ligne.website ?? null,
          street1: ligne.street1 ?? null,
          street2: ligne.street2 ?? null,
          city: ligne.city ?? null,
          province: ligne.province ?? null,
          postal_code: ligne.postal_code ?? null,
          country: ligne.country ?? null,
          revenue_goal_cents: entier(ligne.revenue_goal_cents),
        },
        ...(avertissement ? { warning: avertissement } : {}),
        note: 'Informations de l’entreprise mises à jour : elles apparaîtront sur les prochains devis, factures et courriels. L’objectif de revenus est annuel.',
      };
    }),
};

/* ════════════════════════════════════════════════════════════════
   AUTOMATISATIONS
   ════════════════════════════════════════════════════════════════ */

interface RegleAutomatisation {
  id: string;
  name: string;
  is_active: boolean | null;
  is_preset: boolean | null;
}

/** La règle DE CE BUREAU, hors corbeille — ou une erreur lisible. */
async function regleDuBureau(ctx: ToolContext, id: string): Promise<RegleAutomatisation> {
  const { data, error } = await ctx.client
    .from('automation_rules')
    .select('id, name, is_active, is_preset')
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Automatisation introuvable dans cette entreprise — elle a peut-être été supprimée. Vérifie avec list_automations.');
  return data as RegleAutomatisation;
}

/**
 * « Déjà fait » ne vaut que si la règle créée existe encore : supprimée puis
 * redemandée dans les 10 minutes, elle est recréée (même garde que
 * create_automation_from_text, lue ici avec le client de l'utilisateur).
 */
const regleEncorePresente = (ctx: ToolContext) => async (resultat: Record<string, any>): Promise<boolean> => {
  const id = typeof resultat.rule_id === 'string' ? resultat.rule_id : '';
  if (!id) return true;
  const { data, error } = await ctx.client
    .from('automation_rules')
    .select('id, deleted_at, purged_at')
    .eq('org_id', ctx.orgId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const regle = data as { deleted_at?: string | null; purged_at?: string | null } | null;
  return !!regle && !regle.deleted_at && !regle.purged_at;
};

interface NouvelleRegle { rule_id: string | null; name: string | null; is_active: false | null; avertissement?: string }

/**
 * RIEN ne doit partir chez un client parce que Lumi a créé ou copié une
 * automatisation. Les routes écrivent `is_active: false` ; on ne les croit pas
 * sur parole : si la réponse ne dit pas « brouillon », l'outil éteint la règle
 * lui-même (même écriture que la dépublication de l'écran) et, s'il n'y
 * arrive pas, le DIT au lieu d'annoncer un brouillon.
 */
async function garantirBrouillon(ctx: ToolContext, outil: string, json: any): Promise<NouvelleRegle> {
  const id = typeof json?.id === 'string' && UUID.test(json.id) ? json.id : null;
  const name = typeof json?.name === 'string' ? json.name : null;
  if (!id) {
    return { rule_id: null, name, is_active: null, avertissement: 'Lume n’a pas renvoyé la nouvelle automatisation : vérifie dans Automatisations qu’elle est bien en brouillon.' };
  }
  if (json.is_active === false) return { rule_id: id, name, is_active: false };
  const { data, error } = await ctx.client
    .from('automation_rules')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .select('id, is_active');
  const eteinte = !error && (data ?? []).length > 0 && (data as Array<{ is_active: boolean | null }>)[0].is_active === false;
  if (!eteinte) {
    console.error(`[agent-tool:${outil}] brouillon non confirmé`, ctx.orgId, id, error?.message ?? 'aucune ligne');
    return { rule_id: id, name, is_active: null, avertissement: 'Je n’ai pas pu confirmer que la nouvelle automatisation est en brouillon : ouvre-la dans Automatisations et mets-la en pause avant toute chose.' };
  }
  return { rule_id: id, name, is_active: false };
}

const deleteAutomationRule: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_automation_rule',
    description: 'Move an automation to the bin: it stops and its scheduled sends are cancelled (restorable from the Automations screen). Built-in automations cannot be deleted: pause them with toggle_automation_rule.',
    parameters: {
      type: 'object',
      properties: { rule_id: { type: 'string', description: 'Automation rule id (from list_automations).' } },
      required: ['rule_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_automation_rule', args, async () => {
      const id = identifiant(args.rule_id, 'L’automatisation', 'list_automations');
      const regle = await regleDuBureau(ctx, id);
      if (regle.is_preset) {
        throw new Error(`« ${regle.name} » est une automatisation fournie par Lume : elle ne se supprime pas. Mets-la en pause (toggle_automation_rule), l’effet est le même.`);
      }
      const contexte = 'la suppression de l’automatisation';
      // La route annule d'abord les envois déjà prévus, puis met à la corbeille.
      const r = await viaRoute(ctx, 'DELETE', `/automations/rules/${id}`, {}, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      return {
        deleted: true,
        rule_id: id,
        name: regle.name,
        etait_active: regle.is_active === true,
        note: 'Automatisation mise à la corbeille : elle ne part plus et ses envois déjà prévus sont annulés. Elle se restaure depuis la corbeille de l’écran Automatisations, où elle reviendra en brouillon.',
      };
    }, {
      // Restaurée entre-temps puis redemandée : ce n'est plus « déjà fait ».
      encoreValable: async (resultat) => !(await regleEncorePresente(ctx)(resultat)),
    }),
};

const duplicateAutomationRule: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'duplicate_automation_rule',
    description: 'Copy an automation as a new DRAFT (paused) named "... (copie)", to change it without touching the original. Nothing is sent until the copy is enabled with toggle_automation_rule.',
    parameters: {
      type: 'object',
      properties: { rule_id: { type: 'string', description: 'Automation rule id to copy (from list_automations).' } },
      required: ['rule_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'duplicate_automation_rule', args, async () => {
      const id = identifiant(args.rule_id, 'L’automatisation', 'list_automations');
      // La route copierait aussi une règle à la corbeille : on la refuse ici.
      const source = await regleDuBureau(ctx, id);
      const contexte = 'la duplication de l’automatisation';
      const r = await viaRoute(ctx, 'POST', `/automations/rules/${id}/duplicate`, {}, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      const copie = await garantirBrouillon(ctx, 'duplicate_automation_rule', r.json);
      return {
        duplicated: true,
        rule_id: copie.rule_id,
        name: copie.name,
        copie_de: source.name,
        is_active: copie.is_active,
        ...(copie.avertissement ? { warning: copie.avertissement } : {}),
        note: 'Copie créée EN BROUILLON : rien ne partira tant qu’elle n’est pas activée. L’originale n’a pas changé.',
      };
    }, { encoreValable: regleEncorePresente(ctx) }),
};

const renameAutomationRule: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'rename_automation_rule',
    description: 'Rename an automation. Its steps, messages and on/off state are untouched (to reword a message use update_automation_message).',
    parameters: {
      type: 'object',
      properties: {
        rule_id: { type: 'string', description: 'Automation rule id (from list_automations).' },
        name: { type: 'string', description: 'New name (max 120 characters).' },
      },
      required: ['rule_id', 'name'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'rename_automation_rule', args, async () => {
      const id = identifiant(args.rule_id, 'L’automatisation', 'list_automations');
      const nom = champRequis(args.name, 'Le nouveau nom');
      if (nom.length > 120) throw new Error('Le nom d’une automatisation fait au plus 120 caractères.');
      const regle = await regleDuBureau(ctx, id);
      if (regle.name === nom) throw new Error(`L’automatisation s’appelle déjà « ${nom} » : rien à changer.`);
      const contexte = 'le changement de nom de l’automatisation';
      // Le PATCH de l'éditeur : il détache une copie liée de son modèle et
      // propage le nom aux copies des autres bureaux, comme à l'écran.
      const r = await viaRoute(ctx, 'PATCH', `/automations/rules/${id}`, { name: nom }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      const copies = Array.isArray(r.json?.copies) ? r.json.copies.length : 0;
      return {
        updated: true,
        rule_id: id,
        name: typeof r.json?.name === 'string' ? r.json.name : nom,
        ancien_nom: regle.name,
        ...(copies ? { copies_dans_d_autres_bureaux: copies } : {}),
        note: 'Automatisation renommée. Son parcours, ses messages et son état (active ou en pause) n’ont pas changé.',
      };
    }),
};

const pauseAllAutomations: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'pause_all_automations',
    description: 'The company-wide emergency switch: stop EVERY automation at once (no automatic text, email or task), queue kept; or resume them with paused=false, which lets queued sends go out. For a single automation use toggle_automation_rule.',
    parameters: {
      type: 'object',
      properties: { paused: { type: 'boolean', description: 'true = stop everything (default), false = resume.' } },
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'pause_all_automations', args, async () => {
      if (args.paused !== undefined && args.paused !== null && typeof args.paused !== 'boolean') {
        throw new Error('Précise s’il faut tout arrêter (true) ou reprendre (false).');
      }
      const enPause = args.paused !== false;
      const contexte = enPause ? 'l’arrêt de toutes les automatisations' : 'la reprise des automatisations';
      // L'interrupteur de l'écran Automatisations : il vide aussi le cache du moteur (effet immédiat).
      const r = await viaRoute(ctx, 'POST', '/automations/pause', { paused: enPause }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      // L'état RÉEL relu par la route, pas celui demandé.
      const reel = r.json?.paused === true;
      if (reel !== enPause) {
        throw new Error(enPause
          ? 'Les automatisations ne sont PAS arrêtées : le changement n’a pas été appliqué. Réessaie, ou arrête-les depuis l’écran Automatisations.'
          : 'Les automatisations sont toujours en pause : le changement n’a pas été appliqué. Réessaie, ou reprends-les depuis l’écran Automatisations.');
      }
      return {
        updated: true,
        paused: reel,
        note: reel
          ? 'Toutes les automatisations de l’entreprise sont arrêtées : plus aucun texto ni courriel automatique ne part, aucune tâche n’est créée. Ce qui était prévu est conservé et repartira à la reprise.'
          : 'Les automatisations ont repris : ce qui était en attente repart où c’en était, y compris les messages aux clients.',
      };
    }, {
      // Rebasculé à l'écran depuis : l'état mémorisé ne vaut plus, on refait.
      encoreValable: async (resultat) => {
        const { data, error } = await ctx.client
          .from('company_settings')
          .select('automations_paused')
          .eq('org_id', ctx.orgId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return (data?.automations_paused === true) === (resultat.paused === true);
      },
    }),
};

const LIBELLE_CANAL: Record<string, [fr: string, en: string]> = {
  sms: ['texto', 'text'],
  courriel: ['courriel', 'email'],
  tache: ['tâche', 'task'],
  notification: ['notification', 'notification'],
  avis: ['demande d’avis', 'review request'],
  pipeline: ['pipeline', 'pipeline'],
};
const CLES_CATEGORIES = CATEGORIES_MODELES.map((c) => c.cle);

const listAutomationTemplates: AgentTool = {
  kind: 'read',
  declaration: {
    name: 'list_automation_templates',
    description: 'Library of ready-made automation templates: key, name, trigger, channels (what each does: pass category or search). Source of template_key. A vague request like "automate my reminders" names no template: ask ONE question first (which reminders: appointments, invoices, quotes?).',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: [...CLES_CATEGORIES], description: 'Only this category.' },
        search: { type: 'string', description: 'Words to find in the name or description.' },
        language: { type: 'string', enum: ['fr', 'en'], description: 'Language of names (default fr).' },
      },
    },
  },
  handler: async (args) => {
    const fr = args.language !== 'en';
    const categorie = args.category == null || String(args.category).trim() === '' ? null : String(args.category);
    if (categorie && !(CLES_CATEGORIES as string[]).includes(categorie)) {
      return { error: `Catégorie inconnue. Choix : ${CLES_CATEGORIES.join(', ')}.` };
    }
    const recherche = normaliser(String(args.search ?? ''));
    const [{ MODELES_AUTOMATISATION }, { trouverDeclencheur }] = await Promise.all([
      import('../automationTemplates'),
      import('../../../src/lib/automationCatalogue'),
    ]);
    const nomCategorie = (cle: CategorieModele) => {
      const c = CATEGORIES_MODELES.find((x) => x.cle === cle);
      return c ? (fr ? c.fr : c.en) : cle;
    };
    const modeles = MODELES_AUTOMATISATION.filter((m) => {
      if (categorie && m.categorie !== categorie) return false;
      if (!recherche) return true;
      // Le français ET l'anglais : la demande arrive dans l'une ou l'autre langue.
      return normaliser([m.nom.fr, m.nom.en, m.description.fr, m.description.en, nomCategorie(m.categorie)].join(' ')).includes(recherche);
    });
    const filtre = Boolean(categorie || recherche);
    return {
      count: modeles.length,
      templates: modeles.map((m) => {
        const declencheur = trouverDeclencheur(m.declencheur);
        return {
          template_key: m.id,
          name: fr ? m.nom.fr : m.nom.en,
          // Sans filtre, les 43 modèles avec leur description pèsent 12 000 caractères (≈ 3 500 tokens relus à chaque
          // étape du tour) : la liste complète donne le nom et le déclencheur, le détail vient avec category ou search.
          ...(filtre ? { description: fr ? m.description.fr : m.description.en } : {}),
          category: nomCategorie(m.categorie),
          trigger: declencheur ? (fr ? declencheur.fr : declencheur.en) : m.declencheur,
          channels: m.canaux.map((c) => LIBELLE_CANAL[c]?.[fr ? 0 : 1] ?? c),
          steps: m.nb_etapes,
        };
      }),
      note: modeles.length
        ? `Modèles de la bibliothèque Lume. En utiliser un crée une copie EN BROUILLON dans l’entreprise : rien ne part tant qu’elle n’est pas activée.${filtre ? '' : ' Liste abrégée : ce que fait chaque modèle s’obtient avec category ou search.'}`
        : 'Aucun modèle ne correspond. Élargis la recherche, ou décris l’automatisation voulue pour la créer sur mesure (create_automation_from_text).',
    };
  },
};

const createAutomationFromTemplate: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_automation_from_template',
    description: 'Start an automation from a library template, as a DRAFT (paused): nothing is sent until enabled with toggle_automation_rule. Only when the template does exactly what is asked; if it does more (an extra channel or step) or several could fit, use create_automation_from_text or ask.',
    parameters: {
      type: 'object',
      properties: { template_key: { type: 'string', description: 'Template key from list_automation_templates.' } },
      required: ['template_key'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_automation_from_template', args, async () => {
      const cle = champRequis(args.template_key, 'Le modèle').toLowerCase();
      const inconnu = 'Ce modèle n’existe pas dans la bibliothèque — choisis-en un avec list_automation_templates.';
      // Le même format que la route (lettres minuscules, chiffres, _) : rien d'autre ne part.
      if (!/^[a-z0-9_]{1,80}$/.test(cle)) throw new Error(inconnu);
      const [{ trouverModele }, { trouverDeclencheur }] = await Promise.all([
        import('../automationTemplates'),
        import('../../../src/lib/automationCatalogue'),
      ]);
      const modele = trouverModele(cle);
      if (!modele) throw new Error(inconnu);
      const contexte = 'la création de l’automatisation à partir du modèle';
      // « Utiliser ce modèle » de l'écran : UNE copie, en brouillon, dans l'entreprise de la session.
      const r = await viaRoute(ctx, 'POST', '/automations/templates/utiliser', { templateId: modele.id }, contexte);
      if (!r.ok) return resultatIncertain(contexte);
      const creee = await garantirBrouillon(ctx, 'create_automation_from_template', r.json);
      return {
        created: true,
        rule_id: creee.rule_id,
        name: creee.name ?? modele.nom.fr,
        modele: modele.nom.fr,
        declencheur: trouverDeclencheur(modele.declencheur)?.fr ?? modele.declencheur,
        etapes: modele.nb_etapes,
        is_active: creee.is_active,
        ...(creee.avertissement ? { warning: creee.avertissement } : {}),
        note: 'Automatisation créée EN BROUILLON à partir du modèle : rien ne partira tant qu’elle n’est pas activée. Ses textes se relisent et s’ajustent dans Automatisations avant de l’activer.',
      };
    }, { encoreValable: regleEncorePresente(ctx) }),
};

/* ════════════════════════════════════════════════════════════════
   STATISTIQUES — les fonctions de la page Statistiques (rpc_insights_*)
   ════════════════════════════════════════════════════════════════ */

/** Mêmes arguments que src/lib/statistiquesApi.ts, sans filtre (toute l'entreprise). */
const argsStatistique = (ctx: ToolContext, p: Periode) => ({ p_org: ctx.orgId, p_from: p.du, p_to: p.au, p_filtres: {} });

const getQuoteWinRate: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_quote_win_rate',
    description: 'Win rate of the quotes CREATED in a period: how many and how much were approved, still pending or lost, plus the pipeline deals won vs lost. Same figures as the Statistics page. For the list of quotes use list_quotes.',
    parameters: { type: 'object', properties: { ...PARAMETRES_PERIODE } },
  },
  handler: async (args, ctx) => {
    const demandee = periodeDemandee(args);
    if ('error' in demandee) return demandee;
    let p: Periode = demandee;
    const lire = (periode: Periode) => Promise.all([
      ctx.client.rpc('rpc_insights_soumissions', argsStatistique(ctx, periode)),
      ctx.client.rpc('rpc_insights_pipeline_velocity', argsStatistique(ctx, periode)),
    ]);
    const ligne = (data: unknown) => (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
    let [devis, deals] = await lire(p);
    if (devis.error) return erreurStatistique('quote_win_rate', devis.error);
    let elargie = false;
    if (periodeImplicite(args) && entier(ligne(devis.data)?.nombre) === 0) {
      const large = douzeDerniersMois(p);
      const [devisLarge, dealsLarge] = await lire(large);
      if (!devisLarge.error && entier(ligne(devisLarge.data)?.nombre) > 0) { p = large; devis = devisLarge; deals = dealsLarge; elargie = true; }
    }
    const s = ligne(devis.data);
    const creees = entier(s?.nombre);
    const gagnees = entier(s?.approuvees);
    const enAttente = entier(s?.en_attente);
    const valeur = entier(s?.valeur_cents);
    const valeurGagnee = entier(s?.valeur_approuvee_cents);

    // Les deals : un plus, jamais un motif d'échec — mais on dit qu'ils manquent.
    let pipeline: Record<string, unknown> | null = null;
    if (deals.error) {
      console.error('[agent-tool:quote_win_rate:deals]', deals.error.message);
    } else {
      const d = ligne(deals.data);
      const gagnes = entier(d?.won_deals);
      const perdus = entier(d?.lost_deals);
      pipeline = { deals_gagnes: gagnes, deals_perdus: perdus, taux_de_gain_pct: pourcentage(gagnes, gagnes + perdus) };
    }

    return {
      periode: p,
      ...(elargie ? { periode_elargie: true } : {}),
      definition: 'soumissions CRÉÉES dans la période ; gagnée = approuvée ou convertie ; en attente = brouillon, envoyée sans réponse ou modifications demandées',
      soumissions_creees: creees,
      gagnees,
      en_attente: enAttente,
      perdues_ou_fermees: Math.max(0, creees - gagnees - enAttente),
      taux_de_gain_pct: pourcentage(gagnees, creees),
      taux_de_gain_sur_les_decidees_pct: pourcentage(gagnees, creees - enAttente),
      valeur_creee_cents: valeur,
      valeur_gagnee_cents: valeurGagnee,
      valeur_en_attente_cents: entier(s?.valeur_en_attente_cents),
      taux_de_gain_en_valeur_pct: pourcentage(valeurGagnee, valeur),
      pipeline,
      note: creees === 0
        ? 'Aucune soumission créée sur cette période : pas de taux à calculer.'
        : `${elargie ? `${NOTE_PERIODE_ELARGIE} ` : ''}Montants taxes incluses.${pipeline ? ' « pipeline » = deals créés dans la période, gagnés / (gagnés + perdus).' : ' Les deals du pipeline n’ont pas pu être lus.'}`,
    };
  },
};

const LIBELLE_MODE_PAIEMENT: Record<string, string> = {
  card: 'carte',
  'e-transfer': 'virement Interac',
  cash: 'comptant',
  check: 'chèque',
  other: 'autre ou non précisé',
};

const getPaymentMethodsBreakdown: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_payment_methods_breakdown',
    description: 'Money collected in a period split by payment method (card, e-transfer, cash, cheque), net of refunds, with each share. Same figures as the Statistics page. For individual payments use list_payments.',
    parameters: { type: 'object', properties: { ...PARAMETRES_PERIODE } },
  },
  handler: async (args, ctx) => {
    const demandee = periodeDemandee(args);
    if ('error' in demandee) return demandee;
    let p: Periode = demandee;
    const lire = (periode: Periode) => ctx.client.rpc('rpc_insights_payment_mix', argsStatistique(ctx, periode));
    const repartition = (data: unknown) => ((Array.isArray(data) ? data : []) as Array<{ method: string | null; cents: number | null }>)
      .map((r) => ({ method: String(r.method || 'other'), amount_cents: entier(r.cents) }));
    const somme = (l: Array<{ amount_cents: number }>) => l.reduce((s, x) => s + x.amount_cents, 0);
    const { data, error } = await lire(p);
    if (error) return erreurStatistique('payment_mix', error);
    let lignes = repartition(data);
    let elargie = false;
    if (periodeImplicite(args) && somme(lignes) === 0) {
      const large = douzeDerniersMois(p);
      const second = await lire(large);
      const lignesLarges = second.error ? [] : repartition(second.data);
      if (somme(lignesLarges) > 0) { p = large; lignes = lignesLarges; elargie = true; }
    }
    const total = somme(lignes);
    return {
      periode: p,
      ...(elargie ? { periode_elargie: true } : {}),
      definition: 'encaissé par mode de paiement, remboursements déduits ; paiements enregistrés seulement (une facture importée déjà payée n’a pas de mode)',
      total_cents: total,
      modes: lignes.map((l) => ({
        method: l.method,
        mode: LIBELLE_MODE_PAIEMENT[l.method] ?? l.method,
        amount_cents: l.amount_cents,
        part_pct: pourcentage(l.amount_cents, total),
      })),
      note: elargie ? NOTE_PERIODE_ELARGIE : lignes.length ? 'Répartition de ce qui a été encaissé sur la période.' : 'Aucun paiement enregistré sur cette période.',
    };
  },
};

const getTeamPerformance: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_team_performance',
    description: 'Performance of each named TEAM for jobs created in a period: jobs, completed jobs, completion rate, revenue and average job value. Same figures as the Statistics page. Teams, not individual members.',
    parameters: { type: 'object', properties: { ...PARAMETRES_PERIODE } },
  },
  handler: async (args, ctx) => {
    const demandee = periodeDemandee(args);
    if ('error' in demandee) return demandee;
    let p: Periode = demandee;
    const lire = (periode: Periode) => ctx.client.rpc('rpc_insights_team_performance', argsStatistique(ctx, periode));
    const lignes = (data: unknown) => ((Array.isArray(data) ? data : []) as Array<Record<string, unknown>>).map((r) => ({
      team_id: r.team_id ?? null,
      team: String(r.team_name || '—'),
      jobs: entier(r.jobs_count),
      jobs_completes: entier(r.jobs_completed),
      taux_de_completion_pct: Number(r.completion_rate) || 0,
      revenue_cents: entier(r.revenue_cents),
      avg_job_value_cents: entier(r.avg_job_value_cents),
    }));
    const { data, error } = await lire(p);
    if (error) return erreurStatistique('team_performance', error);
    let equipes = lignes(data);
    let elargie = false;
    // Des équipes, mais aucun job créé depuis le début du mois : même repli que les autres statistiques.
    if (periodeImplicite(args) && equipes.length && equipes.every((e) => e.jobs === 0)) {
      const large = douzeDerniersMois(p);
      const second = await lire(large);
      const equipesLarges = second.error ? [] : lignes(second.data);
      if (equipesLarges.some((e) => e.jobs > 0)) { p = large; equipes = equipesLarges; elargie = true; }
    }
    return {
      periode: p,
      ...(elargie ? { periode_elargie: true } : {}),
      definition: 'équipes actives ; jobs CRÉÉS dans la période ; revenu et valeur moyenne = total des jobs complétés',
      count: equipes.length,
      equipes,
      note: equipes.length
        ? `${elargie ? `${NOTE_PERIODE_ELARGIE} ` : ''}Classées par revenu. Un job sans équipe assignée n’apparaît dans aucune ligne.`
        : 'Aucune équipe active dans cette entreprise : les équipes se créent dans Lume › Équipes.',
    };
  },
};

/* ════════════════════════════════════════════════════════════════
   VERSEMENTS STRIPE
   ════════════════════════════════════════════════════════════════ */

const STATUT_VERSEMENT: Record<string, string> = {
  paid: 'versé',
  pending: 'en attente',
  in_transit: 'en transit',
  canceled: 'annulé',
  failed: 'échoué',
};

const listStripePayouts: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_stripe_payouts',
    description: 'Stripe payouts to the company bank account: balance available and on the way, deposited this week and month, and the payouts created in a period (date, arrival, status, amount). Payments received from clients are in list_payments.',
    parameters: {
      type: 'object',
      properties: {
        ...PARAMETRES_PERIODE,
        limit: { type: 'integer', description: 'Max payouts (default 20, max 50).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const p = periodeDemandee(args);
    if ('error' in p) return p;
    const brutLimite = Number(args.limit);
    const limite = Number.isFinite(brutLimite) && brutLimite > 0 ? Math.min(Math.floor(brutLimite), 50) : 20;
    // Les deux routes de l'onglet Versements (Paiements). Bornes = jours de l'entreprise.
    const base = { orgId: ctx.orgId, provider: 'stripe' };
    const [liste, resume] = await Promise.all([
      lireRoute(ctx, 'payouts_list', '/payments/payouts/list', {
        ...base, limit: String(limite), date_from: bornesJourOrg(p.du).debut, date_to: bornesJourOrg(p.au).fin,
      }),
      lireRoute(ctx, 'payouts_summary', '/payments/payouts/summary', base),
    ]);
    if ('error' in liste) return liste;
    const nonConnecte = liste.status === 409 || (!('error' in resume) && resume.json?.meta?.source === 'not_connected');
    if (nonConnecte) {
      return {
        connected: false,
        payouts: [],
        note: 'Aucun compte Stripe n’est connecté à cette entreprise : il n’y a pas de versements à consulter. La connexion se fait dans Réglages › Paiements.',
      };
    }
    if (!liste.ok) return refusLecture('payouts_list', liste, 'les versements Stripe');

    const items: any[] = Array.isArray(liste.json?.items) ? liste.json.items : [];
    const versements = items.map((v) => ({
      payout_id: String(v?.id ?? ''),
      created_at: v?.date ?? null,
      arrival_date: v?.arrival_date ?? null,
      status: String(v?.status ?? 'unknown'),
      statut: STATUT_VERSEMENT[String(v?.status ?? '')] ?? String(v?.status ?? 'inconnu'),
      amount_cents: entier(v?.net),
      currency: String(v?.currency ?? '').toUpperCase() || null,
      method: v?.method ?? null,
    }));
    // Le solde : un plus. Illisible, on le dit — jamais un « 0 $ » inventé.
    const soldeLu = !('error' in resume) && resume.ok;
    const solde = soldeLu
      ? {
        available_cents: entier(resume.json?.available),
        on_the_way_cents: entier(resume.json?.on_the_way),
        deposited_week_cents: entier(resume.json?.deposited_week),
        deposited_month_cents: entier(resume.json?.deposited_month),
        currency: String(resume.json?.currency ?? '').toUpperCase() || null,
      }
      : null;
    return {
      connected: true,
      periode: p,
      solde,
      count: versements.length,
      total_period_cents: versements.filter((v) => v.status !== 'failed' && v.status !== 'canceled').reduce((s, v) => s + v.amount_cents, 0),
      has_more: liste.json?.has_more === true,
      payouts: versements,
      note: [
        versements.length ? 'Versements CRÉÉS dans la période (hors échoués et annulés pour le total).' : 'Aucun versement créé sur cette période.',
        liste.json?.has_more === true ? `Seuls les ${versements.length} plus récents sont listés : le total de la période est partiel.` : '',
        soldeLu ? '' : 'Le solde Stripe n’a pas pu être lu.',
      ].filter(Boolean).join(' '),
    };
  },
};

/* ════════════════════════════════════════════════════════════════
   Exports — fusionnés par outils-domaines.ts
   ════════════════════════════════════════════════════════════════ */

export const OUTILS_LOT_ENTREPRISE: AgentTool[] = [
  // Taxes
  getTaxesCollected,
  // Entreprise
  updateCompanySettings,
  // Automatisations
  listAutomationTemplates, createAutomationFromTemplate, duplicateAutomationRule, renameAutomationRule, deleteAutomationRule, pauseAllAutomations,
  // Statistiques
  getQuoteWinRate, getPaymentMethodsBreakdown, getTeamPerformance,
  // Versements
  listStripePayouts,
];

/**
 * Attributs des ÉCRITURES (même sens que registre.ts). Aucune n'atteint
 * directement un client : une automatisation créée ou copiée naît en
 * brouillon, la corbeille se restaure, l'arrêt général se reprend.
 */
export const REGISTRE_LOT_ENTREPRISE: Record<string, { sensible: boolean; reversible: boolean; vers_client: boolean }> = {
  update_company_settings:         { sensible: true,  reversible: true, vers_client: false }, // ce qui s'imprime sur les devis, factures et courriels
  create_automation_from_template: { sensible: true,  reversible: true, vers_client: false }, // brouillon ; se supprime dans l'app
  duplicate_automation_rule:       { sensible: false, reversible: true, vers_client: false }, // brouillon
  rename_automation_rule:          { sensible: false, reversible: true, vers_client: false },
  delete_automation_rule:          { sensible: true,  reversible: true, vers_client: false }, // corbeille, mais les envois prévus sont annulés
  pause_all_automations:           { sensible: true,  reversible: true, vers_client: false }, // la reprise relance les envois en attente
};

/** Clé de la page Rôles exigée par chaque outil (même format que PERMISSION_PAR_OUTIL). */
export const PERMISSIONS_LOT_ENTREPRISE: Record<string, { cle: PermissionKey; capacite: string }> = {
  get_taxes_collected:             { cle: 'financial.view_reports',   capacite: 'la consultation des taxes perçues' },
  update_company_settings:         { cle: 'settings.update',          capacite: 'la modification des informations de l’entreprise' },
  list_automation_templates:       { cle: 'automations.read',         capacite: 'la consultation des modèles d’automatisation' },
  create_automation_from_template: { cle: 'automations.update',       capacite: 'la création des automatisations' },
  duplicate_automation_rule:       { cle: 'automations.update',       capacite: 'la duplication des automatisations' },
  rename_automation_rule:          { cle: 'automations.update',       capacite: 'la modification des automatisations' },
  delete_automation_rule:          { cle: 'automations.update',       capacite: 'la suppression des automatisations' },
  pause_all_automations:           { cle: 'automations.update',       capacite: 'l’arrêt et la reprise des automatisations' },
  get_quote_win_rate:              { cle: 'financial.view_analytics', capacite: 'les statistiques de soumissions' },
  get_payment_methods_breakdown:   { cle: 'financial.view_analytics', capacite: 'les statistiques de paiements' },
  get_team_performance:            { cle: 'financial.view_analytics', capacite: 'les statistiques des équipes' },
  list_stripe_payouts:             { cle: 'financial.view_payments',  capacite: 'la consultation des versements Stripe' },
};

/** Topic du routeur pour chaque outil (chaque nom exactement une fois). */
export const TOPICS_LOT_ENTREPRISE: Partial<Record<IdTopic, string[]>> = {
  facturation: ['get_taxes_collected', 'get_payment_methods_breakdown', 'list_stripe_payouts'],
  devis: ['get_quote_win_rate'],
  equipe: ['get_team_performance'],
  rapports: [
    'update_company_settings',
    'list_automation_templates', 'create_automation_from_template', 'duplicate_automation_rule', 'rename_automation_rule', 'delete_automation_rule', 'pause_all_automations',
  ],
};
