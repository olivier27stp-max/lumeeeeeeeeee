/**
 * Ce que la carte dit EN PLUS des arguments : l'effet réel de l'action (inventaire du 2026-10-01).
 * ─────────────────────────────────────────────────────────────────────────
 * L'aperçu générique nomme ce que l'outil REÇOIT. Pour une vingtaine d'outils, l'essentiel
 * n'est pas dans les arguments : un remboursement sans montant est un remboursement complet,
 * un prélèvement vise une carte que personne n'a nommée, une suppression emporte des jobs et
 * des factures, « annule la visite » en choisit une. Ces lignes viennent d'une lecture de la
 * base avec les droits de l'utilisateur (RLS), juste avant la confirmation.
 *
 * Un complément qui échoue ne bloque jamais la carte : il n'ajoute simplement rien.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { argentFr, argentEn, dateLocale, fuseauDe, type LigneApercu } from './apercu-action';
import { computePayPeriod, DEFAULT_PAYROLL_SETTINGS, type PayrollSettings } from '../payroll';

interface Ctx { client: SupabaseClient; orgId: string; userId: string }
type Args = Record<string, unknown>;
type Complement = (args: Args, ctx: Ctx, fuseau: string) => Promise<LigneApercu[]>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const estUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const txt = (v: unknown) => (v == null ? '' : String(v).trim());
const L = (fr: string, en: string) => ({ fr, en });
const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** Compte exact des lignes actives d'une table pour un filtre — 0 si la lecture échoue. */
async function compter(ctx: Ctx, table: string, colonne: string, id: string, sansSupprimes = true): Promise<number> {
  let q = ctx.client.from(table).select('id', { count: 'exact', head: true }).eq('org_id', ctx.orgId).eq(colonne, id);
  if (sansSupprimes) q = q.is('deleted_at', null);
  const { count } = await q;
  return count ?? 0;
}

async function factureEtClient(ctx: Ctx, invoiceId: unknown) {
  if (!estUuid(invoiceId)) return null;
  const { data: f } = await ctx.client.from('invoices').select('client_id, total_cents, paid_cents, balance_cents, status').eq('org_id', ctx.orgId).eq('id', invoiceId).maybeSingle();
  if (!f) return null;
  const { data: c } = estUuid(f.client_id)
    ? await ctx.client.from('clients').select('email, phone').eq('org_id', ctx.orgId).eq('id', f.client_id).maybeSingle()
    : { data: null };
  const solde = Number(f.balance_cents) > 0 ? Number(f.balance_cents) : Math.max(0, Number(f.total_cents) - Number(f.paid_cents || 0));
  return { clientId: estUuid(f.client_id) ? f.client_id : null, solde, courriel: txt(c?.email), telephone: txt(c?.phone) };
}

/** La carte au dossier d'un client : « Visa •••• 4242 (exp. 04/27) », ou l'absence, dite clairement. */
async function carteAuDossier(ctx: Ctx, clientId: string | null, siAbsente: [fr: string, en: string]): Promise<LigneApercu> {
  const libelle = L('Carte au dossier', 'Card on file');
  const { data: p } = clientId
    ? await ctx.client.from('client_payment_profiles').select('card_brand, card_last4, card_exp_month, card_exp_year, payment_method_id')
      .eq('org_id', ctx.orgId).eq('client_id', clientId).is('deleted_at', null).maybeSingle()
    : { data: null };
  if (!p || !p.payment_method_id) return { libelle, valeur: siAbsente[0], valeur_en: siAbsente[1] };
  const marque = txt(p.card_brand) ? txt(p.card_brand).charAt(0).toUpperCase() + txt(p.card_brand).slice(1) : '';
  const exp = p.card_exp_month && p.card_exp_year ? `${String(p.card_exp_month).padStart(2, '0')}/${String(p.card_exp_year).slice(-2)}` : '';
  return {
    libelle,
    valeur: [marque || 'Carte', txt(p.card_last4) ? `•••• ${txt(p.card_last4)}` : '', exp ? `(exp. ${exp})` : ''].filter(Boolean).join(' '),
    valeur_en: [marque || 'Card', txt(p.card_last4) ? `•••• ${txt(p.card_last4)}` : '', exp ? `(exp. ${exp})` : ''].filter(Boolean).join(' '),
  };
}

