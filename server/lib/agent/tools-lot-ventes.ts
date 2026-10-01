/* ═══════════════════════════════════════════════════════════════
   Lume Agent — lot « ventes » (audit de couverture, 2026-10-01)
   ─────────────────────────────────────────────────────────────
   Ce que l'application laisse faire à un vendeur et que Lumi ne
   savait pas faire : créer et corriger un deal du pipeline, marquer
   un devis approuvé à la main, poser un rabais ou un dépôt sur un
   devis, lire et saisir le consentement commercial d'un client,
   consulter les archives et en ressortir un élément.

   Mêmes règles que les autres modules de domaine :
   • chaque écriture passe par executerIdempotent ;
   • quand l'écran appelle une RPC ou une route, on appelle la MÊME
     (pipeline_creer_deal, rpc_recalculate_quote, set_deal_stage,
     /dsr/consent, restore_client / restore_lead / restore_job) ;
     sinon l'écriture se fait avec le client RLS de la personne ;
   • jamais le client service_role ;
   • tout accès base est filtré par org_id = ctx.orgId ;
   • aucun texte d'erreur Postgres ne remonte au modèle.

   Deux faits du schéma à garder en tête :
   • `deals` n'a PAS de colonne de montant : il est dérivé (job liée,
     devis lié, dernier devis du client — pipeline_montants). À la
     création, la base transforme l'estimation en devis brouillon
     rattaché ; ensuite, le montant se change sur ce devis.
   • `quotes.discount_value` / `deposit_value` sont un pourcentage OU
     des dollars selon `*_type` ; les montants en cents (discount_cents,
     total_cents) sont recalculés par la base, jamais écrits ici.
   ═══════════════════════════════════════════════════════════════ */

import type { PermissionKey } from '../../../src/lib/permissions';
import type { IdTopic } from '../lumi/topics';
import type { AgentTool, ToolContext } from './tools';
import { baseLegalePour, type AncragesTacite, type BaseLegale } from '../consentement/base-legale';
import {
  executerIdempotent, champRequis, appelInterne, AppelInterneIncertain,
  traduireStatut, STATUT_DEVIS,
} from './tools-etendus';
import { etapesDesignees } from './tools-leads';

/* ── Helpers locaux ───────────────────────────────────────────── */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Garde-fou contre une faute de frappe : un deal estimé à plus de 1 000 000 $. */
const MONTANT_DEAL_MAX_CENTS = 100_000_000;

type EtapePipeline = Parameters<typeof etapesDesignees>[0][number];
interface PipelineVentes { id: string; name: string; is_default: boolean }
interface FicheClient {
  id: string; first_name: string | null; last_name: string | null; company: string | null;
  display_as_company: boolean | null; status: string | null;
}
interface ErreurBase { code?: string; message?: string }

const texteOuNull = (v: unknown): string | null => {
  const s = v == null ? '' : String(v).trim();
  return s || null;
};

const sansAccentMin = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function nomAffiche(r: Partial<FicheClient> | null | undefined): string {
  if (!r) return '';
  if (r.display_as_company && r.company) return String(r.company);
  return `${r.first_name || ''} ${r.last_name || ''}`.trim() || String(r.company || '');
}

const nomsEtapes = (etapes: EtapePipeline[]) => etapes.map((e) => `« ${e.name_fr} »`).join(', ');

/** Lecture ratée : le brut reste dans les logs, le modèle reçoit une phrase d'exploitant. */
function erreurLecture(scope: string, err: unknown): { error: string } {
  const e = err as ErreurBase | null;
  console.error(`[agent-tool:ventes:${scope}]`, e?.code || '', e?.message || err);
  return { error: 'La consultation a échoué côté Lume. Dis-le simplement à l’utilisateur et propose de réessayer.' };
}

/** Écriture ratée en base : on journalise le brut, on lève une phrase humaine. */
function echecEcriture(action: string, err: unknown): never {
  const e = err as ErreurBase | null;
  console.error(`[agent-tool:ventes] ${action}`, e?.code || '', e?.message || err);
  throw new Error(`Impossible de ${action}. Dis-le simplement à l’utilisateur et propose de réessayer.`);
}

/** Un identifiant obligatoire, au format uuid (sinon Postgres répondrait en jargon). */
function identifiant(v: unknown, nom: string, source: string): string {
  const s = champRequis(v, nom);
  if (!UUID.test(s)) throw new Error(`${nom} n’est pas un identifiant valide — récupère-le via ${source} et réessaie.`);
  return s;
}

function identifiantOptionnel(v: unknown, nom: string, source: string): string | null {
  if (v == null || String(v).trim() === '') return null;
  return identifiant(v, nom, source);
}

function dateYmd(v: unknown, nom: string): string {
  const s = champRequis(v, nom);
  if (!YMD.test(s) || Number.isNaN(Date.parse(`${s}T12:00:00Z`))) throw new Error(`${nom} doit être une date au format AAAA-MM-JJ.`);
  return s;
}

const dollars = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
const enDollars = (cents: number) => dollars.format(cents / 100);

/** Le client (ou prospect) existe-t-il DANS CETTE ORG ? Lu sous la RLS de la personne. */
async function clientDeLOrg(ctx: ToolContext, clientId: string, colonnes = ''): Promise<FicheClient & Record<string, unknown>> {
  const { data, error } = await ctx.client
    .from('clients')
    .select(`id, first_name, last_name, company, display_as_company, status${colonnes ? `, ${colonnes}` : ''}`)
    .eq('org_id', ctx.orgId).eq('id', clientId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) echecEcriture('retrouver le client', error);
  if (!data) throw new Error('Client introuvable dans cette entreprise — cherche-le d’abord avec search_clients.');
  return data as unknown as FicheClient & Record<string, unknown>;
}

