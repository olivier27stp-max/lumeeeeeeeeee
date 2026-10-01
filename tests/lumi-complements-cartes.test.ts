/**
 * La carte dit l'effet réel de l'action, pas seulement ses arguments
 * (server/lib/lumi/complements-cartes.ts).
 *
 * Avant : « rembourser un paiement » sans montant ne disait ni la somme ni que c'était un
 * remboursement complet ; « prélever la carte au dossier » ne disait ni quelle carte ni combien ;
 * « supprimer le client » ne disait pas ce qui partait avec lui ; « annuler la visite » ne disait
 * pas laquelle.
 */
import { describe, it, expect } from 'vitest';
import { AGENT_TOOLS } from '../server/lib/agent/tools';
import { complementsCarte, OUTILS_AVEC_COMPLEMENT } from '../server/lib/lumi/complements-cartes';
import { apercuProposition } from '../server/lib/lumi/fiches';

const ORG = '11111111-1111-4111-8111-111111111111';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Ligne = Record<string, unknown>;

/** Un client Supabase de test : des tables en mémoire, les filtres eq/is appliqués pour vrai. */
function base(tables: Record<string, Ligne[]>, rpc: Record<string, unknown> = {}) {
  const requete = (depart: Ligne[]) => {
    let lignes = depart;
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => { lignes = lignes.filter((l) => l[col] === v); return q; },
      is: (col: string, v: unknown) => { lignes = lignes.filter((l) => (l[col] ?? null) === v); return q; },
      order: (col: string) => { lignes = [...lignes].sort((a, b) => String(a[col]).localeCompare(String(b[col]))); return q; },
      limit: () => q,
      maybeSingle: async () => ({ data: lignes[0] ?? null, error: null }),
      then: (ok: (r: { data: Ligne[]; count: number; error: null }) => unknown) => ok({ data: lignes, count: lignes.length, error: null }),
    };
    return q;
  };
  return {
    client: { from: (t: string) => requete((tables[t] ?? []).map((l) => ({ org_id: ORG, ...l }))), rpc: async (nom: string) => ({ data: rpc[nom] ?? null, error: rpc[nom] === undefined ? { message: 'refusé' } : null }) } as never,
    orgId: ORG, userId: id(99),
  };
}
const texte = async (outil: string, args: Ligne, ctx: ReturnType<typeof base>) => (await complementsCarte(outil, args, ctx)).map((l) => `${l.libelle.fr} : ${l.valeur}`).join('\n');
const dans = (jours: number) => new Date(Date.now() + jours * 86_400_000).toISOString();