/** À qui part un envoi, selon le canal : l'adresse, le numéro, ou ce qui manque sur la fiche. */
function destinataire(canal: string, courriel: string, telephone: string): LigneApercu {
  const libelle = L('Envoyé à', 'Sent to');
  if (canal === 'link_only') return { libelle: L('Envoi', 'Sending'), valeur: 'Rien n’est envoyé : le lien est seulement créé', valeur_en: 'Nothing is sent: the link is only created' };
  const fr: string[] = []; const en: string[] = [];
  if (canal === 'email' || canal === 'both') { fr.push(courriel || 'aucun courriel sur la fiche — le courriel ne partira pas'); en.push(courriel || 'no email on the record — the email will not go out'); }
  if (canal === 'sms' || canal === 'both') { fr.push(telephone || 'aucun numéro sur la fiche — le texto ne partira pas'); en.push(telephone || 'no phone number on the record — the text will not go out'); }
  return { libelle, valeur: fr.join(' · '), valeur_en: en.join(' · ') };
}

/** Les visites actives d'un job, en ordre. */
async function visitesDuJob(ctx: Ctx, jobId: unknown) {
  if (!estUuid(jobId)) return [];
  const { data } = await ctx.client.from('schedule_events').select('id, start_at, status').eq('org_id', ctx.orgId).eq('job_id', jobId).is('deleted_at', null).order('start_at', { ascending: true });
  return (data ?? []) as Array<{ id: string; start_at: string; status: string | null }>;
}

/** Sans visit_id, l'outil vise la PROCHAINE visite à venir non terminée (visiteCible, tools-etendus.ts) : la carte la nomme. */
const visiteVisee: Complement = async (args, ctx, fuseau) => {
  if (estUuid(args.visit_id)) return [];
  const visites = await visitesDuJob(ctx, args.job_id);
  const aVenir = visites.filter((v) => new Date(v.start_at).getTime() >= Date.now() && !['completed', 'cancelled', 'done'].includes(txt(v.status)));
  const libelle = L('Visite visée', 'Visit affected');
  if (!aVenir.length) return visites.length ? [{ libelle, valeur: 'aucune visite à venir sur ce job — il faudra dire laquelle (sa date)', valeur_en: 'no upcoming visit on this job — you will have to say which one (its date)' }] : [];
  const autres = aVenir.length - 1;
  return [{
    libelle,
    valeur: `${dateLocale(aVenir[0].start_at, fuseau, 'fr')} — la prochaine à venir${autres ? ` (${pluriel(autres, 'autre visite à venir reste', 'autres visites à venir restent')} en place)` : ''}`,
    valeur_en: `${dateLocale(aVenir[0].start_at, fuseau, 'en')} — the next upcoming one${autres ? ` (${autres} other upcoming ${autres > 1 ? 'visits stay' : 'visit stays'} in place)` : ''}`,
  }];
};

/** La période de paie visée (celle d'aujourd'hui par défaut) — mêmes réglages que l'écran Paie. */
const periodeDePaie: Complement = async (args, ctx) => {
  const ymd = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(txt(v)) ? txt(v) : undefined);
  let debut = ymd(args.period_start); let fin = ymd(args.period_end); let paie = '';
  if (!debut || !fin) {
    const { data } = await ctx.client.from('payroll_settings').select('pay_period_type, anchor_date, pay_day_offset, timezone').eq('org_id', ctx.orgId).maybeSingle();
    const p = computePayPeriod({ org_id: ctx.orgId, ...(data || DEFAULT_PAYROLL_SETTINGS) } as PayrollSettings, ymd(args.period_ref));
    debut = p.start; fin = p.end; paie = p.payDate;
  }
  const lignes: LigneApercu[] = [{
    libelle: L('Période de paie', 'Pay period'),
    valeur: `du ${debut} au ${fin}${paie ? ` (versée le ${paie})` : ''}`,
    valeur_en: `${debut} to ${fin}${paie ? ` (paid on ${paie})` : ''}`,
  }];
  return lignes;
};

/**
 * Le texte ACTUEL du message qu'on s'apprête à réécrire — la même cible que l'outil
 * (reecrireMessageAutomation, tools-reglages.ts) : les étapes du parcours quand il y en a,
 * sinon la liste d'actions ; le n-ième message de ce type.
 */
