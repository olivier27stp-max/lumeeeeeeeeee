/**
 * Banc du bloc 2 — `npm run qa:evenements-base` (STAGING seulement).
 *
 * Prouve, contre la vraie base, que chaque TRANSITION de statut écrit son
 * événement dans `automation_evenements_base` (migration 20261003100000),
 * dans la même transaction — y compris les chemins qui n'émettaient rien :
 *   · visite créée / annulée ;
 *   · job terminé ;
 *   · devis refusé DEPUIS L'APP (simple mise à jour de statut) et accepté ;
 *   · facture créée déjà « envoyée » (factures récurrentes) et passée de
 *     brouillon à envoyée (« envoyer maintenant ») ;
 *   · un même changement ne produit qu'UN événement.
 * Ne lance PAS le lecteur (il consommerait les événements des autres sur
 * staging). Nettoie et vérifie son ménage.
 */
import { createClient } from '@supabase/supabase-js';

const URL_SB = process.env.VITE_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!URL_SB || !KEY) { console.error('Variables Supabase manquantes — lancer avec --env-file=.env.local'); process.exit(1); }
if (/bbzcuzqfgsdvjsymfwmr/.test(URL_SB) || (process.env.SUPABASE_PROJECT_REF_PROD && URL_SB.includes(process.env.SUPABASE_PROJECT_REF_PROD))) {
  console.error('REFUS : ce banc écrit des jobs, devis et factures — jamais sur la production.');
  process.exit(1);
}
const admin = createClient(URL_SB, KEY, { auth: { persistSession: false } });
const MARQUE = '[QA-EVB]';

const { data: m } = await admin.from('memberships').select('org_id, user_id').limit(1).maybeSingle();
if (!m) { console.error('Aucun membre.'); process.exit(1); }
const ORG = m.org_id as string;
const USER = m.user_id as string;

const res: Array<[string, boolean, string]> = [];
const crees: { jobs: string[]; visites: string[]; devis: string[]; factures: string[]; clients: string[] } = { jobs: [], visites: [], devis: [], factures: [], clients: [] };
const echouer = (etape: string, e: { message: string } | null) => { console.error(`Décor — ${etape} :`, e?.message); };

async function evenements(entityId: string, type: string) {
  const { data } = await admin.from('automation_evenements_base').select('id, type, cle, metadata').eq('entity_id', entityId).eq('type', type);
  return data ?? [];
}

