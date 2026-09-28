/* ═══════════════════════════════════════════════════════════════
   Synchronisation QuickBooks Online — worker de la file.

   Les triggers de la migration 20261002100000 mettent en file chaque
   facture / paiement / client touché. Ce module vide la file :

   • Facture  → Invoice QuickBooks (client créé ou retrouvé au besoin),
                annulée (void) quand la facture Lume est annulée/supprimée.
   • Paiement → Payment QuickBooks LIÉ à la facture, avec son moyen de
                paiement : la facture passe « Payée » dans QuickBooks dès
                qu'elle l'est dans Lume. Paiement supprimé/échoué → retiré.
   • Client   → Customer QuickBooks mis à jour (seulement s'il y est déjà).

   Anti-doublons : un client est retrouvé par son nom affiché, une facture
   par son numéro ET son client — une facture déjà saisie à la main par le
   comptable est reprise au lieu d'être dupliquée.
   ═══════════════════════════════════════════════════════════════ */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceClient } from '../supabase';
import { logger } from '../logger';
import { QboError, qboContext, qboQuery, qboQuote, qboRead, qboRequest, type QboContext } from './api';

type EntityType = 'client' | 'invoice' | 'payment';

interface QueueRow {
  id: string;
  org_id: string;
  entity_type: EntityType;
  entity_id: string;
  status: string;
  reason: string | null;
  attempts: number;
}

export interface QuickBooksSettings {
  org_id: string;
  enabled: boolean;
  sync_from: string | null;
  item_id: string | null;
  item_name: string | null;
  deposit_account_id: string | null;
  deposit_account_name: string | null;
  deposit_account_online_id: string | null;
  deposit_account_online_name: string | null;
  tax_code_taxable_id: string | null;
  tax_code_exempt_id: string | null;
  payment_methods: Record<string, { id: string; name: string }>;
}

/** Résultat d'un envoi : `note` = avertissement affiché sans être une erreur. */
interface Outcome {
  status: 'done' | 'skipped';
  note?: string | null;
}

const MAX_ATTEMPTS = 6;

/** Table/fonction absente : la migration n'est pas encore appliquée. */
export function isMissingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    error.code === 'PGRST205' ||
    /does not exist|could not find the (table|function)/i.test(error.message || '')
  );
}

// ── Utilitaires ────────────────────────────────────────────────

const money = (cents: number | null | undefined) => Math.round(Number(cents) || 0) / 100;

function ymd(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  // Jour civil de Montréal : une facture de 21 h ne glisse pas au lendemain (UTC).
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Toronto' });
}

