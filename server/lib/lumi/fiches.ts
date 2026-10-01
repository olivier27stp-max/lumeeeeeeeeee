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
import { taxesPourDocument } from '../agent/tools-etendus';
import { drapeauxEcriture } from '../agent/registre';
import { apercuAction, apercuTexto, type ApercuAction } from './apercu-action';
import { complementsCarte } from './complements-cartes';
import { montant as montantLisible, dateLisible, langueDe, MOTS } from '../courriels/gabarit';
import { texteDuCourriel } from '../courriels/modeles';
import { htmlVersTexte } from '../../../src/lib/emailBodyText';

export type { ApercuAction, LigneApercu } from './apercu-action';

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
    case 'query_schedule':
      for (const e of result.events ?? []) push(fiche('job', e.job_id, [texte(e.client_name), texte(e.job_title)].filter(Boolean).join(' · ') || 'Job', cents(e.total_cents)));
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
export interface FicheClientApercu { id: string; name: string; company: string | null; email: string | null; phone: string | null; address: string | null; since: string | null; jobs: number; quotes: number; invoices: number }
export interface ApercuFusion { genre: 'fusion'; garder: FicheClientApercu | null; absorber: FicheClientApercu | null }
/** Ce que la carte doit dire en plus : irréversible, part chez le client, jamais d'office (registre). */
export interface DrapeauxApercu { irreversible: boolean; vers_client: boolean; jamais_d_office: boolean }
export type Apercu = (ApercuDocument | ApercuMessage | ApercuFusion | ApercuAction) & { drapeaux?: DrapeauxApercu };

interface CtxApercu { client: SupabaseClient; orgId: string; userId: string }

/**
 * L'aperçu de TOUTE écriture proposée (audit 2026-09-30) : un aperçu composé
 * pour les documents, messages et fusions, sinon l'aperçu générique qui nomme
 * chaque élément visé (apercu-action.ts). Toujours accompagné des drapeaux du
 * registre (irréversible, vers le client, jamais d'office).
 */
export async function apercuProposition(tool: string, args: Record<string, any>, ctx: CtxApercu): Promise<Apercu | null> {
  const drapeaux = drapeauxEcriture(tool);
  let base: ApercuDocument | ApercuMessage | ApercuFusion | ApercuAction | null = null;
  try {
    if (tool === 'create_quote' || tool === 'create_invoice') base = await apercuDocument(tool === 'create_quote' ? 'quote' : 'invoice', args, ctx);
    else if (tool === 'send_sms') base = await apercuTexto(args, ctx);
    else if (tool === 'send_email') base = { genre: 'email', to: texte(args.to) || texte(args.client_name) || null, subject: texte(args.subject) || null, body: texte(args.body ?? args.message) };
    else if (tool === 'send_quote' || tool === 'send_invoice') base = await apercuEnvoiDocument(tool === 'send_quote' ? 'quote' : 'invoice', args, ctx);
    else if (tool === 'merge_clients') base = { genre: 'fusion', garder: await ficheClientApercu(args.keep_client_id, ctx), absorber: await ficheClientApercu(args.absorb_client_id, ctx) };
    if (!base) {
      // Les arguments nommés, puis l'effet réel que les arguments ne disent pas (complements-cartes.ts).
      const generique = await apercuAction(args, ctx, tool);
      generique.details.push(...await complementsCarte(tool, args, ctx));
      base = generique;
    }
  } catch (err: any) {
    // Un aperçu qui rate ne bloque pas la proposition : la carte dit alors qu'elle ne peut pas le montrer.
    console.error('[lumi/apercu]', err?.message || err);
  }
  return base ? { ...base, drapeaux } : { genre: 'action', cibles: [], details: [], drapeaux };
}

