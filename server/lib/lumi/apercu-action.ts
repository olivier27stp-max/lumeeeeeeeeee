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
// Les outils du pipeline écrivent dans pipeline_deals (la table `deals` n'a pas de
// colonne statut : la requête échouait et toute carte de deal disait « introuvable »).
const deal: Resolveur = async (id, ctx, fuseau) => {
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

/** Nom d'argument → résolveur. Les identifiants non listés restent signalés comme « élément visé ». */
const RESOLVEURS: Array<[RegExp, Resolveur]> = [
  [/^(client_id|lead_id|keep_client_id|absorb_client_id|customer_id)$/, client],
  [/^job_id$/, job],
  [/^invoice_id$/, facture],
  [/^quote_id$/, devis],
  [/^payment_id$/, paiement],
  [/^(user_id|member_id|employee_id|technician_id|assigned_user_id|assignee_user_id|rep_id|assessment_user_id)$/, membre],
  [/^(team_id|assessment_team_id)$/, equipe],
  [/^property_id$/, propriete],
  [/^(visit_id|event_id|schedule_event_id)$/, visite],
  [/^task_id$/, tache],
  [/^(rule_id|automation_id|automation_rule_id)$/, automatisation],
  [/^service_id$/, service],
  [/^invitation_id$/, invitation],
  [/^deal_id$/, deal],
  [/^(tax_id|tax_config_id)$/, taxe],
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
