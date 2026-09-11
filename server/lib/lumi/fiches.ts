/**
 * Fiches liées et aperçus pour Lumi.
 * ──────────────────────────────────
 * Le modèle ne voit jamais un identifiant (voir agent/refs.ts). L'INTERFACE,
 * elle, a le droit : ce module extrait, AVANT le masquage, les fiches qu'un
 * outil a touchées (client, job, devis, facture, tâche) pour que la page Lumi
 * affiche des liens vers la fiche exacte — au lieu d'une page générale.
 *
 * Il prépare aussi l'APERÇU d'une écriture proposée (devis, facture : lignes,
 * taxes de l'org, total) pour que la carte de confirmation montre le document
 * tel qu'il sera, avec les mêmes taxes que l'outil appliquera à la création.
 *
 * Rien ici ne part au modèle : fiches et aperçus voyagent en SSE seulement.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { taxesParDefaut } from '../agent/tools-etendus';

export type TypeFiche = 'client' | 'lead' | 'job' | 'quote' | 'invoice' | 'task';
export interface Fiche {
  type: TypeFiche;
  id: string;
  label: string;
  href: string;
  montant_cents?: number;
}

const MAX_FICHES = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function estUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}
function texte(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
}
function cents(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

const HREF: Record<TypeFiche, (id: string) => string> = {
  client: (id) => `/clients/${id}`,
  lead: (id) => `/clients/${id}`,
  job: (id) => `/jobs/${id}`,
  quote: (id) => `/quotes/${id}`,
  invoice: (id) => `/invoices/${id}`,
  task: () => '/tasks',
};

function fiche(type: TypeFiche, id: unknown, label: string, montant?: number): Fiche | null {
  if (!estUuid(id) || !label) return null;
  const f: Fiche = { type, id, label, href: HREF[type](id) };
  if (montant !== undefined) f.montant_cents = montant;
  return f;
}

/** Fiches touchées par un outil de LECTURE, à partir de son résultat non masqué. */
export function fichesDuResultat(tool: string, args: Record<string, any>, result: any): Fiche[] {
  if (!result || typeof result !== 'object' || result.error) return [];
  const out: Fiche[] = [];
  const push = (f: Fiche | null) => { if (f && !out.some((x) => x.href === f.href)) out.push(f); };

  switch (tool) {
    case 'search_clients':
      for (const c of result.clients ?? []) push(fiche('client', c.id, texte(c.name) || texte(c.company)));
      break;
    case 'search_leads':
      for (const l of result.leads ?? []) push(fiche('lead', l.id, texte(l.name) || texte(l.company)));
      break;
    case 'get_client_profile':
      push(fiche('client', args.client_id, texte(result.client?.name) || texte(result.client?.company)));
      break;
    case 'list_jobs':
      for (const j of result.jobs ?? []) push(fiche('job', j.id, libelleJob(j), cents(j.total_cents)));
      break;
    case 'get_job':
      push(fiche('job', result.id, libelleJob(result), cents(result.total_cents)));
      if (result.client_id) push(fiche('client', result.client_id, texte(result.client_name)));
      break;
    case 'list_quotes':
      for (const q of result.quotes ?? []) push(fiche('quote', q.id, `${texte(q.quote_number) || 'Devis'}${q.title ? ` · ${texte(q.title)}` : ''}`, cents(q.total_cents)));
      break;
    case 'list_invoices':
      for (const i of result.invoices ?? []) push(fiche('invoice', i.id, `${texte(i.invoice_number) || 'Facture'}${i.client_name ? ` · ${texte(i.client_name)}` : ''}`, cents(i.total_cents)));
      break;
    case 'get_overdue_payments':
      for (const r of result.overdue ?? []) {
        push(fiche('invoice', r.id, `${texte(r.invoice_number) || 'Facture'}${r.client_name ? ` · ${texte(r.client_name)}` : ''}`, cents(r.balance_cents)));
        push(fiche('client', r.client_id, texte(r.client_name)));
      }
      break;
    case 'list_tasks':
      for (const t of result.tasks ?? []) push(fiche('task', t.id, texte(t.title)));
      break;
    default:
      break;
  }
  return out.slice(0, MAX_FICHES);
}

