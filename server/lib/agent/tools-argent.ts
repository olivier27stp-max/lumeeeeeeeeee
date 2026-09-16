/* ═══════════════════════════════════════════════════════════════
   Lume Agent — outils « argent » (devis, factures, paiements)
   ─────────────────────────────────────────────────────────────
   Complète tools.ts / tools-etendus.ts : tout ce qu'un utilisateur fait
   dans l'app sur un devis, une facture ou un paiement et que Lumi ne
   savait pas encore EXÉCUTER. Mêmes règles que les modules voisins :

   • Une écriture = `kind: 'write'`, `needsIdentity: true`, handler sous
     `executerIdempotent` (empreinte posée AVANT d'agir, jamais de doublon).
   • Quand une ROUTE de l'app existe en POST, on l'emprunte via
     `appelInterne` (mêmes garde-fous, même journalisation) ; sinon on
     reproduit exactement ce que fait le client `src/lib/*Api.ts`, à
     l'identité de l'utilisateur (RLS) et filtré `org_id` explicitement.
   • Les montants sont en cents (`*_cents`). On n'écrit JAMAIS `total`,
     `subtotal`, `tax_total`, `total_amount` : ce sont des projections.
   • Jamais d'erreur brute vers le modèle ; les notes sont en français,
     les statuts traduits.
   • Deux « routes » que le client appelle encore n'existent PLUS côté
     serveur (`/recurring-invoices`, `/invoice-templates` — retirées, voir
     server/index.ts) : ces outils écrivent donc directement en base, en
     reproduisant le moteur (`recurringInvoicesEngine`) et les colonnes.
   ═══════════════════════════════════════════════════════════════ */

import crypto from 'crypto';
import type { PermissionKey } from '../../../src/lib/permissions';
import type { IdTopic } from '../lumi/topics';
import { getServiceClient } from '../supabase';
import { runOneSchedule, type RecurringSchedule } from '../recurringInvoicesEngine';
import type { AgentTool, ToolContext } from './tools';
import {
  executerIdempotent, champRequis, appelInterne, AppelInterneIncertain,
  traduireStatut, STATUT_DEVIS, STATUT_FACTURE,
} from './tools-etendus';

/* ── Garde-fous locaux ─────────────────────────────────────────── */

const clamp = (n: any, def: number, max: number) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return def;
  return Math.min(Math.floor(v), max);
};

/** Même politique que tools.ts : jamais d'erreur brute vers le modèle. */
function erreurOutil(scope: string, err: any): { error: string } {
  console.error(`[agent-tool:${scope}]`, err?.message || err);
  return { error: 'La consultation a échoué côté Lume. Dis-le simplement à l’utilisateur, propose de réessayer, et s’il y a un doute sur la connexion, suggère de reconnecter Lume dans les réglages de Claude.' };
}

/** Plafond des montants qu'une écriture d'agent peut engager (cents) — même variable que tools-etendus. */
const PLAFOND_CENTS = (() => {
  const v = Number(process.env.MCP_MAX_AMOUNT_CENTS);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 1_000_000; // 10 000 $
})();

function verifierPlafond(totalCents: number): void {
  if (totalCents < 0) {
    throw new Error('Le total est négatif — une quantité ou un prix est probablement négatif. Vérifie les articles et recommence.');
  }
  if (totalCents > PLAFOND_CENTS) {
    throw new Error(`Le montant (${(totalCents / 100).toFixed(2)} $) dépasse le plafond autorisé pour l'agent `
      + `(${(PLAFOND_CENTS / 100).toFixed(2)} $). Fais cette pièce dans Lume directement.`);
  }
}

/** Quantité strictement positive, sinon 1 (jamais de total négatif ou nul). */
function qtePositive(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function centsPositifs(v: any): number {
  return Math.max(0, Math.round(Number(v) || 0));
}

const FUSEAU_ORG = 'America/Montreal';

/** Date (YYYY-MM-DD) dans le fuseau de l'entreprise, décalée de `jours`. */
function dateOrgPlusJours(jours = 0): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU_ORG, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + jours * 86400_000));
}

function estDateYmd(v: any): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T12:00:00Z`).getTime());
}

function nomClient(r: any): string {
  if (!r) return '';
  const nom = `${r.first_name || ''} ${r.last_name || ''}`.trim();
  return nom || r.company || '';
}

/**
 * Résultat d'un envoi dont la réponse n'est jamais revenue : on le RENVOIE
 * (au lieu de lever) pour que executerIdempotent garde l'empreinte — une
 * retentative de l'agent ne doit jamais renvoyer un second message au client.
 */
function resultatIncertain(quoi: string): Record<string, any> {
  return {
    incertain: true,
    sent: null,
    note: `Je n'ai pas eu la confirmation que ${quoi} est bien parti — il a PEUT-ÊTRE été envoyé. `
      + 'Ne le renvoie pas d’ici là : vérifie dans Lume si le client l’a reçu.',
  };
}

async function lireDevis(ctx: ToolContext, quoteId: string, colonnes: string): Promise<any> {
  const { data, error } = await ctx.client
    .from('quotes')
    .select(colonnes)
    .eq('org_id', ctx.orgId).eq('id', quoteId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Devis introuvable — vérifie le numéro de devis.');
  return data;
}

async function lireFacture(ctx: ToolContext, invoiceId: string, colonnes: string): Promise<any> {
  const { data, error } = await ctx.client
    .from('invoices')
    .select(colonnes)
    .eq('org_id', ctx.orgId).eq('id', invoiceId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Facture introuvable — vérifie le numéro de facture.');
  return data;
}

/** Lignes de devis normalisées (mêmes règles que create_quote / saveQuoteLineItems). */
function normaliserLignesDevis(brut: any[]): Array<{
  name: string; description: string | null; quantity: number; unit_price_cents: number; is_optional: boolean; total_cents: number;
}> {
  return (Array.isArray(brut) ? brut : [])
    .filter((it) => String(it?.name || '').trim())
    .map((it) => {
      const quantity = qtePositive(it.quantity);
      const unit_price_cents = centsPositifs(it.unit_price_cents);
      return {
        name: String(it.name).trim().slice(0, 500),
        description: it.description ? String(it.description).slice(0, 2000) : null,
        quantity,
        unit_price_cents,
        is_optional: Boolean(it.is_optional),
        total_cents: Math.round(quantity * unit_price_cents),
      };
    });
}

/** Lignes de facture normalisées (mêmes règles que saveInvoiceDraft). */
function normaliserLignesFacture(brut: any[]): Array<{ description: string; qty: number; unit_price_cents: number }> {
  return (Array.isArray(brut) ? brut : [])
    .map((it) => ({
      description: String(it?.description || '').trim().slice(0, 2000),
      qty: qtePositive(it?.qty),
      unit_price_cents: centsPositifs(it?.unit_price_cents),
    }))
    .filter((it) => it.description);
}

const sommeLignes = (lignes: Array<{ qty?: number; quantity?: number; unit_price_cents: number }>) =>
  lignes.reduce((s, it) => s + Math.round(qtePositive(it.qty ?? it.quantity) * centsPositifs(it.unit_price_cents)), 0);

const SCHEMA_LIGNE_DEVIS = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    quantity: { type: 'number', description: 'Default 1.' },
    unit_price_cents: { type: 'integer', description: 'Unit price in CENTS.' },
    is_optional: { type: 'boolean', description: 'Optional item the client may untick.' },
  },
  required: ['name', 'unit_price_cents'],
};

const SCHEMA_LIGNE_FACTURE = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    qty: { type: 'number', description: 'Default 1.' },
    unit_price_cents: { type: 'integer', description: 'Unit price in CENTS.' },
  },
  required: ['description', 'unit_price_cents'],
};

/* ═══════════════════════════════════════════════════════════════
   DEVIS
   ═══════════════════════════════════════════════════════════════ */

const updateQuoteTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_quote',
    description:
      'Edit a quote: title, client-facing notes, validity (days from today) and/or REPLACE its line items '
      + '(totals recomputed by the app’s own calculator). Only provided fields change. A converted quote '
      + 'cannot be edited. Get the quote id from the quotes list.',
    parameters: {
      type: 'object',
      properties: {
        quote_id: { type: 'string', description: 'Quote id.' },
        title: { type: 'string' },
        notes: { type: 'string', description: 'Notes shown to the client.' },
        valid_days: { type: 'integer', description: 'New validity in days from today (1-365).' },
        line_items: { type: 'array', description: 'REPLACES all items when provided.', items: SCHEMA_LIGNE_DEVIS },
      },
      required: ['quote_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_quote', args, async () => {
      const quoteId = champRequis(args.quote_id, 'Le devis');
      const devis = await lireDevis(ctx, quoteId, 'id, quote_number, title, status');
      if (devis.status === 'converted') {
        throw new Error('Ce devis est déjà converti (job ou facture) — il ne se modifie plus. Fais un nouveau devis (duplicate_quote) si besoin.');
      }

      const patch: Record<string, any> = {};
      if (args.title !== undefined) patch.title = champRequis(args.title, 'Le titre').slice(0, 200);
      if (args.notes !== undefined) patch.notes = String(args.notes).slice(0, 20000) || null;
      if (args.valid_days !== undefined) patch.valid_until = dateOrgPlusJours(clamp(args.valid_days, 30, 365));

      let totalLignes: number | null = null;
      if (Array.isArray(args.line_items)) {
        const lignes = normaliserLignesDevis(args.line_items);
        if (!lignes.length) throw new Error('Aucun article valide (chaque article a un nom et un prix).');
        totalLignes = sommeLignes(lignes.filter((l) => !l.is_optional));
        verifierPlafond(totalLignes);

        // Remplacement complet, comme saveQuoteLineItems : delete puis insert.
        const { error: delErr } = await ctx.client
          .from('quote_line_items').delete()
          .eq('org_id', ctx.orgId).eq('quote_id', quoteId);
        if (delErr) throw delErr;
        const { error: insErr } = await ctx.client.from('quote_line_items').insert(lignes.map((l, i) => ({
          quote_id: quoteId,
          org_id: ctx.orgId,
          name: l.name,
          description: l.description,
          quantity: l.quantity,
          unit_price_cents: l.unit_price_cents,
          total_cents: l.total_cents,
          sort_order: i,
          is_optional: l.is_optional,
          item_type: 'service',
          discount_value: 0,
        })));
        // Le delete a réussi : point de non-retour. On RENVOIE (pas de throw)
        // pour que l'empreinte reste posée et qu'une retentative ne refasse
        // pas le delete — l'agent doit dire que les articles sont à ressaisir.
        if (insErr) {
          console.error('[agent-tool:update_quote] insert items failed', insErr.message);
          return {
            updated: true,
            incomplet: true,
            quote: { quote_number: devis.quote_number, title: devis.title },
            note: 'Les anciens articles du devis ont été retirés mais les nouveaux n’ont pas pu être enregistrés. '
              + 'Ne relance pas la modification à l’identique ; ressaisis les articles dans le devis ou dis à l’utilisateur de le faire.',
          };
        }
        // Les totaux du devis sont recalculés PAR LA BASE, jamais à la main.
        const { error: recalcErr } = await ctx.client.rpc('rpc_recalculate_quote', { p_quote_id: quoteId });
        if (recalcErr) throw recalcErr;
      }

      if (!Object.keys(patch).length && totalLignes === null) throw new Error('Aucun champ à modifier.');

      patch.updated_at = new Date().toISOString();
      const { data: maj, error } = await ctx.client
        .from('quotes')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', quoteId)
        .is('deleted_at', null)
        .select('id, quote_number, title, status, total_cents, valid_until')
        .single();
      if (error) throw error;
      return {
        updated: true,
        quote: {
          quote_number: maj.quote_number, title: maj.title,
          statut: traduireStatut(maj.status, STATUT_DEVIS), total_cents: maj.total_cents, valid_until: maj.valid_until,
        },
        note: totalLignes !== null
          ? 'Devis modifié : articles remplacés et totaux recalculés par Lume. Rien n’est parti chez le client.'
          : 'Devis modifié. Rien n’est parti chez le client.',
      };
    }),
};

const duplicateQuoteTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'duplicate_quote',
    description:
      'Duplicate a quote into a NEW draft quote (same client, items, taxes, discount, deposit, validity — '
      + 'title suffixed « (Copy) »), exactly like the app’s Duplicate action. Nothing is sent.',
    parameters: {
      type: 'object',
      properties: {
        quote_id: { type: 'string', description: 'Source quote id.' },
        title: { type: 'string', description: 'Optional title for the copy (default: original title + « (Copy) »).' },
      },
      required: ['quote_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'duplicate_quote', args, async () => {
      const quoteId = champRequis(args.quote_id, 'Le devis');
      const src = await lireDevis(ctx, quoteId,
        'id, quote_number, title, lead_id, client_id, property_id, salesperson_id, context_type, currency, valid_until, created_at, '
        + 'notes, contract_disclaimer, deposit_required, deposit_type, deposit_value, require_payment_method, '
        + 'tax_rate, tax_rate_label, discount_type, discount_value, quote_type, service_plan');
      const { data: items, error: eItems } = await ctx.client
        .from('quote_line_items')
        .select('source_service_id, name, description, quantity, unit_price_cents, discount_type, discount_value, total_cents, is_optional, item_type, image_url')
        .eq('org_id', ctx.orgId).eq('quote_id', quoteId)
        .order('sort_order', { ascending: true });
      if (eItems) throw eItems;
      const { data: sections } = await ctx.client
        .from('quote_sections')
        .select('section_type, title, content, enabled')
        .eq('quote_id', quoteId)
        .order('sort_order', { ascending: true });

      const lignes = items || [];
      verifierPlafond(lignes.filter((l: any) => !l.is_optional).reduce((s: number, l: any) => s + centsPositifs(l.total_cents), 0));

      // Même durée de validité que l'original (valid_until − created_at), sinon 30 jours.
      const validDays = src.valid_until
        ? Math.min(365, Math.max(1, Math.round((new Date(`${src.valid_until}T12:00:00Z`).getTime() - new Date(src.created_at).getTime()) / 86400_000)))
        : 30;
      const titre = args.title ? String(args.title).trim().slice(0, 200) : `${src.title || ''} (Copy)`.trim();

      // Même RPC que l'écran « Nouveau devis » : numérotation et défauts en base.
      const { data: rpcResult, error: rpcError } = await ctx.client.rpc('rpc_create_quote', {
        p_lead_id: src.lead_id || null,
        p_client_id: src.client_id || null,
        p_title: titre,
        p_salesperson_id: src.salesperson_id || null,
        p_context_type: src.context_type || (src.client_id ? 'client' : 'lead'),
        p_currency: src.currency || 'CAD',
        p_valid_days: validDays,
        p_notes: src.notes || null,
        p_contract: src.contract_disclaimer || null,
        p_deposit_required: Boolean(src.deposit_required),
        p_require_payment_method: Boolean(src.require_payment_method),
      });
      if (rpcError) throw rpcError;
      const nouveauId = String((rpcResult as any)?.quote_id || '');
      if (!nouveauId) throw new Error('Le devis a été créé mais son id est introuvable.');

      // À partir d'ici le devis EXISTE : un échec se RENVOIE (empreinte gardée),
      // sinon une retentative créerait un second devis.
      const partiel = (quoi: string) => ({
        created: true, incomplet: true, quote_id: nouveauId, statut: 'brouillon',
        note: `Le devis copié a été créé en brouillon, mais ${quoi} n’ont pas pu être reportés. Complète-le dans Lume avant tout envoi ; ne relance pas la copie.`,
      });
      const reglages: Record<string, any> = {
        tax_rate: src.tax_rate, tax_rate_label: src.tax_rate_label,
        discount_type: src.discount_type || null, discount_value: src.discount_value || 0,
        deposit_type: src.deposit_type || null, deposit_value: src.deposit_value || 0,
      };
      if (src.property_id) reglages.property_id = src.property_id;
      if (src.quote_type === 'service_plan' && src.service_plan) { reglages.quote_type = 'service_plan'; reglages.service_plan = src.service_plan; }
      const { error: eReg } = await ctx.client.from('quotes').update(reglages).eq('org_id', ctx.orgId).eq('id', nouveauId);
      if (eReg) { console.error('[agent-tool:duplicate_quote] settings', eReg.message); return partiel('les réglages (taxes, rabais, dépôt)'); }

      if (lignes.length) {
        const { error: eIns } = await ctx.client.from('quote_line_items').insert(lignes.map((l: any, i: number) => ({
          quote_id: nouveauId, org_id: ctx.orgId,
          source_service_id: l.source_service_id || null,
          name: l.name, description: l.description || null,
          quantity: l.quantity, unit_price_cents: l.unit_price_cents,
          discount_type: l.discount_type || null, discount_value: l.discount_value || 0,
          total_cents: l.total_cents, sort_order: i,
          is_optional: Boolean(l.is_optional), item_type: l.item_type || 'service', image_url: l.image_url || null,
        })));
        if (eIns) { console.error('[agent-tool:duplicate_quote] items', eIns.message); return partiel('les articles'); }
      }
      if (sections?.length) {
        const { error: eSec } = await ctx.client.from('quote_sections').insert(sections.map((s: any, i: number) => ({
          quote_id: nouveauId, section_type: s.section_type, title: s.title || null, content: s.content || null, sort_order: i, enabled: s.enabled !== false,
        })));
        if (eSec) console.error('[agent-tool:duplicate_quote] sections', eSec.message); // non bloquant, comme l'app
      }
      const { error: recalcErr } = await ctx.client.rpc('rpc_recalculate_quote', { p_quote_id: nouveauId });
      if (recalcErr) { console.error('[agent-tool:duplicate_quote] recalc', recalcErr.message); return partiel('les totaux'); }

      const { data: apres } = await ctx.client.from('quotes').select('quote_number, title, total_cents').eq('org_id', ctx.orgId).eq('id', nouveauId).maybeSingle();
      return {
        created: true, quote_id: nouveauId, statut: 'brouillon',
        quote: { quote_number: apres?.quote_number ?? null, title: apres?.title ?? titre, total_cents: apres?.total_cents ?? null },
        source: { quote_number: src.quote_number },
        note: 'Copie créée en BROUILLON — rien n’est parti chez le client. send_quote pour l’envoyer, avec confirmation.',
      };
    }),
};

const deleteQuoteTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_quote',
    description:
      'Delete a quote (soft delete: it disappears from Lume but stays recoverable by support). A converted quote '
      + 'cannot be deleted. To simply take it out of the pipeline, prefer cancel_quote (archive). ALWAYS confirm first.',
    parameters: {
      type: 'object',
      properties: { quote_id: { type: 'string', description: 'Quote id.' } },
      required: ['quote_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_quote', args, async () => {
      const quoteId = champRequis(args.quote_id, 'Le devis');
      const devis = await lireDevis(ctx, quoteId, 'id, quote_number, title, status');
      if (devis.status === 'converted') {
        throw new Error('Ce devis est converti en job ou en facture — on ne le supprime pas, il fait partie du dossier.');
      }
      // Suppression DOUCE (deleted_at), jamais un DELETE : règle du projet.
      const { data, error } = await ctx.client
        .from('quotes')
        .update({ deleted_at: new Date().toISOString(), deleted_by: ctx.userId, updated_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', quoteId)
        .is('deleted_at', null)
        .select('id, quote_number, title')
        .single();
      if (error) throw error;
      return {
        deleted: true,
        quote: { quote_number: data.quote_number, title: data.title },
        note: 'Devis supprimé — il n’apparaît plus dans Lume.',
      };
    }),
};

const unarchiveQuoteTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'unarchive_quote',
    description:
      'Bring an ARCHIVED quote back, restoring the status it had before archiving (draft, awaiting response…), '
      + 'like the app’s Unarchive action. No side effects, nothing sent.',
    parameters: {
      type: 'object',
      properties: { quote_id: { type: 'string', description: 'Quote id.' } },
      required: ['quote_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'unarchive_quote', args, async () => {
      const quoteId = champRequis(args.quote_id, 'Le devis');
      const devis = await lireDevis(ctx, quoteId, 'id, quote_number, title, status');
      if (devis.status !== 'archived') {
        return { already_active: true, quote: { quote_number: devis.quote_number, statut: traduireStatut(devis.status, STATUT_DEVIS) }, note: 'Ce devis n’est pas archivé — rien à faire.' };
      }
      // Miroir de unarchiveQuote (quotesApi) : on restaure le statut d'avant l'archivage.
      const { data: hist } = await ctx.client
        .from('quote_status_history')
        .select('old_status')
        .eq('quote_id', quoteId).eq('new_status', 'archived')
        .order('changed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const restaure = String(hist?.old_status || 'draft');
      const { data, error } = await ctx.client
        .from('quotes')
        .update({ status: restaure, updated_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', quoteId)
        .is('deleted_at', null)
        .select('id, quote_number, title, status')
        .single();
      if (error) throw error;
      const { error: histErr } = await ctx.client.from('quote_status_history').insert({
        quote_id: quoteId, old_status: 'archived', new_status: restaure, changed_by: ctx.userId, reason: 'Unarchived',
      });
      if (histErr) console.error('[agent-tool:unarchive_quote] history', histErr.message);
      return {
        restored: true,
        quote: { quote_number: data.quote_number, title: data.title, statut: traduireStatut(data.status, STATUT_DEVIS) },
        note: 'Devis désarchivé et remis à son statut précédent.',
      };
    }),
};

const sendQuoteSmsTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'send_quote_sms',
    description:
      'Text (SMS) a quote link to its client — IT ACTUALLY SENDS through the app’s own engine (org number, '
      + 'STOP opt-outs, tracking). Use send_quote for email. ALWAYS show the user which quote goes to whom and '
      + 'get their explicit OK first.',
    parameters: {
      type: 'object',
      properties: { quote_id: { type: 'string', description: 'Quote id.' } },
      required: ['quote_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'send_quote_sms', args, async () => {
      const quoteId = champRequis(args.quote_id, 'Le devis');
      let res;
      try {
        res = await appelInterne(ctx, '/quotes/send-sms', { quoteId });
      } catch (e) {
        if (e instanceof AppelInterneIncertain) return resultatIncertain('le texto du devis');
        throw e;
      }
      if (!res.ok) throw new Error(res.json?.error || `Envoi refusé (${res.status}).`);
      return { sent: true, channel: 'sms', note: 'Le devis est parti par texto via le moteur d’envoi de Lume (lien de consultation, suivi habituel).' };
    }),
};

const convertQuoteToInvoiceTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'convert_quote_to_invoice',
    description:
      'Turn a quote directly into a DRAFT invoice through the app’s own conversion route (accepted items '
      + 'carried over, discount and taxes preserved, quote marked converted). Nothing is sent. Use '
      + 'convert_quote_to_job when work must be scheduled first.',
    parameters: {
      type: 'object',
      properties: { quote_id: { type: 'string', description: 'Quote id.' } },
      required: ['quote_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'convert_quote_to_invoice', args, async () => {
      const quoteId = champRequis(args.quote_id, 'Le devis');
      const { ok, status, json } = await appelInterne(ctx, '/quotes/convert-to-invoice', { quoteId });
      if (!ok) throw new Error(json?.error || `Conversion refusée (${status}).`);
      const invoiceId = String(json?.invoiceId || '');
      let invoice: { invoice_number: any; total_cents: any } | null = null;
      if (invoiceId) {
        const { data } = await ctx.client.from('invoices').select('invoice_number, total_cents').eq('org_id', ctx.orgId).eq('id', invoiceId).maybeSingle();
        invoice = { invoice_number: data?.invoice_number ?? null, total_cents: data?.total_cents ?? null };
      }
      return {
        converted: true, invoice_id: invoiceId || null, invoice, statut: 'brouillon',
        note: 'Devis converti en facture BROUILLON par le flux de l’application — rien n’est parti chez le client. send_invoice pour l’envoyer, avec confirmation.',
      };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   PRÉ-RÉGLAGES ET MODÈLES DE DEVIS
   (même table quote_templates, même route /quote-templates : un
   « pré-réglage » est un modèle SANS prix ni mise en page.)
   ═══════════════════════════════════════════════════════════════ */

const COLONNES_MODELE_DEVIS = 'id, name, description, services, notes, terms, quote_title, intro_text, footer_notes, template_category, '
  + 'deposit_required, deposit_type, deposit_value, tax_enabled, tax_rate, tax_label, is_default, is_active, sort_order, updated_at';

function resumePreset(row: any) {
  return {
    id: row.id,
    name: row.name || '',
    description: row.description || null,
    services: (Array.isArray(row.services) ? row.services : []).map((s: any) => ({
      name: s?.name || '', description: s?.description || '', quantity: Number(s?.quantity) || 1, is_optional: Boolean(s?.is_optional),
    })),
    notes: row.notes || null,
    intro_text: row.intro_text || row.quote_title || null,
    terms: row.terms || null,
    deposit_required: Boolean(row.deposit_required),
    is_active: row.is_active !== false,
  };
}

function resumeModeleDevis(row: any) {
  return {
    ...resumePreset(row),
    services: (Array.isArray(row.services) ? row.services : []).map((s: any) => ({
      name: s?.name || '', description: s?.description || '', quantity: Number(s?.quantity) || 1,
      unit_price_cents: centsPositifs(s?.unit_price_cents), is_optional: Boolean(s?.is_optional),
    })),
    category: row.template_category || null,
    is_default: Boolean(row.is_default),
    tax_enabled: row.tax_enabled !== false,
    tax_rate: row.tax_rate == null ? null : Number(row.tax_rate),
    tax_label: row.tax_label || null,
  };
}

const SCHEMA_SERVICE_PRESET = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    quantity: { type: 'number', description: 'Default 1.' },
    is_optional: { type: 'boolean' },
  },
  required: ['name'],
};

const SCHEMA_SERVICE_MODELE = {
  type: 'object',
  properties: {
    ...SCHEMA_SERVICE_PRESET.properties,
    unit_price_cents: { type: 'integer', description: 'Unit price in CENTS (default 0).' },
  },
  required: ['name'],
};

/** Services d'un pré-réglage → forme stockée (prix à 0, id stable). */
function servicesPreset(brut: any[]): any[] {
  return (Array.isArray(brut) ? brut : [])
    .filter((s) => String(s?.name || '').trim())
    .map((s) => ({
      id: typeof s.id === 'string' && s.id ? s.id : crypto.randomUUID(),
      name: String(s.name).trim().slice(0, 500),
      description: s.description ? String(s.description).slice(0, 2000) : '',
      unit_price_cents: 0,
      quantity: qtePositive(s.quantity),
      is_optional: Boolean(s.is_optional),
    }));
}

function servicesModele(brut: any[]): any[] {
  return servicesPreset(brut).map((s, i) => ({ ...s, unit_price_cents: centsPositifs(brut[i]?.unit_price_cents) }));
}

const PROPRIETES_PRESET = {
  name: { type: 'string' },
  description: { type: 'string' },
  services: { type: 'array', description: 'Services the preset pre-fills (no prices).', items: SCHEMA_SERVICE_PRESET },
  notes: { type: 'string', description: 'Client-facing notes.' },
  intro_text: { type: 'string' },
  terms: { type: 'string', description: 'Contract / disclaimer text.' },
  deposit_required: { type: 'boolean' },
  deposit_type: { type: 'string', enum: ['percentage', 'fixed'] },
  deposit_value: { type: 'number' },
  is_active: { type: 'boolean' },
};

/** Champs partiels d'un pré-réglage → patch de colonnes (uniquement ce qui est fourni). */
function patchPreset(args: Record<string, any>): Record<string, any> {
  const p: Record<string, any> = {};
  if (args.name !== undefined) p.name = champRequis(args.name, 'Le nom').slice(0, 200);
  if (args.description !== undefined) p.description = String(args.description).slice(0, 2000) || null;
  if (args.services !== undefined) p.services = servicesPreset(args.services);
  if (args.notes !== undefined) p.notes = String(args.notes).slice(0, 20000) || null;
  if (args.intro_text !== undefined) p.intro_text = String(args.intro_text).slice(0, 5000) || null;
  if (args.terms !== undefined) p.terms = String(args.terms).slice(0, 20000) || null;
  if (args.deposit_required !== undefined) p.deposit_required = Boolean(args.deposit_required);
  if (args.deposit_type !== undefined) p.deposit_type = args.deposit_type || null;
  if (args.deposit_value !== undefined) p.deposit_value = Math.max(0, Number(args.deposit_value) || 0);
  if (args.is_active !== undefined) p.is_active = args.is_active !== false;
  return p;
}

const listQuotePresetsTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_quote_presets',
    description: 'List the org’s quote content presets (name, services without prices, notes, terms) — what the « New quote » screen offers to pre-fill a quote.',
    parameters: {
      type: 'object',
      properties: {
        active_only: { type: 'boolean', description: 'true = only active presets.' },
        limit: { type: 'integer', description: 'Max results (default 20, max 50).' },
      },
    },
  },
  handler: async (args, ctx) => {
    let q = ctx.client
      .from('quote_templates')
      .select(COLONNES_MODELE_DEVIS, { count: 'exact' })
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })
      .limit(clamp(args.limit, 20, 50));
    if (args.active_only) q = q.eq('is_active', true);
    const { data, error, count } = await q;
    if (error) return erreurOutil('list_quote_presets', error);
    return { total_matching: count ?? (data || []).length, count: (data || []).length, presets: (data || []).map(resumePreset) };
  },
};

const createQuotePresetTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_quote_preset',
    description: 'Create a quote content preset (services without prices, notes, terms, deposit rule) through the app’s own route.',
    parameters: { type: 'object', properties: PROPRIETES_PRESET, required: ['name'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_quote_preset', args, async () => {
      const p = patchPreset(args);
      // Même corps que quotePresetsApi.mapToBackend : un pré-réglage n'a ni prix, ni taxes, ni mise en page.
      const corps = {
        name: p.name, description: p.description ?? null, images: [],
        services: p.services ?? [], notes: p.notes ?? null, intro_text: p.intro_text ?? null, terms: p.terms ?? null,
        custom_fields: {}, is_active: p.is_active ?? true,
        deposit_required: p.deposit_required ?? false, deposit_type: p.deposit_type ?? null, deposit_value: p.deposit_value ?? 0,
        tax_enabled: false, tax_rate: 0, tax_label: '', layout_config: {}, style_config: {},
      };
      const { ok, status, json } = await appelInterne(ctx, '/quote-templates', corps);
      if (!ok) throw new Error(json?.error || `Création refusée (${status}).`);
      return { created: true, preset: resumePreset(json?.template || { ...corps, id: null }), note: 'Pré-réglage de devis créé.' };
    }),
};

const updateQuotePresetTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_quote_preset',
    description: 'Edit a quote content preset. Only provided fields change; `services` REPLACES the list when provided.',
    parameters: { type: 'object', properties: { preset_id: { type: 'string', description: 'Preset id.' }, ...PROPRIETES_PRESET }, required: ['preset_id'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_quote_preset', args, async () => {
      const id = champRequis(args.preset_id, 'Le pré-réglage');
      const patch = patchPreset(args);
      if (!Object.keys(patch).length) throw new Error('Aucun champ à modifier.');
      patch.updated_at = new Date().toISOString();
      // La route de l'app est un PUT (appelInterne ne fait que POST) : même écriture, à l'identité, filtrée org.
      const { data, error } = await ctx.client
        .from('quote_templates')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', id)
        .is('deleted_at', null)
        .select(COLONNES_MODELE_DEVIS)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Pré-réglage introuvable.');
      return { updated: true, preset: resumePreset(data), note: 'Pré-réglage modifié.' };
    }),
};

const deleteQuotePresetTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_quote_preset',
    description: 'Delete a quote content preset (soft delete, like the app). Existing quotes are untouched.',
    parameters: { type: 'object', properties: { preset_id: { type: 'string', description: 'Preset id.' } }, required: ['preset_id'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_quote_preset', args, async () => {
      const id = champRequis(args.preset_id, 'Le pré-réglage');
      const { data, error } = await ctx.client
        .from('quote_templates')
        .update({ deleted_at: new Date().toISOString(), is_default: false, updated_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', id)
        .is('deleted_at', null)
        .select('id, name')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Pré-réglage introuvable (ou déjà supprimé).');
      return { deleted: true, preset: { name: data.name }, note: 'Pré-réglage supprimé.' };
    }),
};

const duplicateQuotePresetTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'duplicate_quote_preset',
    description: 'Duplicate a quote content preset (name suffixed « (Copy) ») through the app’s own route.',
    parameters: { type: 'object', properties: { preset_id: { type: 'string', description: 'Preset id.' } }, required: ['preset_id'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'duplicate_quote_preset', args, async () => {
      const id = champRequis(args.preset_id, 'Le pré-réglage');
      const { ok, status, json } = await appelInterne(ctx, `/quote-templates/${encodeURIComponent(id)}/duplicate`, {});
      if (!ok) throw new Error(json?.error || `Duplication refusée (${status}).`);
      return { created: true, preset: resumePreset(json?.template || {}), note: 'Pré-réglage dupliqué.' };
    }),
};

const PROPRIETES_MODELE_DEVIS = {
  name: { type: 'string' },
  description: { type: 'string' },
  category: { type: 'string', description: 'Free-text category.' },
  services: { type: 'array', description: 'Services with prices in CENTS.', items: SCHEMA_SERVICE_MODELE },
  quote_title: { type: 'string' },
  intro_text: { type: 'string' },
  footer_notes: { type: 'string' },
  notes: { type: 'string' },
  terms: { type: 'string' },
  deposit_required: { type: 'boolean' },
  deposit_type: { type: 'string', enum: ['percentage', 'fixed'] },
  deposit_value: { type: 'number' },
  tax_enabled: { type: 'boolean' },
  tax_rate: { type: 'number', description: 'Percent, e.g. 14.975.' },
  tax_label: { type: 'string' },
  is_default: { type: 'boolean', description: 'true = becomes the org’s default template (clears the previous one).' },
  is_active: { type: 'boolean' },
};

function patchModeleDevis(args: Record<string, any>): Record<string, any> {
  const p = patchPreset(args);
  if (args.services !== undefined) p.services = servicesModele(args.services);
  if (args.category !== undefined) p.template_category = String(args.category).slice(0, 120) || null;
  if (args.quote_title !== undefined) p.quote_title = String(args.quote_title).slice(0, 500) || null;
  if (args.footer_notes !== undefined) p.footer_notes = String(args.footer_notes).slice(0, 20000) || null;
  if (args.tax_enabled !== undefined) p.tax_enabled = args.tax_enabled !== false;
  if (args.tax_rate !== undefined) p.tax_rate = Math.max(0, Number(args.tax_rate) || 0);
  if (args.tax_label !== undefined) p.tax_label = String(args.tax_label).slice(0, 120) || null;
  if (args.is_default !== undefined) p.is_default = Boolean(args.is_default);
  return p;
}

const listQuoteTemplatesTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_quote_templates',
    description: 'List the org’s full quote templates (services WITH prices, taxes, deposit, default flag, category).',
    parameters: {
      type: 'object',
      properties: {
        active_only: { type: 'boolean', description: 'true = only active templates.' },
        limit: { type: 'integer', description: 'Max results (default 20, max 50).' },
      },
    },
  },
  handler: async (args, ctx) => {
    let q = ctx.client
      .from('quote_templates')
      .select(COLONNES_MODELE_DEVIS, { count: 'exact' })
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(clamp(args.limit, 20, 50));
    if (args.active_only) q = q.eq('is_active', true);
    const { data, error, count } = await q;
    if (error) return erreurOutil('list_quote_templates', error);
    return { total_matching: count ?? (data || []).length, count: (data || []).length, templates: (data || []).map(resumeModeleDevis) };
  },
};

const createQuoteTemplateTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_quote_template',
    description: 'Create a full quote template (priced services, taxes, deposit, texts) through the app’s own route.',
    parameters: { type: 'object', properties: PROPRIETES_MODELE_DEVIS, required: ['name'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_quote_template', args, async () => {
      const p = patchModeleDevis(args);
      const { ok, status, json } = await appelInterne(ctx, '/quote-templates', {
        name: p.name, description: p.description ?? null, services: p.services ?? [], images: [],
        notes: p.notes ?? null, terms: p.terms ?? null, custom_fields: {},
        ...(p.template_category !== undefined ? { template_category: p.template_category } : {}),
        ...(p.quote_title !== undefined ? { quote_title: p.quote_title } : {}),
        ...(p.intro_text !== undefined ? { intro_text: p.intro_text } : {}),
        ...(p.footer_notes !== undefined ? { footer_notes: p.footer_notes } : {}),
        ...(p.deposit_required !== undefined ? { deposit_required: p.deposit_required } : {}),
        ...(p.deposit_type !== undefined ? { deposit_type: p.deposit_type } : {}),
        ...(p.deposit_value !== undefined ? { deposit_value: p.deposit_value } : {}),
        ...(p.tax_enabled !== undefined ? { tax_enabled: p.tax_enabled } : {}),
        ...(p.tax_rate !== undefined ? { tax_rate: p.tax_rate } : {}),
        ...(p.tax_label !== undefined ? { tax_label: p.tax_label } : {}),
        ...(p.is_default !== undefined ? { is_default: p.is_default } : {}),
        ...(p.is_active !== undefined ? { is_active: p.is_active } : {}),
      });
      if (!ok) throw new Error(json?.error || `Création refusée (${status}).`);
      return { created: true, template: resumeModeleDevis(json?.template || {}), note: 'Modèle de devis créé.' };
    }),
};

const updateQuoteTemplateTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_quote_template',
    description: 'Edit a full quote template. Only provided fields change; `services` REPLACES the list when provided.',
    parameters: { type: 'object', properties: { template_id: { type: 'string', description: 'Template id.' }, ...PROPRIETES_MODELE_DEVIS }, required: ['template_id'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_quote_template', args, async () => {
      const id = champRequis(args.template_id, 'Le modèle');
      const patch = patchModeleDevis(args);
      if (!Object.keys(patch).length) throw new Error('Aucun champ à modifier.');
      // Un seul modèle par défaut : on retire l'ancien d'abord (comme la route PUT).
      if (patch.is_default) {
        const { error: eClear } = await ctx.client
          .from('quote_templates')
          .update({ is_default: false })
          .eq('org_id', ctx.orgId).eq('is_default', true).is('deleted_at', null).neq('id', id);
        if (eClear) throw eClear;
      }
      patch.updated_at = new Date().toISOString();
      const { data, error } = await ctx.client
        .from('quote_templates')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', id)
        .is('deleted_at', null)
        .select(COLONNES_MODELE_DEVIS)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Modèle introuvable.');
      return { updated: true, template: resumeModeleDevis(data), note: 'Modèle de devis modifié.' };
    }),
};

const deleteQuoteTemplateTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_quote_template',
    description: 'Delete a full quote template (soft delete, like the app). Existing quotes are untouched.',
    parameters: { type: 'object', properties: { template_id: { type: 'string', description: 'Template id.' } }, required: ['template_id'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_quote_template', args, async () => {
      const id = champRequis(args.template_id, 'Le modèle');
      const { data, error } = await ctx.client
        .from('quote_templates')
        .update({ deleted_at: new Date().toISOString(), is_default: false, updated_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', id)
        .is('deleted_at', null)
        .select('id, name')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Modèle introuvable (ou déjà supprimé).');
      return { deleted: true, template: { name: data.name }, note: 'Modèle de devis supprimé.' };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   FACTURES
   ═══════════════════════════════════════════════════════════════ */

const updateInvoiceTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_invoice',
    description:
      'Edit an invoice: subject, due date, client notes, internal notes, and — for a DRAFT only — REPLACE its '
      + 'line items and tax amount (totals recomputed by the app’s own RPC). Only provided fields change. Nothing is sent.',
    parameters: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'Invoice id.' },
        subject: { type: 'string' },
        due_date: { type: 'string', description: 'YYYY-MM-DD.' },
        notes: { type: 'string', description: 'Notes shown to the client.' },
        internal_notes: { type: 'string' },
        items: { type: 'array', description: 'DRAFT only — REPLACES all items when provided.', items: SCHEMA_LIGNE_FACTURE },
        tax_cents: { type: 'integer', description: 'DRAFT only — total tax in CENTS.' },
      },
      required: ['invoice_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_invoice', args, async () => {
      const invoiceId = champRequis(args.invoice_id, 'La facture');
      const inv = await lireFacture(ctx, invoiceId, 'id, invoice_number, status, subject, due_date, notes, internal_notes, tax_cents, discount_cents, template_id');
      if (args.due_date !== undefined && args.due_date !== null && !estDateYmd(args.due_date)) {
        throw new Error('La date d’échéance doit être au format AAAA-MM-JJ.');
      }
      const touchePieces = Array.isArray(args.items) || args.tax_cents !== undefined;
      if (touchePieces) {
        if (inv.status !== 'draft') {
          throw new Error(`Cette facture est « ${traduireStatut(inv.status, STATUT_FACTURE)} » : ses articles ne se modifient plus. Remets-la en brouillon d’abord (revert_invoice_to_draft) si elle n’est pas payée.`);
        }
        const lignes = Array.isArray(args.items) ? normaliserLignesFacture(args.items) : null;
        if (lignes && !lignes.length) throw new Error('Aucune ligne valide (description et prix requis).');
        if (lignes) {
          const taxe = args.tax_cents !== undefined ? centsPositifs(args.tax_cents) : centsPositifs(inv.tax_cents);
          verifierPlafond(sommeLignes(lignes) + taxe);
        }
        // Sans lignes fournies, on renvoie les lignes actuelles à la RPC (elle remplace tout).
        let items = lignes;
        if (!items) {
          const { data: actuels, error: eIt } = await ctx.client
            .from('invoice_items').select('description, qty, unit_price_cents')
            .eq('org_id', ctx.orgId).eq('invoice_id', invoiceId).is('deleted_at', null)
            .order('sort_order', { ascending: true }).order('created_at', { ascending: true });
          if (eIt) throw eIt;
          items = normaliserLignesFacture(actuels || []);
        }
        // Même RPC que l'écran d'édition : subject/due_date/notes non fournis = valeurs actuelles.
        const { error: eSave } = await ctx.client.rpc('rpc_save_invoice_draft', {
          p_invoice_id: invoiceId,
          p_subject: args.subject !== undefined ? (String(args.subject).slice(0, 500) || null) : (inv.subject ?? null),
          p_due_date: args.due_date !== undefined ? (args.due_date || null) : (inv.due_date ?? null),
          p_tax_cents: args.tax_cents !== undefined ? centsPositifs(args.tax_cents) : centsPositifs(inv.tax_cents),
          p_discount_cents: centsPositifs(inv.discount_cents),
          p_notes: args.notes !== undefined ? (String(args.notes).slice(0, 20000) || null) : (inv.notes ?? null),
          p_internal_notes: args.internal_notes !== undefined ? (String(args.internal_notes).slice(0, 20000) || null) : (inv.internal_notes ?? null),
          p_items: items,
          ...(inv.template_id ? { p_template_id: inv.template_id } : {}),
        });
        if (eSave) throw eSave;
      } else {
        // Miroir de updateInvoiceFields : champs simples, filtrés org.
        const patch: Record<string, any> = {};
        if (args.subject !== undefined) patch.subject = String(args.subject).slice(0, 500) || null;
        if (args.due_date !== undefined) patch.due_date = args.due_date || null;
        if (args.notes !== undefined) patch.notes = String(args.notes).slice(0, 20000) || null;
        if (args.internal_notes !== undefined) patch.internal_notes = String(args.internal_notes).slice(0, 20000) || null;
        if (!Object.keys(patch).length) throw new Error('Aucun champ à modifier.');
        patch.updated_at = new Date().toISOString();
        const { error } = await ctx.client
          .from('invoices').update(patch)
          .eq('org_id', ctx.orgId).eq('id', invoiceId).is('deleted_at', null);
        if (error) throw error;
      }
      const { data: apres } = await ctx.client
        .from('invoices').select('invoice_number, status, subject, due_date, total_cents, balance_cents')
        .eq('org_id', ctx.orgId).eq('id', invoiceId).maybeSingle();
      return {
        updated: true,
        invoice: {
          invoice_number: apres?.invoice_number ?? inv.invoice_number,
          statut: traduireStatut(apres?.status ?? inv.status, STATUT_FACTURE),
          subject: apres?.subject ?? null, due_date: apres?.due_date ?? null,
          total_cents: apres?.total_cents ?? null, balance_cents: apres?.balance_cents ?? null,
        },
        note: touchePieces
          ? 'Facture modifiée : articles et taxes remplacés, totaux recalculés par Lume. Rien n’est parti chez le client.'
          : 'Facture modifiée. Rien n’est parti chez le client.',
      };
    }),
};

const voidInvoiceTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'void_invoice',
    description:
      'Void (cancel) an invoice — it stays visible as voided, stops reminders and no longer counts as owed, '
      + 'like the app’s Void action. A PAID invoice cannot be voided (refund instead). ALWAYS confirm first.',
    parameters: { type: 'object', properties: { invoice_id: { type: 'string', description: 'Invoice id.' } }, required: ['invoice_id'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'void_invoice', args, async () => {
      const invoiceId = champRequis(args.invoice_id, 'La facture');
      const inv = await lireFacture(ctx, invoiceId, 'id, invoice_number, status, paid_cents');
      if (inv.status === 'void' || inv.status === 'cancelled') {
        return { already_void: true, invoice: { invoice_number: inv.invoice_number }, note: 'Cette facture est déjà annulée — rien à faire.' };
      }
      if (inv.status === 'paid') throw new Error('Cette facture est payée — on ne l’annule pas ; un remboursement passe par refund_payment.');
      const { data, error } = await ctx.client
        .from('invoices')
        .update({ status: 'void', updated_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', invoiceId).is('deleted_at', null)
        .select('invoice_number, status, paid_cents')
        .single();
      if (error) throw error;
      return {
        voided: true,
        invoice: { invoice_number: data.invoice_number, statut: traduireStatut(data.status, STATUT_FACTURE) },
        note: Number(inv.paid_cents) > 0
          ? 'Facture annulée. Attention : un paiement partiel y était enregistré — vérifie s’il faut le rembourser.'
          : 'Facture annulée : elle ne compte plus comme due et les rappels s’arrêtent.',
      };
    }),
};

const revertInvoiceToDraftTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'revert_invoice_to_draft',
    description:
      'Put a sent (or voided) invoice back to DRAFT so it can be edited, like the app’s « Revert to draft ». '
      + 'Refused if any payment was recorded on it.',
    parameters: { type: 'object', properties: { invoice_id: { type: 'string', description: 'Invoice id.' } }, required: ['invoice_id'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'revert_invoice_to_draft', args, async () => {
      const invoiceId = champRequis(args.invoice_id, 'La facture');
      const inv = await lireFacture(ctx, invoiceId, 'id, invoice_number, status, paid_cents');
      if (inv.status === 'draft') return { already_draft: true, invoice: { invoice_number: inv.invoice_number }, note: 'Cette facture est déjà en brouillon.' };
      if (Number(inv.paid_cents) > 0) throw new Error('Un paiement est déjà enregistré sur cette facture — elle ne peut pas revenir en brouillon.');
      // Miroir de revertToDraft (invoicesApi).
      const { data, error } = await ctx.client
        .from('invoices')
        .update({ status: 'draft', issued_at: null, sent_at: null, updated_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', invoiceId).is('deleted_at', null)
        .select('invoice_number, status')
        .single();
      if (error) throw error;
      return {
        reverted: true,
        invoice: { invoice_number: data.invoice_number, statut: traduireStatut(data.status, STATUT_FACTURE) },
        note: 'Facture remise en brouillon — modifiable à nouveau, rappels suspendus. Il faudra la renvoyer au client.',
      };
    }),
};

const duplicateInvoiceTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'duplicate_invoice',
    description:
      'Duplicate an invoice into a NEW draft (same client, items, taxes, subject suffixed « (Copy) », no due date), '
      + 'like the app’s Duplicate action. Nothing is sent.',
    parameters: { type: 'object', properties: { invoice_id: { type: 'string', description: 'Source invoice id.' } }, required: ['invoice_id'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'duplicate_invoice', args, async () => {
      const invoiceId = champRequis(args.invoice_id, 'La facture');
      const src = await lireFacture(ctx, invoiceId, 'id, invoice_number, client_id, subject, tax_cents, discount_cents, notes, template_id');
      if (!src.client_id) throw new Error('Cette facture n’a pas de client — impossible de la dupliquer.');
      const { data: items, error: eIt } = await ctx.client
        .from('invoice_items').select('description, qty, unit_price_cents')
        .eq('org_id', ctx.orgId).eq('invoice_id', invoiceId).is('deleted_at', null)
        .order('sort_order', { ascending: true }).order('created_at', { ascending: true });
      if (eIt) throw eIt;
      const lignes = normaliserLignesFacture(items || []);
      const taxe = centsPositifs(src.tax_cents);
      verifierPlafond(sommeLignes(lignes) + taxe);
      const sujet = src.subject ? `${src.subject} (Copy)` : null;

      // Mêmes RPC que l'écran « Nouvelle facture ».
      const { data: creation, error: e1 } = await ctx.client.rpc('rpc_create_invoice_draft', {
        p_client_id: src.client_id, p_subject: sujet, p_due_date: null,
      });
      if (e1) throw e1;
      const row: any = Array.isArray(creation) ? creation[0] : creation;
      const nouveauId = String(row?.id || '');
      if (!nouveauId) throw new Error('La facture a été créée mais son id est introuvable.');

      const { error: e2 } = await ctx.client.rpc('rpc_save_invoice_draft', {
        p_invoice_id: nouveauId, p_subject: sujet, p_due_date: null,
        p_tax_cents: taxe, p_discount_cents: centsPositifs(src.discount_cents),
        p_notes: src.notes ?? null, p_internal_notes: null, p_items: lignes,
        ...(src.template_id ? { p_template_id: src.template_id } : {}),
      });
      // La facture EXISTE déjà : on renvoie (empreinte gardée) plutôt que de risquer un doublon.
      if (e2) {
        console.error('[agent-tool:duplicate_invoice] save failed', e2.message);
        return {
          created: true, incomplet: true, invoice_id: nouveauId, invoice_number: row?.invoice_number ?? null, statut: 'brouillon',
          note: 'La facture copiée a été créée en brouillon, mais ses articles n’ont pas pu être reportés. Complète-la dans Lume ; ne relance pas la copie.',
        };
      }
      return {
        created: true, invoice_id: nouveauId, invoice_number: row?.invoice_number ?? null, statut: 'brouillon',
        total_cents: sommeLignes(lignes) + taxe, source: { invoice_number: src.invoice_number },
        note: 'Copie créée en BROUILLON — rien n’est parti chez le client. send_invoice pour l’envoyer, avec confirmation.',
      };
    }),
};

const deleteInvoiceTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_invoice',
    description:
      'Delete an invoice (soft delete: gone from Lume, recoverable by support). Refused if any payment was recorded — '
      + 'void it instead. ALWAYS confirm first.',
    parameters: { type: 'object', properties: { invoice_id: { type: 'string', description: 'Invoice id.' } }, required: ['invoice_id'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_invoice', args, async () => {
      const invoiceId = champRequis(args.invoice_id, 'La facture');
      const inv = await lireFacture(ctx, invoiceId, 'id, invoice_number, status, paid_cents');
      if (inv.status === 'paid' || Number(inv.paid_cents) > 0) {
        throw new Error('Un paiement est enregistré sur cette facture — on ne la supprime pas (piste comptable). Annule-la plutôt (void_invoice).');
      }
      // Suppression DOUCE (deleted_at), jamais un DELETE : règle du projet.
      const { data, error } = await ctx.client
        .from('invoices')
        .update({ deleted_at: new Date().toISOString(), deleted_by: ctx.userId, updated_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', invoiceId).is('deleted_at', null)
        .select('invoice_number')
        .single();
      if (error) throw error;
      return { deleted: true, invoice: { invoice_number: data.invoice_number }, note: 'Facture supprimée — elle n’apparaît plus dans Lume.' };
    }),
};

const recordInvoicePaymentTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'record_invoice_payment',
    description:
      'Record a PARTIAL manual payment (cash, e-transfer, cheque…) on an invoice: the balance goes down and the '
      + 'invoice becomes partially paid. The amount must be below the remaining balance — for the full '
      + 'balance use mark_invoice_paid. Nothing is charged. ALWAYS confirm the invoice and amount first.',
    parameters: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'Invoice id.' },
        amount_cents: { type: 'integer', description: 'Amount received in CENTS (> 0, < remaining balance).' },
        method: { type: 'string', enum: ['cash', 'e-transfer', 'check', 'card'], description: 'How it was paid. Optional.' },
      },
      required: ['invoice_id', 'amount_cents'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'record_invoice_payment', args, async () => {
      const invoiceId = champRequis(args.invoice_id, 'La facture');
      const montant = Math.round(Number(args.amount_cents));
      if (!Number.isFinite(montant) || montant <= 0) throw new Error('Le montant doit être un nombre de cents strictement positif.');
      verifierPlafond(montant);
      // Lecture À L'IDENTITÉ (RLS garantit l'appartenance à l'org).
      const inv = await lireFacture(ctx, invoiceId, 'id, invoice_number, status, total_cents, paid_cents, balance_cents, client_id');
      if (inv.status === 'paid' || (Number(inv.balance_cents) <= 0 && Number(inv.paid_cents) > 0)) {
        return { already_paid: true, invoice: { invoice_number: inv.invoice_number }, note: 'Cette facture est déjà payée — rien à enregistrer.' };
      }
      if (inv.status === 'draft') throw new Error('Cette facture est encore un brouillon — envoie-la d’abord au client, ensuite je pourrai y enregistrer un paiement.');
      if (inv.status === 'void' || inv.status === 'cancelled') throw new Error('Cette facture est annulée — on n’y enregistre pas de paiement.');
      const solde = Number(inv.balance_cents) > 0 ? Number(inv.balance_cents) : Math.max(0, Number(inv.total_cents) - Number(inv.paid_cents || 0));
      if (montant > solde) {
        throw new Error(`Le montant (${(montant / 100).toFixed(2)} $) dépasse le solde restant (${(solde / 100).toFixed(2)} $). Enregistre au plus le solde.`);
      }
      if (montant === solde) {
        throw new Error('Ce montant règle la facture au complet — utilise mark_invoice_paid pour la marquer payée.');
      }
      const methode = ['cash', 'e-transfer', 'check', 'card'].includes(String(args.method)) ? String(args.method) : null;
      // Même RPC (service_role) que mark_invoice_paid : paid/balance/statut mis à jour atomiquement, filtrée org.
      const admin = getServiceClient();
      const { error: eApply } = await admin.rpc('apply_invoice_payment', { p_invoice_id: invoiceId, p_org_id: ctx.orgId, p_amount_cents: montant });
      if (eApply) throw eApply;
      const { data: apres } = await admin.from('invoices').select('invoice_number, balance_cents, status').eq('org_id', ctx.orgId).eq('id', invoiceId).maybeSingle();
      return {
        recorded: true,
        invoice: { invoice_number: apres?.invoice_number || inv.invoice_number, statut: traduireStatut(apres?.status, STATUT_FACTURE) },
        amount_cents: montant,
        balance_cents: apres?.balance_cents ?? (solde - montant),
        methode_paiement: methode,
        note: 'Paiement partiel enregistré : le solde a diminué et la facture est partiellement payée. Rien n’a été prélevé — c’est un paiement reçu à part.',
      };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   FACTURES RÉCURRENTES
   (la route /recurring-invoices n'existe plus côté serveur : on écrit
   directement dans recurring_invoice_schedules, et « exécuter
   maintenant » emprunte le moteur du cron.)
   ═══════════════════════════════════════════════════════════════ */

const FREQUENCES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'];
const FREQUENCE_FR: Record<string, string> = { weekly: 'chaque semaine', biweekly: 'aux deux semaines', monthly: 'chaque mois', quarterly: 'chaque trimestre', yearly: 'chaque année' };

function resumeRecurrence(r: any) {
  const items = Array.isArray(r.items) ? r.items : [];
  return {
    id: r.id,
    subject: r.subject,
    client_name: nomClient(r.client) || null,
    frequence: FREQUENCE_FR[r.frequency] || r.frequency,
    next_run_date: r.next_run_date,
    end_date: r.end_date,
    due_days_offset: r.due_days_offset,
    auto_send: Boolean(r.auto_send),
    is_active: r.is_active !== false,
    last_run_at: r.last_run_at,
    amount_cents: sommeLignes(items),
    items_count: items.length,
  };
}

const listRecurringInvoicesTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_recurring_invoices',
    description: 'List recurring invoice schedules (client, subject, frequency, next run, amount, auto-send, active).',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Optional client filter.' },
        include_inactive: { type: 'boolean', description: 'true = also paused/ended schedules.' },
        limit: { type: 'integer', description: 'Max results (default 20, max 50).' },
      },
    },
  },
  handler: async (args, ctx) => {
    let q = ctx.client
      .from('recurring_invoice_schedules')
      .select('id, client_id, subject, items, frequency, next_run_date, end_date, due_days_offset, auto_send, is_active, last_run_at, client:clients!recurring_invoice_schedules_client_id_fkey(first_name, last_name, company)', { count: 'exact' })
      .eq('org_id', ctx.orgId)
      .order('next_run_date', { ascending: true })
      .limit(clamp(args.limit, 20, 50));
    if (args.client_id) q = q.eq('client_id', String(args.client_id));
    if (!args.include_inactive) q = q.eq('is_active', true);
    const { data, error, count } = await q;
    if (error) return erreurOutil('list_recurring_invoices', error);
    const rows = data || [];
    return { total_matching: count ?? rows.length, count: rows.length, sum_amount_cents: rows.reduce((s: number, r: any) => s + sommeLignes(Array.isArray(r.items) ? r.items : []), 0), schedules: rows.map(resumeRecurrence) };
  },
};

const createRecurringInvoiceTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_recurring_invoice',
    description:
      'Create a recurring invoice schedule for a client: Lume will generate an invoice at each run (draft, or marked '
      + 'sent when auto_send is true). Amounts in CENTS. ALWAYS confirm client, items, frequency and start date first.',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string', description: 'Client id (from a client search).' },
        subject: { type: 'string', description: 'Invoice subject.' },
        items: { type: 'array', items: SCHEMA_LIGNE_FACTURE },
        frequency: { type: 'string', enum: FREQUENCES },
        start_date: { type: 'string', description: 'First run, YYYY-MM-DD.' },
        end_date: { type: 'string', description: 'Optional last day, YYYY-MM-DD.' },
        due_days_offset: { type: 'integer', description: 'Days between issue and due date (default 30).' },
        auto_send: { type: 'boolean', description: 'true = each generated invoice is marked sent automatically (default false).' },
      },
      required: ['client_id', 'subject', 'items', 'frequency', 'start_date'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_recurring_invoice', args, async () => {
      const clientId = champRequis(args.client_id, 'Le client');
      const sujet = champRequis(args.subject, 'Le sujet').slice(0, 500);
      const lignes = normaliserLignesFacture(args.items);
      if (!lignes.length) throw new Error('Aucune ligne valide (description et prix requis).');
      if (!FREQUENCES.includes(String(args.frequency))) throw new Error('Fréquence inconnue (weekly, biweekly, monthly, quarterly, yearly).');
      if (!estDateYmd(args.start_date)) throw new Error('La date de début doit être au format AAAA-MM-JJ.');
      if (args.end_date && !estDateYmd(args.end_date)) throw new Error('La date de fin doit être au format AAAA-MM-JJ.');
      if (args.end_date && String(args.end_date) < String(args.start_date)) throw new Error('La date de fin précède la date de début.');
      verifierPlafond(sommeLignes(lignes));
      // Le client doit appartenir à l'org (la FK composite le garantit aussi, mais on répond proprement).
      const { data: cli, error: eCli } = await ctx.client
        .from('clients').select('id, first_name, last_name, company')
        .eq('org_id', ctx.orgId).eq('id', clientId).is('deleted_at', null).maybeSingle();
      if (eCli) throw eCli;
      if (!cli) throw new Error('Client introuvable — vérifie le nom du client.');
      const { data, error } = await ctx.client
        .from('recurring_invoice_schedules')
        .insert({
          org_id: ctx.orgId,
          client_id: clientId,
          subject: sujet,
          items: lignes,
          frequency: String(args.frequency),
          start_date: String(args.start_date),
          end_date: args.end_date ? String(args.end_date) : null,
          next_run_date: String(args.start_date),
          due_days_offset: clamp(args.due_days_offset, 30, 365),
          auto_send: Boolean(args.auto_send),
          is_active: true,
        })
        .select('id, subject, frequency, next_run_date, end_date, due_days_offset, auto_send, is_active, items')
        .single();
      if (error) throw error;
      return {
        created: true,
        schedule: { ...resumeRecurrence(data), client_name: nomClient(cli) },
        note: `Facturation récurrente créée (${FREQUENCE_FR[String(args.frequency)]}, première le ${data.next_run_date}). `
          + (args.auto_send ? 'Chaque facture sera marquée envoyée automatiquement.' : 'Chaque facture sera générée en brouillon, à envoyer ensuite.'),
      };
    }),
};

const updateRecurringInvoiceTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_recurring_invoice',
    description: 'Edit a recurring invoice schedule (subject, items, frequency, dates, due offset, auto-send, pause/resume via is_active). Only provided fields change.',
    parameters: {
      type: 'object',
      properties: {
        schedule_id: { type: 'string', description: 'Schedule id (from list_recurring_invoices).' },
        subject: { type: 'string' },
        items: { type: 'array', description: 'REPLACES all items when provided.', items: SCHEMA_LIGNE_FACTURE },
        frequency: { type: 'string', enum: FREQUENCES },
        next_run_date: { type: 'string', description: 'YYYY-MM-DD.' },
        end_date: { type: 'string', description: 'YYYY-MM-DD.' },
        due_days_offset: { type: 'integer' },
        auto_send: { type: 'boolean' },
        is_active: { type: 'boolean', description: 'false = pause, true = resume.' },
      },
      required: ['schedule_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_recurring_invoice', args, async () => {
      const id = champRequis(args.schedule_id, 'La facturation récurrente');
      const patch: Record<string, any> = {};
      if (args.subject !== undefined) patch.subject = champRequis(args.subject, 'Le sujet').slice(0, 500);
      if (args.items !== undefined) {
        const lignes = normaliserLignesFacture(args.items);
        if (!lignes.length) throw new Error('Aucune ligne valide (description et prix requis).');
        verifierPlafond(sommeLignes(lignes));
        patch.items = lignes;
      }
      if (args.frequency !== undefined) {
        if (!FREQUENCES.includes(String(args.frequency))) throw new Error('Fréquence inconnue (weekly, biweekly, monthly, quarterly, yearly).');
        patch.frequency = String(args.frequency);
      }
      if (args.next_run_date !== undefined) { if (!estDateYmd(args.next_run_date)) throw new Error('next_run_date doit être au format AAAA-MM-JJ.'); patch.next_run_date = args.next_run_date; }
      if (args.end_date !== undefined) { if (args.end_date && !estDateYmd(args.end_date)) throw new Error('end_date doit être au format AAAA-MM-JJ.'); patch.end_date = args.end_date || null; }
      if (args.due_days_offset !== undefined) patch.due_days_offset = clamp(args.due_days_offset, 30, 365);
      if (args.auto_send !== undefined) patch.auto_send = Boolean(args.auto_send);
      if (args.is_active !== undefined) patch.is_active = Boolean(args.is_active);
      if (!Object.keys(patch).length) throw new Error('Aucun champ à modifier.');
      patch.updated_at = new Date().toISOString();
      const { data, error } = await ctx.client
        .from('recurring_invoice_schedules')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', id)
        .select('id, subject, frequency, next_run_date, end_date, due_days_offset, auto_send, is_active, last_run_at, items, client:clients!recurring_invoice_schedules_client_id_fkey(first_name, last_name, company)')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Facturation récurrente introuvable.');
      return {
        updated: true, schedule: resumeRecurrence(data),
        note: args.is_active === false ? 'Facturation récurrente mise en pause.' : args.is_active === true ? 'Facturation récurrente réactivée.' : 'Facturation récurrente modifiée.',
      };
    }),
};

const deleteRecurringInvoiceTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_recurring_invoice',
    description: 'Stop a recurring invoice schedule for good (deactivated — no further invoice will be generated). Invoices already generated are untouched.',
    parameters: { type: 'object', properties: { schedule_id: { type: 'string', description: 'Schedule id.' } }, required: ['schedule_id'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_recurring_invoice', args, async () => {
      const id = champRequis(args.schedule_id, 'La facturation récurrente');
      // La table n'a pas de deleted_at : on désactive (jamais de DELETE — règle du projet), la liste ne la montre plus.
      const { data, error } = await ctx.client
        .from('recurring_invoice_schedules')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('org_id', ctx.orgId).eq('id', id)
        .select('id, subject')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Facturation récurrente introuvable.');
      return { deleted: true, schedule: { subject: data.subject }, note: 'Facturation récurrente arrêtée : plus aucune facture ne sera générée.' };
    }),
};

const runRecurringInvoiceNowTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'run_recurring_invoice_now',
    description:
      'Generate ONE invoice right now from a recurring schedule, without moving its next run date — the same engine '
      + 'as the nightly run. Draft unless the schedule has auto_send. ALWAYS confirm first.',
    parameters: { type: 'object', properties: { schedule_id: { type: 'string', description: 'Schedule id.' } }, required: ['schedule_id'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'run_recurring_invoice_now', args, async () => {
      const id = champRequis(args.schedule_id, 'La facturation récurrente');
      // Lecture À L'IDENTITÉ et filtrée org : le moteur (service_role) ne reçoit qu'une ligne de CETTE org.
      const { data: sched, error } = await ctx.client
        .from('recurring_invoice_schedules')
        .select('id, org_id, client_id, subject, items, frequency, start_date, end_date, next_run_date, due_days_offset, auto_send, is_active')
        .eq('org_id', ctx.orgId).eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!sched || sched.org_id !== ctx.orgId) throw new Error('Facturation récurrente introuvable.');
      verifierPlafond(sommeLignes(Array.isArray(sched.items) ? sched.items : []));
      const r = await runOneSchedule(getServiceClient(), sched as RecurringSchedule, { advance: false });
      return {
        created: true, invoice_id: r.invoice_id, invoice_number: r.invoice_number,
        statut: sched.auto_send ? 'envoyée' : 'brouillon',
        note: sched.auto_send
          ? 'Facture générée et marquée envoyée (réglage auto-envoi de cette récurrence). La prochaine échéance n’a pas bougé.'
          : 'Facture générée en BROUILLON — rien n’est parti chez le client. La prochaine échéance n’a pas bougé.',
      };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   MODÈLES DE FACTURE
   (la route /invoice-templates n'existe plus : écriture directe dans
   invoice_templates, mêmes colonnes que InvoiceTemplateInput.)
   ═══════════════════════════════════════════════════════════════ */

const LAYOUTS_FACTURE = ['classic', 'modern', 'minimal', 'bold', 'executive', 'contractor'];
const COLONNES_MODELE_FACTURE = 'id, name, title, description, line_items, taxes, payment_terms, client_note, email_subject, email_body, is_default, layout_type, updated_at';

function resumeModeleFacture(row: any) {
  const lignes = Array.isArray(row.line_items) ? row.line_items : [];
  return {
    id: row.id, name: row.name, title: row.title || '', description: row.description || '',
    line_items: lignes.map((l: any) => ({ description: l?.description || '', qty: Number(l?.qty) || 1, unit_price_cents: centsPositifs(l?.unit_price_cents) })),
    taxes: (Array.isArray(row.taxes) ? row.taxes : []).map((t: any) => ({ name: t?.name || '', rate: Number(t?.rate) || 0 })),
    payment_terms: row.payment_terms || '', client_note: row.client_note || '',
    email_subject: row.email_subject || '', email_body: row.email_body || '',
    is_default: Boolean(row.is_default), layout_type: row.layout_type || 'classic',
    amount_cents: sommeLignes(lignes),
  };
}

const PROPRIETES_MODELE_FACTURE = {
  name: { type: 'string' },
  title: { type: 'string' },
  description: { type: 'string' },
  line_items: { type: 'array', description: 'Pre-filled lines (CENTS).', items: SCHEMA_LIGNE_FACTURE },
  taxes: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, rate: { type: 'number', description: 'Percent.' } }, required: ['name', 'rate'] } },
  payment_terms: { type: 'string', description: 'e.g. « Net 30 ».' },
  client_note: { type: 'string' },
  email_subject: { type: 'string' },
  email_body: { type: 'string' },
  is_default: { type: 'boolean', description: 'true = becomes the org’s default (clears the previous one).' },
  layout_type: { type: 'string', enum: LAYOUTS_FACTURE },
};

function patchModeleFacture(args: Record<string, any>): Record<string, any> {
  const p: Record<string, any> = {};
  if (args.name !== undefined) p.name = champRequis(args.name, 'Le nom').slice(0, 200);
  if (args.title !== undefined) p.title = String(args.title).slice(0, 500);
  if (args.description !== undefined) p.description = String(args.description).slice(0, 5000);
  if (args.line_items !== undefined) {
    const lignes = normaliserLignesFacture(args.line_items);
    verifierPlafond(sommeLignes(lignes));
    p.line_items = lignes;
  }
  if (args.taxes !== undefined) {
    p.taxes = (Array.isArray(args.taxes) ? args.taxes : [])
      .filter((t: any) => String(t?.name || '').trim())
      .map((t: any) => ({ name: String(t.name).trim().slice(0, 80), rate: Math.max(0, Number(t.rate) || 0) }));
  }
  if (args.payment_terms !== undefined) p.payment_terms = String(args.payment_terms).slice(0, 200);
  if (args.client_note !== undefined) p.client_note = String(args.client_note).slice(0, 20000);
  if (args.email_subject !== undefined) p.email_subject = String(args.email_subject).slice(0, 500);
  if (args.email_body !== undefined) p.email_body = String(args.email_body).slice(0, 20000);
  if (args.is_default !== undefined) p.is_default = Boolean(args.is_default);
  if (args.layout_type !== undefined) {
    if (!LAYOUTS_FACTURE.includes(String(args.layout_type))) throw new Error('Mise en page inconnue (classic, modern, minimal, bold, executive, contractor).');
    p.layout_type = String(args.layout_type);
  }
  return p;
}

const listInvoiceTemplatesTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_invoice_templates',
    description: 'List the org’s invoice templates (name, pre-filled lines, taxes, payment terms, default flag, layout).',
    parameters: { type: 'object', properties: { limit: { type: 'integer', description: 'Max results (default 20, max 50).' } } },
  },
  handler: async (args, ctx) => {
    const { data, error, count } = await ctx.client
      .from('invoice_templates')
      .select(COLONNES_MODELE_FACTURE, { count: 'exact' })
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .is('archived_at', null)
      .order('is_default', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(clamp(args.limit, 20, 50));
    if (error) return erreurOutil('list_invoice_templates', error);
    return { total_matching: count ?? (data || []).length, count: (data || []).length, templates: (data || []).map(resumeModeleFacture) };
  },
};

const createInvoiceTemplateTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_invoice_template',
    description: 'Create an invoice template (pre-filled lines in CENTS, taxes, payment terms, email texts, layout).',
    parameters: { type: 'object', properties: PROPRIETES_MODELE_FACTURE, required: ['name'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_invoice_template', args, async () => {
      const p = patchModeleFacture(args);
      if (p.is_default) {
        const { error: eClear } = await ctx.client.from('invoice_templates').update({ is_default: false })
          .eq('org_id', ctx.orgId).eq('is_default', true).is('deleted_at', null);
        if (eClear) throw eClear;
      }
      const { data, error } = await ctx.client
        .from('invoice_templates')
        .insert({
          org_id: ctx.orgId, created_by: ctx.userId,
          name: p.name, title: p.title ?? '', description: p.description ?? '',
          line_items: p.line_items ?? [], taxes: p.taxes ?? [],
          payment_terms: p.payment_terms ?? 'Net 30', client_note: p.client_note ?? '',
          branding: {}, payment_methods: {},
          email_subject: p.email_subject ?? '', email_body: p.email_body ?? '',
          is_default: p.is_default ?? false, layout_type: p.layout_type ?? 'classic',
        })
        .select(COLONNES_MODELE_FACTURE)
        .single();
      if (error) throw error;
      return { created: true, template: resumeModeleFacture(data), note: 'Modèle de facture créé.' };
    }),
};

const updateInvoiceTemplateTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_invoice_template',
    description: 'Edit an invoice template. Only provided fields change; `line_items` and `taxes` REPLACE their lists when provided.',
    parameters: { type: 'object', properties: { template_id: { type: 'string', description: 'Template id.' }, ...PROPRIETES_MODELE_FACTURE }, required: ['template_id'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_invoice_template', args, async () => {
      const id = champRequis(args.template_id, 'Le modèle');
      const patch = patchModeleFacture(args);
      if (!Object.keys(patch).length) throw new Error('Aucun champ à modifier.');
      if (patch.is_default) {
        const { error: eClear } = await ctx.client.from('invoice_templates').update({ is_default: false })
          .eq('org_id', ctx.orgId).eq('is_default', true).is('deleted_at', null).neq('id', id);
        if (eClear) throw eClear;
      }
      patch.updated_at = new Date().toISOString();
      const { data, error } = await ctx.client
        .from('invoice_templates')
        .update(patch)
        .eq('org_id', ctx.orgId).eq('id', id)
        .is('deleted_at', null)
        .select(COLONNES_MODELE_FACTURE)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Modèle de facture introuvable.');
      return { updated: true, template: resumeModeleFacture(data), note: 'Modèle de facture modifié.' };
    }),
};

const deleteInvoiceTemplateTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'delete_invoice_template',
    description: 'Delete an invoice template (soft delete). Existing invoices are untouched.',
    parameters: { type: 'object', properties: { template_id: { type: 'string', description: 'Template id.' } }, required: ['template_id'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'delete_invoice_template', args, async () => {
      const id = champRequis(args.template_id, 'Le modèle');
      const maintenant = new Date().toISOString();
      const { data, error } = await ctx.client
        .from('invoice_templates')
        .update({ deleted_at: maintenant, archived_at: maintenant, is_default: false, updated_at: maintenant })
        .eq('org_id', ctx.orgId).eq('id', id)
        .is('deleted_at', null)
        .select('id, name')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Modèle de facture introuvable (ou déjà supprimé).');
      return { deleted: true, template: { name: data.name }, note: 'Modèle de facture supprimé.' };
    }),
};