describe('compléments des cartes de Lumi', () => {
  it('chaque complément vise un outil d’écriture qui existe', () => {
    const ecritures = new Set(AGENT_TOOLS.filter((t) => t.kind === 'write').map((t) => t.declaration.name));
    expect(OUTILS_AVEC_COMPLEMENT.filter((o) => !ecritures.has(o))).toEqual([]);
  });

  it('un remboursement sans montant est annoncé COMPLET, avec la somme', async () => {
    const ctx = base({ payments: [{ id: id(1), amount_cents: 25000, refunded_cents: 0 }] });
    expect(await texte('refund_payment', { payment_id: id(1) }, ctx)).toMatch(/Somme remboursée : 250,00 \$ — remboursement COMPLET, la facture redevient due/);
    expect(await texte('refund_payment', { payment_id: id(1), amount_cents: 5000 }, ctx)).toMatch(/50,00 \$ sur 250,00 \$ — remboursement partiel/);
  });

  it('un remboursement complet ne rend que ce qui n’a pas déjà été remboursé', async () => {
    const ctx = base({ payments: [{ id: id(1), amount_cents: 25000, refunded_cents: 10000 }] });
    expect(await texte('refund_payment', { payment_id: id(1) }, ctx)).toMatch(/150,00 \$ — remboursement COMPLET/);
  });

  it('un prélèvement dit la somme et la carte', async () => {
    const ctx = base({
      invoices: [{ id: id(2), client_id: id(3), total_cents: 40000, paid_cents: 10000, balance_cents: 30000 }],
      clients: [{ id: id(3), email: 'marie@exemple.test', phone: '514-555-0101' }],
      client_payment_profiles: [{ client_id: id(3), card_brand: 'visa', card_last4: '4242', card_exp_month: 4, card_exp_year: 2027, payment_method_id: 'pm_1' }],
    });
    const t = await texte('charge_card_on_file', { invoice_id: id(2) }, ctx);
    expect(t).toMatch(/Somme prélevée : 300,00 \$ — le solde de la facture/);
    expect(t).toMatch(/Carte au dossier : Visa •••• 4242 \(exp\. 04\/27\)/);
  });

  it('sans carte au dossier, la carte le dit avant la confirmation', async () => {
    const ctx = base({ invoices: [{ id: id(2), client_id: id(3), total_cents: 40000, paid_cents: 0, balance_cents: 40000 }], clients: [{ id: id(3) }] });
    expect(await texte('charge_card_on_file', { invoice_id: id(2) }, ctx)).toMatch(/aucune carte au dossier pour ce client — le prélèvement sera refusé/);
    expect(await texte('remove_card_on_file', { client_id: id(3) }, ctx)).toMatch(/pas de carte au dossier — rien à retirer/);
  });

  it('un paiement partiel montre le solde qui restera', async () => {
    const ctx = base({ invoices: [{ id: id(2), client_id: id(3), total_cents: 40000, paid_cents: 10000, balance_cents: 30000 }] });
    expect(await texte('record_invoice_payment', { invoice_id: id(2), amount_cents: 12000 }, ctx)).toMatch(/Solde après ce paiement : 180,00 \$/);
    expect(await texte('record_invoice_payment', { invoice_id: id(2), amount_cents: 50000 }, ctx)).toMatch(/dépasse le solde restant \(300,00 \$\)/);
  });

  it('un lien de paiement dit son montant, et à qui il part ou qu’il ne part pas', async () => {
    const ctx = base({
      invoices: [{ id: id(2), client_id: id(3), total_cents: 40000, paid_cents: 0, balance_cents: 40000 }],
      clients: [{ id: id(3), email: 'marie@exemple.test', phone: '' }],
    });
    const defaut = await texte('create_payment_request', { invoice_id: id(2) }, ctx);
    expect(defaut).toMatch(/Montant demandé : 400,00 \$/);
    expect(defaut).toMatch(/Rien n’est envoyé : le lien est seulement créé/);
    expect(await texte('create_payment_request', { invoice_id: id(2), send_via: 'both' }, ctx)).toMatch(/Envoyé à : marie@exemple\.test · aucun numéro sur la fiche — le texto ne partira pas/);
    expect(await texte('resend_payment_request', { invoice_id: id(2) }, ctx)).toMatch(/Envoyer par : Courriel \(par défaut\)\nEnvoyé à : marie@exemple\.test/);
  });

  it('le texto d’un devis dit le numéro : celui du client, sinon du prospect', async () => {
    const ctx = base({ quotes: [{ id: id(4), client_id: null, lead_id: id(5) }], clients: [{ id: id(5), phone: '438-555-0199' }] });
    expect(await texte('send_quote_sms', { quote_id: id(4) }, ctx)).toMatch(/Texto envoyé au : 438-555-0199/);
  });

  it('supprimer un client annonce ce qui part avec lui', async () => {
    const ctx = base({
      jobs: [{ id: id(6), client_id: id(3) }, { id: id(7), client_id: id(3) }, { id: id(8), client_id: id(3), deleted_at: '2026-01-01' }],
      quotes: [{ id: id(9), client_id: id(3) }], invoices: [{ id: id(10), client_id: id(3) }, { id: id(11), client_id: id(3) }, { id: id(12), client_id: id(3) }],
    });
    expect(await texte('delete_client', { client_id: id(3) }, ctx)).toBe('Supprimés avec le client : 2 jobs, 1 devis, 3 factures');
    expect(await texte('delete_client', { client_id: id(50) }, ctx)).toMatch(/rien d’autre/);
  });

  it('« annule la visite » nomme la prochaine visite à venir, jamais une passée', async () => {
    const ctx = base({ schedule_events: [
      { id: id(20), job_id: id(6), start_at: dans(-3), status: 'completed' },
      { id: id(21), job_id: id(6), start_at: dans(2), status: 'scheduled' },
      { id: id(22), job_id: id(6), start_at: dans(9), status: 'scheduled' },
    ] });
    expect(await texte('cancel_visit', { job_id: id(6) }, ctx)).toMatch(/Visite visée : .* — la prochaine à venir \(1 autre visite à venir reste en place\)/);
    expect(await texte('reschedule_job', { job_id: id(6), visit_id: id(20) }, ctx)).toBe('');
    const passee = base({ schedule_events: [{ id: id(20), job_id: id(6), start_at: dans(-3), status: 'completed' }] });
    expect(await texte('cancel_visit', { job_id: id(6) }, passee)).toMatch(/aucune visite à venir/);
  });

  it('retirer un job du calendrier dit que TOUTES ses visites partent', async () => {
    const ctx = base({ schedule_events: [{ id: id(21), job_id: id(6), start_at: dans(2) }, { id: id(22), job_id: id(6), start_at: dans(9) }] });
    expect(await texte('unschedule_job', { job_id: id(6) }, ctx)).toMatch(/Visites retirées : TOUTES — 2 visites/);
    expect(await texte('unschedule_job', { job_id: id(6), event_id: id(21) }, ctx)).toBe('');
    expect(await texte('delete_job', { job_id: id(6) }, ctx)).toBe('Retirées du calendrier : 2 visites');
  });

  it('la paie dit la période visée', async () => {
    const ctx = base({ payroll_settings: [{ pay_period_type: 'weekly', anchor_date: '2026-01-05', pay_day_offset: 5, timezone: 'America/Toronto' }] });
    expect(await texte('mark_payroll_period_paid', { user_id: id(30), period_ref: '2026-09-30' }, ctx)).toMatch(/Période de paie : du 2026-09-28 au 2026-10-04/);
    expect(await texte('add_payroll_adjustment', { user_id: id(30), amount_cents: 5000, period_start: '2026-09-01', period_end: '2026-09-15' }, ctx)).toBe('Période de paie : du 2026-09-01 au 2026-09-15');
  });

  it('le taux horaire actuel se voit ; illisible pour ce rôle, la carte ne dit rien de faux', async () => {
    const tables = { team_members: [{ id: id(31), user_id: id(30) }] };
    expect(await texte('set_hourly_rate', { user_id: id(30), hourly_rate_cents: 2800 }, base(tables, { membres_remuneration: [{ team_member_id: id(31), hourly_rate_cents: 2500 }] }))).toBe('Taux actuel : 25,00 $ de l’heure');
    expect(await texte('set_hourly_rate', { user_id: id(30), hourly_rate_cents: 2800 }, base(tables))).toBe('');
  });

  it('réécrire un message d’automatisation montre le texte qu’on remplace', async () => {
    const etapes = [
      { type: 'action', action: { type: 'send_sms', config: { body: 'Rappel : visite demain.' } } },
      { type: 'attente' },
      { type: 'action', action: { type: 'send_sms', config: { body: 'Merci pour votre confiance !' } } },
      { type: 'action', action: { type: 'send_email', config: { subject: 'Votre visite', body: 'Bonjour, à demain.' } } },
    ];
    const ctx = base({ automation_rules: [{ id: id(40), steps: etapes, actions: [{ type: 'send_sms', config: { body: 'reflet périmé' } }] }] });
    expect(await texte('update_automation_sms_body', { rule_id: id(40), body: 'x', message_number: 2 }, ctx)).toBe('Texte actuel : Merci pour votre confiance !');
    expect(await texte('update_automation_sms_body', { rule_id: id(40), body: 'x' }, ctx)).toMatch(/envoie 2 messages de ce type — il faudra dire lequel/);
    expect(await texte('update_automation_message', { rule_id: id(40), action_type: 'send_email', body: 'x', subject: 'y' }, ctx)).toBe('Objet actuel : Votre visite\nTexte actuel : Bonjour, à demain.');
    const sansEtapes = base({ automation_rules: [{ id: id(41), steps: [], actions: [{ type: 'send_sms', config: { body: 'Ancien texte' } }] }] });
    expect(await texte('update_automation_message', { rule_id: id(41), action_type: 'send_sms', body: 'x' }, sansEtapes)).toBe('Texte actuel : Ancien texte');
    expect(await texte('update_automation_message', { rule_id: id(41), action_type: 'send_email', body: 'x' }, sansEtapes)).toMatch(/n’envoie pas de courriel/);
  });

  it('un échéancier remplacé annonce les jalons qui disparaissent', async () => {
    const ctx = base({ job_billing_milestones: [
      { id: id(50), job_id: id(6), position: 0, label: 'Dépôt', amount_cents: 20000 },
      { id: id(51), job_id: id(6), position: 1, label: 'Fin des travaux', amount_cents: 80000 },
    ] });
    expect(await texte('save_job_billing_milestones', { job_id: id(6), milestones: [{ id: id(50), label: 'Dépôt', amount_cents: 30000 }, { label: 'Solde', amount_cents: 70000 }] }, ctx)).toBe('Jalons supprimés : Fin des travaux (800,00 $)');
    expect(await texte('save_job_billing_milestones', { job_id: id(6), milestones: [{ id: id(50), label: 'a', amount_cents: 1 }, { id: id(51), label: 'b', amount_cents: 1 }] }, ctx)).toBe('');
  });

  it('un changement de rôle dit combien de membres il touche, et le rôle qu’on quitte', async () => {
    const ctx = base({ memberships: [
      { user_id: id(60), role: 'technician', status: 'active' }, { user_id: id(61), role: 'technician', status: 'active' },
      { user_id: id(62), role: 'technician', status: 'suspended' }, { user_id: id(63), role: 'sales_rep', status: 'active' },
    ] });
    expect(await texte('update_role_preset', { role: 'technician', permissions: {} }, ctx)).toMatch(/Membres touchés : 2 membres actifs ont ce rôle/);
    expect(await texte('update_role_preset', { role: 'admin', permissions: {} }, ctx)).toMatch(/aucun membre actif/);
    expect(await texte('update_member_role', { user_id: id(63), role: 'admin' }, ctx)).toMatch(/Rôle actuel : Représentant/);
  });

  it('un outil sans complément, ou une lecture qui plante, n’ajoute rien et ne bloque rien', async () => {
    expect(await complementsCarte('create_task', { title: 'x' }, base({}))).toEqual([]);
    const casse = { client: { from: () => { throw new Error('panne'); } } as never, orgId: ORG, userId: id(99) };
    expect(await complementsCarte('delete_client', { client_id: id(3) }, casse)).toEqual([]);
  });

  it('le complément arrive sur la carte proposée', async () => {
    const ctx = base({ payments: [{ id: id(1), amount_cents: 25000, refunded_cents: 0 }] });
    const carte = await apercuProposition('refund_payment', { payment_id: id(1) }, ctx as never);
    expect(JSON.stringify(carte)).toMatch(/remboursement COMPLET/);
  });
});

