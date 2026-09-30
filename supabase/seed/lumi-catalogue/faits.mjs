/**
 * Faits attendus du catalogue, CALCULÉS à partir de donnees.mjs.
 * ─────────────────────────────────────────────────────────────────────────
 * Chaque chiffre du catalogue (CATALOGUE_TACHES_LUMI.md / .json) vient d'ici :
 * `node supabase/seed/lumi-catalogue/generer-catalogue.mjs` les injecte dans les
 * tâches, et seed.mjs les recompare à la base après chaque seed (verificationsSql).
 * Montants en cents ; `argent(c)` les formate comme Lumi doit les dire.
 */
import { BUREAUX, PERSONNES, CLIENTS, client, nomClient, iso, plusJours, taxes } from './donnees.mjs';

export const argent = (c) => `${(c / 100).toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ | /g, ' ')} $`;
const moisDe = (j) => `${j.y}-${String(j.m).padStart(2, '0')}`;

export function calculerFaits(jeu, cal) {
  const aujourdhui = iso(cal.ancre);
  const moisCourant = moisDe(cal.ancre);
  const moisPrecedent = `${cal.moisPrec.y}-${String(cal.moisPrec.m).padStart(2, '0')}`;
  const duBureau = (b) => (x) => x.bureau === b;

  // ── Factures ──
  const etat = (f) => {
    if (f.annulee) return 'void';
    if (f.brouillon) return 'draft';
    const paye = f.paiements.reduce((a, p) => a + p.montant, 0);
    if (paye >= f.total) return 'paid';
    return paye > 0 ? 'partial' : 'sent';
  };
  const factures = jeu.factures.map((f) => {
    const paye = f.paiements.reduce((a, p) => a + p.montant, 0);
    const statut = etat(f);
    const solde = statut === 'void' || statut === 'draft' ? (statut === 'draft' ? f.total : 0) : f.total - paye;
    const enRetard = (statut === 'sent' || statut === 'partial') && f.echeance && iso(f.echeance) < aujourdhui;
    const joursRetard = enRetard ? Math.round((Date.parse(aujourdhui) - Date.parse(iso(f.echeance))) / 86400000) : 0;
    return { ...f, paye, statut, solde, enRetard, joursRetard, nomClient: nomClient(client(f.client)) };
  });
  const fq = factures.filter(duBureau('qc'));
  const aRecevoir = fq.filter((f) => (f.statut === 'sent' || f.statut === 'partial') && f.solde > 0);
  const retards = fq.filter((f) => f.enRetard);
  const paiements = jeu.factures.flatMap((f) => f.paiements.map((p) => ({ ...p, bureau: f.bureau, facture: f, client: f.client })));
  const pq = paiements.filter(duBureau('qc'));
  const somme = (xs, k) => xs.reduce((a, x) => a + x[k], 0);
  const encaisseMois = pq.filter((p) => moisDe(p.jour) === moisCourant);
  const encaisseMoisPasse = pq.filter((p) => moisDe(p.jour) === moisPrecedent);
  const encaisseAujourdhui = pq.filter((p) => iso(p.jour) === aujourdhui);

  // Meilleurs clients (encaissé, tout temps)
  const parClient = {};
  for (const p of pq) parClient[p.client] = (parClient[p.client] ?? 0) + p.montant;
  const topClients = Object.entries(parClient).sort((a, b) => b[1] - a[1]).map(([cle, c]) => ({ cle, nom: nomClient(client(cle)), encaisse: c }));

  // Taxes perçues (TPS/TVQ) sur les factures PAYÉES ce mois-ci (définition de /taxes/collected : tax_cents des factures payées)
  const payeesCeMois = fq.filter((f) => f.statut === 'paid' && f.paiements.length && moisDe(f.paiements[f.paiements.length - 1].jour) === moisCourant);
  const tpsMois = payeesCeMois.reduce((a, f) => a + taxes(f.sousTotal).tps, 0);
  const tvqMois = payeesCeMois.reduce((a, f) => a + taxes(f.sousTotal).tvq, 0);

  // ── Soumissions ──
  const sq = jeu.soumissions.filter(duBureau('qc'));
  const parStatut = {};
  for (const q of sq) parStatut[q.statut] = (parStatut[q.statut] ?? 0) + 1;
  const enAttente = sq.filter((q) => q.statut === 'awaiting_response' || q.statut === 'changes_requested');
  const sansReponse7j = sq.filter((q) => q.statut === 'awaiting_response' && iso(q.envoyee) < iso(cal.J(-7)));

  // ── Jobs et visites ──
  const jq = jeu.jobs.filter(duBureau('qc'));
  const visites = jq.flatMap((j) => j.visites.map((v, i) => ({ ...v, job: j, i })));
  const visitesDu = (jour) => visites.filter((v) => iso(v.jour) === iso(jour) && v.job.statut !== 'cancelled').sort((a, b) => a.debut.localeCompare(b.debut));
  const demain = visitesDu(cal.J(1));
  const aujourdhuiVisites = visitesDu(cal.J(0));
  const aFacturer = jq.filter((j) => j.statut === 'completed' && !jeu.factures.some((f) => f.job === j.cle));
  const nonPlanifies = jq.filter((j) => j.visites.length === 0 && j.statut !== 'cancelled');
  // Rentabilité : revenu (sous-total) − dépenses − main-d'œuvre (heures × taux horaire)
  const rentabilite = jq.filter((j) => j.statut === 'completed').map((j) => {
    const mo = Object.entries(j.heures ?? {}).reduce((a, [qui, h]) => a + h * PERSONNES[qui].taux, 0);
    const marge = j.sousTotal - (j.depenses ?? 0) - mo;
    return { cle: j.cle, numero: j.numero, titre: j.titre, client: nomClient(client(j.client)), revenu: j.sousTotal, depenses: j.depenses ?? 0, mainOeuvre: mo, marge, margePct: Math.round((marge / j.sousTotal) * 1000) / 10 };
  }).sort((a, b) => a.marge - b.marge);

  // ── Temps et paie ──
  const semainePassee = jeu.entreesTemps.filter((e) => e.fin && iso(e.jour) >= iso(cal.lundiPasse) && iso(e.jour) < iso(cal.lundiCourant));
  const heures = (e) => { const [a, b] = [e.debut, e.fin].map((x) => { const [h, m] = x.split(':').map(Number); return h * 60 + m; }); return (b - a - (e.pause ?? 0)) / 60; };
  const heuresSemainePassee = {};
  for (const e of semainePassee) heuresSemainePassee[e.personne] = (heuresSemainePassee[e.personne] ?? 0) + heures(e);
  const nonApprouvees = jeu.entreesTemps.filter((e) => e.fin && !e.approuve);

  // ── Tâches ──
  const ouvertes = jeu.taches.filter((t) => !t.fait);
  const tachesRetard = ouvertes.filter((t) => t.echeance && iso(t.echeance) < aujourdhui);
  const tachesAujourdhui = ouvertes.filter((t) => t.echeance && iso(t.echeance) === aujourdhui);

  // ── Autres bureaux ──
  const fl = factures.filter(duBureau('lev'));
  const fb = factures.filter(duBureau('boreal'));

  return {
    aujourdhui, moisCourant, moisPrecedent,
    factures, aRecevoir, totalARecevoir: somme(aRecevoir, 'solde'), retards, totalRetards: somme(retards, 'solde'),
    encaisseMois: somme(encaisseMois, 'montant'), encaisseMoisPasse: somme(encaisseMoisPasse, 'montant'), encaisseAujourdhui: somme(encaisseAujourdhui, 'montant'),
    nbPaiementsMois: encaisseMois.length, topClients, tpsMois, tvqMois, payeesCeMois,
    parStatut, enAttente, totalEnAttente: somme(enAttente, 'total'), sansReponse7j,
    demain, aujourdhuiVisites, aFacturer, nonPlanifies, rentabilite,
    heuresSemainePassee, nonApprouvees,
    ouvertes, tachesRetard, tachesAujourdhui,
    levis: { aRecevoir: fl.filter((f) => f.solde > 0 && f.statut !== 'draft').reduce((a, f) => a + f.solde, 0), retards: fl.filter((f) => f.enRetard) },
    boreal: { aRecevoir: fb.filter((f) => f.solde > 0 && f.statut !== 'draft').reduce((a, f) => a + f.solde, 0) },
    clientsActifs: CLIENTS.filter((k) => k.bureau === 'qc' && k.statut === 'active' && !k.supprime).length,
    prospects: CLIENTS.filter((k) => k.bureau === 'qc' && k.statut === 'lead' && !k.supprime).length,
  };
}

