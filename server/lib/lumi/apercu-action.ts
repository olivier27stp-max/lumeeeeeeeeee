/**
 * Aperçu GÉNÉRIQUE d'une écriture proposée (audit des outils, 2026-09-30).
 * ─────────────────────────────────────────────────────────────────────────
 * Avant : seules 7 écritures sur 180 avaient un aperçu ; les autres
 * retombaient sur la liste des arguments, identifiants retirés. La carte de
 * « supprimer le client » était vide, celle d'un remboursement disait
 * « amount cents 5000 » : on confirmait sans voir QUOI.
 *
 * Ici, chaque identifiant passé à l'outil est lu en base (org de la session,
 * client de l'utilisateur : RLS) et nommé ; les montants sont en dollars, les
 * dates à l'heure de l'entreprise, les textes en entier. Un identifiant qui ne
 * correspond à rien dans l'entreprise est SIGNALÉ (alerte) — jamais caché.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface LigneApercu {
  libelle: { fr: string; en: string };
  valeur: string;
  valeur_en?: string;
  /** L'élément visé est introuvable dans l'entreprise : à ne pas confirmer. */
  alerte?: boolean;
}
export interface ApercuAction { genre: 'action'; cibles: LigneApercu[]; details: LigneApercu[] }

interface Ctx { client: SupabaseClient; orgId: string; userId: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const estUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const txt = (v: unknown) => (v == null ? '' : String(v).trim());
const L = (fr: string, en: string) => ({ fr, en });

export function argentFr(cents: number): string {
  return `${(cents / 100).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`.replace(/[  ]/g, ' ');
}
export function argentEn(cents: number): string {
  const v = (Math.abs(cents) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${cents < 0 ? '-' : ''}$${v}`;
}
function dateLocale(iso: string, fuseau: string, langue: 'fr' | 'en'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const avecHeure = /T\d{2}:\d{2}/.test(iso);
  return new Intl.DateTimeFormat(langue === 'fr' ? 'fr-CA' : 'en-CA', {
    timeZone: fuseau, weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
    ...(avecHeure ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(avecHeure ? d : new Date(`${iso.slice(0, 10)}T12:00:00Z`));
}
const nomPersonne = (p: { first_name?: string | null; last_name?: string | null; company?: string | null; display_as_company?: boolean | null; email?: string | null } | null) => {
  if (!p) return '';
  const nom = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return (p.display_as_company && p.company) ? p.company : (nom || p.company || p.email || '');
};

/* ── Résolveurs : un identifiant → une ligne lisible ─────────────────────── */
type Resolveur = (id: string, ctx: Ctx, fuseau: string) => Promise<LigneApercu | null>;
const introuvable = (libelle: LigneApercu['libelle']): LigneApercu => ({ libelle, valeur: 'introuvable dans cette entreprise', valeur_en: 'not found in this company', alerte: true });

const client: Resolveur = async (id, { client: db, orgId }) => {
  const { data: c } = await db.from('clients').select('first_name, last_name, company, display_as_company, email, phone, address, city, status')
    .eq('org_id', orgId).eq('id', id).maybeSingle();
  const lib = L(c?.status === 'lead' ? 'Prospect' : 'Client', c?.status === 'lead' ? 'Lead' : 'Client');
  if (!c) return introuvable(lib);
  return { libelle: lib, valeur: [nomPersonne(c), [c.address, c.city].filter(Boolean).join(', '), c.phone, c.email].filter(Boolean).join(' · ') };
};
const job: Resolveur = async (id, { client: db, orgId }) => {
  const { data: j } = await db.from('jobs').select('job_number, title, client_name, status').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (!j) return introuvable(L('Job', 'Job'));
  return { libelle: L('Job', 'Job'), valeur: [`#${txt(j.job_number)}`, txt(j.title), txt(j.client_name)].filter(Boolean).join(' · ') };
};
const facture: Resolveur = async (id, { client: db, orgId }) => {
  const { data: f } = await db.from('invoices').select('invoice_number, total_cents, balance_cents, status, client_name_snapshot')
    .eq('org_id', orgId).eq('id', id).maybeSingle();
  if (!f) return introuvable(L('Facture', 'Invoice'));
  const tot = Number(f.total_cents) || 0; const sol = Number(f.balance_cents) || 0;
  return {
    libelle: L('Facture', 'Invoice'),
    valeur: [`#${txt(f.invoice_number)}`, txt(f.client_name_snapshot), `total ${argentFr(tot)}`, `solde ${argentFr(sol)}`, txt(f.status)].filter(Boolean).join(' · '),
    valeur_en: [`#${txt(f.invoice_number)}`, txt(f.client_name_snapshot), `total ${argentEn(tot)}`, `balance ${argentEn(sol)}`, txt(f.status)].filter(Boolean).join(' · '),
  };
};
const devis: Resolveur = async (id, { client: db, orgId }) => {
  const { data: q } = await db.from('quotes').select('quote_number, title, total_cents, status, client_id').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (!q) return introuvable(L('Devis', 'Quote'));
  const { data: c } = estUuid(q.client_id)
    ? await db.from('clients').select('first_name, last_name, company, display_as_company').eq('org_id', orgId).eq('id', q.client_id).maybeSingle()
    : { data: null };
  const tot = Number(q.total_cents) || 0;
  return {
    libelle: L('Devis', 'Quote'),
    valeur: [`#${txt(q.quote_number)}`, txt(q.title), nomPersonne(c), argentFr(tot), txt(q.status)].filter(Boolean).join(' · '),
    valeur_en: [`#${txt(q.quote_number)}`, txt(q.title), nomPersonne(c), argentEn(tot), txt(q.status)].filter(Boolean).join(' · '),
  };
};
const paiement: Resolveur = async (id, { client: db, orgId }, fuseau) => {
  const { data: p } = await db.from('payments').select('amount_cents, refunded_cents, paid_at, method, provider, invoice_id')
    .eq('org_id', orgId).eq('id', id).maybeSingle();
  if (!p) return introuvable(L('Paiement', 'Payment'));
  const { data: f } = estUuid(p.invoice_id)
    ? await db.from('invoices').select('invoice_number, client_name_snapshot').eq('org_id', orgId).eq('id', p.invoice_id).maybeSingle()
    : { data: null };
  const m = Number(p.amount_cents) || 0; const r = Number(p.refunded_cents) || 0;
  const quand = p.paid_at ? dateLocale(String(p.paid_at), fuseau, 'fr') : '';
  return {
    libelle: L('Paiement', 'Payment'),
    valeur: [argentFr(m), quand, txt(p.method || p.provider), f ? `facture #${txt(f.invoice_number)}` : '', txt(f?.client_name_snapshot), r > 0 ? `déjà remboursé ${argentFr(r)}` : ''].filter(Boolean).join(' · '),
    valeur_en: [argentEn(m), p.paid_at ? dateLocale(String(p.paid_at), fuseau, 'en') : '', txt(p.method || p.provider), f ? `invoice #${txt(f.invoice_number)}` : '', txt(f?.client_name_snapshot), r > 0 ? `already refunded ${argentEn(r)}` : ''].filter(Boolean).join(' · '),
  };
};
const membre: Resolveur = async (id, { client: db, orgId }) => {
  let { data: m } = await db.from('team_members').select('first_name, last_name, email, role').eq('org_id', orgId).eq('user_id', id).maybeSingle();
  if (!m) ({ data: m } = await db.from('team_members').select('first_name, last_name, email, role').eq('org_id', orgId).eq('id', id).maybeSingle());
  if (!m) return introuvable(L('Membre', 'Member'));
  return { libelle: L('Membre', 'Member'), valeur: [nomPersonne(m), txt(m.email), txt(m.role)].filter(Boolean).join(' · ') };
};
const equipe: Resolveur = async (id, { client: db, orgId }) => {
  const { data: t } = await db.from('teams').select('name').eq('org_id', orgId).eq('id', id).maybeSingle();
  return t ? { libelle: L('Équipe', 'Team'), valeur: txt(t.name) } : introuvable(L('Équipe', 'Team'));
};
const propriete: Resolveur = async (id, { client: db, orgId }) => {
  const { data: p } = await db.from('properties').select('name, address, city').eq('org_id', orgId).eq('id', id).maybeSingle();
  return p ? { libelle: L('Adresse', 'Property'), valeur: [txt(p.name), txt(p.address), txt(p.city)].filter(Boolean).join(' · ') } : introuvable(L('Adresse', 'Property'));
};
const visite: Resolveur = async (id, { client: db, orgId }, fuseau) => {
  const { data: v } = await db.from('schedule_events').select('start_at, start_time, job_id').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (!v) return introuvable(L('Visite', 'Visit'));
  const debut = v.start_at ?? v.start_time;
  const j = estUuid(v.job_id) ? await job(v.job_id, { client: db, orgId, userId: '' }, fuseau) : null;
  return {
    libelle: L('Visite', 'Visit'),
    valeur: [debut ? dateLocale(String(debut), fuseau, 'fr') : '', j?.valeur].filter(Boolean).join(' · '),
    valeur_en: [debut ? dateLocale(String(debut), fuseau, 'en') : '', j?.valeur].filter(Boolean).join(' · '),
  };
};
const tache: Resolveur = async (id, { client: db, orgId }) => {
  const { data: t } = await db.from('tasks').select('title, status').eq('org_id', orgId).eq('id', id).maybeSingle();
  return t ? { libelle: L('Tâche', 'Task'), valeur: [txt(t.title), txt(t.status)].filter(Boolean).join(' · ') } : introuvable(L('Tâche', 'Task'));
};
const automatisation: Resolveur = async (id, { client: db, orgId }) => {
  const { data: a } = await db.from('automation_rules').select('name, trigger_event, is_active').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (!a) return introuvable(L('Automatisation', 'Automation'));
  return { libelle: L('Automatisation', 'Automation'), valeur: [txt(a.name), txt(a.trigger_event), a.is_active ? 'active' : 'en pause'].filter(Boolean).join(' · '), valeur_en: [txt(a.name), txt(a.trigger_event), a.is_active ? 'active' : 'paused'].filter(Boolean).join(' · ') };
};
const service: Resolveur = async (id, { client: db, orgId }) => {
  const { data: s } = await db.from('predefined_services').select('name, default_price_cents').eq('org_id', orgId).eq('id', id).maybeSingle();
  return s ? { libelle: L('Service', 'Service'), valeur: `${txt(s.name)} · ${argentFr(Number(s.default_price_cents) || 0)}`, valeur_en: `${txt(s.name)} · ${argentEn(Number(s.default_price_cents) || 0)}` } : introuvable(L('Service', 'Service'));
};
const invitation: Resolveur = async (id, { client: db, orgId }) => {
  const { data: i } = await db.from('invitations').select('email, role, status').eq('org_id', orgId).eq('id', id).maybeSingle();
  return i ? { libelle: L('Invitation', 'Invitation'), valeur: [txt(i.email), txt(i.role), txt(i.status)].filter(Boolean).join(' · ') } : introuvable(L('Invitation', 'Invitation'));
};
// Le pipeline de ventes vit sur `deals` (étapes de l'entreprise, pipeline_stages) depuis que les
// outils list_deals / update_deal_stage / delete_deal y ont été rebranchés (2026-10-01) : la carte
// montre le client et l'étape ACTUELLE telle qu'elle s'appelle à l'écran. L'ancien tableau
// (pipeline_deals) ne sert plus qu'au porte-à-porte : on y retombe si le deal n'est pas dans `deals`.
const deal: Resolveur = async (id, ctx, fuseau) => {
  const { data: n } = await ctx.client.from('deals').select('title, stage_id, client_id').eq('org_id', ctx.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (n) {
    const { data: e } = estUuid(n.stage_id)
      ? await ctx.client.from('pipeline_stages').select('name_fr, name_en').eq('org_id', ctx.orgId).eq('id', n.stage_id).maybeSingle()
      : { data: null };
    const c = estUuid(n.client_id) ? await client(n.client_id, ctx, fuseau) : null;
    return {
      libelle: L('Deal', 'Deal'),
      valeur: [txt(n.title), c?.valeur, e ? `étape actuelle : ${txt(e.name_fr)}` : ''].filter(Boolean).join(' · '),
      valeur_en: [txt(n.title), c?.valeur, e ? `current stage: ${txt(e.name_en) || txt(e.name_fr)}` : ''].filter(Boolean).join(' · '),
    };
  }
  const { data: d } = await ctx.client.from('pipeline_deals').select('title, stage, client_id, lead_id').eq('org_id', ctx.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (!d) return introuvable(L('Carte du pipeline', 'Pipeline card'));
  const pid = estUuid(d.client_id) ? d.client_id : estUuid(d.lead_id) ? d.lead_id : null;
  const c = pid ? await client(pid, ctx, fuseau) : null;
  return { libelle: L('Carte du pipeline', 'Pipeline card'), valeur: [txt(d.title), c?.valeur, txt(d.stage)].filter(Boolean).join(' · ') };
};
// Taxe : nom et taux ACTUELS, pour voir l'avant → après sur la carte (audit 2026-09-30).
const taxe: Resolveur = async (id, { client: db, orgId }) => {
  const { data: t } = await db.from('tax_configs').select('name, rate, is_active').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (!t) return introuvable(L('Taxe', 'Tax'));
  return { libelle: L('Taxe (actuellement)', 'Tax (currently)'), valeur: `${txt(t.name)} · ${String(t.rate).replace('.', ',')} %${t.is_active ? '' : ' · inactive'}`, valeur_en: `${txt(t.name)} · ${t.rate}%${t.is_active ? '' : ' · inactive'}` };
};

// Modèle (courriel, facture ou devis : même nom d'argument selon l'outil) — trois
// requêtes explicites, la première qui trouve l'identifiant nomme le modèle.
const modele: Resolveur = async (id, { client: db, orgId }) => {
  const { data: c } = await db.from('email_templates').select('name, type, is_active').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (c) return { libelle: L('Modèle de courriel', 'Email template'), valeur: [txt(c.name), txt(c.type), c.is_active === false ? 'inactif' : ''].filter(Boolean).join(' · ') };
  const { data: f } = await db.from('invoice_templates').select('name').eq('org_id', orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (f) return { libelle: L('Modèle de facture', 'Invoice template'), valeur: txt(f.name) };
  const { data: q } = await db.from('quote_templates').select('name').eq('org_id', orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (q) return { libelle: L('Modèle de devis', 'Quote template'), valeur: txt(q.name) };
  return introuvable(L('Modèle', 'Template'));
};
// Rapport planifié : À QUI il part (un rapport financier vers une adresse externe = risque).
const rapport: Resolveur = async (id, { client: db, orgId }) => {
  const { data: r } = await db.from('scheduled_reports').select('recipient_email, frequency, enabled').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (!r) return introuvable(L('Rapport planifié', 'Scheduled report'));
  return { libelle: L('Rapport planifié', 'Scheduled report'), valeur: [txt(r.recipient_email), txt(r.frequency), r.enabled ? 'actif' : 'en pause'].filter(Boolean).join(' · '), valeur_en: [txt(r.recipient_email), txt(r.frequency), r.enabled ? 'active' : 'paused'].filter(Boolean).join(' · ') };
};

// Contrat : le job, le client qui le recevra, son statut.
const contrat: Resolveur = async (id, ctx, fuseau) => {
  const { data: c } = await ctx.client.from('job_agreements').select('job_id, client_id, status').eq('org_id', ctx.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (!c) return introuvable(L('Contrat', 'Contract'));
  const j = estUuid(c.job_id) ? await job(c.job_id, ctx, fuseau) : null;
  const cl = estUuid(c.client_id) ? await client(c.client_id, ctx, fuseau) : null;
  return { libelle: L('Contrat', 'Contract'), valeur: [j?.valeur, cl?.valeur, txt(c.status)].filter(Boolean).join(' · ') };
};
// Facture récurrente : client, objet, fréquence, actif — c'est de l'argent qui part tout seul.
const recurrence: Resolveur = async (id, ctx, fuseau) => {
  const { data: r } = await ctx.client.from('recurring_invoice_schedules').select('client_id, subject, frequency, is_active, auto_send').eq('org_id', ctx.orgId).eq('id', id).maybeSingle();
  if (!r) return introuvable(L('Facture récurrente', 'Recurring invoice'));
  const cl = estUuid(r.client_id) ? await client(r.client_id, ctx, fuseau) : null;
  return {
    libelle: L('Facture récurrente', 'Recurring invoice'),
    valeur: [cl?.valeur, txt(r.subject), txt(r.frequency), r.is_active ? 'active' : 'arrêtée', r.auto_send ? 'envoi automatique' : ''].filter(Boolean).join(' · '),
    valeur_en: [cl?.valeur, txt(r.subject), txt(r.frequency), r.is_active ? 'active' : 'stopped', r.auto_send ? 'auto-send' : ''].filter(Boolean).join(' · '),
  };
};
// Préréglage de devis (stocké dans quote_templates).
const prereglage: Resolveur = async (id, { client: db, orgId }) => {
  const { data: q } = await db.from('quote_templates').select('name').eq('org_id', orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  return q ? { libelle: L('Préréglage', 'Preset'), valeur: txt(q.name) } : introuvable(L('Préréglage', 'Preset'));
};
// Demande reçue d'un formulaire : qui l'a envoyée.
const demande: Resolveur = async (id, { client: db, orgId }) => {
  const { data: d } = await db.from('form_submissions').select('first_name, last_name, company, email, phone, city').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (!d) return introuvable(L('Demande reçue', 'Request'));
  return { libelle: L('Demande reçue', 'Request'), valeur: [nomPersonne(d), txt(d.city), txt(d.phone), txt(d.email)].filter(Boolean).join(' · ') };
};
// Note de l'onglet Notes : son texte (tronqué).
const noteFiche: Resolveur = async (id, { client: db, orgId }) => {
  const { data: n } = await db.from('specific_notes').select('text, entity_type').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (!n) return introuvable(L('Note', 'Note'));
  const t = txt(n.text);
  return { libelle: L('Note', 'Note'), valeur: `« ${t.slice(0, 120)}${t.length > 120 ? '…' : ''} » (${txt(n.entity_type)})` };
};
// Jalon de facturation : libellé et montant.
const jalon: Resolveur = async (id, { client: db, orgId }) => {
  const { data: m } = await db.from('job_billing_milestones').select('label, amount_cents').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (!m) return introuvable(L('Jalon de facturation', 'Billing milestone'));
  const c = Number(m.amount_cents) || 0;
  return { libelle: L('Jalon de facturation', 'Billing milestone'), valeur: `${txt(m.label)} · ${argentFr(c)}`, valeur_en: `${txt(m.label)} · ${argentEn(c)}` };
};
// Groupe de taxes.
const groupeTaxes: Resolveur = async (id, { client: db, orgId }) => {
  const { data: g } = await db.from('tax_groups').select('name, region, is_default').eq('org_id', orgId).eq('id', id).maybeSingle();
  if (!g) return introuvable(L('Groupe de taxes', 'Tax group'));
  return { libelle: L('Groupe de taxes', 'Tax group'), valeur: [txt(g.name), txt(g.region), g.is_default ? 'par défaut actuellement' : ''].filter(Boolean).join(' · ') };
};
// Liste de vérification d'un job.
const listeJob: Resolveur = async (id, ctx, fuseau) => {
  const { data: l } = await ctx.client.from('job_checklists').select('job_id, items').eq('org_id', ctx.orgId).eq('id', id).maybeSingle();
  if (!l) return introuvable(L('Liste de vérification', 'Checklist'));
  const j = estUuid(l.job_id) ? await job(l.job_id, ctx, fuseau) : null;
  const n = Array.isArray(l.items) ? l.items.length : 0;
  return { libelle: L('Liste de vérification', 'Checklist'), valeur: [j?.valeur, `${n} élément(s)`].filter(Boolean).join(' · '), valeur_en: [j?.valeur, `${n} item(s)`].filter(Boolean).join(' · ') };
};

/** Nom d'argument → résolveur. Les identifiants non listés restent signalés comme « élément visé ». */
const RESOLVEURS: Array<[RegExp, Resolveur]> = [
  [/^(client_id|lead_id|keep_client_id|absorb_client_id|customer_id)$/, client],
  [/^job_id$/, job],
  [/^invoice_id$/, facture],
  [/^quote_id$/, devis],
  [/^payment_id$/, paiement],
  [/^(user_id|member_id|employee_id|technician_id|assigned_user_id|assignee_user_id|rep_id|assessment_user_id|challenger_user_id|opponent_user_id|leader_id)$/, membre],
  [/^(team_id|assessment_team_id|assigned_team_id)$/, equipe],
  [/^property_id$/, propriete],
  [/^(visit_id|event_id|schedule_event_id)$/, visite],
  [/^task_id$/, tache],
  [/^(rule_id|automation_id|automation_rule_id)$/, automatisation],
  [/^service_id$/, service],
  [/^invitation_id$/, invitation],
  [/^deal_id$/, deal],
  [/^(tax_id|tax_config_id)$/, taxe],
  [/^template_id$/, modele],
  [/^agreement_id$/, contrat],
  [/^schedule_id$/, recurrence],
  [/^preset_id$/, prereglage],
  [/^submission_id$/, demande],
  [/^note_id$/, noteFiche],
  [/^milestone_id$/, jalon],
  [/^group_id$/, groupeTaxes],
  [/^checklist_id$/, listeJob],
  [/^(report_id|scheduled_report_id)$/, rapport],
];
const resolveurDe = (cle: string) => RESOLVEURS.find(([re]) => re.test(cle))?.[1] ?? null;

/* ── Détails non identifiants ─────────────────────────────────────────── */
const LIBELLES: Record<string, [string, string]> = {
  message_text: ['Message', 'Message'], message: ['Message', 'Message'], body: ['Message', 'Message'], subject: ['Objet', 'Subject'],
  reason: ['Raison', 'Reason'], status: ['Statut', 'Status'], role: ['Rôle', 'Role'], title: ['Titre', 'Title'], name: ['Nom', 'Name'],
  note: ['Note', 'Note'], notes: ['Notes', 'Notes'], email: ['Courriel', 'Email'], to: ['À', 'To'], phone_number: ['Téléphone', 'Phone'],
  start_at: ['Début', 'Start'], end_at: ['Fin', 'End'], date: ['Date', 'Date'], due_date: ['Échéance', 'Due date'],
  is_active: ['Active', 'Active'], permissions: ['Permissions', 'Permissions'], rate: ['Taux', 'Rate'], method: ['Mode', 'Method'],
};
const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function detail(cle: string, v: unknown, fuseau: string): LigneApercu | null {
  if (v === null || v === undefined || v === '') return null;
  const [fr, en] = LIBELLES[cle] ?? [cle.replace(/_cents$/, '').replace(/_dollars$/, '').replace(/_/g, ' '), cle.replace(/_cents$/, '').replace(/_dollars$/, '').replace(/_/g, ' ')];
  const libelle = L(fr.charAt(0).toUpperCase() + fr.slice(1), en.charAt(0).toUpperCase() + en.slice(1));
  if (/_cents$/.test(cle) && typeof v === 'number') return { libelle, valeur: argentFr(v), valeur_en: argentEn(v) };
  if (/(_dollars|^amount)$/.test(cle) && typeof v === 'number') return { libelle, valeur: argentFr(Math.round(v * 100)), valeur_en: argentEn(Math.round(v * 100)) };
  if (typeof v === 'boolean') return { libelle, valeur: v ? 'Oui' : 'Non', valeur_en: v ? 'Yes' : 'No' };
  if (typeof v === 'string' && ISO.test(v)) return { libelle, valeur: dateLocale(v, fuseau, 'fr'), valeur_en: dateLocale(v, fuseau, 'en') };
  if (typeof v === 'object') return { libelle, valeur: JSON.stringify(v) };
  return { libelle, valeur: String(v) };
}

async function fuseauDe(ctx: Ctx): Promise<string> {
  const { data } = await ctx.client.from('company_settings').select('timezone').eq('org_id', ctx.orgId).maybeSingle();
  return txt(data?.timezone) || 'America/Toronto';
}

/**
 * Les cibles qu'un aperçu déclare introuvables (lignes marquées `alerte`), par leur
 * libellé. Vide = tout ce que l'action vise existe. Parcourt tout l'aperçu : chaque
 * genre de carte (action, document, message, fusion) range ses lignes à sa façon.
 */
export function ciblesIntrouvables(apercu: unknown, langue: 'fr' | 'en' = 'fr'): string[] {
  const trouvees: string[] = [];
  const voir = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(voir); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (o.alerte === true && o.libelle && typeof o.libelle === 'object') {
      const lib = o.libelle as { fr?: string; en?: string };
      trouvees.push(String((langue === 'en' ? lib.en : lib.fr) ?? lib.fr ?? ''));
    }
    Object.values(o).forEach(voir);
  };
  voir(apercu);
  return [...new Set(trouvees.filter(Boolean))];
}

/** L'aperçu générique : cibles nommées + détails lisibles. */
export async function apercuAction(args: Record<string, any>, ctx: Ctx): Promise<ApercuAction> {
  const fuseau = await fuseauDe(ctx);
  const cibles: LigneApercu[] = [];
  const details: LigneApercu[] = [];
  for (const [cle, v] of Object.entries(args ?? {})) {
    const res = resolveurDe(cle);
    if (res && estUuid(v)) { cibles.push((await res(v, ctx, fuseau)) ?? introuvable(L(cle, cle))); continue; }
    // Liste d'identifiants (task_ids…) : chaque élément nommé.
    if (Array.isArray(v) && v.every(estUuid) && v.length) {
      const r = resolveurDe(cle.replace(/_ids$/, '_id'));
      for (const id of v.slice(0, 30)) cibles.push(r ? await r(id, ctx, fuseau) ?? introuvable(L(cle, cle)) : { libelle: L('Élément visé', 'Target'), valeur: cle.replace(/_/g, ' ') });
      if (v.length > 30) details.push({ libelle: L('Et encore', 'And'), valeur: `${v.length - 30} autres`, valeur_en: `${v.length - 30} more` });
      continue;
    }
    // Liste d'objets (relances : un client + un texte chacun) : une ligne par élément.
    if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
      for (const [i, el] of v.slice(0, 30).entries()) {
        const morceaux: string[] = [];
        let alerte = false;
        for (const [k, x] of Object.entries(el as Record<string, unknown>)) {
          const r = resolveurDe(k);
          if (r && estUuid(x)) { const l = await r(x, ctx, fuseau); if (l?.alerte) alerte = true; if (l) morceaux.push(l.valeur); continue; }
          const d = detail(k, x, fuseau);
          if (d) morceaux.push(d.valeur);
        }
        details.push({ libelle: L(`${i + 1}.`, `${i + 1}.`), valeur: morceaux.join(' — '), ...(alerte ? { alerte: true } : {}) });
      }
      if (v.length > 30) details.push({ libelle: L('Et encore', 'And'), valeur: `${v.length - 30} autres`, valeur_en: `${v.length - 30} more` });
      continue;
    }
    if (estUuid(v) || /(^|_)id$/.test(cle)) {
      // Identifiant sans résolveur : on dit qu'il y a un élément visé, sans l'inventer.
      if (estUuid(v)) cibles.push({ libelle: L('Élément visé', 'Target'), valeur: cle.replace(/_id$/, '').replace(/_/g, ' ') });
      // Une fiche (client, job, facture, membre…) désignée par autre chose qu'un
      // identifiant — un nom devenu « jean-pierre-gagnon », un numéro introuvable :
      // le modèle l'a inventé. La carte le SIGNALE (audit 2026-09-30, éval des outils).
      else if (res && typeof v === 'string' && v.trim()) cibles.push({ ...introuvable(L(cle.replace(/_id$/, '').replace(/_/g, ' '), cle.replace(/_id$/, '').replace(/_/g, ' '))), valeur: `« ${v.slice(0, 60)} » ne correspond à aucune fiche de l'entreprise`, valeur_en: `“${v.slice(0, 60)}” matches no record in this company` });
      continue;
    }
    const d = detail(cle, v, fuseau);
    if (d) details.push(d);
  }
  return { genre: 'action', cibles, details };
}

/**
 * Texto : le destinataire RÉEL (la fiche client et SON numéro quand un client
 * est donné — c'est ce numéro que l'outil utilise) et le message ENTIER.
 */
export async function apercuTexto(args: Record<string, any>, ctx: Ctx): Promise<{ genre: 'sms'; to: string | null; subject: null; body: string }> {
  const corps = txt(args.message_text ?? args.message ?? args.body);
  if (estUuid(args.client_id)) {
    const { data: c } = await ctx.client.from('clients').select('first_name, last_name, company, display_as_company, phone')
      .eq('org_id', ctx.orgId).eq('id', args.client_id).maybeSingle();
    if (c) return { genre: 'sms', to: [nomPersonne(c), txt(c.phone) || 'aucun numéro sur la fiche'].join(' · '), subject: null, body: corps };
    return { genre: 'sms', to: 'client introuvable dans cette entreprise', subject: null, body: corps };
  }
  const tel = txt(args.phone_number);
  return { genre: 'sms', to: [txt(args.client_name), tel].filter(Boolean).join(' · ') || null, subject: null, body: corps };
}