/* ═══════════════════════════════════════════════════════════════
   PAIEMENTS
   ═══════════════════════════════════════════════════════════════ */

const CANAUX_DEMANDE = ['email', 'sms', 'both', 'link_only'];
const CANAL_FR: Record<string, string> = { email: 'par courriel', sms: 'par texto', both: 'par courriel et texto', link_only: 'lien seulement (rien envoyé)' };

function resumeNotifications(n: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (n?.email) out.email = n.email.sent ? 'envoyé' : `non envoyé (${n.email.reason || 'raison inconnue'})`;
  if (n?.sms) out.sms = n.sms.sent ? 'envoyé' : `non envoyé (${n.sms.reason || 'raison inconnue'})`;
  return out;
}

const createPaymentRequestTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'create_payment_request',
    description:
      'Create an online payment link (Stripe) for an invoice’s remaining balance and optionally SEND it to the '
      + 'client by email and/or SMS — the app’s own route. link_only creates the link without sending. ALWAYS '
      + 'confirm invoice, amount and channel with the user first.',
    parameters: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'Invoice id.' },
        send_via: { type: 'string', enum: CANAUX_DEMANDE, description: 'Default link_only.' },
      },
      required: ['invoice_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'create_payment_request', args, async () => {
      const invoiceId = champRequis(args.invoice_id, 'La facture');
      const sendVia = CANAUX_DEMANDE.includes(String(args.send_via)) ? String(args.send_via) : 'link_only';
      let res;
      try {
        res = await appelInterne(ctx, '/payment-requests/create', { invoiceId, sendVia });
      } catch (e) {
        if (e instanceof AppelInterneIncertain) return resultatIncertain('le lien de paiement');
        throw e;
      }
      if (!res.ok) throw new Error(res.json?.error || `Demande refusée (${res.status}).`);
      const pr = res.json?.payment_request || {};
      return {
        created: true,
        payment_url: pr.payment_url || null,
        amount_cents: pr.amount_cents ?? null,
        sent_via: CANAL_FR[sendVia],
        notifications: resumeNotifications(res.json?.notifications),
        note: sendVia === 'link_only'
          ? 'Lien de paiement créé — rien n’a été envoyé. Donne le lien à l’utilisateur ou renvoie-le au client avec resend_payment_request.'
          : `Lien de paiement créé et envoyé ${CANAL_FR[sendVia]} par le moteur de Lume.`,
      };
    }),
};

const resendPaymentRequestTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'resend_payment_request',
    description:
      'Re-send the existing payment link of an invoice to the client by email and/or SMS (app’s own route). '
      + 'Requires an active payment request (create_payment_request first). ALWAYS confirm first.',
    parameters: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'Invoice id.' },
        send_via: { type: 'string', enum: ['email', 'sms', 'both'], description: 'Default email.' },
      },
      required: ['invoice_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'resend_payment_request', args, async () => {
      const invoiceId = champRequis(args.invoice_id, 'La facture');
      const sendVia = ['email', 'sms', 'both'].includes(String(args.send_via)) ? String(args.send_via) : 'email';
      let res;
      try {
        res = await appelInterne(ctx, '/payment-requests/resend', { invoiceId, sendVia });
      } catch (e) {
        if (e instanceof AppelInterneIncertain) return resultatIncertain('le rappel du lien de paiement');
        throw e;
      }
      if (!res.ok) throw new Error(res.json?.error || `Renvoi refusé (${res.status}).`);
      const pr = res.json?.payment_request || {};
      return {
        sent: true, payment_url: pr.payment_url || null, sent_via: CANAL_FR[sendVia],
        notifications: resumeNotifications(res.json?.notifications),
        note: `Lien de paiement renvoyé ${CANAL_FR[sendVia]} par le moteur de Lume.`,
      };
    }),
};

const refundPaymentTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'refund_payment',
    description:
      'REFUND a Stripe payment to the client (full by default, or a partial amount in CENTS) — IRREVERSIBLE, money '
      + 'actually leaves the account, owner/admin only. A full refund reopens the invoice balance. Get the payment '
      + 'id from list_payments. ALWAYS show payment, client and amount and get an explicit OK first.',
    parameters: {
      type: 'object',
      properties: {
        payment_id: { type: 'string', description: 'Payment id (from list_payments).' },
        amount_cents: { type: 'integer', description: 'Partial amount in CENTS. Omit for a full refund.' },
        reason: { type: 'string', enum: ['requested_by_customer', 'duplicate', 'fraudulent'] },
      },
      required: ['payment_id'],
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'refund_payment', args, async () => {
      const paymentId = champRequis(args.payment_id, 'Le paiement');
      const corps: Record<string, any> = { paymentId };
      if (args.amount_cents !== undefined) {
        const m = Math.round(Number(args.amount_cents));
        if (!Number.isFinite(m) || m <= 0) throw new Error('Le montant à rembourser doit être un nombre de cents strictement positif.');
        verifierPlafond(m);
        corps.amountCents = m;
      }
      if (args.reason) corps.reason = String(args.reason);
      let res;
      try {
        res = await appelInterne(ctx, '/payments/refund', corps);
      } catch (e) {
        if (e instanceof AppelInterneIncertain) {
          return { incertain: true, refunded: null, note: 'Je n’ai pas eu la confirmation du remboursement — il a PEUT-ÊTRE été fait. Ne relance pas : vérifie dans Lume (paiements) ou dans Stripe avant toute nouvelle tentative.' };
        }
        throw e;
      }
      // Remboursement émis chez Stripe mais synchro locale ratée : c'est FAIT, on ne retente pas.
      if (!res.ok && res.json?.code === 'DB_SYNC_FAILED') {
        return { refunded: true, incomplet: true, refund_id: res.json?.refund_id || null, note: 'Le remboursement est parti chez Stripe, mais Lume n’a pas pu mettre la facture à jour — signale-le à l’utilisateur pour une vérification manuelle. Ne relance pas.' };
      }
      if (!res.ok) throw new Error(res.json?.error || `Remboursement refusé (${res.status}).`);
      return {
        refunded: true,
        refund_amount_cents: res.json?.refund_amount ?? corps.amountCents ?? null,
        full_refund: Boolean(res.json?.full_refund),
        note: res.json?.full_refund
          ? 'Remboursement complet émis : le client sera recrédité par Stripe (quelques jours) et la facture redevient due.'
          : 'Remboursement partiel émis : le client sera recrédité par Stripe (quelques jours) ; le paiement reste enregistré.',
      };
    }),
};

const chargeCardOnFileTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'charge_card_on_file',
    description:
      'CHARGE the client’s card on file for an invoice’s remaining balance (Stripe, owner/admin only) — money '
      + 'is actually taken, IRREVERSIBLE except by refund. The payment is applied automatically once Stripe confirms. '
      + 'ALWAYS show invoice, client and amount and get an explicit OK first.',
    parameters: { type: 'object', properties: { invoice_id: { type: 'string', description: 'Invoice id.' } }, required: ['invoice_id'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'charge_card_on_file', args, async () => {
      const invoiceId = champRequis(args.invoice_id, 'La facture');
      let res;
      try {
        res = await appelInterne(ctx, '/payments/card-on-file/charge', { invoiceId });
      } catch (e) {
        if (e instanceof AppelInterneIncertain) {
          return { incertain: true, charged: null, note: 'Je n’ai pas eu la confirmation du prélèvement — il a PEUT-ÊTRE été fait. Ne relance pas : vérifie la facture dans Lume avant toute nouvelle tentative.' };
        }
        throw e;
      }
      const j = res.json || {};
      if (!res.ok || j.ok === false) {
        const RAISONS: Record<string, string> = {
          no_card_on_file: 'Ce client n’a pas de carte au dossier.',
          nothing_due: 'Rien à percevoir : cette facture n’a pas de solde.',
          not_ready: 'Le compte de paiement de l’entreprise n’est pas prêt (onboarding Stripe à compléter).',
          no_client: 'Cette facture n’a pas de client.',
          not_found: 'Facture introuvable.',
          card_declined: 'La carte a été refusée par la banque du client.',
        };
        throw new Error(RAISONS[String(j.status)] || j.error || j.reason || `Prélèvement refusé (${res.status}).`);
      }
      return {
        charged: true, statut: 'en traitement',
        note: 'Prélèvement lancé sur la carte au dossier. Le paiement s’inscrira sur la facture dès la confirmation de Stripe (quelques secondes) — ne relance pas.',
      };
    }),
};

const removeCardOnFileTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'remove_card_on_file',
    description:
      'Remove a client’s stored card (detached at Stripe, profile deleted) — the client’s right of withdrawal. '
      + 'IRREVERSIBLE: the client will have to re-enter a card. ALWAYS confirm first.',
    parameters: { type: 'object', properties: { client_id: { type: 'string', description: 'Client id.' } }, required: ['client_id'] },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'remove_card_on_file', args, async () => {
      const clientId = champRequis(args.client_id, 'Le client');
      const { ok, status, json } = await appelInterne(ctx, '/payments/card-on-file/remove', { clientId });
      if (!ok) throw new Error(status === 404 ? 'Ce client n’a pas de carte au dossier.' : (json?.error || `Retrait refusé (${status}).`));
      return { removed: true, note: 'Carte au dossier retirée : détachée chez Stripe et effacée de Lume.' };
    }),
};

const CANAUX_RAPPEL = ['email', 'sms', 'both'];

const updateReminderSettingsTool: AgentTool = {
  kind: 'write',
  needsIdentity: true,
  declaration: {
    name: 'update_reminder_settings',
    description:
      'Change the org’s automatic payment reminder settings (owner/admin): on/off, the schedule (days after due '
      + 'date + channel) and custom texts. `schedule` REPLACES the whole schedule when provided. Only provided fields change.',
    parameters: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        schedule: {
          type: 'array',
          description: 'Up to 20 steps.',
          items: {
            type: 'object',
            properties: {
              days_after_due: { type: 'integer', description: '0-365.' },
              channel: { type: 'string', enum: CANAUX_RAPPEL },
            },
            required: ['days_after_due', 'channel'],
          },
        },
        custom_email_subject: { type: 'string' },
        custom_email_body: { type: 'string' },
        custom_sms_body: { type: 'string', description: 'Max 320 characters.' },
      },
    },
  },
  handler: async (args, ctx) =>
    executerIdempotent(ctx, 'update_reminder_settings', args, async () => {
      const patch: Record<string, any> = {};
      if (args.enabled !== undefined) patch.enabled = Boolean(args.enabled);
      if (args.schedule !== undefined) {
        // Mêmes règles que sanitizeSchedule de la route PATCH.
        if (!Array.isArray(args.schedule) || args.schedule.length > 20) throw new Error('Le calendrier de rappels doit être une liste de 0 à 20 étapes.');
        const etapes = args.schedule.map((e: any) => {
          const jours = Number(e?.days_after_due);
          const canal = String(e?.channel || '').toLowerCase();
          if (!Number.isFinite(jours) || jours < 0 || jours > 365) throw new Error('Chaque étape doit indiquer un nombre de jours entre 0 et 365.');
          if (!CANAUX_RAPPEL.includes(canal)) throw new Error('Le canal d’une étape doit être email, sms ou both.');
          return { days_after_due: Math.floor(jours), channel: canal };
        });
        patch.schedule = etapes;
      }
      if (args.custom_email_subject !== undefined) {
        const s = String(args.custom_email_subject);
        if (s.length > 500) throw new Error('Le sujet personnalisé dépasse 500 caractères.');
        patch.custom_email_subject = s || null;
      }
      if (args.custom_email_body !== undefined) {
        const s = String(args.custom_email_body);
        if (s.length > 5000) throw new Error('Le courriel personnalisé dépasse 5000 caractères.');
        patch.custom_email_body = s || null;
      }
      if (args.custom_sms_body !== undefined) {
        const s = String(args.custom_sms_body);
        if (s.length > 320) throw new Error('Le texto personnalisé dépasse 320 caractères.');
        patch.custom_sms_body = s || null;
      }
      if (!Object.keys(patch).length) throw new Error('Aucun réglage à modifier.');
      patch.updated_at = new Date().toISOString();
      // La route est un PATCH (appelInterne ne fait que POST) : même écriture, à l'identité (RLS = admin/owner),
      // upsert car la ligne n'existe qu'après une première visite de l'écran.
      const { data, error } = await ctx.client
        .from('reminder_settings')
        .upsert({ org_id: ctx.orgId, ...patch }, { onConflict: 'org_id' })
        .select('enabled, schedule, custom_email_subject, custom_sms_body')
        .single();
      if (error) throw error;
      return {
        updated: true,
        enabled: Boolean(data.enabled),
        schedule: (Array.isArray(data.schedule) ? data.schedule : []).map((e: any) => ({ jours_apres_echeance: e.days_after_due, canal: e.channel })),
        note: data.enabled ? 'Réglages de rappels enregistrés — les relances automatiques sont actives.' : 'Réglages de rappels enregistrés — les relances automatiques sont désactivées.',
      };
    }),
};