/** Un membre de l'équipe ayant un compte — les seuls à qui l'écran permet d'assigner un deal. */
async function membreDeLOrg(ctx: ToolContext, userId: string): Promise<string> {
  const { data, error } = await ctx.client
    .from('team_members')
    .select('user_id, first_name, last_name, email')
    .eq('org_id', ctx.orgId).eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  if (error) echecEcriture('retrouver le membre de l’équipe', error);
  if (!data) throw new Error('Ce membre ne fait pas partie de l’équipe de cette entreprise — consulte get_team.');
  return `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() || String(data.email ?? '');
}

async function pipelinesDeLOrg(ctx: ToolContext): Promise<PipelineVentes[]> {
  const { data, error } = await ctx.client.from('pipelines_ventes').select('id, name, is_default, position')
    .eq('org_id', ctx.orgId).is('archived_at', null)
    .order('position', { ascending: true }).order('name', { ascending: true });
  if (error) echecEcriture('lire les pipelines', error);
  return (data ?? []) as PipelineVentes[];
}

async function etapesDuPipeline(ctx: ToolContext, pipelineId: string): Promise<EtapePipeline[]> {
  const { data, error } = await ctx.client.from('pipeline_stages').select('id, name_fr, name_en, kind, position')
    .eq('org_id', ctx.orgId).eq('pipeline_id', pipelineId).is('archived_at', null)
    .order('position', { ascending: true });
  if (error) echecEcriture('lire les étapes du pipeline', error);
  return (data ?? []) as EtapePipeline[];
}

/** Le devis, sous la RLS de la personne, dans CETTE org et non supprimé. */
async function lireDevis(ctx: ToolContext, quoteId: string, colonnes: string): Promise<Record<string, unknown>> {
  const { data, error } = await ctx.client
    .from('quotes')
    .select(colonnes)
    .eq('org_id', ctx.orgId).eq('id', quoteId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) echecEcriture('retrouver le devis', error);
  if (!data) throw new Error('Devis introuvable dans cette entreprise — vérifie le numéro avec list_quotes.');
  return data as unknown as Record<string, unknown>;
}

/* ═══════════════════════════════════════════════════════════════
   PIPELINE DE VENTES — créer et corriger un deal
   ═══════════════════════════════════════════════════════════════ */

/** Les exceptions de pipeline_creer_deal sont des phrases françaises écrites pour l'écran (P0001). */
function refusCreationDeal(err: ErreurBase): never {
  console.error('[agent-tool:ventes] pipeline_creer_deal', err.code || '', err.message || '');
  if (err.code === 'P0001' && err.message) throw new Error(`Impossible de créer le deal : ${String(err.message).slice(0, 160)}.`);
  throw new Error('Impossible de créer le deal. Dis-le simplement à l’utilisateur et propose de réessayer.');
}

const createDeal: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_deal',
    description:
      'Create a deal on the sales pipeline board for an EXISTING client or lead (same as « New deal »). '
      + 'A client keeps one open deal per pipeline. For a brand-new contact, create_lead first.',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client or lead id (from search_clients / search_leads).' },
        title: { type: 'string', description: 'Deal title (optional; the card shows the client name otherwise).' },
        amount_cents: { type: 'integer', description: 'Estimated value in CENTS (optional). Stored as a draft quote linked to the deal.' },
        stage: { type: 'string', description: 'Open stage name as shown on the board (default: first stage). See list_deals.' },
        pipeline: { type: 'string', description: 'Pipeline name when the company has several (default: main pipeline).' },
        assigned_user_id: { type: 'string', description: 'Owner: member user id (from get_team). Optional.' },
        expected_close_date: { type: 'string', description: 'Target close date, YYYY-MM-DD. Optional.' },
      },
      required: ['client_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_deal', args, async () => {
      // 1. Entrées — tout est refusé AVANT la moindre écriture.
      const clientId = identifiant(args.client_id, 'Le client', 'search_clients');
      const titre = texteOuNull(args.title)?.slice(0, 200) ?? null;
      let montant: number | null = null;
      if (args.amount_cents !== undefined && args.amount_cents !== null && args.amount_cents !== '') {
        const n = Number(args.amount_cents);
        if (!Number.isInteger(n) || n < 0) throw new Error('Le montant du deal doit être un nombre entier de cents, positif (ex. 35000 pour 350 $).');
        if (n > MONTANT_DEAL_MAX_CENTS) throw new Error(`Le montant (${enDollars(n)}) dépasse ce que Lumi accepte pour un deal (${enDollars(MONTANT_DEAL_MAX_CENTS)}) — vérifie qu’il est bien en cents.`);
        montant = n > 0 ? n : null;
      }
      const vendeurId = identifiantOptionnel(args.assigned_user_id, 'Le responsable', 'get_team');
      const dateVisee = texteOuNull(args.expected_close_date) ? dateYmd(args.expected_close_date, 'La date de fermeture visée') : null;
      const etapeDemandee = texteOuNull(args.stage);
      const pipelineDemande = texteOuNull(args.pipeline);

      // 2. Lectures sous RLS : le client, le pipeline, l'étape, le responsable.
      const client = await clientDeLOrg(ctx, clientId);
      const nomClient = nomAffiche(client) || 'ce client';
      const pipelines = await pipelinesDeLOrg(ctx);
      let pipeline: PipelineVentes | null = null;
      if (pipelineDemande) {
        const voulu = sansAccentMin(pipelineDemande);
        pipeline = pipelines.find((p) => sansAccentMin(p.name) === voulu) ?? pipelines.find((p) => sansAccentMin(p.name).includes(voulu)) ?? null;
        if (!pipeline) {
          throw new Error(pipelines.length
            ? `Aucun pipeline nommé « ${pipelineDemande} ». Pipelines : ${pipelines.map((p) => `« ${p.name} »`).join(', ')}.`
            : 'Cette entreprise n’a pas encore de pipeline de ventes — crée le deal sans préciser de pipeline, Lume en posera un.');
        }
      } else {
        pipeline = pipelines.find((p) => p.is_default) ?? pipelines[0] ?? null;
      }

      let premiere: EtapePipeline | null = null;
      let cible: EtapePipeline | null = null;
      if (pipeline) {
        const ouvertes = (await etapesDuPipeline(ctx, pipeline.id)).filter((e) => e.kind === 'open');
        premiere = ouvertes[0] ?? null;
        if (!premiere) throw new Error(`Le pipeline « ${pipeline.name} » n’a aucune étape ouverte — ajoute-en une dans Lume avant d’y créer un deal.`);
        if (etapeDemandee) {
          const candidates = etapesDesignees(ouvertes, etapeDemandee);
          if (candidates.length === 0) throw new Error(`Aucune étape ouverte « ${etapeDemandee} » dans ce pipeline. Étapes : ${nomsEtapes(ouvertes)}. (Gagné ou perdu : crée le deal, puis update_deal_stage.)`);
          if (candidates.length > 1) throw new Error(`« ${etapeDemandee} » désigne plusieurs étapes (${nomsEtapes(candidates)}) : précise laquelle.`);
          cible = candidates[0];
        }
        // Un seul deal ouvert par client et par pipeline (règle de la base). On le dit
        // AVANT d'appeler la fonction : elle rattacherait sinon un devis estimatif au
        // deal existant, ce que personne n'a demandé.
        const { data: ouverts, error: errOuverts } = await ctx.client.from('deals')
          .select('id, title, stage_id')
          .eq('org_id', ctx.orgId).eq('pipeline_id', pipeline.id).eq('client_id', clientId)
          .is('deleted_at', null)
          .in('stage_id', ouvertes.map((e) => e.id))
          .limit(1);
        if (errOuverts) echecEcriture('vérifier les deals ouverts du client', errOuverts);
        const existant = ((ouverts ?? []) as Array<{ id: string; title: string | null; stage_id: string }>)[0];
        if (existant) {
          const etape = ouvertes.find((e) => e.id === existant.stage_id);
          return {
            created: false, existing: true,
            deal: { id: existant.id, title: existant.title || nomClient, client: nomClient, etape: etape?.name_fr ?? null },
            note: `${nomClient} a déjà un deal ouvert dans « ${pipeline.name} » — rien n’a été créé. Pour le corriger : update_deal ; pour changer son étape : update_deal_stage.`,
          };
        }
      } else if (etapeDemandee) {
        throw new Error('Cette entreprise n’a pas encore de pipeline de ventes : crée le deal sans préciser d’étape, Lume posera le pipeline de base.');
      }
      const nomVendeur = vendeurId ? await membreDeLOrg(ctx, vendeurId) : null;

      // 3. Même fonction que « Nouveau deal » (creerDealManuel) : elle dérive l'org de
      //    la session, vérifie « leads.create », pose le deal à la première étape
      //    ouverte et transforme l'estimation en devis brouillon rattaché.
      const { data, error } = await ctx.client.rpc('pipeline_creer_deal', {
        p_first_name: nomClient,
        p_last_name: null,
        p_email: null,
        p_phone: null,
        p_address: null,
        p_montant_cents: montant,
        p_assigne_a: vendeurId,
        p_date_fermeture_visee: dateVisee,
        p_source: null,
        p_client_id: clientId,
        p_quote_id: null,
        p_pipeline_id: pipeline?.id ?? null,
      });
      if (error) refusCreationDeal(error as ErreurBase);
      const r = (data ?? {}) as { deal_id?: string; deal_existant?: boolean };
      if (!r.deal_id) throw new Error('Le deal n’a pas été créé — Lume n’a rien renvoyé. Propose de réessayer.');
      if (r.deal_existant) {
        return {
          created: false, existing: true,
          deal: { id: r.deal_id, client: nomClient },
          note: `${nomClient} avait déjà un deal ouvert dans ce pipeline — aucun deal n’a été créé en double.`,
        };
      }

      // 4. Titre et étape : les deux gestes de l'écran après la création (majTitreDeal,
      //    deplacerDeal). Le deal EXISTE déjà : un raté devient un avertissement.
      const avertissements: string[] = [];
      const apres: Record<string, unknown> = {};
      if (titre) apres.title = titre;
      if (cible && premiere && cible.id !== premiere.id) apres.stage_id = cible.id;
      if (Object.keys(apres).length) {
        const { data: maj, error: errMaj } = await ctx.client.from('deals')
          .update(apres)
          .eq('org_id', ctx.orgId).eq('id', r.deal_id)
          .select('id');
        if (errMaj || !maj || maj.length === 0) {
          if (errMaj) console.error('[agent-tool:ventes] create_deal détails', (errMaj as ErreurBase).code || '', (errMaj as ErreurBase).message || '');
          avertissements.push('le titre ou l’étape demandés n’ont pas pu être enregistrés — le deal est à la première étape, sans titre');
        }
      }
      const pose = avertissements.length === 0;
      const etapeFinale = pose && cible ? cible : premiere;
      return {
        created: true,
        deal: {
          id: r.deal_id,
          title: (pose ? titre : null) || nomClient,
          client: nomClient,
          pipeline: pipeline?.name ?? null,
          etape: etapeFinale?.name_fr ?? null,
          responsable: nomVendeur,
          expected_close_date: dateVisee,
        },
        amount_cents: montant,
        ...(avertissements.length ? { avertissements } : {}),
        note: `Deal créé pour ${nomClient}${etapeFinale ? ` à l’étape « ${etapeFinale.name_fr} »` : ''}.`
          + (montant ? ' Le montant estimé est enregistré comme un devis brouillon rattaché au deal (rien n’est envoyé au client).' : ' Sans montant : il viendra du devis ou du job rattaché.')
          + (avertissements.length ? ` Attention : ${avertissements.join(' ; ')}.` : ''),
      };
    }),
};

const updateDeal: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_deal',
    description:
      'Edit a deal: title, owner (assigned rep) or target close date. Only provided fields change. '
      + 'Stage → update_deal_stage. The amount is not stored on the deal: edit its linked quote (update_quote).',
    parameters: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'Deal id (from list_deals).' },
        title: { type: 'string', description: 'New title; empty string removes it.' },
        assigned_user_id: { type: 'string', description: 'New owner: member user id (from get_team).' },
        clear_assignee: { type: 'boolean', description: 'true to leave the deal unassigned.' },
        expected_close_date: { type: 'string', description: 'YYYY-MM-DD; empty string clears it.' },
      },
      required: ['deal_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_deal', args, async () => {
      const dealId = identifiant(args.deal_id, 'Le deal', 'list_deals');
      const vendeurId = identifiantOptionnel(args.assigned_user_id, 'Le responsable', 'get_team');
      const retirer = args.clear_assignee === true;
      if (retirer && vendeurId) throw new Error('Choisis : un nouveau responsable (assigned_user_id) OU retirer le responsable (clear_assignee), pas les deux.');

      // Miroir de la fiche du deal (majTitreDeal, majDateFermeture, assignerDeal).
      const patch: Record<string, unknown> = {};
      if (args.title !== undefined) patch.title = texteOuNull(args.title)?.slice(0, 200) ?? null;
      if (args.expected_close_date !== undefined) {
        patch.expected_close_date = texteOuNull(args.expected_close_date) ? dateYmd(args.expected_close_date, 'La date de fermeture visée') : null;
      }
      if (!Object.keys(patch).length && !vendeurId && !retirer) {
        throw new Error('Aucun champ à modifier — précise un titre, un responsable ou une date de fermeture visée. (Le montant d’un deal se change sur son devis, avec update_quote.)');
      }

      const { data: deal, error: errDeal } = await ctx.client.from('deals')
        .select('id, title, client_id, assigned_user_id, expected_close_date, client:clients!deals_client_same_org(first_name, last_name, company, display_as_company)')
        .eq('org_id', ctx.orgId).eq('id', dealId)
        .is('deleted_at', null)
        .maybeSingle();
      if (errDeal) echecEcriture('retrouver le deal', errDeal);
      if (!deal) throw new Error('Deal introuvable dans le pipeline de cette entreprise — consulte list_deals.');
      const brut = deal as unknown as { title: string | null; client: Partial<FicheClient> | Array<Partial<FicheClient>> | null };
      const ficheClient = Array.isArray(brut.client) ? brut.client[0] : brut.client;

      let nomVendeur: string | null = null;
      if (vendeurId) {
        nomVendeur = await membreDeLOrg(ctx, vendeurId);
        patch.assigned_user_id = vendeurId;
        patch.assigned_at = new Date().toISOString();
      } else if (retirer) {
        patch.assigned_user_id = null;
        patch.assigned_at = null;
      }

      const { data: maj, error } = await ctx.client.from('deals')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', dealId)
        .is('deleted_at', null)
        .select('id, title, assigned_user_id, expected_close_date');
      if (error) echecEcriture('modifier le deal', error);
      const ligne = ((maj ?? []) as Array<{ title: string | null; expected_close_date: string | null }>)[0];
      if (!ligne) throw new Error('Le deal n’a pas été modifié : tu n’as pas accès à ce pipeline, ou le deal a changé entre-temps.');

      const gestes: string[] = [];
      if ('title' in patch) gestes.push(patch.title ? 'titre changé' : 'titre retiré');
      if (vendeurId) gestes.push(`assigné à ${nomVendeur}`);
      if (retirer) gestes.push('responsable retiré');
      if ('expected_close_date' in patch) gestes.push(patch.expected_close_date ? `fermeture visée le ${String(patch.expected_close_date)}` : 'date de fermeture retirée');
      const nom = ligne.title || nomAffiche(ficheClient) || 'ce deal';
      return {
        updated: true,
        deal: { title: nom, client: nomAffiche(ficheClient) || null, responsable: vendeurId ? nomVendeur : retirer ? null : undefined, expected_close_date: ligne.expected_close_date },
        note: `Deal « ${nom} » mis à jour : ${gestes.join(', ')}.`,
      };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   DEVIS — statut à la main, rabais et dépôt
   ═══════════════════════════════════════════════════════════════ */

const STATUTS_MANUELS = ['approved', 'awaiting_response'] as const;
type StatutManuel = (typeof STATUTS_MANUELS)[number];
/** Étape de l'ANCIEN tableau (pipeline_deals) que l'écran synchronise après un changement de statut. */
const ETAPE_ANCIEN_PIPELINE: Record<StatutManuel, string> = { approved: 'closed_won', awaiting_response: 'quote_sent' };

/**
 * Miroir de moveLeadDealToStage (quotesApi) : la carte de l'ancien tableau liée au
 * prospect du devis suit le statut. Au mieux — l'écran n'échoue pas non plus si ça rate.
 */
async function synchroniserAncienPipeline(ctx: ToolContext, leadId: unknown, etape: string): Promise<void> {
  if (!leadId || typeof leadId !== 'string') return;
  try {
    const { data: carte } = await ctx.client
      .from('pipeline_deals')
      .select('id, stage')
      .eq('org_id', ctx.orgId).eq('lead_id', leadId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!carte) return;
    const { error } = await ctx.client.rpc('set_deal_stage', { p_deal_id: carte.id, p_stage: etape });
    if (error) console.error('[agent-tool:ventes] set_deal_stage', error.message);
  } catch (e) {
    console.error('[agent-tool:ventes] synchronisation de l’ancien pipeline', e instanceof Error ? e.message : e);
  }
}

const setQuoteStatus: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'set_quote_status',
    description:
      'Mark a quote approved by hand (the client said yes outside Lume) or put it back to awaiting response — the « Mark as » menu. '
      + 'Approving fires the company’s « quote accepted » automations, which may message the client: confirm first. '
      + 'Declined / archived → cancel_quote.',
    parameters: {
      type: 'object',
      properties: {
        quote_id: { type: 'string', description: 'Quote id (from list_quotes).' },
        status: { type: 'string', enum: [...STATUTS_MANUELS], description: "'approved' or 'awaiting_response'." },
      },
      required: ['quote_id', 'status'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'set_quote_status', args, async () => {
      const quoteId = identifiant(args.quote_id, 'Le devis', 'list_quotes');
      const statut = String(args.status ?? '').trim() as StatutManuel;
      if (!(STATUTS_MANUELS as readonly string[]).includes(statut)) {
        throw new Error('Le statut doit être « approved » (approuvé) ou « awaiting_response » (en attente de réponse). Pour refuser ou archiver : cancel_quote.');
      }
      const devis = await lireDevis(ctx, quoteId, 'id, quote_number, title, status, lead_id');
      const avant = String(devis.status ?? '');
      if (avant === 'converted') throw new Error('Ce devis est déjà converti (job ou facture) : son statut ne se change plus.');
      if (avant === statut) {
        return {
          updated: true, changed: false,
          quote: { quote_number: devis.quote_number, title: devis.title, statut: traduireStatut(statut, STATUT_DEVIS) },
          note: `Le devis était déjà « ${traduireStatut(statut, STATUT_DEVIS)} » — rien à changer.`,
        };
      }

      // Miroir de updateQuoteStatus (quotesApi) : statut + son horodatage.
      const maintenant = new Date().toISOString();
      const patch: Record<string, unknown> = { status: statut, updated_at: maintenant };
      if (statut === 'approved') patch.approved_at = maintenant;
      const { data, error } = await ctx.client
        .from('quotes')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', quoteId)
        .is('deleted_at', null)
        .select('id, quote_number, title, status')
        .maybeSingle();
      if (error) echecEcriture('changer le statut du devis', error);
      if (!data) throw new Error('Le statut n’a pas été changé : les accès Lume de cette personne ne permettent pas de modifier ce devis.');

      // Journal du statut, comme l'écran : un raté ne défait pas le changement.
      const { error: histErr } = await ctx.client.from('quote_status_history').insert({
        quote_id: quoteId, old_status: avant || null, new_status: statut, changed_by: ctx.userId, reason: null,
      });
      if (histErr) console.error('[agent-tool:ventes] quote_status_history', histErr.message);

      await synchroniserAncienPipeline(ctx, devis.lead_id, ETAPE_ANCIEN_PIPELINE[statut]);

      return {
        updated: true, changed: true,
        quote: { quote_number: data.quote_number, title: data.title, statut: traduireStatut(data.status, STATUT_DEVIS) },
        de: traduireStatut(avant, STATUT_DEVIS),
        note: statut === 'approved'
          ? 'Devis marqué approuvé. Les automatisations « devis accepté » de l’entreprise se déclenchent comme à l’écran. Aucun dépôt n’est demandé au client par ce geste ; pour le planifier : convert_quote_to_job.'
          : 'Devis remis « en attente de réponse ».',
      };
    }),
};

const TYPES_MONTANT = ['percentage', 'fixed'] as const;
type TypeMontant = (typeof TYPES_MONTANT)[number];

function typeMontant(v: unknown, nom: string): TypeMontant | null {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim().toLowerCase();
  if (!(TYPES_MONTANT as readonly string[]).includes(s)) throw new Error(`${nom} doit être « percentage » (pourcentage) ou « fixed » (montant fixe en dollars).`);
  return s as TypeMontant;
}

function nombrePositifOuZero(v: unknown, nom: string): number {
  const n = Number(v);
  if (v === '' || v === null || !Number.isFinite(n) || n < 0) throw new Error(`${nom} doit être un nombre positif.`);
  return Math.round(n * 100) / 100;
}

const setQuoteDiscountDeposit: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'set_quote_discount_deposit',
    description:
      'Set a quote’s overall discount and/or required deposit; totals are recomputed by Lume. Only provided fields change. '
      + 'The client sees the new total on a quote already sent: confirm first. Line items → update_quote.',
    parameters: {
      type: 'object',
      properties: {
        quote_id: { type: 'string', description: 'Quote id (from list_quotes).' },
        discount_type: { type: 'string', enum: [...TYPES_MONTANT], description: "'percentage' or 'fixed' (dollars)." },
        discount_value: { type: 'number', description: 'Percent (0-100) or DOLLARS per discount_type. 0 removes the discount.' },
        deposit_required: { type: 'boolean', description: 'false removes the deposit.' },
        deposit_type: { type: 'string', enum: [...TYPES_MONTANT], description: "'percentage' of the total, or 'fixed' (dollars)." },
        deposit_value: { type: 'number', description: 'Percent (1-100) or DOLLARS per deposit_type.' },
      },
      required: ['quote_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'set_quote_discount_deposit', args, async () => {
      const quoteId = identifiant(args.quote_id, 'Le devis', 'list_quotes');
      const toucheRabais = args.discount_type !== undefined || args.discount_value !== undefined;
      const toucheDepot = args.deposit_required !== undefined || args.deposit_type !== undefined || args.deposit_value !== undefined;
      if (!toucheRabais && !toucheDepot) throw new Error('Rien à modifier — précise un rabais (discount_value) ou un dépôt (deposit_required, deposit_value).');
      // Types et nombres validés AVANT toute lecture ou écriture.
      const rabaisTypeDemande = typeMontant(args.discount_type, 'Le type de rabais');
      const rabaisValeurDemandee = args.discount_value !== undefined ? nombrePositifOuZero(args.discount_value, 'Le rabais') : undefined;
      const depotTypeDemande = typeMontant(args.deposit_type, 'Le type de dépôt');
      const depotValeurDemandee = args.deposit_value !== undefined ? nombrePositifOuZero(args.deposit_value, 'Le dépôt') : undefined;
      if (args.deposit_required !== undefined && typeof args.deposit_required !== 'boolean') throw new Error('deposit_required doit être vrai ou faux.');
      if (args.deposit_required === false && (depotValeurDemandee ?? 0) > 0) throw new Error('Choisis : retirer le dépôt (deposit_required: false) OU en fixer un (deposit_value), pas les deux.');

      const devis = await lireDevis(ctx, quoteId,
        'id, quote_number, title, status, subtotal_cents, tax_rate, discount_type, discount_value, deposit_required, deposit_type, deposit_value');
      if (devis.status === 'converted') throw new Error('Ce devis est déjà converti (job ou facture) — il ne se modifie plus. Fais un nouveau devis (duplicate_quote) si besoin.');
      const sousTotal = Math.max(0, Number(devis.subtotal_cents) || 0);

      // Miroir de updateQuote (quotesApi) : mêmes colonnes, mêmes unités.
      const patch: Record<string, unknown> = {};
      let rabaisType = (devis.discount_type as TypeMontant | null) ?? null;
      let rabaisValeur = Number(devis.discount_value) || 0;
      if (toucheRabais) {
        const valeur = rabaisValeurDemandee ?? rabaisValeur;
        const type = rabaisTypeDemande ?? rabaisType;
        if (valeur === 0) {
          rabaisType = null; rabaisValeur = 0;
        } else {
          if (!type) throw new Error('Précise le type de rabais : « percentage » (pourcentage) ou « fixed » (montant en dollars).');
          if (type === 'percentage' && valeur > 100) throw new Error('Un rabais en pourcentage ne peut pas dépasser 100 %.');
          if (type === 'fixed' && Math.round(valeur * 100) > sousTotal) throw new Error(`Le rabais (${enDollars(Math.round(valeur * 100))}) dépasse le sous-total du devis (${enDollars(sousTotal)}).`);
          rabaisType = type; rabaisValeur = valeur;
        }
        patch.discount_type = rabaisType;
        patch.discount_value = rabaisValeur;
      }
      // Le total tel que rpc_recalculate_quote le calculera — pour borner un dépôt fixe.
      const rabaisCents = rabaisType === 'percentage' ? Math.round(sousTotal * rabaisValeur / 100) : rabaisType === 'fixed' ? Math.round(rabaisValeur * 100) : 0;
      const totalPrevu = sousTotal - rabaisCents + Math.round((sousTotal - rabaisCents) * (Number(devis.tax_rate) || 0) / 100);

      if (toucheDepot) {
        if (args.deposit_required === false) {
          patch.deposit_required = false; patch.deposit_type = null; patch.deposit_value = 0;
        } else {
          const type = depotTypeDemande ?? (devis.deposit_type as TypeMontant | null) ?? null;
          const valeur = depotValeurDemandee ?? (Number(devis.deposit_value) || 0);
          if (!type) throw new Error('Précise le type de dépôt : « percentage » (pourcentage du total) ou « fixed » (montant en dollars).');
          if (valeur <= 0) throw new Error('Précise le dépôt à exiger (deposit_value), ou passe deposit_required: false pour le retirer.');
          if (type === 'percentage' && valeur > 100) throw new Error('Un dépôt en pourcentage ne peut pas dépasser 100 %.');
          if (type === 'fixed' && Math.round(valeur * 100) > totalPrevu) throw new Error(`Le dépôt (${enDollars(Math.round(valeur * 100))}) dépasse le total du devis (${enDollars(totalPrevu)}).`);
          patch.deposit_required = true; patch.deposit_type = type; patch.deposit_value = valeur;
        }
      }

      patch.updated_at = new Date().toISOString();
      const { data: ecrit, error } = await ctx.client
        .from('quotes')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', quoteId)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle();
      if (error) echecEcriture('modifier le devis', error);
      if (!ecrit) throw new Error('Le devis n’a pas été modifié : les accès Lume de cette personne ne permettent pas de modifier ce devis.');

      const numero = { quote_number: devis.quote_number, title: devis.title };
      // Les totaux sont recalculés PAR LA BASE (même appel que l'écran), jamais à la main.
      if (toucheRabais) {
        const { error: recalcErr } = await ctx.client.rpc('rpc_recalculate_quote', { p_quote_id: quoteId });
        if (recalcErr) {
          // Le rabais EST écrit : on renvoie (pas de throw) pour garder l'empreinte.
          console.error('[agent-tool:ventes] rpc_recalculate_quote', recalcErr.message);
          return {
            updated: true, incomplet: true, quote: numero,
            note: 'Le rabais est enregistré, mais Lume n’a pas pu recalculer le total du devis. Ne relance pas à l’identique : ouvre le devis dans Lume et enregistre-le pour rafraîchir les totaux.',
          };
        }
      }

      const { data: relu, error: errRelu } = await ctx.client
        .from('quotes')
        .select('status, subtotal_cents, discount_type, discount_value, discount_cents, tax_cents, total_cents, deposit_required, deposit_type, deposit_value')
        .eq('org_id', ctx.orgId).eq('id', quoteId)
        .is('deleted_at', null)
        .maybeSingle();
      if (errRelu || !relu) {
        if (errRelu) console.error('[agent-tool:ventes] relecture du devis', errRelu.message);
        return { updated: true, quote: numero, note: 'Devis modifié. Je n’ai pas pu relire les nouveaux totaux — consulte le devis (get_quote).' };
      }
      const total = Number(relu.total_cents) || 0;
      const depotExige = Boolean(relu.deposit_required) && Number(relu.deposit_value) > 0;
      const depotCents = !depotExige ? 0
        : relu.deposit_type === 'percentage' ? Math.round(total * Number(relu.deposit_value) / 100)
          : Math.round(Number(relu.deposit_value) * 100);
      const dejaChezLeClient = ['awaiting_response', 'changes_requested', 'approved'].includes(String(relu.status));
      return {
        updated: true,
        quote: { ...numero, statut: traduireStatut(relu.status, STATUT_DEVIS) },
        subtotal_cents: Number(relu.subtotal_cents) || 0,
        discount_cents: Number(relu.discount_cents) || 0,
        ...(relu.discount_type === 'percentage' ? { discount_percent: Number(relu.discount_value) || 0 } : {}),
        tax_cents: Number(relu.tax_cents) || 0,
        total_cents: total,
        deposit_required: depotExige,
        deposit_cents: depotCents,
        ...(depotExige && relu.deposit_type === 'percentage' ? { deposit_percent: Number(relu.deposit_value) || 0 } : {}),
        note: `Devis modifié${toucheRabais ? ' : totaux recalculés par Lume' : ''}.`
          + (dejaChezLeClient ? ' Le client voit ces nouveaux montants sur sa page de devis ; rien ne lui a été renvoyé.' : ' Rien n’est parti chez le client.'),
      };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   CONSENTEMENT COMMERCIAL (LCAP) — courriel et texto
   ═══════════════════════════════════════════════════════════════ */

const CANAUX = ['email', 'sms'] as const;
type Canal = (typeof CANAUX)[number];

/** Les ancrages du tacite, lus comme le fait le moteur d'envoi (actions/index.ts). */
async function ancragesDuClient(ctx: ToolContext, clientId: string): Promise<AncragesTacite> {
  const recent = async (table: 'jobs' | 'invoices' | 'quotes') => {
    const { data, error } = await ctx.client
      .from(table)
      .select('id, created_at')
      .eq('org_id', ctx.orgId).eq('client_id', clientId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? { id: String(data.id), date: String(data.created_at) } : null;
  };
  const [dernierJob, derniereFacture, dernierDevis] = await Promise.all([recent('jobs'), recent('invoices'), recent('quotes')]);
  return { dernierJob, derniereFacture, dernierDevis };
}

function decrireBase(base: BaseLegale | null): { base: string; depuis?: string; jusqu_au?: string } {
  if (!base) return { base: 'aucune' };
  if (base.type === 'expres') return { base: 'consentement exprès', depuis: base.depuis };
  return {
    base: base.raison === 'relation_affaires' ? 'consentement tacite (relation d’affaires, 2 ans)' : 'consentement tacite (demande de prix, 6 mois)',
    jusqu_au: base.expire,
  };
}

const getClientConsent: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'get_client_consent',
    description:
      'A client’s marketing consent (CASL) for email and SMS: express consent date, implied consent still valid, email unsubscribe. '
      + 'Use before promising a promotional send.',
    parameters: {
      type: 'object',
      properties: { client_id: { type: 'string', description: 'Client id (from search_clients).' } },
      required: ['client_id'],
    },
  },
  handler: async (args, ctx) => {
    const clientId = String(args.client_id ?? '').trim();
    if (!UUID.test(clientId)) return { error: 'Le client n’est pas un identifiant valide — récupère-le via search_clients.' };
    try {
      const { data, error } = await ctx.client
        .from('clients')
        .select('id, first_name, last_name, company, display_as_company, email, phone, email_consent_at, sms_consent_at, email_opt_out_at')
        .eq('org_id', ctx.orgId).eq('id', clientId)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) return erreurLecture('consent', error);
      if (!data) return { error: 'Client introuvable dans cette entreprise — cherche-le d’abord avec search_clients.' };
      const ancrages = await ancragesDuClient(ctx, clientId);
      const desabonne = Boolean(data.email_opt_out_at);
      const baseCourriel = baseLegalePour(data.email_consent_at as string | null, ancrages);
      const baseTexto = baseLegalePour(data.sms_consent_at as string | null, ancrages);
      return {
        client: nomAffiche(data),
        email: {
          adresse_au_dossier: Boolean(data.email),
          consentement_expres_depuis: data.email_consent_at ?? null,
          desabonne,
          ...(desabonne ? { desabonne_depuis: data.email_opt_out_at } : {}),
          envoi_commercial_permis: !desabonne && baseCourriel !== null,
          ...decrireBase(desabonne ? null : baseCourriel),
        },
        sms: {
          numero_au_dossier: Boolean(data.phone),
          consentement_expres_depuis: data.sms_consent_at ?? null,
          envoi_commercial_permis: baseTexto !== null,
          ...decrireBase(baseTexto),
        },
        note: 'Un désabonnement (lien du courriel, réponse STOP à un texto) prime toujours sur ces bases ; un STOP par texto n’est pas vérifié ici. Les messages de service (confirmation, rappel de rendez-vous, facture) ne dépendent pas de ce consentement.',
      };
    } catch (e) {
      return erreurLecture('consent', e);
    }
  },
};

const setClientConsent: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'set_client_consent',
    description:
      'Record or withdraw a client’s EXPRESS marketing consent for email or SMS, with its proof-journal entry (same as the consent card). '
      + 'Only when the client actually said so: confirm first.',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client id (from search_clients).' },
        channel: { type: 'string', enum: [...CANAUX], description: "'email' or 'sms'." },
        granted: { type: 'boolean', description: 'true = the client consented; false = withdraw.' },
      },
      required: ['client_id', 'channel', 'granted'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'set_client_consent', args, async () => {
      const clientId = identifiant(args.client_id, 'Le client', 'search_clients');
      const canal = String(args.channel ?? '').trim().toLowerCase() as Canal;
      if (!(CANAUX as readonly string[]).includes(canal)) throw new Error('Le canal doit être « email » (courriel) ou « sms » (texto).');
      if (typeof args.granted !== 'boolean') throw new Error('Précise si le client consent (granted: true) ou retire son consentement (granted: false).');
      const accorde = args.granted;
      const colonne = canal === 'email' ? 'email_consent_at' : 'sms_consent_at';
      const motCanal = canal === 'email' ? 'courriel' : 'texto';

      const fiche = await clientDeLOrg(ctx, clientId, 'email_consent_at, sms_consent_at, email_opt_out_at');
      const nom = nomAffiche(fiche) || 'ce client';
      const actuel = (fiche[colonne] as string | null | undefined) ?? null;
      // Déjà dans l'état demandé : on ne réécrit rien — la date d'un consentement
      // est une preuve, la rafraîchir l'affaiblirait.
      if (Boolean(actuel) === accorde) {
        return {
          updated: false, client: nom, canal: motCanal, consent: accorde,
          ...(actuel ? { depuis: actuel } : {}),
          note: accorde
            ? `${nom} a déjà un consentement exprès au ${motCanal} — rien à changer.`
            : `${nom} n’a pas de consentement exprès au ${motCanal} — rien à retirer.`,
        };
      }

      // 1. L'état courant, lu avant chaque envoi (miroir de definirConsentement, clientsApi).
      const maintenant = new Date().toISOString();
      const { data: ecrit, error } = await ctx.client
        .from('clients')
        .update({ [colonne]: accorde ? maintenant : null })
        .eq('org_id', ctx.orgId).eq('id', clientId)
        .is('deleted_at', null)
        .select('id')
        .maybeSingle();
      if (error) echecEcriture('enregistrer le consentement', error);
      if (!ecrit) throw new Error('Le consentement n’a pas été enregistré : les accès Lume de cette personne ne permettent pas de modifier ce client.');

      // 2. Le registre probant, par la route de l'écran. S'il rate, on ne défait PAS
      //    la colonne (le consentement a bien été donné) : on le dit.
      let journalEcrit = false;
      try {
        const r = await appelInterne(ctx, '/dsr/consent', {
          subject_type: 'client',
          subject_id: clientId,
          purpose: canal === 'email' ? 'email-marketing' : 'sms-marketing',
          granted: accorde,
          method: 'crm-manual',
          org_id: ctx.orgId,
        });
        journalEcrit = r.ok;
        if (!r.ok) console.error('[agent-tool:ventes] journal de consentement', r.status);
      } catch (e) {
        console.error('[agent-tool:ventes] journal de consentement', e instanceof AppelInterneIncertain ? e.cause : e instanceof Error ? e.message : e);
      }

      const desabonne = canal === 'email' && Boolean(fiche.email_opt_out_at);
      return {
        updated: true, client: nom, canal: motCanal, consent: accorde,
        ...(accorde ? { depuis: maintenant } : {}),
        journal_ecrit: journalEcrit,
        note: (accorde
          ? `Consentement exprès au ${motCanal} enregistré pour ${nom}.`
          : `Consentement au ${motCanal} retiré pour ${nom} : les envois commerciaux cessent, sauf si une relation d’affaires récente les permet encore.`)
          + (journalEcrit ? '' : ' Attention : le journal de preuve n’a pas pu être écrit — signale-le, c’est cette trace qu’on produirait en cas de plainte.')
          + (accorde && desabonne ? ' Ce client est désabonné des courriels : le désabonnement prime, aucun courriel commercial ne partira.' : ''),
      };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   ARCHIVES — lister et restaurer (Réglages → Archives)
   ═══════════════════════════════════════════════════════════════ */

const TYPES_ARCHIVE = ['client', 'lead', 'job'] as const;
type TypeArchive = (typeof TYPES_ARCHIVE)[number];
const CLE_ARCHIVE: Record<TypeArchive, 'clients' | 'leads' | 'jobs'> = { client: 'clients', lead: 'leads', job: 'jobs' };
const MOT_ARCHIVE: Record<TypeArchive, string> = { client: 'client', lead: 'prospect', job: 'job' };

interface ElementArchive {
  id: string; type: TypeArchive; name: string | null; company?: string | null; status?: string | null;
  client_name?: string | null; job_number?: string | null; archived_at: string | null;
}

/** Les archives de CETTE org, par la fonction de l'écran (fetchArchivedItems). */
async function archivesDeLOrg(ctx: ToolContext): Promise<ElementArchive[]> {
  const { data, error } = await ctx.client.rpc('list_archived_items', { p_org_id: ctx.orgId });
  if (error) throw error;
  const brut = (data ?? {}) as Partial<Record<'clients' | 'leads' | 'jobs', unknown>>;
  const lignes: ElementArchive[] = [];
  for (const type of TYPES_ARCHIVE) {
    const liste = brut[CLE_ARCHIVE[type]];
    for (const e of (Array.isArray(liste) ? liste : []) as Array<Record<string, unknown>>) {
      lignes.push({
        id: String(e.id), type,
        name: texteOuNull(e.name), company: texteOuNull(e.company), status: texteOuNull(e.status),
        client_name: texteOuNull(e.client_name), job_number: texteOuNull(e.job_number),
        archived_at: texteOuNull(e.archived_at),
      });
    }
  }
  return lignes.sort((a, b) => String(b.archived_at ?? '').localeCompare(String(a.archived_at ?? '')));
}

const nomArchive = (e: ElementArchive) => e.name || e.company || (e.job_number ? `Job #${e.job_number}` : `ce ${MOT_ARCHIVE[e.type]}`);

const listArchived: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_archived',
    description:
      'What is in the Archives (archived clients, leads and jobs), newest first, with the ids needed by restore_archived. '
      + 'Archived quotes are not here: list_quotes.',
    parameters: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', enum: [...TYPES_ARCHIVE], description: 'Optional filter.' },
        query: { type: 'string', description: 'Optional words: name, company or job number.' },
        limit: { type: 'integer', description: 'Max results (default 20, max 50).' },
      },
    },
  },
  handler: async (args, ctx) => {
    try {
      let lignes = await archivesDeLOrg(ctx);
      const parType = { clients: 0, leads: 0, jobs: 0 };
      for (const e of lignes) parType[CLE_ARCHIVE[e.type]] += 1;
      const type = String(args.entity_type ?? '').trim();
      if ((TYPES_ARCHIVE as readonly string[]).includes(type)) lignes = lignes.filter((e) => e.type === type);
      const mots = sansAccentMin(args.query).split(/\s+/).filter(Boolean);
      if (mots.length) {
        lignes = lignes.filter((e) => {
          const foin = sansAccentMin([e.name, e.company, e.client_name, e.job_number].filter(Boolean).join(' '));
          return mots.every((m) => foin.includes(m));
        });
      }
      const n = Number(args.limit);
      const limite = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : 20;
      const total = lignes.length;
      return {
        counts: parType,
        total_matching: total,
        shown: Math.min(total, limite),
        ...(total > limite ? { note: `Only ${limite} of ${total} are listed below. The exact total is ${total}.` } : {}),
        items: lignes.slice(0, limite).map((e) => ({
          id: e.id, type: e.type, genre: MOT_ARCHIVE[e.type], name: nomArchive(e),
          ...(e.company && e.company !== e.name ? { company: e.company } : {}),
          ...(e.client_name ? { client: e.client_name } : {}),
          ...(e.job_number ? { job_number: e.job_number } : {}),
          archived_at: e.archived_at,
        })),
      };
    } catch (e) {
      return erreurLecture('archives', e);
    }
  },
};