try {
  const { data: client, error: eC } = await admin.from('clients').insert({ org_id: ORG, first_name: MARQUE, last_name: 'Test', email: 'qa-evb@lume-staging.test', created_by: USER }).select('id').single();
  if (eC || !client) { echouer('client', eC); process.exit(1); }
  crees.clients.push(client.id);

  const { data: job, error: eJ } = await admin.from('jobs').insert({ org_id: ORG, title: `${MARQUE} job`, client_id: client.id, status: 'scheduled', created_by: USER }).select('id').single();
  if (eJ || !job) { echouer('job', eJ); process.exit(1); }
  crees.jobs.push(job.id);

  // 1. Visite créée → appointment.created (avec job et client).
  const debut = new Date(Date.now() + 5 * 86_400_000);
  const { data: v1, error: eV } = await admin.from('schedule_events').insert({ org_id: ORG, job_id: job.id, title: `${MARQUE} visite`, status: 'scheduled', created_by: USER, start_at: debut.toISOString(), end_at: new Date(debut.getTime() + 3600_000).toISOString() }).select('id').single();
  if (eV || !v1) { echouer('visite', eV); process.exit(1); }
  crees.visites.push(v1.id);
  const c1 = await evenements(v1.id, 'appointment.created');
  res.push(['visite créée → appointment.created', c1.length === 1 && (c1[0].metadata as any)?.job_id === job.id && (c1[0].metadata as any)?.client_id === client.id, JSON.stringify(c1.map((e) => e.metadata))]);

  // 2. Visite annulée → appointment.cancelled ; une 2e mise à jour sans changement n'en crée pas d'autre.
  await admin.from('schedule_events').update({ status: 'cancelled' }).eq('id', v1.id);
  await admin.from('schedule_events').update({ notes: 'x' }).eq('id', v1.id);
  const c2 = await evenements(v1.id, 'appointment.cancelled');
  res.push(['visite annulée → appointment.cancelled (une seule fois)', c2.length === 1, `${c2.length} événement(s)`]);

  // 3. Job terminé → job.completed.
  await admin.from('jobs').update({ status: 'completed' }).eq('id', job.id);
  const c3 = await evenements(job.id, 'job.completed');
  res.push(['job terminé → job.completed', c3.length === 1, `${c3.length} événement(s)`]);

  // 4. Devis refusé DEPUIS L'APP (mise à jour directe) → quote.declined ; puis accepté.
  const { data: devis, error: eD } = await admin.from('quotes').insert({ org_id: ORG, client_id: client.id, status: 'awaiting_response', title: `${MARQUE} devis`, quote_number: `QA-EVB-${Date.now()}`, created_by: USER }).select('id').single();
  if (eD || !devis) { echouer('devis', eD); } else {
    crees.devis.push(devis.id);
    await admin.from('quotes').update({ status: 'declined' }).eq('id', devis.id);
    const c4 = await evenements(devis.id, 'quote.declined');
    res.push(['devis refusé depuis l’app → quote.declined', c4.length === 1, `${c4.length} événement(s)`]);
    await admin.from('quotes').update({ status: 'approved' }).eq('id', devis.id);
    const c5 = await evenements(devis.id, 'quote.approved');
    res.push(['devis accepté → quote.approved', c5.length === 1, `${c5.length} événement(s)`]);
  }

  // 5-6. Facture : le VRAI chemin des factures récurrentes et de « envoyer
  // maintenant » — brouillon, lignes, recalcul, puis statut « envoyée ».
  // (Une facture à 0 $ est ramenée en brouillon par la base.)
  const factureEnvoyee = async (libelle: string) => {
    const { data: f, error: eF } = await admin.from('invoices').insert({ org_id: ORG, client_id: client.id, status: 'draft', created_by: USER, subject: `${MARQUE} ${libelle}` }).select('id').single();
    if (eF || !f) { echouer(`facture ${libelle}`, eF); return null; }
    crees.factures.push(f.id);
    const { error: eL } = await admin.from('invoice_items').insert({ org_id: ORG, invoice_id: f.id, description: 'Lavage', qty: 1, unit_price_cents: 10000 });
    if (eL) echouer('ligne de facture', eL);
    await admin.rpc('recalculate_invoice_totals', { p_invoice_id: f.id });
    const avant = await evenements(f.id, 'invoice.sent');
    const nowIso = new Date().toISOString();
    await admin.from('invoices').update({ status: 'sent', issued_at: nowIso, sent_at: nowIso }).eq('id', f.id);
    return { id: f.id, avant: avant.length };
  };
  const rec = await factureEnvoyee('récurrente');
  if (rec) {
    const c6 = await evenements(rec.id, 'invoice.sent');
    res.push(['facture récurrente envoyée → invoice.sent', rec.avant === 0 && c6.length === 1, `avant ${rec.avant}, après ${c6.length}`]);
  }
  const maint = await factureEnvoyee('envoyer maintenant');
  if (maint) {
    await admin.from('invoices').update({ status: 'sent' }).eq('id', maint.id); // renvoi
    const c7 = await evenements(maint.id, 'invoice.sent');
    res.push(['« envoyer maintenant » → invoice.sent (un renvoi n’en recrée pas)', maint.avant === 0 && c7.length === 1, `après ${c7.length}`]);
  }
} finally {
  // ── Ménage vérifié ──
  const tous = [...crees.jobs, ...crees.visites, ...crees.devis, ...crees.factures];
  const restes: string[] = [];
  const net = async (q: PromiseLike<{ error: { message: string } | null }>, t: string) => { const { error } = await q; if (error) restes.push(`${t}: ${error.message}`); };
  if (tous.length) await net(admin.from('automation_evenements_base').delete().in('entity_id', tous), 'file');
  if (crees.visites.length) await net(admin.from('schedule_events').delete().in('id', crees.visites), 'visites');
  if (crees.factures.length) await net(admin.from('invoices').delete().in('id', crees.factures), 'factures');
  if (crees.devis.length) await net(admin.from('quotes').delete().in('id', crees.devis), 'devis');
  if (crees.jobs.length) await net(admin.from('jobs').delete().in('id', crees.jobs), 'jobs');
  if (crees.clients.length) await net(admin.from('clients').delete().in('id', crees.clients), 'clients');
  const { count } = await admin.from('automation_evenements_base').select('id', { count: 'exact', head: true }).in('entity_id', tous.length ? tous : ['00000000-0000-0000-0000-000000000000']);
  if (count) restes.push(`${count} ligne(s) de file restée(s)`);
  for (const [cas, ok, detail] of res) console.log(`${ok ? '✓' : '✗'} ${cas} — ${detail}`);
  console.log(restes.length ? `\n⚠ Ménage incomplet : ${restes.join(' ; ')}` : '\nMénage : tout supprimé et vérifié.');
  const ko = res.filter((r) => !r[1]).length;
  console.log(`\n${res.length - ko}/${res.length} ${ko || res.length < 7 ? '— ÉCHEC' : '— OK'}`);
  process.exitCode = ko || restes.length || res.length < 7 ? 1 : 0;
}