describe('la carte annonce les automatisations que l’action va déclencher', () => {
  const regles = [
    { id: id(100), name: 'Demande d’avis', trigger_event: 'job.completed', is_active: true, steps: [{ type: 'attente' }, { type: 'action', action: { type: 'request_review' } }, { type: 'action', action: { type: 'send_sms' } }], actions: [] },
    { id: id(101), name: 'Tâche interne', trigger_event: 'job.completed', is_active: true, steps: [], actions: [{ type: 'create_task' }] },
    { id: id(102), name: 'Ancienne relance', trigger_event: 'job.completed', is_active: false, steps: [], actions: [{ type: 'send_email' }] },
    { id: id(103), name: 'Confirmation de visite', trigger_event: 'appointment.created', is_active: true, steps: [], actions: [{ type: 'send_email' }] },
    { id: id(104), name: 'Supprimée', trigger_event: 'appointment.created', is_active: true, deleted_at: '2026-01-01', steps: [], actions: [{ type: 'send_sms' }] },
  ];

  it('terminer un job nomme les automatisations actives qui écrivent au client, pas les autres', async () => {
    const t = await texte('update_job_status', { job_id: id(6), status: 'completed' }, base({ automation_rules: regles }));
    expect(t).toBe('Automatisations déclenchées : « Demande d’avis » (demande d’avis, texto au client) — si leurs conditions sont remplies');
  });

  it('un autre statut ne déclenche rien ; une visite planifiée annonce la confirmation', async () => {
    expect(await texte('update_job_status', { job_id: id(6), status: 'in_progress' }, base({ automation_rules: regles }))).toBe('');
    expect(await texte('add_visit', { job_id: id(6) }, base({ automation_rules: regles }))).toMatch(/« Confirmation de visite » \(courriel au client\)/);
    expect(await texte('add_visit', { job_id: id(6) }, base({ automation_rules: regles }))).not.toMatch(/Supprimée/);
  });

  it('entreprise en pause : la carte dit que rien ne part pour l’instant', async () => {
    const ctx = base({ automation_rules: regles, company_settings: [{ automations_paused: true }] });
    expect(await texte('update_job_status', { job_id: id(6), status: 'completed' }, ctx)).toMatch(/aucune pour l’instant : toutes les automatisations sont arrêtées/);
  });

  it('annuler une visite garde la visite visée ET annonce les automatisations', async () => {
    const ctx = base({
      schedule_events: [{ id: id(21), job_id: id(6), start_at: dans(2), status: 'scheduled' }],
      automation_rules: [{ id: id(105), name: 'Avis d’annulation', trigger_event: 'appointment.cancelled', is_active: true, steps: [], actions: [{ type: 'send_sms' }] }],
    });
    const t = await texte('cancel_visit', { job_id: id(6) }, ctx);
    expect(t).toMatch(/^Visite visée : /);
    expect(t).toMatch(/Automatisations déclenchées : « Avis d’annulation » \(texto au client\)/);
  });

  it('aucune automatisation sur l’événement : aucune ligne', async () => {
    expect(await texte('schedule_job', { job_id: id(6) }, base({}))).toBe('');
  });
});