/** Les fonctions de restauration exigent propriétaire ou administrateur : on le dit avant, en français. */
async function exigerAdmin(ctx: ToolContext): Promise<void> {
  const { data, error } = await ctx.client
    .from('memberships')
    .select('role')
    .eq('org_id', ctx.orgId).eq('user_id', ctx.userId)
    .maybeSingle();
  if (error) echecEcriture('vérifier le rôle', error);
  const role = String(data?.role ?? '').toLowerCase();
  if (role !== 'owner' && role !== 'admin') {
    throw new Error('Restaurer un élément archivé est réservé au propriétaire et aux administrateurs de l’entreprise.');
  }
}

const restoreArchived: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'restore_archived',
    description:
      'Restore an archived client, lead or job from the Archives (owner/admin only). Restoring a client also restores its archived jobs. '
      + 'Get type and id from list_archived. An archived quote → unarchive_quote.',
    parameters: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', enum: [...TYPES_ARCHIVE], description: "'client', 'lead' or 'job' (the item’s type in list_archived)." },
        entity_id: { type: 'string', description: 'Item id (from list_archived).' },
      },
      required: ['entity_type', 'entity_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'restore_archived', args, async () => {
      const type = String(args.entity_type ?? '').trim().toLowerCase() as TypeArchive;
      if (!(TYPES_ARCHIVE as readonly string[]).includes(type)) throw new Error('Le type doit être « client », « lead » (prospect) ou « job ».');
      const id = identifiant(args.entity_id, 'L’élément à restaurer', 'list_archived');
      await exigerAdmin(ctx);

      // L'élément est-il dans les archives de CETTE org ? (la liste est bornée à ctx.orgId)
      let archives: ElementArchive[];
      try {
        archives = await archivesDeLOrg(ctx);
      } catch (e) {
        echecEcriture('lire les archives', e);
      }
      const element = archives.find((e) => e.id === id);
      if (!element) throw new Error('Cet élément n’est pas dans les archives de cette entreprise — il est peut-être déjà restauré. Consulte list_archived.');
      if (element.type !== type) throw new Error(`Cet élément archivé est un ${MOT_ARCHIVE[element.type]}, pas un ${MOT_ARCHIVE[type]} — reprends avec entity_type: '${element.type}'.`);

      // Mêmes fonctions que l'écran (restoreClient / restoreLead / restoreJob, archiveApi).
      const { data, error } = type === 'client'
        ? await ctx.client.rpc('restore_client', { p_org_id: ctx.orgId, p_client_id: id })
        : type === 'lead'
          ? await ctx.client.rpc('restore_lead', { p_org_id: ctx.orgId, p_lead_id: id })
          : await ctx.client.rpc('restore_job', { p_org_id: ctx.orgId, p_job_id: id });
      if (error) {
        if ((error as ErreurBase).code === '42501') throw new Error('Restaurer un élément archivé est réservé au propriétaire et aux administrateurs de l’entreprise.');
        echecEcriture(`restaurer ce ${MOT_ARCHIVE[type]}`, error);
      }
      const compte = (data ?? {}) as { client?: number; lead?: number; job?: number; jobs?: number };
      if (!(Number(compte[type]) > 0)) throw new Error('Rien n’a été restauré : l’élément n’est plus dans les archives. Consulte list_archived.');
      const jobs = type === 'client' ? Number(compte.jobs) || 0 : 0;
      const nom = nomArchive(element);
      return {
        restored: true,
        item: { type, genre: MOT_ARCHIVE[type], name: nom },
        ...(type === 'client' ? { jobs_restored: jobs } : {}),
        note: `${nom} est sorti des archives et réapparaît dans Lume`
          + (jobs > 0 ? `, avec ${jobs} job(s) archivé(s) avec lui.` : '.'),
      };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════ */

export const OUTILS_LOT_VENTES: AgentTool[] = [
  // Pipeline de ventes
  createDeal, updateDeal,
  // Devis
  setQuoteStatus, setQuoteDiscountDeposit,
  // Consentement commercial
  getClientConsent, setClientConsent,
  // Archives
  listArchived, restoreArchived,
];

/** Une entrée par ÉCRITURE — même vocabulaire que registre.ts (sensible / reversible / vers_client). */
export const REGISTRE_LOT_VENTES: Record<string, { sensible: boolean; reversible: boolean; vers_client: boolean }> = {
  create_deal:                { sensible: false, reversible: true,  vers_client: false }, // un deal s'abandonne (delete_deal)
  update_deal:                { sensible: false, reversible: true,  vers_client: false },
  set_quote_status:           { sensible: true,  reversible: true,  vers_client: false }, // « devis accepté » lance les automatisations de l'entreprise
  set_quote_discount_deposit: { sensible: true,  reversible: true,  vers_client: false }, // argent ; visible sur la page publique d'un devis envoyé
  set_client_consent:         { sensible: true,  reversible: true,  vers_client: false }, // acte légal (LCAP), journalisé
  restore_archived:           { sensible: false, reversible: true,  vers_client: false },
};

/** Une entrée par outil — même forme que PERMISSION_PAR_OUTIL (garde.ts). */
export const PERMISSIONS_LOT_VENTES: Record<string, { cle: PermissionKey; capacite: string }> = {
  create_deal:                { cle: 'leads.create',    capacite: 'la création de deals dans le pipeline' },
  update_deal:                { cle: 'leads.update',    capacite: 'la modification des deals du pipeline' },
  set_quote_status:           { cle: 'quotes.approve',  capacite: 'l’approbation des devis' },
  set_quote_discount_deposit: { cle: 'quotes.update',   capacite: 'la modification des devis' },
  get_client_consent:         { cle: 'clients.read',    capacite: 'la consultation du consentement des clients' },
  set_client_consent:         { cle: 'clients.update',  capacite: 'la saisie du consentement des clients' },
  // Archives : l'écran vit dans Réglages (route gardée par settings.read) ; restaurer
  // est en plus réservé aux propriétaires et administrateurs par la base.
  list_archived:              { cle: 'settings.read',   capacite: 'la consultation des archives' },
  restore_archived:           { cle: 'settings.update', capacite: 'la restauration des éléments archivés' },
};

/** Chaque outil, exactement une fois — à fusionner dans TOPICS (topics.ts). */
export const TOPICS_LOT_VENTES: Partial<Record<IdTopic, string[]>> = {
  clients: ['create_deal', 'update_deal', 'get_client_consent', 'set_client_consent', 'list_archived', 'restore_archived'],
  devis: ['set_quote_status', 'set_quote_discount_deposit'],
};