function libelleJob(j: any): string {
  const num = texte(j?.job_number);
  const titre = texte(j?.title);
  return `${num ? `Job #${num}` : 'Job'}${titre ? ` · ${titre}` : ''}`;
}

/** Aperçu d'une écriture proposée : ce que la carte de confirmation montre. */
export interface ApercuDocument {
  genre: 'quote' | 'invoice';
  client: { name: string; company: string | null; email: string | null; phone: string | null; address: string | null } | null;
  title: string;
  lignes: Array<{ name: string; description: string | null; quantity: number; unit_price_cents: number; total_cents: number }>;
  subtotal_cents: number;
  taxes: Array<{ label: string; rate: number; amount_cents: number }>;
  total_cents: number;
  valid_days: number | null;
  notes: string | null;
}
export interface ApercuMessage {
  genre: 'sms' | 'email';
  to: string | null;
  subject: string | null;
  body: string;
}
export type Apercu = ApercuDocument | ApercuMessage;

interface CtxApercu { client: SupabaseClient; orgId: string; userId: string }

export async function apercuProposition(tool: string, args: Record<string, any>, ctx: CtxApercu): Promise<Apercu | null> {
  try {
    if (tool === 'create_quote' || tool === 'create_invoice') return await apercuDocument(tool === 'create_quote' ? 'quote' : 'invoice', args, ctx);
    if (tool === 'send_sms') return { genre: 'sms', to: texte(args.client_name) || texte(args.phone_number) || null, subject: null, body: texte(args.message ?? args.body) };
    if (tool === 'send_email') return { genre: 'email', to: texte(args.to) || texte(args.client_name) || null, subject: texte(args.subject) || null, body: texte(args.body ?? args.message) };
    if (tool === 'send_quote' || tool === 'send_invoice') return await apercuEnvoiDocument(tool === 'send_quote' ? 'quote' : 'invoice', args, ctx);
  } catch (err: any) {
    // Un aperçu qui rate ne bloque pas la proposition : la carte retombe sur la liste des champs.
    console.error('[lumi/apercu]', err?.message || err);
  }
  return null;
}

async function apercuDocument(genre: 'quote' | 'invoice', args: Record<string, any>, ctx: CtxApercu): Promise<ApercuDocument> {
  const brut: any[] = Array.isArray(args.line_items) ? args.line_items : Array.isArray(args.items) ? args.items : [];
  const lignes = brut.map((it) => {
    const quantity = Math.max(0, Number(it.quantity ?? it.qty) || 1);
    const unit = Math.max(0, Math.round(Number(it.unit_price_cents) || 0));
    return { name: texte(it.name), description: texte(it.description) || null, quantity, unit_price_cents: unit, total_cents: Math.round(quantity * unit) };
  });
  const subtotal = lignes.reduce((s, l) => s + l.total_cents, 0);
  const taxes = args.no_taxes ? [] : (await taxesParDefaut(ctx)).filter((t) => t.enabled).map((t) => ({
    label: t.label, rate: t.rate, amount_cents: Math.round(subtotal * (t.rate / 100)),
  }));
  const total = subtotal + taxes.reduce((s, t) => s + t.amount_cents, 0);

  let client: ApercuDocument['client'] = null;
  const id = args.client_id || args.lead_id;
  if (estUuid(id)) {
    const { data: c } = await ctx.client.from('clients')
      .select('first_name, last_name, company, display_as_company, email, phone, address, city')
      .eq('org_id', ctx.orgId).eq('id', id).maybeSingle();
    if (c) {
      const nom = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
      client = {
        name: (c.display_as_company && c.company) ? c.company : (nom || c.company || ''),
        company: c.company || null, email: c.email || null, phone: c.phone || null,
        address: [c.address, c.city].filter(Boolean).join(', ') || null,
      };
    }
  }
  return {
    genre, client, title: texte(args.title), lignes, subtotal_cents: subtotal, taxes, total_cents: total,
    valid_days: genre === 'quote' ? Math.max(1, Number(args.valid_days) || 30) : null,
    notes: texte(args.notes) || null,
  };
}