async function apercuDocument(genre: 'quote' | 'invoice', args: Record<string, any>, ctx: CtxApercu): Promise<ApercuDocument> {
  const brut: any[] = Array.isArray(args.line_items) ? args.line_items : Array.isArray(args.items) ? args.items : [];
  const lignes = brut.map((it) => {
    const quantity = Math.max(0, Number(it.quantity ?? it.qty) || 1);
    const unit = Math.max(0, Math.round(Number(it.unit_price_cents) || 0));
    return { name: texte(it.name), description: texte(it.description) || null, quantity, unit_price_cents: unit, total_cents: Math.round(quantity * unit) };
  });
  const subtotal = lignes.reduce((s, l) => s + l.total_cents, 0);
  // MÊME fonction que create_quote / create_invoice (audit 2026-09-30) : taxes
  // du client (région, exemption). Avant : toutes les taxes actives de l'org.
  const calcul = await taxesPourDocument(ctx, args.client_id || args.lead_id, subtotal, Boolean(args.no_taxes));
  const taxes = calcul.lignes.map((t) => ({ label: t.name, rate: t.rate, amount_cents: t.amount_cents }));
  const total = subtotal + calcul.tax_cents;

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

/** Une fiche client résumée pour la carte de fusion : coordonnées et volume d'historique. */
async function ficheClientApercu(id: unknown, ctx: CtxApercu): Promise<FicheClientApercu | null> {
  if (!estUuid(id)) return null;
  const { data: c } = await ctx.client.from('clients').select('id, first_name, last_name, company, display_as_company, email, phone, address, city, created_at').eq('org_id', ctx.orgId).eq('id', id).maybeSingle();
  if (!c) return null;
  // Trois requêtes explicites (pas de nom de table dynamique : le vérificateur
  // de schéma et le lecteur voient chaque colonne citée).
  const nb = (r: { count: number | null }) => r.count ?? 0;
  const jobs = nb(await ctx.client.from('jobs').select('id', { count: 'exact', head: true }).eq('org_id', ctx.orgId).eq('client_id', id).is('deleted_at', null));
  const quotes = nb(await ctx.client.from('quotes').select('id', { count: 'exact', head: true }).eq('org_id', ctx.orgId).eq('client_id', id).is('deleted_at', null));
  const invoices = nb(await ctx.client.from('invoices').select('id', { count: 'exact', head: true }).eq('org_id', ctx.orgId).eq('client_id', id).is('deleted_at', null));
  const nom = [c.first_name, c.last_name].filter(Boolean).join(' ').trim();
  return {
    id, name: (c.display_as_company && c.company) ? c.company : (nom || c.company || ''), company: c.company || null,
    email: c.email || null, phone: c.phone || null, address: [c.address, c.city].filter(Boolean).join(', ') || null,
    since: c.created_at ? String(c.created_at).slice(0, 10) : null,
    jobs, quotes, invoices,
  };
}

/** Envoi d'un devis ou d'une facture existants : à qui, quel document, quel montant. */
async function apercuEnvoiDocument(genre: 'quote' | 'invoice', args: Record<string, any>, ctx: CtxApercu): Promise<ApercuMessage | null> {
  const id = genre === 'quote' ? args.quote_id : args.invoice_id;
  if (!estUuid(id)) return null;
  // Deux requêtes explicites : `invoices` n'a pas de colonne title, et avec
  // PostgREST une colonne inexistante fait échouer toute la requête.
  // Même destinataire et même montant que les routes d'envoi (audit 2026-09-30) :
  // devis → courriel du client, sinon du prospect (routes/quotes.ts) ;
  // facture → le SOLDE, comme le courriel envoyé (pas le total).
  const d: { numero: string; montant_cents: unknown; client_id: unknown; lead_id: unknown; devise: string; date: string | null } | null = genre === 'quote'
    ? await ctx.client.from('quotes').select('quote_number, total_cents, client_id, lead_id, currency, valid_until').eq('org_id', ctx.orgId).eq('id', id).maybeSingle()
        .then(({ data }) => (data ? { numero: texte(data.quote_number), montant_cents: data.total_cents, client_id: data.client_id, lead_id: data.lead_id, devise: texte(data.currency) || 'CAD', date: data.valid_until ?? null } : null))
    // Le solde, sinon le total quand il n'y a plus de solde : la même règle que la route d'envoi.
    : await ctx.client.from('invoices').select('invoice_number, balance_cents, total_cents, client_id, currency, due_date').eq('org_id', ctx.orgId).eq('id', id).maybeSingle()
        .then(({ data }) => (data ? { numero: texte(data.invoice_number), montant_cents: data.balance_cents || data.total_cents, client_id: data.client_id, lead_id: null, devise: texte(data.currency) || 'CAD', date: data.due_date ?? null } : null));
  if (!d) return null;
  let to: string | null = null;
  const personne = async (pid: unknown) => {
    if (!estUuid(pid)) return null;
    const { data: c } = await ctx.client.from('clients').select('first_name, last_name, company, email').eq('org_id', ctx.orgId).eq('id', pid).maybeSingle();
    return c ? { nom: [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.company || '', email: c.email || null } : null;
  };
  const client = await personne(d.client_id);
  const prospect = client?.email ? null : await personne(d.lead_id);
  const qui = client?.email ? client : prospect?.email ? prospect : client ?? prospect;
  if (qui) to = qui.email ? `${qui.nom} <${qui.email}>` : `${qui.nom} — aucune adresse courriel : l’envoi sera refusé`;
  const num = d.numero;
  /* L'objet et le texte affichés sont ceux qui PARTENT (routes/quotes.ts, routes/emails.ts) :
     la langue de l'entreprise, le montant au format du courriel, et le modèle « soumission
     envoyée » / « facture envoyée » de l'entreprise quand elle en a un. Avant, la carte montrait
     « Soumission 12 · 300,00 $ » et « Courriel standard de Lume » même quand le client allait
     recevoir l'objet et le texte écrits par l'entreprise. */
  const { data: cs } = await ctx.client.from('company_settings').select('company_name, default_language').eq('org_id', ctx.orgId).maybeSingle();
  const langue = langueDe(cs?.default_language);
  const montantTexte = montantLisible(cents(d.montant_cents) ?? 0, d.devise, langue);
  const communes = { client_name: qui?.nom || 'Client', company_name: texte(cs?.company_name) };
  const variables: Record<string, string> = genre === 'quote'
    ? { ...communes, quote_number: num, quote_amount: montantTexte, valid_until: dateLisible(d.date, langue), quote_link: '' }
    : { ...communes, invoice_number: num, invoice_amount: montantTexte, due_date: dateLisible(d.date, langue), payment_link: '' };
  const modele = texte(args.subject) && texte(args.message)
    ? null
    : await texteDuCourriel(ctx.orgId, genre === 'quote' ? 'quote_sent' : 'invoice_sent', variables, ctx.client);
  const mots = MOTS[langue];
  const objetParDefaut = genre === 'quote' ? `${mots.soumission}${num ? ` ${num}` : ''} — ${montantTexte}` : `${mots.facture} ${num} — ${montantTexte}`;
  const suite = genre === 'quote'
    ? 'Suivi du montant et du bouton pour consulter et approuver la soumission en ligne.'
    : 'Suivi du montant à payer et du bouton pour payer la facture en ligne.';
  const texteModele = modele?.corpsHtml ? htmlVersTexte(modele.corpsHtml).trim() : '';
  return {
    genre: 'email',
    to,
    subject: texte(args.subject) || modele?.sujet || objetParDefaut,
    body: texte(args.message)
      ? `${texte(args.message)}\n\n${suite}`
      : texteModele
        ? `${texteModele}\n\n${suite}`
        : (genre === 'quote'
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
    const jobCree = result.job_id ?? result.job?.id;
    if (tool === 'create_job' && estUuid(jobCree)) {
      const { data: j } = await ctx.client.from('jobs').select('id, job_number, title').eq('id', jobCree).maybeSingle();
      return fiche('job', jobCree, libelleJob(j));
    }
    if (tool === 'create_task' && estUuid(result.task?.id)) return fiche('task', result.task.id, texte(result.task.title) || texte(args.title) || 'Tâche');
    if (tool === 'create_client' && estUuid(result.client?.id)) return fiche('client', result.client.id, texte(result.client.name) || texte(args.company));
    // Conversion : le reçu mène au JOB créé (c'est lui qu'on veut ouvrir), pas au devis.
    if (tool === 'convert_quote_to_job' && estUuid(result.job?.id)) return fiche('job', result.job.id, libelleJob(result.job));
    if ((tool === 'send_quote' || tool === 'convert_quote_to_job') && estUuid(args.quote_id)) return fiche('quote', args.quote_id, 'Devis');
    if (tool === 'send_invoice' && estUuid(args.invoice_id)) return fiche('invoice', args.invoice_id, 'Facture');
    if (tool === 'merge_clients' && estUuid(result.kept_client_id)) return fiche('client', result.kept_client_id, 'Fiche gardée');
  } catch (err: any) {
    console.error('[lumi/fiche-creee]', err?.message || err);
  }
  return null;
}