const texteActuelAutomatisation = (typeForce?: 'send_sms'): Complement => async (args, ctx) => {
  if (!estUuid(args.rule_id)) return [];
  const { data: regle } = await ctx.client.from('automation_rules').select('actions, steps').eq('org_id', ctx.orgId).eq('id', args.rule_id).maybeSingle();
  if (!regle) return [];
  const type = typeForce ?? (args.action_type === 'send_email' ? 'send_email' : 'send_sms');
  type Action = { type?: string; config?: { body?: unknown; subject?: unknown } };
  const etapes = (Array.isArray(regle.steps) ? regle.steps : []) as Array<{ type?: string; action?: Action }>;
  const actions = (Array.isArray(regle.actions) ? regle.actions : []) as Action[];
  const messages = etapes.length
    ? etapes.flatMap((e) => (e?.type === 'action' && e.action?.type === type ? [e.action] : []))
    : actions.filter((a) => a?.type === type);
  const libelle = L('Texte actuel', 'Current text');
  if (!messages.length) return [{ libelle, valeur: `cette automatisation n’envoie pas de ${type === 'send_sms' ? 'texto' : 'courriel'} — rien à réécrire`, valeur_en: `this automation sends no ${type === 'send_sms' ? 'text message' : 'email'} — nothing to rewrite` }];
  const numero = Number.isInteger(args.message_number) && Number(args.message_number) > 0 ? Number(args.message_number) : null;
  if (messages.length > 1 && !numero) return [{ libelle, valeur: `cette automatisation envoie ${messages.length} messages de ce type — il faudra dire lequel`, valeur_en: `this automation sends ${messages.length} messages of this type — you will have to say which one` }];
  const cible = messages[(numero ?? 1) - 1];
  if (!cible) return [];
  const lignes: LigneApercu[] = [];
  const objet = txt(cible.config?.subject);
  if (type === 'send_email' && objet && args.subject !== undefined) lignes.push({ libelle: L('Objet actuel', 'Current subject'), valeur: objet });
  lignes.push({ libelle, valeur: txt(cible.config?.body) || '(vide)', ...(txt(cible.config?.body) ? {} : { valeur_en: '(empty)' }) });
  return lignes;
};