describe('cartes des outils ajoutés le 2026-10-01', () => {
  it('une automatisation créée depuis un modèle dit lequel, et qu’elle naît éteinte', async () => {
    const { MODELES_AUTOMATISATION } = await import('../server/lib/automationTemplates');
    const modele = MODELES_AUTOMATISATION[0];
    const t = await texte('create_automation_from_template', { template_key: modele.id }, base({}));
    expect(t).toContain(`Modèle : ${modele.nom.fr}`);
    expect(t).toMatch(/État à la création : brouillon, éteinte/);
    expect(await texte('create_automation_from_template', { template_key: 'modele_invente' }, base({}))).toMatch(/n’existe pas dans la bibliothèque/);
  });

  it('« tout arrêter » dit combien d’automatisations sont touchées, et la reprise que des messages repartent', async () => {
    const ctx = base({ automation_rules: [{ id: id(70), is_active: true }, { id: id(71), is_active: true }, { id: id(72), is_active: false }, { id: id(73), is_active: true, deleted_at: '2026-01-01' }] });
    expect(await texte('pause_all_automations', { paused: true }, ctx)).toMatch(/plus aucun message automatique ne part \(2 automatisations actives\)/);
    expect(await texte('pause_all_automations', { paused: false }, ctx)).toMatch(/les messages qui attendaient repartent/);
  });

  it('supprimer une automatisation annonce les envois prévus qui tombent', async () => {
    const ctx = base({ automation_scheduled_tasks: [{ id: id(80), automation_rule_id: id(70), status: 'pending' }, { id: id(81), automation_rule_id: id(70), status: 'pending' }, { id: id(82), automation_rule_id: id(70), status: 'completed' }] });
    expect(await texte('delete_automation_rule', { rule_id: id(70) }, ctx)).toBe('Envois prévus annulés : 2 envois en attente');
    expect(await texte('delete_automation_rule', { rule_id: id(71) }, ctx)).toBe('Envois prévus annulés : aucun envoi en attente');
  });

  it('la carte nomme l’entrée de temps, la commission et l’élément archivé', async () => {
    const { apercuAction } = await import('../server/lib/lumi/apercu-action');
    const ctx = base({
      time_entries: [{ id: id(90), employee_name: 'Zoé Roy', date: '2026-09-30', punch_in: '08:02:11', punch_out: null }],
      fs_commission_entries: [{ id: id(91), user_id: id(60), amount: 125.5, status: 'pending', description: 'Vente Tremblay' }],
      team_members: [{ user_id: id(60), first_name: 'Luc', last_name: 'Roy', email: 'l@x.ca', role: 'sales_rep' }],
      jobs: [{ id: id(92), job_number: 44, title: 'Lavage', client_name: 'Marie Tremblay' }],
    });
    const cible = async (args: Ligne, outil: string) => (await apercuAction(args, ctx, outil)).cibles[0];
    expect((await cible({ entry_id: id(90) }, 'force_punch_out')).valeur).toBe('Zoé Roy · 2026-09-30 · 08:02 → pointage encore ouvert');
    expect((await cible({ commission_id: id(91) }, 'approve_commission')).valeur).toBe('125,50 $ · Luc Roy · l@x.ca · représentant · Vente Tremblay · en attente');
    const archive = await cible({ entity_type: 'job', entity_id: id(92) }, 'restore_archived');
    expect(archive.libelle.fr).toBe('Job archivé');
    expect(archive.valeur).toMatch(/#44 · Lavage · Marie Tremblay/);
    expect((await cible({ entity_type: 'client', entity_id: id(93) }, 'restore_archived')).alerte).toBe(true);
  });

  it('le rabais et le dépôt d’un devis portent leur unité', async () => {
    const { apercuAction } = await import('../server/lib/lumi/apercu-action');
    const a = await apercuAction({ discount_type: 'percentage', discount_value: 10, deposit_required: true, deposit_type: 'fixed', deposit_value: 150 }, base({}), 'set_quote_discount_deposit');
    const lignes = a.details.map((d) => `${d.libelle.fr} : ${d.valeur}`);
    expect(lignes).toContain('Rabais : 10 %');
    expect(lignes).toContain('Type de rabais : Pourcentage');
    expect(lignes.find((l) => l.startsWith('Montant du dépôt') || l.includes('150,00'))).toMatch(/150,00 \$/);
  });
});