/** Envoi d'un devis ou d'une facture existants : à qui, quel document, quel montant. */
async function apercuEnvoiDocument(genre: 'quote' | 'invoice', args: Record<string, any>, ctx: CtxApercu): Promise<ApercuMessage | null> {
  const id = genre === 'quote' ? args.quote_id : args.invoice_id;
  if (!estUuid(id)) return null;
  const table = genre === 'quote' ? 'quotes' : 'invoices';
  const numero = genre === 'quote' ? 'quote_number' : 'invoice_number';
  const { data: d } = await ctx.client.from(table).select(`${numero}, total_cents, client_id, title`).eq('org_id', ctx.orgId).eq('id', id).maybeSingle();
  if (!d) return null;
  let to: string | null = null;
  if (estUuid((d as any).client_id)) {
    const { data: c } = await ctx.client.from('clients').select('first_name, last_name, company, email').eq('org_id', ctx.orgId).eq('id', (d as any).client_id).maybeSingle();
    if (c) {
      const nom = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.company || '';
      to = c.email ? `${nom} <${c.email}>` : nom || null;
    }
  }
  const num = texte((d as any)[numero]);
  const montant = cents((d as any).total_cents);
  const libelle = genre === 'quote' ? `Soumission ${num}` : `Facture ${num}`;
  return {
    genre: 'email',
    to,
    subject: texte(args.subject) || `${libelle}${montant !== undefined ? ` · ${(montant / 100).toFixed(2).replace('.', ',')} $` : ''}`,
    body: texte(args.message) || (genre === 'quote'
      ? `Courriel standard de Lume avec le lien pour consulter et accepter la soumission en ligne.`
      : `Courriel standard de Lume avec le lien pour consulter et payer la facture en ligne.`),
  };
}

/** Fiche de ce qu'une écriture vient de créer (pour le reçu de la carte). */
export async function ficheCreee(tool: string, args: Record<string, any>, result: any, ctx: CtxApercu): Promise<Fiche | null> {
  if (!result || typeof result !== 'object') return null;
  try {
    if (tool === 'create_quote' && estUuid(result.quote_id)) {
      const { data: q } = await ctx.client.from('quotes').select('id, quote_number, total_cents').eq('id', result.quote_id).maybeSingle();
      return fiche('quote', result.quote_id, `Devis ${texte(q?.quote_number) || ''}`.trim(), cents(q?.total_cents));
    }
    if (tool === 'create_invoice' && estUuid(result.invoice_id)) {
      const { data: i } = await ctx.client.from('invoices').select('id, invoice_number, total_cents').eq('id', result.invoice_id).maybeSingle();
      return fiche('invoice', result.invoice_id, `Facture ${texte(i?.invoice_number) || ''}`.trim(), cents(i?.total_cents));
    }
    if (tool === 'create_job' && estUuid(result.job_id)) {
      const { data: j } = await ctx.client.from('jobs').select('id, job_number, title').eq('id', result.job_id).maybeSingle();
      return fiche('job', result.job_id, libelleJob(j));
    }
    if (tool === 'create_task' && estUuid(result.task?.id)) return fiche('task', result.task.id, texte(result.task.title) || texte(args.title) || 'Tâche');
    if (tool === 'create_client' && estUuid(result.client?.id)) return fiche('client', result.client.id, texte(result.client.name) || texte(args.company));
    if ((tool === 'send_quote' || tool === 'convert_quote_to_job') && estUuid(args.quote_id)) return fiche('quote', args.quote_id, 'Devis');
    if (tool === 'send_invoice' && estUuid(args.invoice_id)) return fiche('invoice', args.invoice_id, 'Facture');
  } catch (err: any) {
    console.error('[lumi/fiche-creee]', err?.message || err);
  }
  return null;
}