function clip(value: unknown, max: number): string | undefined {
  const s = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  return s ? s.slice(0, max) : undefined;
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// ── Réglages ───────────────────────────────────────────────────

export async function loadSettings(db: SupabaseClient, orgId: string): Promise<QuickBooksSettings> {
  const { data, error } = await db.from('quickbooks_settings').select('*').eq('org_id', orgId).maybeSingle();
  if (error) throw error;
  if (data) {
    if (!data.sync_from) {
      const now = new Date().toISOString();
      await db.from('quickbooks_settings').update({ sync_from: now }).eq('org_id', orgId);
      data.sync_from = now;
    }
    return { ...data, payment_methods: data.payment_methods || {} } as QuickBooksSettings;
  }

  // Premier passage : on part de la date de connexion — l'historique ne
  // part qu'à la demande (« Envoyer l'historique »).
  const { data: conn } = await db
    .from('app_connections')
    .select('connected_at')
    .eq('org_id', orgId)
    .eq('app_id', 'quickbooks')
    .maybeSingle();
  const row = { org_id: orgId, enabled: true, sync_from: conn?.connected_at || new Date().toISOString() };
  const { data: created, error: insErr } = await db
    .from('quickbooks_settings')
    .upsert(row, { onConflict: 'org_id', ignoreDuplicates: true })
    .select('*')
    .maybeSingle();
  if (insErr) throw insErr;
  if (created) return { ...created, payment_methods: created.payment_methods || {} } as QuickBooksSettings;
  return loadSettings(db, orgId);
}

async function patchSettings(db: SupabaseClient, orgId: string, patch: Partial<QuickBooksSettings>) {
  await db
    .from('quickbooks_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('org_id', orgId);
}

// ── Correspondances ────────────────────────────────────────────

interface MapRow {
  qbo_id: string;
  qbo_state: string;
}

async function getMap(db: SupabaseClient, ctx: QboContext, type: EntityType, lumeId: string): Promise<MapRow | null> {
  const { data } = await db
    .from('quickbooks_entity_map')
    .select('qbo_id, qbo_state')
    .eq('org_id', ctx.orgId)
    .eq('realm_id', ctx.realmId)
    .eq('entity_type', type)
    .eq('lume_id', lumeId)
    .maybeSingle();
  return data ?? null;
}

async function isQboIdTaken(db: SupabaseClient, ctx: QboContext, type: EntityType, qboId: string, exceptLumeId: string) {
  const { data } = await db
    .from('quickbooks_entity_map')
    .select('lume_id')
    .eq('org_id', ctx.orgId)
    .eq('realm_id', ctx.realmId)
    .eq('entity_type', type)
    .eq('qbo_id', qboId)
    .neq('lume_id', exceptLumeId)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

async function setMap(
  db: SupabaseClient,
  ctx: QboContext,
  type: EntityType,
  lumeId: string,
  qboId: string,
  extra: { qbo_doc_number?: string | null; qbo_state?: string } = {},
) {
  const { error } = await db.from('quickbooks_entity_map').upsert(
    {
      org_id: ctx.orgId,
      realm_id: ctx.realmId,
      entity_type: type,
      lume_id: lumeId,
      qbo_id: qboId,
      qbo_doc_number: extra.qbo_doc_number ?? null,
      qbo_state: extra.qbo_state ?? 'active',
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,realm_id,entity_type,lume_id' },
  );
  if (error) throw error;
}

async function setMapState(db: SupabaseClient, ctx: QboContext, type: EntityType, lumeId: string, state: string) {
  await db
    .from('quickbooks_entity_map')
    .update({ qbo_state: state, last_synced_at: new Date().toISOString() })
    .eq('org_id', ctx.orgId)
    .eq('realm_id', ctx.realmId)
    .eq('entity_type', type)
    .eq('lume_id', lumeId);
}

// ── Caches par compagnie (10 min) ──────────────────────────────

interface TaxCodeInfo {
  id: string;
  name: string;
  rate: number; // % combiné (TPS + TVQ = 14.975)
}

interface CompanyCache {
  at: number;
  country: string;
  taxCodes: TaxCodeInfo[] | null;
}

const companyCache = new Map<string, CompanyCache>();
const CACHE_MS = 10 * 60_000;

async function company(ctx: QboContext): Promise<CompanyCache> {
  const key = `${ctx.orgId}:${ctx.realmId}`;
  const hit = companyCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const info = await qboRead<{ Country?: string }>(ctx.orgId, 'CompanyInfo', ctx.realmId);
  const entry: CompanyCache = { at: Date.now(), country: (info?.Country || 'CA').toUpperCase(), taxCodes: null };
  companyCache.set(key, entry);
  return entry;
}

const isUS = (c: CompanyCache) => c.country === 'US' || c.country === 'USA';

export async function listTaxCodes(ctx: QboContext): Promise<TaxCodeInfo[]> {
  const c = await company(ctx);
  if (c.taxCodes) return c.taxCodes;
  const [codes, rates] = await Promise.all([
    qboQuery<any>(ctx.orgId, 'TaxCode', 'Active = true'),
    qboQuery<any>(ctx.orgId, 'TaxRate'),
  ]);
  const rateById = new Map<string, number>(rates.map((r: any) => [String(r.Id), Number(r.RateValue) || 0]));
  c.taxCodes = codes.map((code: any) => {
    const details: any[] = code.SalesTaxRateList?.TaxRateDetail || [];
    const rate = details.reduce((sum, d) => sum + (rateById.get(String(d.TaxRateRef?.value)) || 0), 0);
    return { id: String(code.Id), name: String(code.Name || ''), rate: Math.round(rate * 1000) / 1000 };
  });
  return c.taxCodes;
}

/**
 * Code de taxe QuickBooks d'une facture. Canada : QuickBooks exige un code
 * par ligne ; on prend celui dont le taux combiné égale le taux effectif de
 * la facture (14,975 % → « TPS/TVQ QC »). États-Unis : TAX / NON.
 */
async function taxCodeFor(
  ctx: QboContext,
  settings: QuickBooksSettings,
  subtotalCents: number,
  taxCents: number,
): Promise<{ id: string | null; us: boolean }> {
  const c = await company(ctx);
  if (isUS(c)) return { id: taxCents > 0 ? 'TAX' : 'NON', us: true };

  const codes = await listTaxCodes(ctx);
  if (taxCents <= 0) {
    if (settings.tax_code_exempt_id) return { id: settings.tax_code_exempt_id, us: false };
    const exempt =
      codes.find((t) => /exon|exempt/i.test(t.name)) ||
      codes.find((t) => /d[ée]taxé|zero/i.test(t.name)) ||
      codes.find((t) => /hors|out of scope/i.test(t.name)) ||
      codes.find((t) => t.rate === 0);
    if (!exempt) throw new QboError('Aucun code de taxe « Exonéré » dans QuickBooks — choisissez-en un dans les réglages de la synchro.');
    return { id: exempt.id, us: false };
  }

  const effective = subtotalCents > 0 ? (taxCents / subtotalCents) * 100 : 0;
  const match = codes
    .filter((t) => t.rate > 0)
    .map((t) => ({ t, diff: Math.abs(t.rate - effective) }))
    .sort((a, b) => a.diff - b.diff)[0];
  // Tolérance : l'arrondi au cent d'une petite facture déplace le taux effectif.
  const tolerance = Math.max(0.05, subtotalCents > 0 ? (100 / subtotalCents) * 100 : 0);
  if (match && match.diff <= tolerance) return { id: match.t.id, us: false };
  if (settings.tax_code_taxable_id) return { id: settings.tax_code_taxable_id, us: false };
  throw new QboError(
    `Aucun code de taxe QuickBooks à ${effective.toFixed(3)} % — choisissez le code des factures taxables dans les réglages de la synchro.`,
  );
}

// ── Produit / service des lignes ───────────────────────────────

async function ensureItem(db: SupabaseClient, ctx: QboContext, settings: QuickBooksSettings): Promise<string> {
  if (settings.item_id) return settings.item_id;

  const services = await qboQuery<any>(ctx.orgId, 'Item', "Type = 'Service' AND Active = true");
  const preferred =
    services.find((i) => /^services?$/i.test(String(i.Name).trim())) ||
    services.find((i) => /^(services lume|lume)$/i.test(String(i.Name).trim()));
  if (preferred) {
    await patchSettings(db, ctx.orgId, { item_id: String(preferred.Id), item_name: preferred.Name });
    settings.item_id = String(preferred.Id);
    return settings.item_id;
  }

  const incomes = await qboQuery<any>(ctx.orgId, 'Account', "AccountType = 'Income' AND Active = true");
  const income =
    incomes.find((a) => /service/i.test(a.Name)) ||
    incomes.find((a) => /vente|sales/i.test(a.Name)) ||
    incomes[0];
  if (!income) throw new QboError('Aucun compte de revenus dans QuickBooks — créez-en un ou choisissez un produit dans les réglages.');

  const created = await qboRequest<{ Item: any }>(ctx.orgId, 'POST', 'item', {
    Name: 'Services Lume',
    Type: 'Service',
    IncomeAccountRef: { value: String(income.Id) },
  });
  await patchSettings(db, ctx.orgId, { item_id: String(created.Item.Id), item_name: created.Item.Name });
  settings.item_id = String(created.Item.Id);
  return settings.item_id;
}

// ── Clients ────────────────────────────────────────────────────

function customerPayload(client: any): Record<string, unknown> {
  const person = [client.first_name, client.last_name].filter(Boolean).join(' ').trim();
  // « : » est réservé aux sous-clients dans QuickBooks.
  const display = (clip(client.company, 100) || clip(person, 100) || 'Client Lume').replace(/:/g, '-');
  const email = clip(client.email, 100);
  const address = clip(client.billing_address || client.address, 500);
  return {
    DisplayName: display,
    ...(clip(client.first_name, 100) ? { GivenName: clip(client.first_name, 100) } : {}),
    ...(clip(client.last_name, 100) ? { FamilyName: clip(client.last_name, 100) } : {}),
    ...(clip(client.company, 100) ? { CompanyName: clip(client.company, 100) } : {}),
    ...(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { PrimaryEmailAddr: { Address: email } } : {}),
    ...(clip(client.phone, 30) ? { PrimaryPhone: { FreeFormNumber: clip(client.phone, 30) } } : {}),
    ...(address ? { BillAddr: { Line1: address } } : {}),
  };
}

const DUPLICATE_NAME = '6240';

async function loadClient(db: SupabaseClient, orgId: string, clientId: string) {
  const { data, error } = await db.from('clients').select('*').eq('id', clientId).eq('org_id', orgId).maybeSingle();
  if (error) throw error;
  return data;
}

async function ensureCustomer(db: SupabaseClient, ctx: QboContext, clientId: string): Promise<string> {
  const mapped = await getMap(db, ctx, 'client', clientId);
  if (mapped) {
    const still = await qboRead<any>(ctx.orgId, 'Customer', mapped.qbo_id);
    if (still && still.Active !== false) return mapped.qbo_id;
  }

  const client = await loadClient(db, ctx.orgId, clientId);
  if (!client) throw new QboError('Client introuvable dans Lume.');
  const payload = customerPayload(client);
  const name = String(payload.DisplayName);

  // Client déjà saisi dans QuickBooks (même nom) et pas encore relié à un
  // autre client Lume : on le reprend.
  const existing = await qboQuery<any>(ctx.orgId, 'Customer', `DisplayName = ${qboQuote(name)}`, 5);
  for (const c of existing) {
    if (c.Active === false) continue;
    if (!(await isQboIdTaken(db, ctx, 'client', String(c.Id), clientId))) {
      await setMap(db, ctx, 'client', clientId, String(c.Id));
      return String(c.Id);
    }
  }

  // Homonyme déjà relié (Lume permet deux clients du même nom) ou nom pris
  // par un fournisseur/employé : suffixe court et stable.
  const suffixed = { ...payload, DisplayName: `${name.slice(0, 90)} (${clientId.slice(0, 6)})` };
  let created: { Customer: any };
  try {
    created = await qboRequest(ctx.orgId, 'POST', 'customer', existing.length ? suffixed : payload);
  } catch (err) {
    if (!(err instanceof QboError && err.code === DUPLICATE_NAME) || existing.length) throw err;
    created = await qboRequest(ctx.orgId, 'POST', 'customer', suffixed);
  }
  await setMap(db, ctx, 'client', clientId, String(created.Customer.Id));
  return String(created.Customer.Id);
}

async function syncClient(db: SupabaseClient, ctx: QboContext, clientId: string): Promise<Outcome> {
  const mapped = await getMap(db, ctx, 'client', clientId);
  if (!mapped) return { status: 'skipped', note: 'Client absent de QuickBooks (aucune facture envoyée).' };
  const client = await loadClient(db, ctx.orgId, clientId);
  if (!client) return { status: 'skipped', note: 'Client supprimé dans Lume.' };
  const current = await qboRead<any>(ctx.orgId, 'Customer', mapped.qbo_id);
  if (!current) return { status: 'skipped', note: 'Client supprimé dans QuickBooks.' };

  const payload = customerPayload(client);
  const base = { Id: current.Id, SyncToken: current.SyncToken, sparse: true };
  try {
    await qboRequest(ctx.orgId, 'POST', 'customer', { ...base, ...payload });
  } catch (err) {
    // Nouveau nom déjà pris : on met à jour le reste sans toucher au nom.
    if (!(err instanceof QboError && err.code === DUPLICATE_NAME)) throw err;
    const { DisplayName: _d, ...rest } = payload;
    await qboRequest(ctx.orgId, 'POST', 'customer', { ...base, ...rest });
    return { status: 'done', note: `Nom « ${payload.DisplayName} » déjà pris dans QuickBooks — nom conservé.` };
  }
  return { status: 'done' };
}

// ── Factures ───────────────────────────────────────────────────

async function loadInvoice(db: SupabaseClient, orgId: string, invoiceId: string) {
  const { data, error } = await db.from('invoices').select('*').eq('id', invoiceId).eq('org_id', orgId).maybeSingle();
  if (error) throw error;
  return data;
}

async function voidInvoice(db: SupabaseClient, ctx: QboContext, invoiceId: string, mapped: MapRow): Promise<Outcome> {
  if (mapped.qbo_state !== 'active') return { status: 'skipped' };
  const current = await qboRead<any>(ctx.orgId, 'Invoice', mapped.qbo_id);
  if (!current) {
    await setMapState(db, ctx, 'invoice', invoiceId, 'deleted');
    return { status: 'skipped', note: 'Facture déjà supprimée dans QuickBooks.' };
  }
  await qboRequest(ctx.orgId, 'POST', 'invoice?operation=void', { Id: current.Id, SyncToken: current.SyncToken });
  await setMapState(db, ctx, 'invoice', invoiceId, 'voided');
  return { status: 'done', note: 'Annulée dans QuickBooks.' };
}

/**
 * Envoie (crée ou met à jour) une facture. `force` : envoyée même si elle
 * est antérieure au branchement — un paiement d'aujourd'hui sur une vieille
 * facture a besoin de sa facture dans QuickBooks.
 */
async function syncInvoice(
  db: SupabaseClient,
  ctx: QboContext,
  settings: QuickBooksSettings,
  invoiceId: string,
  opts: { force?: boolean } = {},
): Promise<{ outcome: Outcome; qboId: string | null; customerId: string | null }> {
  const invoice = await loadInvoice(db, ctx.orgId, invoiceId);
  const mapped = await getMap(db, ctx, 'invoice', invoiceId);

  if (!invoice || invoice.deleted_at || invoice.status === 'void') {
    if (!mapped) return { outcome: { status: 'skipped', note: 'Facture annulée avant tout envoi.' }, qboId: null, customerId: null };
    return { outcome: await voidInvoice(db, ctx, invoiceId, mapped), qboId: null, customerId: null };
  }
  if (invoice.status === 'draft') {
    return { outcome: { status: 'skipped', note: 'Brouillon — envoyée à sa finalisation.' }, qboId: mapped?.qbo_id ?? null, customerId: null };
  }
  if (mapped && mapped.qbo_state !== 'active') {
    return { outcome: { status: 'skipped', note: 'Déjà annulée dans QuickBooks.' }, qboId: null, customerId: null };
  }

  const invoiceDate = invoice.issued_at || invoice.created_at;
  if (!mapped && !opts.force && settings.sync_from && invoiceDate && new Date(invoiceDate) < new Date(settings.sync_from)) {
    return {
      outcome: { status: 'skipped', note: 'Antérieure au branchement de QuickBooks — utilisez « Envoyer l\'historique ».' },
      qboId: null,
      customerId: null,
    };
  }

  const { data: items, error: itemsErr } = await db
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId);
  if (itemsErr) throw itemsErr;
  const ordered = (items || []).sort(
    (a: any, b: any) =>
      (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0) ||
      String(a.created_at || '').localeCompare(String(b.created_at || '')),
  );

  const customerId = await ensureCustomer(db, ctx, invoice.client_id);
  const itemId = await ensureItem(db, ctx, settings);
  const subtotal = Number(invoice.subtotal_cents) || 0;
  const tax = Number(invoice.tax_cents) || 0;
  const taxCode = await taxCodeFor(ctx, settings, subtotal, tax);

  const line = (description: string | undefined, amountCents: number, qty?: number, unitCents?: number) => {
    // QuickBooks refuse une ligne où Montant ≠ Qté × Prix : sinon 1 × montant.
    const exact = qty != null && unitCents != null && Math.round(qty * unitCents) === amountCents;
    return {
      DetailType: 'SalesItemLineDetail',
      Amount: money(amountCents),
      ...(description ? { Description: description } : {}),
      SalesItemLineDetail: {
        ItemRef: { value: itemId },
        Qty: exact ? qty : 1,
        UnitPrice: exact ? money(unitCents) : money(amountCents),
        ...(taxCode.id ? { TaxCodeRef: { value: taxCode.id } } : {}),
      },
    };
  };

  const lines = ordered.map((it: any) => {
    const qty = Number(it.qty) || 1;
    const unit = Number(it.unit_price_cents) || 0;
    const total = it.line_total_cents != null ? Number(it.line_total_cents) : Math.round(qty * unit);
    const description = clip([it.title || it.name, it.description].filter(Boolean).join(' — '), 4000);
    return { total, payload: line(description, total, qty, unit) };
  });
  // Rabais ou arrondi au niveau de la facture : une ligne d'ajustement garde
  // le sous-total QuickBooks égal à celui de Lume.
  const linesTotal = lines.reduce((s: number, l: { total: number }) => s + l.total, 0);
  const payloadLines = lines.map((l: { payload: unknown }) => l.payload);
  if (linesTotal !== subtotal) payloadLines.push(line('Ajustement', subtotal - linesTotal));
  if (!payloadLines.length) payloadLines.push(line(clip(invoice.subject, 4000) || 'Services', subtotal));

  const docNumber = clip(invoice.invoice_number, 21);
  const payload: Record<string, unknown> = {
    CustomerRef: { value: customerId },
    Line: payloadLines,
    ...(docNumber ? { DocNumber: docNumber } : {}),
    ...(ymd(invoiceDate) ? { TxnDate: ymd(invoiceDate) } : {}),
    ...(ymd(invoice.due_date) ? { DueDate: ymd(invoice.due_date) } : {}),
    ...(clip(invoice.subject, 1000) ? { CustomerMemo: { value: clip(invoice.subject, 1000) } } : {}),
    PrivateNote: `Lume — facture #${invoice.invoice_number ?? ''}`.slice(0, 4000),
    // QuickBooks calcule la taxe à partir du code de chaque ligne ; un écart
    // d'arrondi avec Lume est signalé en note ci-dessous.
    ...(taxCode.us ? {} : { GlobalTaxCalculation: 'TaxExcluded' }),
  };

  let qboId = mapped?.qbo_id ?? null;
  let current = qboId ? await qboRead<any>(ctx.orgId, 'Invoice', qboId) : null;

  // Facture déjà saisie à la main dans QuickBooks : même numéro ET même client.
  if (!current && docNumber) {
    const found = await qboQuery<any>(ctx.orgId, 'Invoice', `DocNumber = ${qboQuote(docNumber)}`, 10);
    for (const f of found) {
      if (String(f.CustomerRef?.value) !== customerId) continue;
      if (await isQboIdTaken(db, ctx, 'invoice', String(f.Id), invoiceId)) continue;
      current = f;
      break;
    }
  }

  let saved: any;
  if (current) {
    const res = await qboRequest<{ Invoice: any }>(ctx.orgId, 'POST', 'invoice', {
      Id: current.Id,
      SyncToken: current.SyncToken,
      sparse: true,
      ...payload,
    });
    saved = res.Invoice;
  } else {
    const res = await qboRequest<{ Invoice: any }>(ctx.orgId, 'POST', 'invoice', payload);
    saved = res.Invoice;
  }
  qboId = String(saved.Id);
  await setMap(db, ctx, 'invoice', invoiceId, qboId, { qbo_doc_number: saved.DocNumber ?? docNumber ?? null });

  const qboTotal = Math.round(Number(saved.TotalAmt) * 100);
  const lumeTotal = Number(invoice.total_cents) || 0;
  const note =
    Number.isFinite(qboTotal) && Math.abs(qboTotal - lumeTotal) > 1
      ? `Écart de total : QuickBooks ${money(qboTotal).toFixed(2)} $ vs Lume ${money(lumeTotal).toFixed(2)} $ (taxes recalculées par QuickBooks).`
      : null;
  return { outcome: { status: 'done', note }, qboId, customerId };
}

// ── Paiements ──────────────────────────────────────────────────

type MethodKey = 'card' | 'cash' | 'check' | 'e-transfer' | 'paypal' | 'bank';

const METHOD_NAMES: Record<MethodKey, { create: string; type: 'CREDIT_CARD' | 'NON_CREDIT_CARD'; match: string[] }> = {
  card: { create: 'Carte de crédit', type: 'CREDIT_CARD', match: ['carte de credit', 'credit card', 'carte', 'card', 'visa', 'mastercard'] },
  cash: { create: 'Comptant', type: 'NON_CREDIT_CARD', match: ['comptant', 'argent comptant', 'cash', 'especes'] },
  check: { create: 'Chèque', type: 'NON_CREDIT_CARD', match: ['cheque', 'check'] },
  'e-transfer': { create: 'Virement Interac', type: 'NON_CREDIT_CARD', match: ['virement interac', 'interac', 'e-transfer', 'etransfer', 'virement'] },
  paypal: { create: 'PayPal', type: 'NON_CREDIT_CARD', match: ['paypal'] },
  bank: { create: 'Virement bancaire', type: 'NON_CREDIT_CARD', match: ['virement bancaire', 'bank transfer', 'eft', 'ach', 'direct deposit', 'depot direct'] },
};

export function methodKeyOf(method: string | null | undefined, provider: string | null | undefined): MethodKey | null {
  const m = normalize(String(method || ''));
  const p = normalize(String(provider || ''));
  if (/paypal/.test(m) || p === 'paypal') return 'paypal';
  if (/interac|e-?transfer|virement interac/.test(m)) return 'e-transfer';
  if (/cash|comptant|espece/.test(m)) return 'cash';
  if (/cheque|check/.test(m)) return 'check';
  if (/ach|bank|eft|acss|sepa|us_bank|virement|debit/.test(m)) return 'bank';
  if (/card|carte|visa|master|amex|credit|apple|google|link/.test(m)) return 'card';
  if (p === 'stripe') return 'card';
  return null;
}

async function ensurePaymentMethod(
  db: SupabaseClient,
  ctx: QboContext,
  settings: QuickBooksSettings,
  key: MethodKey,
): Promise<string> {
  const cached = settings.payment_methods?.[key];
  if (cached?.id) return cached.id;

  const spec = METHOD_NAMES[key];
  const all = await qboQuery<any>(ctx.orgId, 'PaymentMethod', 'Active = true');
  let found: any = null;
  for (const candidate of spec.match) {
    found = all.find((pm) => normalize(String(pm.Name)) === candidate);
    if (found) break;
  }
  if (!found) {
    const res = await qboRequest<{ PaymentMethod: any }>(ctx.orgId, 'POST', 'paymentmethod', {
      Name: spec.create,
      Type: spec.type,
    });
    found = res.PaymentMethod;
  }
  const next = { ...(settings.payment_methods || {}), [key]: { id: String(found.Id), name: String(found.Name) } };
  settings.payment_methods = next;
  await patchSettings(db, ctx.orgId, { payment_methods: next });
  return String(found.Id);
}

async function removePayment(db: SupabaseClient, ctx: QboContext, paymentId: string, mapped: MapRow | null): Promise<Outcome> {
  if (!mapped || mapped.qbo_state !== 'active') return { status: 'skipped', note: 'Paiement jamais envoyé.' };
  const current = await qboRead<any>(ctx.orgId, 'Payment', mapped.qbo_id);
  if (current) {
    await qboRequest(ctx.orgId, 'POST', 'payment?operation=delete', { Id: current.Id, SyncToken: current.SyncToken });
  }
  await setMapState(db, ctx, 'payment', paymentId, 'deleted');
  return { status: 'done', note: 'Retiré de QuickBooks.' };
}

async function syncPayment(db: SupabaseClient, ctx: QboContext, settings: QuickBooksSettings, paymentId: string): Promise<Outcome> {
  const { data: payment, error } = await db
    .from('payments')
    .select('*')
    .eq('id', paymentId)
    .eq('org_id', ctx.orgId)
    .maybeSingle();
  if (error) throw error;
  const mapped = await getMap(db, ctx, 'payment', paymentId);

  const amount = Math.max(0, Math.round(Number(payment?.amount_cents) || 0));
  if (!payment || payment.deleted_at || payment.status !== 'succeeded' || !payment.invoice_id || amount <= 0) {
    return removePayment(db, ctx, paymentId, mapped);
  }
  if (mapped && mapped.qbo_state !== 'active') {
    return { status: 'skipped', note: 'Paiement retiré de QuickBooks.' };
  }

  const invoice = await loadInvoice(db, ctx.orgId, payment.invoice_id);
  if (!invoice) throw new QboError('Facture du paiement introuvable dans Lume.');

  // Facture déjà dans QuickBooks : on s'y lie directement. Sinon on l'envoie
  // d'abord, même antérieure au branchement.
  const invoiceMap = await getMap(db, ctx, 'invoice', payment.invoice_id);
  let qboInvoiceId = invoiceMap?.qbo_state === 'active' ? invoiceMap.qbo_id : null;
  let customerId: string | null = null;
  if (!qboInvoiceId) {
    const inv = await syncInvoice(db, ctx, settings, payment.invoice_id, { force: true });
    if (!inv.qboId) {
      throw new QboError(`Facture du paiement non envoyée : ${inv.outcome.note || 'facture introuvable'}`);
    }
    qboInvoiceId = inv.qboId;
    customerId = inv.customerId;
  }
  if (!customerId) customerId = await ensureCustomer(db, ctx, invoice.client_id);

  const current = mapped ? await qboRead<any>(ctx.orgId, 'Payment', mapped.qbo_id) : null;
  // Nouveau paiement : jamais plus que le solde ouvert de la facture dans
  // QuickBooks (pourboire, paiement en double…) — le surplus reste en crédit.
  let applied = Math.min(amount, Math.max(0, Number(invoice.total_cents) || amount));
  if (!current) {
    const qboInvoice = await qboRead<any>(ctx.orgId, 'Invoice', qboInvoiceId);
    const balance = Math.round(Number(qboInvoice?.Balance) * 100);
    if (Number.isFinite(balance)) applied = Math.min(applied, Math.max(0, balance));
  }

  const key = methodKeyOf(payment.method, payment.provider);
  const methodId = key ? await ensurePaymentMethod(db, ctx, settings, key) : null;
  const online = ['stripe', 'paypal'].includes(String(payment.provider || '').toLowerCase());
  const depositId = (online && settings.deposit_account_online_id) || settings.deposit_account_id || null;
  const refNum = clip(payment.reference || (payment.card_last4 ? `•••• ${payment.card_last4}` : null) || payment.provider_payment_id, 21);
  const date = ymd(payment.payment_date || payment.paid_at || payment.created_at);

  const payload: Record<string, unknown> = {
    CustomerRef: { value: customerId },
    TotalAmt: money(amount),
    ...(date ? { TxnDate: date } : {}),
    ...(methodId ? { PaymentMethodRef: { value: methodId } } : {}),
    // Sans compte choisi : QuickBooks dépose dans « Fonds non déposés ».
    ...(depositId ? { DepositToAccountRef: { value: depositId } } : {}),
    ...(refNum ? { PaymentRefNum: refNum } : {}),
    PrivateNote: clip(
      [`Lume — paiement ${payment.provider || 'manuel'}`, payment.card_brand, payment.notes].filter(Boolean).join(' · '),
      4000,
    ),
    Line: applied > 0 ? [{ Amount: money(applied), LinkedTxn: [{ TxnId: qboInvoiceId, TxnType: 'Invoice' }] }] : [],
  };

  let saved: any;
  try {
    const res = await qboRequest<{ Payment: any }>(
      ctx.orgId,
      'POST',
      'payment',
      current ? { Id: current.Id, SyncToken: current.SyncToken, sparse: true, ...payload } : payload,
    );
    saved = res.Payment;
  } catch (err) {
    // Moyen de paiement mis en cache puis supprimé dans QuickBooks.
    if (key && err instanceof QboError && err.status === 400 && /PaymentMethod/i.test(err.message)) {
      const { [key]: _drop, ...rest } = settings.payment_methods || {};
      settings.payment_methods = rest;
      await patchSettings(db, ctx.orgId, { payment_methods: rest });
    }
    throw err;
  }
  await setMap(db, ctx, 'payment', paymentId, String(saved.Id));
  return {
    status: 'done',
    note: applied < amount ? `Surplus de ${money(amount - applied).toFixed(2)} $ laissé en crédit client dans QuickBooks.` : null,
  };
}

// ── File ───────────────────────────────────────────────────────

async function finish(db: SupabaseClient, job: QueueRow, status: string, message: string | null, nextAttemptAt?: string) {
  const patch: Record<string, unknown> = {
    status,
    last_error: message ? message.slice(0, 2000) : null,
    locked_at: null,
    updated_at: new Date().toISOString(),
  };
  if (nextAttemptAt) patch.next_attempt_at = nextAttemptAt;
  const { error } = await db.from('quickbooks_sync_queue').update(patch).eq('id', job.id);
  // 23505 : une nouvelle modification est déjà en file pour cette entité —
  // elle repassera, cette ligne n'a plus d'objet.
  if (error?.code === '23505') {
    await db
      .from('quickbooks_sync_queue')
      .update({ status: 'superseded', locked_at: null, updated_at: new Date().toISOString() })
      .eq('id', job.id);
  } else if (error) {
    throw error;
  }

  if (status === 'done' || status === 'skipped') {
    // Les anciennes erreurs de la même entité sont réglées par ce succès.
    await db
      .from('quickbooks_sync_queue')
      .update({ status: 'superseded', updated_at: new Date().toISOString() })
      .eq('org_id', job.org_id)
      .eq('entity_type', job.entity_type)
      .eq('entity_id', job.entity_id)
      .eq('status', 'error');
  }
}

async function handle(db: SupabaseClient, job: QueueRow, ctx: QboContext): Promise<Outcome> {
  const settings = await loadSettings(db, job.org_id);
  if (!settings.enabled) return { status: 'skipped', note: 'Synchronisation désactivée.' };
  switch (job.entity_type) {
    case 'client':
      return syncClient(db, ctx, job.entity_id);
    case 'invoice':
      return (await syncInvoice(db, ctx, settings, job.entity_id, { force: job.reason === 'history' })).outcome;
    case 'payment':
      return syncPayment(db, ctx, settings, job.entity_id);
    default:
      return { status: 'skipped' };
  }
}

let schemaMissingLogged = false;

/** Une passe : réclame jusqu'à `limit` lignes et les envoie. */
export async function runQuickBooksSync(db: SupabaseClient = getServiceClient(), limit = 25) {
  const { data, error } = await db.rpc('quickbooks_claim_jobs', { p_limit: limit });
  if (error) {
    if (isMissingSchema(error)) {
      if (!schemaMissingLogged) {
        logger.warn('[quickbooks-sync] migration 20261002100000 non appliquée — synchro inactive');
        schemaMissingLogged = true;
      }
      return { processed: 0 };
    }
    throw new Error(`quickbooks_claim_jobs: ${error.message}`);
  }
  const jobs = (data || []) as QueueRow[];
  const blockedOrgs = new Map<string, string>();
  let processed = 0;

  for (const job of jobs) {
    const blocked = blockedOrgs.get(job.org_id);
    if (blocked) {
      // Connexion morte pour ce bureau : on remet en attente sans brûler d'essai.
      await db
        .from('quickbooks_sync_queue')
        .update({ attempts: Math.max(0, job.attempts - 1) })
        .eq('id', job.id);
      await finish(db, job, 'pending', blocked, new Date(Date.now() + 30 * 60_000).toISOString());
      continue;
    }

    try {
      const ctx = await qboContext(job.org_id);
      const outcome = await handle(db, job, ctx);
      await finish(db, job, outcome.status, outcome.note ?? null);
      processed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof QboError && err.auth) {
        blockedOrgs.set(job.org_id, message);
        await db
          .from('quickbooks_sync_queue')
          .update({ attempts: Math.max(0, job.attempts - 1) })
          .eq('id', job.id);
        await finish(db, job, 'pending', message, new Date(Date.now() + 30 * 60_000).toISOString());
        continue;
      }
      // Validation QuickBooks (400) : réessayer ne changera rien.
      const permanent = err instanceof QboError && !err.retryable;
      if (permanent || job.attempts >= MAX_ATTEMPTS) {
        await finish(db, job, 'error', message);
      } else {
        const delayMin = Math.min(120, 2 ** job.attempts);
        await finish(db, job, 'pending', message, new Date(Date.now() + delayMin * 60_000).toISOString());
      }
      logger.warn(`[quickbooks-sync] ${job.entity_type} ${job.entity_id} (org ${job.org_id}) : ${message}`);
    }
  }
  return { processed };
}