const COMPLEMENTS: Record<string, Complement> = {
  refund_payment: async (args, ctx) => {
    if (!estUuid(args.payment_id)) return [];
    const { data: p } = await ctx.client.from('payments').select('amount_cents, refunded_cents').eq('org_id', ctx.orgId).eq('id', args.payment_id).maybeSingle();
    if (!p) return [];
    const total = Number(p.amount_cents) || 0;
    const reste = Math.max(0, total - (Number(p.refunded_cents) || 0));
    const demande = typeof args.amount_cents === 'number' ? Math.round(args.amount_cents) : null;
    if (demande == null || demande >= reste) {
      return [{ libelle: L('Somme remboursée', 'Amount refunded'), valeur: `${argentFr(reste)} — remboursement COMPLET, la facture redevient due`, valeur_en: `${argentEn(reste)} — FULL refund, the invoice becomes due again` }];
    }
    return [{ libelle: L('Somme remboursée', 'Amount refunded'), valeur: `${argentFr(demande)} sur ${argentFr(total)} — remboursement partiel, le paiement reste enregistré`, valeur_en: `${argentEn(demande)} of ${argentEn(total)} — partial refund, the payment stays on record` }];
  },

  charge_card_on_file: async (args, ctx) => {
    const f = await factureEtClient(ctx, args.invoice_id);
    if (!f) return [];
    return [
      { libelle: L('Somme prélevée', 'Amount charged'), valeur: `${argentFr(f.solde)} — le solde de la facture`, valeur_en: `${argentEn(f.solde)} — the invoice balance` },
      await carteAuDossier(ctx, f.clientId, ['aucune carte au dossier pour ce client — le prélèvement sera refusé', 'no card on file for this client — the charge will be refused']),
    ];
  },

  remove_card_on_file: async (args, ctx) =>
    (estUuid(args.client_id) ? [await carteAuDossier(ctx, args.client_id, ['ce client n’a pas de carte au dossier — rien à retirer', 'this client has no card on file — nothing to remove'])] : []),

  record_invoice_payment: async (args, ctx) => {
    const f = await factureEtClient(ctx, args.invoice_id);
    const montant = typeof args.amount_cents === 'number' ? Math.round(args.amount_cents) : null;
    if (!f || montant == null) return [];
    const apres = f.solde - montant;
    if (apres < 0) return [{ libelle: L('Solde après ce paiement', 'Balance after this payment'), valeur: `le montant dépasse le solde restant (${argentFr(f.solde)}) — il sera refusé`, valeur_en: `the amount is above the remaining balance (${argentEn(f.solde)}) — it will be refused` }];
    return [{ libelle: L('Solde après ce paiement', 'Balance after this payment'), valeur: argentFr(apres), valeur_en: argentEn(apres) }];
  },

  create_payment_request: async (args, ctx) => {
    const f = await factureEtClient(ctx, args.invoice_id);
    if (!f) return [];
    const canal = ['email', 'sms', 'both', 'link_only'].includes(txt(args.send_via)) ? txt(args.send_via) : 'link_only';
    return [
      { libelle: L('Montant demandé', 'Amount requested'), valeur: `${argentFr(f.solde)} — le solde de la facture`, valeur_en: `${argentEn(f.solde)} — the invoice balance` },
      destinataire(canal, f.courriel, f.telephone),
    ];
  },

  resend_payment_request: async (args, ctx) => {
    const f = await factureEtClient(ctx, args.invoice_id);
    if (!f) return [];
    const precise = ['email', 'sms', 'both'].includes(txt(args.send_via));
    const lignes = [destinataire(precise ? txt(args.send_via) : 'email', f.courriel, f.telephone)];
    // Sans canal précisé, l'outil envoie par courriel : la carte le dit, l'argument n'y est pas.
    if (!precise) lignes.unshift({ libelle: L('Envoyer par', 'Send by'), valeur: 'Courriel (par défaut)', valeur_en: 'Email (default)' });
    return lignes;
  },

  send_quote_sms: async (args, ctx) => {
    if (!estUuid(args.quote_id)) return [];
    const { data: q } = await ctx.client.from('quotes').select('client_id, lead_id').eq('org_id', ctx.orgId).eq('id', args.quote_id).maybeSingle();
    if (!q) return [];
    // Même ordre que la route /quotes/send-sms : le numéro du client, sinon celui du prospect.
    let telephone = '';
    for (const id of [q.client_id, q.lead_id]) {
      if (telephone || !estUuid(id)) continue;
      const { data: c } = await ctx.client.from('clients').select('phone').eq('org_id', ctx.orgId).eq('id', id).maybeSingle();
      telephone = txt(c?.phone);
    }
    return [
      { libelle: L('Texto envoyé au', 'Text sent to'), valeur: telephone || 'aucun numéro sur la fiche — le texto ne partira pas', valeur_en: telephone || 'no phone number on the record — the text will not go out' },
      { libelle: L('Contenu', 'Content'), valeur: 'le lien de consultation du devis, avec le texte habituel de l’entreprise', valeur_en: 'the link to view the quote, with the company’s usual wording' },
    ];
  },

  delete_client: async (args, ctx) => {
    if (!estUuid(args.client_id)) return [];
    const [jobs, devis, factures, deals] = await Promise.all([
      compter(ctx, 'jobs', 'client_id', args.client_id), compter(ctx, 'quotes', 'client_id', args.client_id),
      compter(ctx, 'invoices', 'client_id', args.client_id), compter(ctx, 'deals', 'client_id', args.client_id),
    ]);
    const fr = [jobs && pluriel(jobs, 'job', 'jobs'), devis && pluriel(devis, 'devis', 'devis'), factures && pluriel(factures, 'facture', 'factures'), deals && pluriel(deals, 'deal du pipeline', 'deals du pipeline')].filter(Boolean);
    const en = [jobs && pluriel(jobs, 'job', 'jobs'), devis && pluriel(devis, 'quote', 'quotes'), factures && pluriel(factures, 'invoice', 'invoices'), deals && pluriel(deals, 'pipeline deal', 'pipeline deals')].filter(Boolean);
    return [{ libelle: L('Supprimés avec le client', 'Deleted with the client'), valeur: fr.length ? fr.join(', ') : 'rien d’autre : aucun job, devis ni facture à son nom', valeur_en: en.length ? en.join(', ') : 'nothing else: no job, quote or invoice under their name' }];
  },

  delete_lead: async (args, ctx) => {
    if (!estUuid(args.lead_id)) return [];
    const [parClient, parProspect, deals] = await Promise.all([
      compter(ctx, 'quotes', 'client_id', args.lead_id), compter(ctx, 'quotes', 'lead_id', args.lead_id), compter(ctx, 'deals', 'client_id', args.lead_id),
    ]);
    const devis = Math.max(parClient, parProspect);
    const fr = [devis && pluriel(devis, 'devis', 'devis'), deals && pluriel(deals, 'deal du pipeline', 'deals du pipeline')].filter(Boolean);
    const en = [devis && pluriel(devis, 'quote', 'quotes'), deals && pluriel(deals, 'pipeline deal', 'pipeline deals')].filter(Boolean);
    return [{ libelle: L('Supprimés avec le prospect', 'Deleted with the lead'), valeur: fr.length ? fr.join(', ') : 'rien d’autre : aucun devis ni deal à son nom', valeur_en: en.length ? en.join(', ') : 'nothing else: no quote or deal under their name' }];
  },

  delete_job: async (args, ctx) => {
    const visites = await visitesDuJob(ctx, args.job_id);
    if (!visites.length) return [];
    return [{ libelle: L('Retirées du calendrier', 'Removed from the calendar'), valeur: pluriel(visites.length, 'visite', 'visites'), valeur_en: pluriel(visites.length, 'visit', 'visits') }];
  },

  unschedule_job: async (args, ctx, fuseau) => {
    if (estUuid(args.event_id)) return [];
    const visites = await visitesDuJob(ctx, args.job_id);
    if (!visites.length) return [{ libelle: L('Visites retirées', 'Visits removed'), valeur: 'ce job n’a aucune visite au calendrier — rien à retirer', valeur_en: 'this job has no visit on the calendar — nothing to remove' }];
    const dates = (langue: 'fr' | 'en') => visites.slice(0, 5).map((v) => dateLocale(v.start_at, fuseau, langue)).join(' ; ') + (visites.length > 5 ? ' ; …' : '');
    return [{ libelle: L('Visites retirées', 'Visits removed'), valeur: `TOUTES — ${pluriel(visites.length, 'visite', 'visites')} : ${dates('fr')}`, valeur_en: `ALL — ${pluriel(visites.length, 'visit', 'visits')}: ${dates('en')}` }];
  },

  cancel_visit: visiteVisee,
  reschedule_job: visiteVisee,

  delete_team: async (args, ctx) => {
    if (!estUuid(args.team_id)) return [];
    const [membres, jobs] = await Promise.all([compter(ctx, 'memberships', 'team_id', args.team_id, false), compter(ctx, 'jobs', 'team_id', args.team_id)]);
    return [{
      libelle: L('Détachés de l’équipe', 'Detached from the team'),
      valeur: `${pluriel(membres, 'membre', 'membres')} et ${pluriel(jobs, 'job', 'jobs')} — conservés, mais plus rattachés à aucune équipe`,
      valeur_en: `${pluriel(membres, 'member', 'members')} and ${pluriel(jobs, 'job', 'jobs')} — kept, but no longer attached to any team`,
    }];
  },

  set_default_availability: async () => [{
    libelle: L('Effet', 'Effect'),
    valeur: 'TOUTES les plages actuelles de l’équipe sont remplacées par lundi à vendredi, 8 h à 17 h',
    valeur_en: 'ALL of the team’s current windows are replaced by Monday to Friday, 8 am to 5 pm',
  }],

  set_hourly_rate: async (args, ctx) => {
    if (!estUuid(args.user_id)) return [];
    const [{ data: fiche }, { data: remunerations, error }] = await Promise.all([
      ctx.client.from('team_members').select('id').eq('org_id', ctx.orgId).eq('user_id', args.user_id).limit(1),
      ctx.client.rpc('membres_remuneration', { p_org: ctx.orgId }),
    ]);
    // Taux illisibles pour ce rôle (grants par colonne) : on ne dit rien plutôt que « aucun taux ».
    if (error) return [];
    const avant = fiche?.length ? ((remunerations ?? []) as Array<{ team_member_id: string; hourly_rate_cents: number | null }>).find((r) => r.team_member_id === fiche[0].id) : undefined;
    const taux = avant ? Number(avant.hourly_rate_cents) || 0 : 0;
    return [{ libelle: L('Taux actuel', 'Current rate'), valeur: taux > 0 ? `${argentFr(taux)} de l’heure` : 'aucun taux enregistré', valeur_en: taux > 0 ? `${argentEn(taux)} per hour` : 'no rate on record' }];
  },

  update_automation_message: texteActuelAutomatisation(),
  update_automation_sms_body: texteActuelAutomatisation('send_sms'),

  // La liste REMPLACE l'échéancier : un jalon existant absent de la liste est supprimé.
  save_job_billing_milestones: async (args, ctx) => {
    if (!estUuid(args.job_id) || !Array.isArray(args.milestones)) return [];
    const { data } = await ctx.client.from('job_billing_milestones').select('id, label, amount_cents').eq('org_id', ctx.orgId).eq('job_id', args.job_id).order('position', { ascending: true });
    const gardes = new Set((args.milestones as Array<{ id?: unknown }>).map((m) => txt(m?.id)).filter(Boolean));
    const supprimes = ((data ?? []) as Array<{ id: string; label: string; amount_cents: number }>).filter((j) => !gardes.has(j.id));
    if (!supprimes.length) return [];
    return [{
      libelle: L('Jalons supprimés', 'Milestones deleted'),
      valeur: supprimes.map((j) => `${txt(j.label)} (${argentFr(Number(j.amount_cents) || 0)})`).join(', '),
      valeur_en: supprimes.map((j) => `${txt(j.label)} (${argentEn(Number(j.amount_cents) || 0)})`).join(', '),
    }];
  },

  // Un changement de rôle s'applique tout de suite à tous les membres de ce rôle.
  update_role_preset: async (args, ctx) => {
    const role = txt(args.role);
    if (!role) return [];
    const { count } = await ctx.client.from('memberships').select('user_id', { count: 'exact', head: true }).eq('org_id', ctx.orgId).eq('role', role).eq('status', 'active');
    const n = count ?? 0;
    return [{
      libelle: L('Membres touchés', 'Members affected'),
      valeur: n ? `${pluriel(n, 'membre actif a', 'membres actifs ont')} ce rôle — le changement s’applique tout de suite (sauf permissions sur mesure)` : 'aucun membre actif n’a ce rôle pour l’instant',
      valeur_en: n ? `${n} active ${n > 1 ? 'members have' : 'member has'} this role — the change applies right away (except custom permissions)` : 'no active member has this role yet',
    }];
  },

  update_member_role: async (args, ctx) => {
    if (!estUuid(args.user_id) || args.role === undefined) return [];
    const { data: m } = await ctx.client.from('memberships').select('role').eq('org_id', ctx.orgId).eq('user_id', args.user_id).maybeSingle();
    if (!m) return [];
    const NOMS: Record<string, [string, string]> = { owner: ['Propriétaire', 'Owner'], admin: ['Administrateur', 'Admin'], sales_rep: ['Représentant', 'Sales rep'], technician: ['Technicien', 'Technician'] };
    const actuel = NOMS[txt(m.role)] ?? [txt(m.role), txt(m.role)];
    return [{
      libelle: L('Rôle actuel', 'Current role'),
      valeur: `${actuel[0]} — ses permissions repartiront du modèle du nouveau rôle`,
      valeur_en: `${actuel[1]} — their permissions will restart from the new role’s preset`,
    }];
  },

  add_payroll_adjustment: periodeDePaie,
  mark_payroll_period_paid: periodeDePaie,
  unmark_payroll_period_paid: periodeDePaie,
};

/** Les outils qui ont un complément — pour les tests de couverture. */
export const OUTILS_AVEC_COMPLEMENT = Object.keys(COMPLEMENTS);

export async function complementsCarte(outil: string, args: Args, ctx: Ctx): Promise<LigneApercu[]> {
  const complement = COMPLEMENTS[outil];
  if (!complement) return [];
  try {
    return await complement(args ?? {}, ctx, await fuseauDe(ctx));
  } catch (err) {
    console.error('[lumi/complement-carte]', outil, err instanceof Error ? err.message : err);
    return [];
  }
}
