/**
 * Valeurs des champs SYSTÈME comme variables de modèles (mission GHL,
 * 2026-09-28) : ce que les formulaires enregistrent déjà (prénom, courriel,
 * vendeur, dépôt…) devient citable avec la même clé que dans Réglages —
 * {{client.first_name}}, {{job.salesperson}}, {{quote.valid_days}}… — sans
 * toucher aux formulaires. Même nom interne que les champs personnalisés
 * (`<objet>_cf_<clé>`) : tous les résolveurs existants les lisent déjà.
 *
 * Les clés viennent de CHAMPS_STANDARD (src/lib/champs/standard.ts) ; seules
 * celles qui ont une section (un vrai champ de formulaire) sont calculées.
 * tests/champs-variables-systeme.test.ts vérifie que chacune a sa valeur.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';

type Objet = 'client' | 'deal' | 'job' | 'quote' | 'invoice' | 'property';
type Ligne = Record<string, unknown>;
type Valeurs = Record<string, string>;

interface Format { langue: 'fr' | 'en'; fuseau: string }

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const ouiNon = (v: unknown, f: Format) => (v === null || v === undefined ? '' : v ? (f.langue === 'fr' ? 'Oui' : 'Yes') : (f.langue === 'fr' ? 'Non' : 'No'));
const argent = (cents: unknown, f: Format) => {
  const n = Number(cents);
  if (cents === null || cents === undefined || !Number.isFinite(n)) return '';
  return new Intl.NumberFormat(f.langue === 'fr' ? 'fr-CA' : 'en-CA', { style: 'currency', currency: 'CAD' }).format(n / 100);
};
const date = (iso: unknown, f: Format) => {
  const s = txt(iso);
  if (!s) return '';
  // Date seule (AAAA-MM-JJ) : pas de conversion de fuseau, elle glisserait d'un jour.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`) : new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(f.langue === 'fr' ? 'fr-CA' : 'en-CA', {
    dateStyle: 'long', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(s) ? 'UTC' : f.fuseau,
  }).format(d);
};
const nomClient = (c: Ligne | null | undefined) => {
  if (!c) return '';
  const personne = `${txt(c.first_name)} ${txt(c.last_name)}`.trim();
  return c.display_as_company && txt(c.company) ? txt(c.company) : personne || txt(c.company);
};
const typeDepot = (v: unknown, f: Format) => (v === 'fixed' ? (f.langue === 'fr' ? 'Montant fixe' : 'Fixed amount')
  : v === 'percentage' ? (f.langue === 'fr' ? 'Pourcentage' : 'Percentage') : '');
const valeurDepot = (type: unknown, valeur: unknown, f: Format) => {
  const n = Number(valeur);
  if (!Number.isFinite(n) || n === 0) return '';
  return type === 'percentage' ? `${n} %` : argent(Math.round(n * 100), f);
};

async function une(db: SupabaseClient, table: string, colonnes: string, id: string, orgId: string): Promise<Ligne | null> {
  const { data, error } = await db.from(table).select(colonnes).eq('id', id).eq('org_id', orgId).maybeSingle();
  if (error) throw new Error(`${table} : ${error.message}`);
  return (data as unknown as Ligne) ?? null;
}
async function nomProfil(db: SupabaseClient, id: unknown): Promise<string> {
  if (!id) return '';
  const { data } = await db.from('profiles').select('full_name').eq('id', String(id)).maybeSingle();
  return txt(data?.full_name);
}
async function client(db: SupabaseClient, id: unknown, orgId: string): Promise<Ligne | null> {
  return id ? une(db, 'clients', 'first_name, last_name, company, display_as_company, email, phone, address', String(id), orgId) : null;
}

async function valeursClient(db: SupabaseClient, orgId: string, id: string, f: Format): Promise<Valeurs> {
  const c = await une(db, 'clients', 'first_name, last_name, client_number, company, display_as_company, phone, email, lead_source, address, tax_ids, billing_same_as_service, billing_address', id, orgId);
  if (!c) return {};
  const taxIds = Array.isArray(c.tax_ids) ? (c.tax_ids as string[]) : [];
  let taxes = '';
  if (taxIds.length) {
    const { data } = await db.from('tax_configs').select('name').eq('org_id', orgId).in('id', taxIds);
    taxes = (data ?? []).map((t) => txt(t.name)).filter(Boolean).join(', ');
  }
  return {
    first_name: txt(c.first_name), last_name: txt(c.last_name), client_number: txt(c.client_number), company: txt(c.company),
    display_as_company: ouiNon(c.display_as_company, f), phone: txt(c.phone), email: txt(c.email), lead_source: txt(c.lead_source),
    address: txt(c.address), taxes, billing_same_as_service: ouiNon(c.billing_same_as_service, f),
    billing_address: c.billing_same_as_service ? txt(c.address) : txt(c.billing_address),
  };
}

async function valeursJob(db: SupabaseClient, orgId: string, id: string, f: Format): Promise<Valeurs> {
  const j = await une(db, 'jobs', 'title, job_number, salesperson_id, sale_date, show_on_leaderboard, ask_for_review, client_id, client_name, property_address, job_type, team_id, requires_invoicing, billing_split, deposit_required, deposit_type, deposit_value, require_payment_method, tax_lines, notes', id, orgId);
  if (!j) return {};
  const [vendeur, equipe, lignes, visites, contrat, cli] = await Promise.all([
    nomProfil(db, j.salesperson_id),
    j.team_id ? db.from('teams').select('name').eq('id', String(j.team_id)).maybeSingle().then((r) => txt(r.data?.name)) : Promise.resolve(''),
    db.from('job_line_items').select('name').eq('job_id', id).is('deleted_at', null).order('created_at').then((r) => (r.data ?? []).map((x) => txt(x.name)).filter(Boolean).join(', ')),
    db.from('schedule_events').select('start_at').eq('job_id', id).is('deleted_at', null).order('start_at').then((r) => (r.data ?? []).map((x) => txt(x.start_at))),
    db.from('job_agreements').select('id').eq('job_id', id).is('deleted_at', null).limit(1).then((r) => (r.data ?? []).length > 0),
    client(db, j.client_id, orgId),
  ]);
  // La prochaine visite ; à défaut, la dernière.
  const maintenant = new Date().toISOString();
  const visite = visites.find((v) => v >= maintenant) ?? visites[visites.length - 1] ?? '';
  const taxes = Array.isArray(j.tax_lines) ? (j.tax_lines as Ligne[]).filter((t) => t.enabled !== false).map((t) => txt(t.name)).filter(Boolean).join(', ') : '';
  const recurrent = j.job_type === 'recurring';
  return {
    title: txt(j.title), job_number: txt(j.job_number), salesperson: vendeur, sale_date: date(j.sale_date, f),
    show_on_leaderboard: ouiNon(j.show_on_leaderboard, f), ask_for_review: ouiNon(j.ask_for_review, f),
    client: nomClient(cli) || txt(j.client_name), property: txt(j.property_address) === '-' ? '' : txt(j.property_address),
    job_type: recurrent ? (f.langue === 'fr' ? 'Forfait de service' : 'Service plan') : (f.langue === 'fr' ? 'Service ponctuel' : 'One-off'),
    visits: date(visite, f), team: equipe, requires_invoicing: ouiNon(j.requires_invoicing, f), billing_split: ouiNon(j.billing_split, f),
    deposit_required: ouiNon(j.deposit_required, f), deposit_type: j.deposit_required ? typeDepot(j.deposit_type, f) : '',
    deposit_value: j.deposit_required ? valeurDepot(j.deposit_type, j.deposit_value, f) : '',
    require_payment_method: ouiNon(j.require_payment_method, f), line_items: lignes, taxes,
    agreement: ouiNon(contrat, f), notes: txt(j.notes),
  };
}

async function valeursDevis(db: SupabaseClient, orgId: string, id: string, f: Format): Promise<Valeurs> {
  const q = await une(db, 'quotes', 'client_id, lead_id, quote_type, title, property_id, quote_number, salesperson_id, created_at, valid_until, contract_disclaimer, notes, discount_cents, tax_cents, deposit_required, deposit_type, deposit_value, require_payment_method', id, orgId);
  if (!q) return {};
  const [cli, vendeur, propriete, sections, lignes] = await Promise.all([
    client(db, q.client_id ?? q.lead_id, orgId),
    nomProfil(db, q.salesperson_id),
    q.property_id ? db.from('properties').select('address, name').eq('id', String(q.property_id)).maybeSingle().then((r) => txt(r.data?.address) || txt(r.data?.name)) : Promise.resolve(''),
    db.from('quote_sections').select('section_type, content, enabled').eq('quote_id', id).then((r) => (r.data ?? []) as Ligne[]),
    db.from('quote_line_items').select('name').eq('quote_id', id).order('sort_order').then((r) => (r.data ?? []).map((x) => txt(x.name)).filter(Boolean).join(', ')),
  ]);
  const section = (type: string) => txt(sections.find((s) => s.section_type === type && s.enabled !== false)?.content);
  let photos = 0;
  try { const p: unknown = JSON.parse(section('images') || '[]'); photos = Array.isArray(p) ? p.length : 0; } catch { photos = 0; }
  const jours = q.valid_until && q.created_at
    ? Math.round((new Date(String(q.valid_until)).getTime() - new Date(String(q.created_at)).getTime()) / 86_400_000) : null;
  return {
    client: nomClient(cli), quote_type: q.quote_type === 'service_plan' ? (f.langue === 'fr' ? 'Plan de service' : 'Service plan') : (f.langue === 'fr' ? 'Devis ponctuel' : 'One-off quote'),
    title: txt(q.title), property: propriete, quote_number: txt(q.quote_number), salesperson: vendeur,
    valid_days: jours !== null && jours > 0 ? String(jours) : '', photos: photos ? String(photos) : '',
    introduction: section('introduction'), line_items: lignes, contract_disclaimer: txt(q.contract_disclaimer),
    client_message: section('client_message'), notes: txt(q.notes), discount: Number(q.discount_cents) ? argent(q.discount_cents, f) : '',
    tax: argent(q.tax_cents, f), deposit_required: ouiNon(q.deposit_required, f), deposit_type: q.deposit_required ? typeDepot(q.deposit_type, f) : '',
    deposit_value: q.deposit_required ? valeurDepot(q.deposit_type, q.deposit_value, f) : '', require_payment_method: ouiNon(q.require_payment_method, f),
  };
}

async function valeursFacture(db: SupabaseClient, orgId: string, id: string, f: Format): Promise<Valeurs> {
  const i = await une(db, 'invoices', 'client_id, subject, created_at, due_date, salesperson_id, discount_cents, tax_cents, notes, internal_notes', id, orgId);
  if (!i) return {};
  const [cli, vendeur, lignes] = await Promise.all([
    client(db, i.client_id, orgId),
    nomProfil(db, i.salesperson_id),
    db.from('invoice_items').select('description').eq('invoice_id', id).is('deleted_at', null).order('sort_order').then((r) => (r.data ?? []).map((x) => txt(x.description)).filter(Boolean).join(', ')),
  ]);
  return {
    client: nomClient(cli), subject: txt(i.subject), invoice_date: date(i.created_at, f), due_date: date(i.due_date, f), salesperson: vendeur,
    line_items: lignes, discount: Number(i.discount_cents) ? argent(i.discount_cents, f) : '', tax: argent(i.tax_cents, f),
    notes: txt(i.notes), internal_notes: txt(i.internal_notes),
  };
}

async function valeursDeal(db: SupabaseClient, orgId: string, id: string, f: Format): Promise<Valeurs> {
  const d = await une(db, 'deals', 'pipeline_id, client_id, quote_id, expected_close_date, assigned_user_id, source', id, orgId);
  if (!d) return {};
  const [pipeline, cli, responsable, montant] = await Promise.all([
    d.pipeline_id ? db.from('pipelines_ventes').select('name').eq('id', String(d.pipeline_id)).maybeSingle().then((r) => txt(r.data?.name)) : Promise.resolve(''),
    client(db, d.client_id, orgId),
    nomProfil(db, d.assigned_user_id),
    d.quote_id ? db.from('quotes').select('total_cents').eq('id', String(d.quote_id)).maybeSingle().then((r) => argent(r.data?.total_cents, f)) : Promise.resolve(''),
  ]);
  const SOURCES: Record<string, [string, string]> = {
    manual: ['Saisie manuelle', 'Manual entry'], form_web: ['Formulaire web', 'Web form'], meta: ['Meta', 'Meta'], d2d: ['Porte-à-porte', 'Door to door'],
  };
  const s = SOURCES[txt(d.source)];
  return {
    pipeline, client: nomClient(cli), first_name: txt(cli?.first_name), last_name: txt(cli?.last_name), email: txt(cli?.email),
    phone: txt(cli?.phone), address: txt(cli?.address), amount: montant, expected_close_date: date(d.expected_close_date, f),
    assigned_user: responsable, source: s ? (f.langue === 'fr' ? s[0] : s[1]) : txt(d.source),
  };
}

async function valeursPropriete(db: SupabaseClient, orgId: string, id: string): Promise<Valeurs> {
  const p = await une(db, 'properties', 'name, address', id, orgId);
  return p ? { name: txt(p.name), address: txt(p.address) } : {};
}

const CALCULS: Record<Objet, (db: SupabaseClient, orgId: string, id: string, f: Format) => Promise<Valeurs>> = {
  client: valeursClient, job: valeursJob, quote: valeursDevis, invoice: valeursFacture, deal: valeursDeal,
  property: (db, orgId, id) => valeursPropriete(db, orgId, id),
};

/** Valeurs des champs système d'une fiche, par clé (sans préfixe). Une fiche illisible donne {} et une trace. */
export async function valeursSysteme(
  db: SupabaseClient, orgId: string, objet: Objet, id: string, langue: 'fr' | 'en', fuseau: string,
): Promise<Valeurs> {
  try {
    return await CALCULS[objet](db, orgId, id, { langue, fuseau });
  } catch (err) {
    logger.error('[champs] valeurs des champs système illisibles', { objet, error: err instanceof Error ? err.message : String(err) });
    return {};
  }
}
