#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   LES INVARIANTS MÉTIER — ce qui doit toujours être vrai dans la base.

   Les clés étrangères et la RLS garantissent la structure. Elles ne
   disent rien du SENS : un total qui ne suit pas ses lignes, une facture
   encaissée restée brouillon, un job terminé sans date de fin, un
   courriel en double. Ces incohérences ne plantent rien — elles
   faussent un rapport, ratent une relance, trompent un client.

   Le 2026-09-06, cette passe sur la prod a trouvé 9 violations sur 35,
   dont 3 causées par des triggers (corrigés dans 20260906140000).

   Lecture seule. Cible staging (VITE_SUPABASE_URL) ; `-- --prod` pour la prod.
   Usage : npm run qa:invariants [-- --prod]
   ═══════════════════════════════════════════════════════════════ */

const PROD = process.argv.includes('--prod');
const ref = PROD ? (process.env.SUPABASE_PROJECT_REF_PROD || 'bbzcuzqfgsdvjsymfwmr') : (process.env.SUPABASE_PROJECT_REF || 'boylnjjlhexljmddmjyg');
if (!process.env.SUPABASE_ACCESS_TOKEN) { console.error('SUPABASE_ACCESS_TOKEN manquant — lancer avec --env-file=.env.local'); process.exit(2); }
console.log(`Cible : ${PROD ? 'PROD' : 'staging'} (${ref})
`);
const q = async (sql) => {
  const r = await fetch('https://api.supabase.com/v1/projects/' + ref + '/database/query', { method: 'POST', headers: { Authorization: 'Bearer ' + process.env.SUPABASE_ACCESS_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const j = await r.json();
  if (!Array.isArray(j)) return { err: (j.message || '').split('\n')[0].slice(0, 110) };
  return j;
};
const C = [
  // ── argent ──
  ['facture : total ≠ sous-total + taxes − remise', "select count(*) n from invoices where deleted_at is null and total_cents <> subtotal_cents + tax_cents - coalesce(discount_cents,0)"],
  ['facture : sous-total ≠ somme des lignes (quand il y a des lignes)', "select count(*) n from invoices i where i.deleted_at is null and exists (select 1 from invoice_items x where x.invoice_id=i.id and x.deleted_at is null) and i.subtotal_cents <> (select coalesce(sum(line_total_cents),0) from invoice_items x where x.invoice_id=i.id and x.deleted_at is null)"],
  ['facture : solde ≠ total − payé', "select count(*) n from invoices where deleted_at is null and balance_cents <> total_cents - paid_cents"],
  ['facture : payé ≠ somme des paiements réussis', "select count(*) n from invoices i where i.deleted_at is null and i.paid_cents <> (select coalesce(sum(amount_cents),0) from payments p where p.invoice_id=i.id and p.deleted_at is null and p.status in ('succeeded','completed','paid'))"],
  ['facture : statut « payée » mais solde > 0', "select count(*) n from invoices where deleted_at is null and status='paid' and balance_cents > 0"],
  ['facture : solde 0, total > 0, statut ≠ payée', "select count(*) n from invoices where deleted_at is null and total_cents > 0 and balance_cents <= 0 and status not in ('paid','void','cancelled','refunded')"],
  ['facture : montant négatif', "select count(*) n from invoices where deleted_at is null and (total_cents < 0 or subtotal_cents < 0 or tax_cents < 0 or paid_cents < 0)"],
  ['facture : projection $ ≠ cents', "select count(*) n from invoices where deleted_at is null and abs(total - total_cents/100.0) > 0.011"],
  ['facture : brouillon mais déjà envoyée (sent_at)', "select count(*) n from invoices where deleted_at is null and status='draft' and sent_at is not null"],
  ['facture : échéance avant émission', "select count(*) n from invoices where deleted_at is null and due_date is not null and issued_at is not null and due_date < issued_at::date"],
  ['facture : client supprimé', "select count(*) n from invoices i join clients c on c.id=i.client_id where i.deleted_at is null and c.deleted_at is not null"],
  ['paiement : sans facture ni job', "select count(*) n from payments where deleted_at is null and invoice_id is null and job_id is null"],
  ['paiement : montant ≤ 0', "select count(*) n from payments where deleted_at is null and amount_cents <= 0"],
  ['paiement : facture supprimée', "select count(*) n from payments p join invoices i on i.id=p.invoice_id where p.deleted_at is null and i.deleted_at is not null"],
  ['demande de paiement en attente : montant ≠ solde', "select count(*) n from payment_requests r join invoices i on i.id=r.invoice_id where r.deleted_at is null and r.status in ('pending','sent') and r.amount_cents <> i.balance_cents"],
  // ── devis ──
  ['devis : total ≠ sous-total + taxes − remise', "select count(*) n from quotes where deleted_at is null and total_cents <> subtotal_cents + tax_cents - coalesce(discount_cents,0)"],
  ['devis : sous-total ≠ somme des lignes', "select count(*) n from quotes q where q.deleted_at is null and exists (select 1 from quote_line_items l where l.quote_id=q.id) and q.subtotal_cents <> (select coalesce(sum(total_cents),0) from quote_line_items l where l.quote_id=q.id)"],
  ['devis : approuvé sans approved_at', "select count(*) n from quotes where deleted_at is null and status='approved' and approved_at is null"],
  ['devis : converti sans job', "select count(*) n from quotes where deleted_at is null and status='converted' and job_id is null"],
  ['devis : client supprimé', "select count(*) n from quotes q join clients c on c.id=q.client_id where q.deleted_at is null and c.deleted_at is not null"],
  // ── jobs ──
  ['job : total ≠ sous-total + taxes', "select count(*) n from jobs where deleted_at is null and total_cents <> subtotal_cents + tax_cents"],
  ['job : sous-total ≠ somme des lignes', "select count(*) n from jobs j where j.deleted_at is null and exists (select 1 from job_line_items l where l.job_id=j.id and l.deleted_at is null) and j.subtotal_cents <> (select coalesce(sum(total_cents),0) from job_line_items l where l.job_id=j.id and l.deleted_at is null)"],
  ['job : terminé sans completed_at', "select count(*) n from jobs where deleted_at is null and status='completed' and completed_at is null"],
  ['job : fin avant début', "select count(*) n from jobs where deleted_at is null and start_at is not null and end_at is not null and end_at < start_at"],
  ['job : planifié sans date', "select count(*) n from jobs where deleted_at is null and status='scheduled' and scheduled_at is null and start_at is null"],
  ['job : client supprimé', "select count(*) n from jobs j join clients c on c.id=j.client_id where j.deleted_at is null and c.deleted_at is not null"],
  ['job : projection $ ≠ cents', "select count(*) n from jobs where deleted_at is null and abs(total - total_cents/100.0) > 0.011"],
  // ── temps ──
  ['pointage : sortie avant entrée', "select count(*) n from time_entries where punch_out_at is not null and punch_out_at < punch_in_at"],
  ['pointage : > 24 h', "select count(*) n from time_entries where punch_out_at is not null and punch_out_at - punch_in_at > interval '24 hours'"],
  ['pointage : ouvert depuis > 24 h', "select count(*) n from time_entries where punch_out_at is null and punch_in_at < now() - interval '24 hours'"],
  // ── clients / orgs ──
  ['client : même courriel deux fois dans une org (actifs)', "select count(*) n from (select org_id, lower(email) from clients where deleted_at is null and email is not null and email<>'' group by 1,2 having count(*)>1) d"],
  ['org : sans propriétaire actif', "select count(*) n from orgs o where not exists (select 1 from memberships m where m.org_id=o.id and m.role='owner' and m.status='active')"],
  ['org : plusieurs abonnements actifs', "select count(*) n from (select org_id from subscriptions where status='active' group by 1 having count(*)>1) d"],
  ['membre : deux adhésions actives à la même org', "select count(*) n from (select user_id, org_id from memberships where status='active' group by 1,2 having count(*)>1) d"],
  ['membre : compte auth disparu', "select count(*) n from memberships m where not exists (select 1 from auth.users u where u.id=m.user_id)"],
];
let ko = 0;
for (const [nom, sql] of C) {
  const r = await q(sql);
  if (r.err) { console.log('  ?   ' + nom.padEnd(64) + r.err); continue; }
  const n = Number(r[0].n);
  if (n > 0) ko++;
  console.log('  ' + (n > 0 ? '!!  ' : 'ok  ') + nom.padEnd(64) + (n > 0 ? n : ''));
}
console.log('\n' + C.length + ' invariants, ' + ko + ' violé(s)');