/** Requêtes de contrôle : chaque attendu du catalogue qui dépend de la base. */
export function verificationsSql(f, jeu, cal) {
  const qc = `'${BUREAUX.qc.id}'`;
  const auj = `(now() at time zone 'America/Montreal')::date`;
  const mois = (col) => `date_trunc('month', ${col} at time zone 'America/Montreal') = date_trunc('month', now() at time zone 'America/Montreal')`;
  const moisPasse = (col) => `date_trunc('month', ${col} at time zone 'America/Montreal') = date_trunc('month', now() at time zone 'America/Montreal') - interval '1 month'`;
  const kevin = `(select user_id from memberships m join team_members t using (org_id, user_id) where m.org_id = ${qc} and t.first_name = 'Kevin' limit 1)`;
  return [
    { nom: 'À recevoir (sent+partial)', attendu: f.totalARecevoir, sql: `select coalesce(sum(balance_cents),0) from invoices where org_id = ${qc} and deleted_at is null and status in ('sent','partial')` },
    { nom: 'En retard', attendu: f.totalRetards, sql: `select coalesce(sum(balance_cents),0) from invoices where org_id = ${qc} and deleted_at is null and status in ('sent','partial') and due_date < ${auj}` },
    { nom: 'Nb factures en retard', attendu: f.retards.length, sql: `select count(*) from invoices where org_id = ${qc} and deleted_at is null and status in ('sent','partial') and due_date < ${auj}` },
    { nom: 'Encaissé ce mois', attendu: f.encaisseMois, sql: `select coalesce(sum(amount_cents),0) from payments where org_id = ${qc} and deleted_at is null and status = 'succeeded' and ${mois('payment_date')}` },
    { nom: 'Encaissé le mois passé', attendu: f.encaisseMoisPasse, sql: `select coalesce(sum(amount_cents),0) from payments where org_id = ${qc} and deleted_at is null and status = 'succeeded' and ${moisPasse('payment_date')}` },
    { nom: 'Encaissé aujourd\'hui', attendu: f.encaisseAujourdhui, sql: `select coalesce(sum(amount_cents),0) from payments where org_id = ${qc} and deleted_at is null and status = 'succeeded' and (payment_date at time zone 'America/Montreal')::date = ${auj}` },
    { nom: 'Facture 1003 total', attendu: f.factures.find((x) => x.cle === 'jean').total, sql: `select total_cents from invoices where org_id = ${qc} and invoice_number = '1003'` },
    { nom: 'Facture 1005 solde', attendu: f.factures.find((x) => x.cle === 'luc').solde, sql: `select balance_cents from invoices where org_id = ${qc} and invoice_number = '1005'` },
    { nom: 'Facture 1005 statut', attendu: 'partial', sql: `select status from invoices where org_id = ${qc} and invoice_number = '1005'` },
    { nom: 'Facture 1010 statut', attendu: 'void', sql: `select status from invoices where org_id = ${qc} and invoice_number = '1010'` },
    { nom: 'Facture 1009 statut', attendu: 'draft', sql: `select status from invoices where org_id = ${qc} and invoice_number = '1009'` },
    { nom: 'Soumissions en attente (total)', attendu: f.totalEnAttente, sql: `select coalesce(sum(total_cents),0) from quotes where org_id = ${qc} and deleted_at is null and status in ('awaiting_response','changes_requested')` },
    { nom: 'Soumissions (nb)', attendu: jeu.soumissions.filter((q) => q.bureau === 'qc').length, sql: `select count(*) from quotes where org_id = ${qc} and deleted_at is null` },
    { nom: 'Visites demain', attendu: f.demain.length, sql: `select count(*) from schedule_events e join jobs j on j.id = e.job_id where e.org_id = ${qc} and e.deleted_at is null and j.status <> 'cancelled' and (e.start_at at time zone 'America/Montreal')::date = ${auj} + 1` },
    { nom: 'Heures Kevin semaine passée', attendu: f.heuresSemainePassee.tech1, sql: `select round(sum(extract(epoch from punch_out_at - punch_in_at))/3600, 2)::float from time_entries where org_id = ${qc} and employee_id = ${kevin} and status = 'completed' and date >= date_trunc('week', ${auj})::date - 7 and date < date_trunc('week', ${auj})::date` },
    { nom: 'Kevin pointé maintenant', attendu: 1, sql: `select count(*) from time_entries where org_id = ${qc} and employee_id = ${kevin} and status = 'active'` },
    { nom: 'Tâches ouvertes', attendu: f.ouvertes.length, sql: `select count(*) from tasks where org_id = ${qc} and deleted_at is null and status = 'open'` },
    { nom: 'Tâches en retard', attendu: f.tachesRetard.length, sql: `select count(*) from tasks where org_id = ${qc} and deleted_at is null and status = 'open' and due_date < ${auj}` },
    { nom: 'Deals ouverts', attendu: jeu.deals.filter((d) => typeof d.etape === 'number').length, sql: `select count(*) from deals where org_id = ${qc} and deleted_at is null and statut = 'ouvert'` },
    { nom: 'Clients actifs', attendu: f.clientsActifs, sql: `select count(*) from clients where org_id = ${qc} and deleted_at is null and status = 'active'` },
    { nom: 'Prospects', attendu: f.prospects, sql: `select count(*) from clients where org_id = ${qc} and deleted_at is null and status = 'lead'` },
    { nom: 'Homonymes Tremblay (Québec)', attendu: 2, sql: `select count(*) from clients where org_id = ${qc} and deleted_at is null and last_name = 'Tremblay'` },
    { nom: 'Lévis à recevoir', attendu: f.levis.aRecevoir, sql: `select coalesce(sum(balance_cents),0) from invoices where org_id = '${BUREAUX.lev.id}' and deleted_at is null and status in ('sent','partial')` },
    { nom: 'Taxe TPS+TVQ facture 1004', attendu: f.factures.find((x) => x.cle === 'clinique').tax, sql: `select tax_cents from invoices where org_id = ${qc} and invoice_number = '1004'` },
    { nom: 'Sans-texto Karine', attendu: 1, sql: `select count(*) from sms_opt_outs where org_id = ${qc}` },
    { nom: 'Taxes QC configurées', attendu: 2, sql: `select count(*) from tax_configs where org_id = ${qc} and is_active` },
    // Même calcul que l'app (rentabilite_jobs : revenu HT − main-d'œuvre pointée × taux − dépenses).
    { nom: 'Profit du job 106 (le moins rentable)', attendu: f.rentabilite[0].marge, sql: `select profit_cents from rentabilite_jobs(${qc}, '2000-01-01', '2100-01-01') where job_number = '${f.rentabilite[0].numero}'` },
    { nom: 'Objectif annuel (réglages)', attendu: jeu.objectifs.revenuAnnuel, sql: `select revenue_goal_cents from company_settings where org_id = ${qc}` },
  ];
}