const STATUT_PAIEMENT: Record<string, string> = {
  pending: 'en attente', processing: 'en traitement', succeeded: 'réussi', failed: 'échoué', refunded: 'remboursé', cancelled: 'annulé',
};
const FOURNISSEUR_FR: Record<string, string> = { manual: 'manuel', stripe: 'Stripe', paypal: 'PayPal' };

const listPaymentsTool: AgentTool = {
  kind: 'read',
  needsIdentity: true,
  declaration: {
    name: 'list_payments',
    description:
      'List payments received (manual, Stripe, PayPal): amount, date, method, status, invoice and client. Returns '
      + 'total_matching (exact) and sum_amount_cents. Source of payment ids for refund_payment.',
    parameters: {
      type: 'object',
      properties: {
        invoice_id: { type: 'string', description: 'Optional invoice filter.' },
        client_id: { type: 'string', description: 'Optional client filter.' },
        status: { type: 'string', enum: ['pending', 'processing', 'succeeded', 'failed', 'refunded'], description: 'Optional status filter.' },
        from: { type: 'string', description: 'Optional start date YYYY-MM-DD.' },
        to: { type: 'string', description: 'Optional end date YYYY-MM-DD.' },
        limit: { type: 'integer', description: 'Max results (default 20, max 50).' },
      },
    },
  },
  handler: async (args, ctx) => {
    const limit = clamp(args.limit, 20, 50);
    let q = ctx.client
      .from('payments')
      .select('id, amount_cents, currency, status, method, provider, payment_date, paid_at, invoice_id, client_id, '
        + 'invoice:invoices!payments_invoice_id_fkey(invoice_number), client:clients!payments_client_id_fkey(first_name, last_name, company)', { count: 'exact' })
      .eq('org_id', ctx.orgId)
      .is('deleted_at', null)
      .order('payment_date', { ascending: false })
      .limit(limit);
    if (args.invoice_id) q = q.eq('invoice_id', String(args.invoice_id));
    if (args.client_id) q = q.eq('client_id', String(args.client_id));
    if (args.status) q = q.eq('status', String(args.status));
    if (estDateYmd(args.from)) q = q.gte('payment_date', `${args.from}T00:00:00`);
    if (estDateYmd(args.to)) q = q.lte('payment_date', `${args.to}T23:59:59`);
    const { data, error, count } = await q;
    if (error) return erreurOutil('list_payments', error);
    const rows = data || [];
    const total = count ?? rows.length;
    return {
      total_matching: total,
      shown: rows.length,
      ...(total > rows.length ? { note: `Seuls ${rows.length} paiements sur ${total} sont listés. Le total exact est ${total}.` } : {}),
      sum_amount_cents: rows.filter((p: any) => p.status === 'succeeded').reduce((s: number, p: any) => s + (Number(p.amount_cents) || 0), 0),
      payments: rows.map((p: any) => ({
        id: p.id, // interne : pour refund_payment
        amount_cents: p.amount_cents,
        currency: p.currency,
        statut: traduireStatut(p.status, STATUT_PAIEMENT),
        methode: p.method || null,
        fournisseur: FOURNISSEUR_FR[String(p.provider)] || p.provider,
        payment_date: p.payment_date || p.paid_at,
        invoice_number: p.invoice?.invoice_number ?? null,
        client_name: nomClient(p.client) || null,
      })),
    };
  },
};

/* ═══════════════════════════════════════════════════════════════
   MANIFESTES
   ═══════════════════════════════════════════════════════════════ */

export const OUTILS_ARGENT: AgentTool[] = [
  // Devis
  updateQuoteTool, duplicateQuoteTool, deleteQuoteTool, unarchiveQuoteTool, sendQuoteSmsTool, convertQuoteToInvoiceTool,
  // Pré-réglages et modèles de devis
  listQuotePresetsTool, createQuotePresetTool, updateQuotePresetTool, deleteQuotePresetTool, duplicateQuotePresetTool,
  listQuoteTemplatesTool, createQuoteTemplateTool, updateQuoteTemplateTool, deleteQuoteTemplateTool,
  // Factures
  updateInvoiceTool, voidInvoiceTool, revertInvoiceToDraftTool, duplicateInvoiceTool, deleteInvoiceTool, recordInvoicePaymentTool,
  // Factures récurrentes
  listRecurringInvoicesTool, createRecurringInvoiceTool, updateRecurringInvoiceTool, deleteRecurringInvoiceTool, runRecurringInvoiceNowTool,
  // Modèles de facture
  listInvoiceTemplatesTool, createInvoiceTemplateTool, updateInvoiceTemplateTool, deleteInvoiceTemplateTool,
  // Paiements
  createPaymentRequestTool, resendPaymentRequestTool, refundPaymentTool, chargeCardOnFileTool, removeCardOnFileTool,
  updateReminderSettingsTool, listPaymentsTool,
];

const A = (a: Partial<{ sensible: boolean; reversible: boolean; vers_client: boolean }>) =>
  ({ sensible: false, reversible: true, vers_client: false, ...a });

/** Attributs des ÉCRITURES (à fusionner dans REGISTRE_ECRITURES) — une entrée par outil `write`, rien d'autre. */
export const REGISTRE_ARGENT: Record<string, { sensible: boolean; reversible: boolean; vers_client: boolean }> = {
  // Devis
  update_quote:              A({ sensible: true }),
  duplicate_quote:           A({ sensible: true }),
  delete_quote:              A({ sensible: true }),                        // soft delete (deleted_at)
  unarchive_quote:           A({}),
  send_quote_sms:            A({ sensible: true, reversible: false, vers_client: true }),
  convert_quote_to_invoice:  A({ sensible: true, reversible: false }),
  // Pré-réglages et modèles de devis
  create_quote_preset:       A({}),
  update_quote_preset:       A({}),
  delete_quote_preset:       A({}),                                        // soft delete
  duplicate_quote_preset:    A({}),
  create_quote_template:     A({}),
  update_quote_template:     A({}),
  delete_quote_template:     A({}),                                        // soft delete
  // Factures
  update_invoice:            A({ sensible: true }),
  void_invoice:              A({ sensible: true }),                        // revert_invoice_to_draft défait
  revert_invoice_to_draft:   A({ sensible: true }),
  duplicate_invoice:         A({ sensible: true }),
  delete_invoice:            A({ sensible: true }),                        // soft delete
  record_invoice_payment:    A({ sensible: true, reversible: false }),
  // Factures récurrentes
  create_recurring_invoice:  A({ sensible: true }),
  update_recurring_invoice:  A({ sensible: true }),
  delete_recurring_invoice:  A({}),                                        // désactivation (is_active)
  run_recurring_invoice_now: A({ sensible: true, reversible: false }),
  // Modèles de facture
  create_invoice_template:   A({}),
  update_invoice_template:   A({}),
  delete_invoice_template:   A({}),                                        // soft delete
  // Paiements
  create_payment_request:    A({ sensible: true, reversible: false, vers_client: true }),
  resend_payment_request:    A({ sensible: true, reversible: false, vers_client: true }),
  refund_payment:            A({ sensible: true, reversible: false, vers_client: true }),
  charge_card_on_file:       A({ sensible: true, reversible: false, vers_client: true }),
  remove_card_on_file:       A({ sensible: true, reversible: false }),
  update_reminder_settings:  A({ sensible: true }),
};

/** Permission de la page Rôles exigée par chaque outil (à fusionner dans PERMISSION_PAR_OUTIL). */
export const PERMISSIONS_ARGENT: Record<string, { cle: PermissionKey; capacite: string }> = {
  // Devis
  update_quote:              { cle: 'quotes.update',      capacite: 'la modification des devis' },
  duplicate_quote:           { cle: 'quotes.create',      capacite: 'la création de devis' },
  delete_quote:              { cle: 'quotes.delete',      capacite: 'la suppression des devis' },
  unarchive_quote:           { cle: 'quotes.update',      capacite: 'la modification des devis' },
  send_quote_sms:            { cle: 'quotes.send',        capacite: "l'envoi de devis" },
  convert_quote_to_invoice:  { cle: 'invoices.create',    capacite: 'la création de factures' },
  // Pré-réglages et modèles de devis
  list_quote_presets:        { cle: 'quotes.read',        capacite: 'la consultation des modèles de devis' },
  create_quote_preset:       { cle: 'quotes.create',      capacite: 'la création de modèles de devis' },
  update_quote_preset:       { cle: 'quotes.update',      capacite: 'la modification des modèles de devis' },
  delete_quote_preset:       { cle: 'quotes.delete',      capacite: 'la suppression des modèles de devis' },
  duplicate_quote_preset:    { cle: 'quotes.create',      capacite: 'la création de modèles de devis' },
  list_quote_templates:      { cle: 'quotes.read',        capacite: 'la consultation des modèles de devis' },
  create_quote_template:     { cle: 'quotes.create',      capacite: 'la création de modèles de devis' },
  update_quote_template:     { cle: 'quotes.update',      capacite: 'la modification des modèles de devis' },
  delete_quote_template:     { cle: 'quotes.delete',      capacite: 'la suppression des modèles de devis' },
  // Factures
  update_invoice:            { cle: 'invoices.update',    capacite: 'la modification des factures' },
  void_invoice:              { cle: 'invoices.update',    capacite: "l'annulation des factures" },
  revert_invoice_to_draft:   { cle: 'invoices.update',    capacite: 'la modification des factures' },
  duplicate_invoice:         { cle: 'invoices.create',    capacite: 'la création de factures' },
  delete_invoice:            { cle: 'invoices.delete',    capacite: 'la suppression des factures' },
  record_invoice_payment:    { cle: 'financial.view_payments', capacite: "l'enregistrement d'un paiement" }, // même clé que mark_invoice_paid
  // Factures récurrentes
  list_recurring_invoices:   { cle: 'invoices.read',      capacite: 'la consultation des factures récurrentes' },
  create_recurring_invoice:  { cle: 'invoices.create',    capacite: 'la création de factures récurrentes' },
  update_recurring_invoice:  { cle: 'invoices.update',    capacite: 'la modification des factures récurrentes' },
  delete_recurring_invoice:  { cle: 'invoices.delete',    capacite: "l'arrêt des factures récurrentes" },
  run_recurring_invoice_now: { cle: 'invoices.create',    capacite: 'la création de factures' },
  // Modèles de facture
  list_invoice_templates:    { cle: 'invoices.read',      capacite: 'la consultation des modèles de facture' },
  create_invoice_template:   { cle: 'invoices.create',    capacite: 'la création de modèles de facture' },
  update_invoice_template:   { cle: 'invoices.update',    capacite: 'la modification des modèles de facture' },
  delete_invoice_template:   { cle: 'invoices.delete',    capacite: 'la suppression des modèles de facture' },
  // Paiements
  create_payment_request:    { cle: 'invoices.send',      capacite: "l'envoi de demandes de paiement" },
  resend_payment_request:    { cle: 'invoices.send',      capacite: "l'envoi de demandes de paiement" },
  refund_payment:            { cle: 'payments.refund',    capacite: 'les remboursements' },
  charge_card_on_file:       { cle: 'payments.create',    capacite: 'le prélèvement sur carte au dossier' },
  remove_card_on_file:       { cle: 'clients.update',     capacite: 'la modification des clients (carte au dossier)' },
  update_reminder_settings:  { cle: 'settings.update',    capacite: 'les réglages de rappels de paiement' },
  list_payments:             { cle: 'payments.read',      capacite: 'la consultation des paiements' },
};

/** Topic de chaque outil (à fusionner dans TOPICS) : tout ce module relève de « facturation ». */
export const TOPICS_ARGENT: Partial<Record<IdTopic, string[]>> = {
  facturation: OUTILS_ARGENT.map((t) => t.declaration.name),
};
