/**
 * Exécution RÉELLE de chaque outil d'écriture de Lumi sur STAGING (org QA).
 * ─────────────────────────────────────────────────────────────────────────
 * La batterie evaluer-outils.mts vérifie la PROPOSITION (la carte) ; celle-ci
 * vérifie que l'exécution passe : mêmes handlers, même identité JWT + RLS,
 * mêmes routes de l'app. C'est elle qui aurait vu, avant la prod, les
 * « permission denied » de 19 tables (migration 20260916170000).
 *
 * Scénario ordonné (créer → modifier → supprimer) sur des entités « Exec … »
 * créées ici, jamais sur les vraies fiches sauf actions réversibles (suspendre
 * puis réactiver un technicien, pointer puis dépointer…). Les envois réels
 * (texto, courriel, paiements) sont EXCLUS et listés avec la raison.
 * Refuse la prod. API locale requise (PORT, défaut 3012).
 *
 *   PORT=3012 node --env-file=.env.local --import tsx scripts/qa/executer-outils-staging.mts [--seulement a,b]
 */
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';

process.env.PORT = process.env.PORT || '3012';
const url = process.env.VITE_SUPABASE_URL ?? '';
if (process.env.SUPABASE_PROJECT_REF_PROD && url.includes(process.env.SUPABASE_PROJECT_REF_PROD)) throw new Error('Refus : la prod.');
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : ''; };
const SEULEMENT = arg('--seulement') ? new Set(arg('--seulement').split(',')) : null;
const COMPTE = process.env.QA_COMPTE || 'willhebert30@gmail.com';
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });
const anonOpts = { auth: { persistSession: false, autoRefreshToken: false } };
const { data: l, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: COMPTE });
if (error) throw new Error(`lien magique : ${error.message}`);
const { data: s, error: e2 } = await createClient(url, process.env.VITE_SUPABASE_ANON_KEY ?? '', anonOpts).auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' });
if (e2 || !s.session) throw new Error(`session : ${e2?.message}`);
const userId = s.session.user.id;
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', userId).eq('status', 'active').limit(1).maybeSingle();
if (!m) throw new Error('aucune org');
const orgId = m.org_id as string;
const client = createClient(url, process.env.VITE_SUPABASE_ANON_KEY ?? '', { ...anonOpts, global: { headers: { Authorization: `Bearer ${s.session.access_token}` } } });
const ctx = { client, orgId, userId, accessToken: s.session.access_token };
const { AGENT_TOOLS } = await import('../../server/lib/agent/tools');
const outil = (n: string) => { const t = AGENT_TOOLS.find((x) => x.declaration.name === n); if (!t?.handler) throw new Error(`outil absent : ${n}`); return t; };
const lire = async (n: string, a: Record<string, any> = {}): Promise<any> => outil(n).handler!(a, ctx as any);

/** Cherche dans un résultat l'objet dont une valeur texte contient l'aiguille ; renvoie l'identifiant (clé donnée, sinon id / *_id). */
function trouver(r: unknown, aiguille: string | null, ...cles: string[]): string | undefined {
  let res: string | undefined;
  const marcher = (v: unknown) => {
    if (res) return;
    if (Array.isArray(v)) { v.forEach(marcher); return; }
    if (v && typeof v === 'object') {
      const o = v as Record<string, any>;
      const ok = aiguille === null || Object.values(o).some((x) => typeof x === 'string' && x.toLowerCase().includes(aiguille.toLowerCase()));
      if (ok) {
        for (const k of cles) if (typeof o[k] === 'string') { res = o[k]; return; }
        if (!cles.length) { const k = Object.keys(o).find((x) => x === 'id' || x.endsWith('_id')); if (k && typeof o[k] === 'string') { res = o[k]; return; } }
      }
      Object.values(o).forEach(marcher);
    }
  };
  marcher(r);
  return res;
}
const jour = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const heure = (d: number, h: number) => { const x = new Date(); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x.toISOString(); };

type Resultat = { outil: string; verdict: 'ok' | 'erreur' | 'exclu' | 'non_couvert'; detail: string; duree_ms: number };
const resultats: Resultat[] = [];
const S: Record<string, any> = {};
/** Exécute un outil d'écriture ; `apres` reçoit le résultat pour retenir des ids. */
/**
 * Suffixe de passe : executerIdempotent renvoie « déjà fait » pour des arguments
 * identiques à une passe récente (anti double-clic de l'app) — et le résultat
 * mémorisé pointe sur des entités effacées en fin de passe. Chaque passe a donc
 * ses propres noms : « Exec » → « Exec-k3f2 », « exec.x@ » → « exec.k3f2.x@ », « exec_test » → « exec_test_k3f2 ».
 */
const R = Date.now().toString(36).slice(-4);
function suffixer<T>(v: T): T {
  if (typeof v === 'string') return v.replace(/\bExec\b/g, `Exec-${R}`).replace(/\bexec\.(\w+)@/g, `exec.${R}.$1@`).replace(/\bexec_test\b/g, `exec_test_${R}`).replace(/exec_badge/g, `exec_badge_${R}`) as unknown as T;
  if (Array.isArray(v)) return v.map(suffixer) as unknown as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, suffixer(x)])) as unknown as T;
  return v;
}
/** Erreurs qui signifient « l'état voulu existe déjà » (une passe précédente l'a créé) : comptées ok, avec la note. */
const DEJA: Partial<Record<string, RegExp>> = { create_rep: /already exists|existe déjà/i };
async function ex(nom: string, args: Record<string, any> | null | (() => Record<string, any> | null), apres?: (r: any) => void): Promise<any> {
  if (SEULEMENT && !SEULEMENT.has(nom)) return null;
  const brut = typeof args === 'function' ? args() : args;
  const a = brut ? suffixer(brut) : brut;
  if (!a) { resultats.push({ outil: nom, verdict: 'non_couvert', detail: 'préalable manquant (id introuvable)', duree_ms: 0 }); console.log(`  ?    ${nom} (préalable manquant)`); return null; }
  const debut = Date.now();
  try {
    if (process.env.DEBUG_ARGS) console.log(`  args ${nom} ${JSON.stringify(a).slice(0, 160)}`);
    const r = await outil(nom).handler!(a, ctx as any);
    if (r && typeof r === 'object' && 'error' in r) throw new Error(String((r as any).error));
    resultats.push({ outil: nom, verdict: 'ok', detail: JSON.stringify(r).slice(0, 160), duree_ms: Date.now() - debut });
    console.log(`  OK   ${nom}`);
    apres?.(r);
    return r;
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 220);
    if (DEJA[nom]?.test(msg)) { resultats.push({ outil: nom, verdict: 'ok', detail: `déjà en place (${msg})`, duree_ms: Date.now() - debut }); console.log(`  OK   ${nom} (déjà en place)`); return null; }
    resultats.push({ outil: nom, verdict: 'erreur', detail: msg, duree_ms: Date.now() - debut });
    console.log(`  ERR  ${nom} : ${msg}`);
    return null;
  }
}
const exclu = (nom: string, raison: string) => { if (!SEULEMENT || SEULEMENT.has(nom)) { resultats.push({ outil: nom, verdict: 'exclu', detail: raison, duree_ms: 0 }); } };

console.log(`Exécution réelle — org ${orgId}, ${COMPTE}, API ${process.env.PORT}`);

// ── Repères existants ──
const equipe = await lire('get_team');
S.tech = trouver(equipe, 'Antoine', 'user_id', 'id');
S.job33 = trouver(await lire('list_jobs', { query: '33', limit: 5 }), 'Lavage de vitres', 'job_id', 'id');
S.gagnon = trouver(await lire('search_clients', { query: 'Gagnon', limit: 5 }), 'Gagnon', 'client_id', 'id');
S.equipeNord = trouver(await lire('list_teams'), 'Équipe Nord', 'team_id', 'id');
S.regle = trouver(await lire('list_automations'), null, 'rule_id', 'id');
S.groupeTaxes = trouver(await lire('get_tax_config'), null, 'group_id');
S.deal = trouver(await lire('list_deals'), null, 'deal_id', 'id');
S.conversation = trouver(await lire('get_conversations', { limit: 3 }), null, 'conversation_id', 'id');
S.invitation = trouver(await lire('list_invitations', { status: 'all' }), 'marc.tremblay', 'invitation_id', 'id');
S.tagUrgent = trouver(await lire('list_job_tags'), 'Urgent', 'tag_id', 'id');
console.log('repères', JSON.stringify(S));

// ── Clients, prospects, notes, adresses ──
await ex('create_client', { first_name: 'Exec', last_name: 'Client', phone: '514-555-0111', email: 'exec.client@example.com', address: '1 rue Exec', city: 'Montréal' }, (r) => { S.client = trouver(r, null, 'client_id', 'id'); });
await ex('update_client', () => S.client && { client_id: S.client, phone: '514-555-0112' });
await ex('add_note', () => S.client && { entity_type: 'client', entity_id: S.client, note: 'Note exec' }, (r) => { S.note = trouver(r, null, 'note_id', 'id'); });
if (!S.note && S.client) S.note = trouver(await lire('list_notes', { entity_type: 'client', entity_id: S.client }), suffixer('Note exec'), 'note_id', 'id');
await ex('update_note', () => S.note && { note_id: S.note, text: 'Note exec modifiée' });
await ex('delete_note', () => S.note && { note_id: S.note });
await ex('create_property', () => S.client && { client_id: S.client, name: suffixer('Exec chalet'), address: '2 chemin Exec', city: 'Magog', province: 'QC', country: 'CA', kind: 'service' }, (r) => { S.prop = trouver(r, null, 'property_id', 'id'); });
if (!S.prop && S.client) S.prop = trouver(await lire('list_properties', { client_id: S.client }), suffixer('Exec chalet'), 'property_id', 'id');
await ex('update_property', () => S.prop && { property_id: S.prop, name: 'Exec chalet 2' });
await ex('delete_property', () => S.prop && { property_id: S.prop });
S.champ = trouver(await lire('list_custom_fields'), null, 'field_id', 'id');
if (S.champ && S.client) await ex('set_custom_field', { field_id: S.champ, record_id: S.client, value: 'exec' }); else exclu('set_custom_field', 'aucun champ personnalisé dans l’org QA (le constructeur de champs est hors périmètre du mandat)');
await ex('create_lead', { first_name: 'Exec', last_name: 'Prospect', phone: '514-555-0113' }, (r) => { S.lead = trouver(r, null, 'lead_id', 'id'); });
await ex('create_lead', { first_name: 'Exec', last_name: 'Prospect2', phone: '514-555-0114' }, (r) => { S.lead2 = trouver(r, null, 'lead_id', 'id'); });
await ex('create_lead', { first_name: 'Exec', last_name: 'Prospect3', phone: '514-555-0115' }, (r) => { S.lead3 = trouver(r, null, 'lead_id', 'id'); });
await ex('update_lead', () => S.lead && { lead_id: S.lead, email: 'exec.prospect@example.com' });
await ex('update_lead_status', () => S.lead && { lead_id: S.lead, status: 'contacted' });
await ex('convert_lead_to_client', () => S.lead && { lead_id: S.lead }, (r) => { S.clientDuLead = trouver(r, null, 'client_id'); });
await ex('convert_lead_to_job', () => S.lead2 && { lead_id: S.lead2, job_title: 'Exec job du prospect' }, (r) => { S.jobDuLead = trouver(r, null, 'job_id'); });
await ex('delete_lead', () => S.lead3 && { lead_id: S.lead3 });
await ex('update_deal_stage', () => S.deal && { deal_id: S.deal, stage: 'nouveau' });
exclu('delete_deal', 'seule carte du pipeline de l’org QA (irréversible)');
exclu('process_request_submission', 'aucune demande de formulaire sur staging');
exclu('delete_request_submission', 'aucune demande de formulaire sur staging');
exclu('merge_clients', 'déjà exécuté par le seed (fusion Gagnon/Bouchard)');

// ── Jobs ──
await ex('create_job', () => S.client && { title: 'Exec job', client_id: S.client, scheduled_at: heure(3, 9), end_at: heure(3, 11), line_items: [{ name: 'Lavage', qty: 1, unit_price_cents: 10000 }] }, (r) => { S.job = trouver(r, null, 'job_id', 'id'); });
if (!S.job) S.job = trouver(await lire('list_jobs', { query: `Exec-${R} job`, limit: 5 }), `Exec-${R} job`, 'job_id', 'id');
await ex('update_job', () => S.job && { job_id: S.job, description: 'Exec description' });
await ex('update_job_status', () => S.job && { job_id: S.job, status: 'in_progress' });
await ex('assign_job', () => S.job && S.tech && { job_id: S.job, assignee_user_id: S.tech });
await ex('add_visit', () => S.job && { job_id: S.job, start_at: heure(5, 13), end_at: heure(5, 15) });
if (S.job) S.visite = trouver(await lire('get_job', { job_id: S.job }), null, 'visit_id');
await ex('reschedule_job', () => S.job && { job_id: S.job, start_at: heure(4, 9), end_at: heure(4, 11) });
await ex('cancel_visit', () => S.job && { job_id: S.job });
await ex('schedule_job', () => S.job && { job_id: S.job, start_at: heure(6, 9), end_at: heure(6, 11) });
await ex('unschedule_job', () => S.job && { job_id: S.job });
await ex('set_job_expenses', () => S.job && { job_id: S.job, amount_dollars: 12.5 });
await ex('set_job_tags', () => S.job && S.tagUrgent && { job_id: S.job, tag_ids: [S.tagUrgent] });
await ex('create_job_checklist', () => S.job && { job_id: S.job, items: [{ id: 'a', type: 'checkbox', label: 'Exec item', required: false }] }, (r) => { S.checklist = trouver(r, null, 'checklist_id', 'id'); });
if (!S.checklist && S.job) S.checklist = trouver(await lire('list_job_checklists', { job_id: S.job }), null, 'checklist_id', 'id');
await ex('update_job_checklist', () => S.job && S.checklist && { job_id: S.job, checklist_id: S.checklist, responses: { a: true }, completed: true });
await ex('delete_job_checklist', () => S.job && S.checklist && { job_id: S.job, checklist_id: S.checklist });
await ex('save_job_billing_milestones', () => S.job && { job_id: S.job, milestones: [{ label: 'Dépôt', amount_cents: 3000, percent: 30 }, { label: 'Solde', amount_cents: 7000, percent: 70 }], billing_split: true }, (r) => { S.jalon = trouver(r, 'Dépôt', 'milestone_id', 'id'); });
if (!S.jalon && S.job) S.jalon = trouver(await lire('get_job', { job_id: S.job }), 'Dépôt', 'milestone_id', 'id');
await ex('create_invoice_for_milestone', () => S.job && S.jalon && { job_id: S.job, milestone_id: S.jalon });
exclu('create_invoice_for_visit', 'exige une visite TERMINÉE sur un job facturé « par visite » (RPC create_invoice_from_visit) — la visite se termine sur le terrain, pas par Lumi');
await ex('create_job_agreement', () => S.job && { job_id: S.job, terms: 'Conditions exec', require_signature: true }, (r) => { S.contrat = trouver(r, null, 'agreement_id', 'id'); });
exclu('send_agreement_email', 'envoi réel au client');
exclu('send_agreement_sms', 'envoi réel au client');
await ex('create_recurrence_rule', () => S.job && { job_id: S.job, frequency: 'weekly', start_date: jour(7), max_occurrences: 2 }, (r) => { S.recurrence = trouver(r, null, 'rule_id', 'id'); });
if (!S.recurrence && S.job) S.recurrence = trouver(await lire('list_recurrence_rules'), `Exec-${R} job`, 'rule_id', 'id');
await ex('deactivate_recurrence_rule', () => S.recurrence && { rule_id: S.recurrence });
await ex('create_job_template', { title: 'Exec modèle de job', line_items: [{ name: 'Lavage', qty: 1, unit_price_cents: 10000 }] });
// Un job neuf, sans jalon ni facture : un job facturé par jalons refuse une facture globale (« existe déjà »).
await ex('create_job', () => S.client && { title: 'Exec job à facturer', client_id: S.client, line_items: [{ name: 'Lavage', qty: 1, unit_price_cents: 8000 }] }, (r) => { S.jobFacture = trouver(r, null, 'job_id', 'id'); });
await ex('create_invoice_from_job', () => S.jobFacture && { job_id: S.jobFacture }, (r) => { S.factureJob = trouver(r, null, 'invoice_id', 'id'); });
await ex('archive_job', () => S.job && { job_id: S.job });
await ex('archive_job', () => S.job && { job_id: S.job, restore: true });

// ── Devis, préréglages, modèles ──
await ex('create_quote', () => S.client && { client_id: S.client, title: 'Exec devis', line_items: [{ name: 'Lavage', quantity: 1, unit_price_cents: 15000 }] }, (r) => { S.devis = trouver(r, null, 'quote_id', 'id'); });
await ex('update_quote', () => S.devis && { quote_id: S.devis, title: 'Exec devis 2', valid_days: 45 });
await ex('duplicate_quote', () => S.devis && { quote_id: S.devis, title: 'Exec devis copie' }, (r) => { S.devis2 = trouver(r, null, 'quote_id', 'id'); });
await ex('cancel_quote', () => S.devis2 && { quote_id: S.devis2, reason: 'exec' });
await ex('unarchive_quote', () => S.devis2 && { quote_id: S.devis2 });
await ex('create_quote', () => S.client && { client_id: S.client, title: 'Exec devis job', line_items: [{ name: 'Lavage', quantity: 1, unit_price_cents: 9000 }] }, (r) => { S.devis3 = trouver(r, null, 'quote_id', 'id'); });
await ex('convert_quote_to_invoice', () => S.devis && { quote_id: S.devis });
exclu('convert_quote_to_job', 'exige un devis APPROUVÉ par le client (règle de l’app) — l’approbation est l’action du client');
await ex('delete_quote', () => S.devis2 && { quote_id: S.devis2 });
exclu('send_quote', 'envoi réel au client'); exclu('send_quote_sms', 'envoi réel au client');
await ex('create_quote_preset', { name: suffixer('Exec préréglage'), services: [{ name: 'Lavage', quantity: 1 }] }, (r) => { S.preset = trouver(r, null, 'preset_id', 'id'); });
if (!S.preset) S.preset = trouver(await lire('list_quote_presets'), suffixer('Exec préréglage'), 'preset_id', 'id');
await ex('update_quote_preset', () => S.preset && { preset_id: S.preset, name: 'Exec préréglage 2' });
await ex('duplicate_quote_preset', () => S.preset && { preset_id: S.preset }, (r) => { S.preset2 = trouver(r, null, 'preset_id', 'id'); });
await ex('delete_quote_preset', () => S.preset && { preset_id: S.preset });
if (S.preset2) await ex('delete_quote_preset', { preset_id: S.preset2 });
await ex('create_quote_template', { name: suffixer('Exec modèle devis'), services: [{ name: 'Lavage', quantity: 1, unit_price_cents: 15000 }] }, (r) => { S.mdevis = trouver(r, null, 'template_id', 'id'); });
if (!S.mdevis) S.mdevis = trouver(await lire('list_quote_templates'), suffixer('Exec modèle devis'), 'template_id', 'id');
await ex('update_quote_template', () => S.mdevis && { template_id: S.mdevis, name: 'Exec modèle devis 2' });
await ex('delete_quote_template', () => S.mdevis && { template_id: S.mdevis });

// ── Factures, paiements, récurrentes, modèles, relances ──
await ex('create_invoice', () => S.client && { client_id: S.client, subject: 'Exec facture', items: [{ description: 'Lavage', qty: 1, unit_price_cents: 10000 }], due_date: jour(30) }, (r) => { S.facture = trouver(r, null, 'invoice_id', 'id'); });
await ex('update_invoice', () => S.facture && { invoice_id: S.facture, subject: 'Exec facture 2', notes: 'merci' });
await ex('duplicate_invoice', () => S.facture && { invoice_id: S.facture }, (r) => { S.facture2 = trouver(r, null, 'invoice_id', 'id'); });
exclu('record_invoice_payment', 'exige une facture ENVOYÉE (règle de l’app) — l’envoi réel est exclu');
exclu('mark_invoice_paid', 'exige une facture ENVOYÉE (règle de l’app) — l’envoi réel est exclu');
await ex('revert_invoice_to_draft', () => S.facture2 && { invoice_id: S.facture2 });
await ex('void_invoice', () => S.factureJob && { invoice_id: S.factureJob });
await ex('delete_invoice', () => S.facture2 && { invoice_id: S.facture2 });
exclu('send_invoice', 'envoi réel au client'); exclu('send_payment_reminders', 'envoi réel au client');
exclu('create_payment_request', 'lien de paiement Stripe réel'); exclu('resend_payment_request', 'renvoi réel d’un lien de paiement au client (courriel ou texto)');
exclu('charge_card_on_file', 'prélèvement réel'); exclu('refund_payment', 'remboursement réel'); exclu('remove_card_on_file', 'carte Stripe réelle');
await ex('create_recurring_invoice', () => S.client && { client_id: S.client, subject: suffixer('Exec récurrente'), items: [{ description: 'Entretien', qty: 1, unit_price_cents: 5000 }], frequency: 'monthly', start_date: jour(10) }, (r) => { S.recurrente = trouver(r, null, 'schedule_id', 'id'); });
if (!S.recurrente) S.recurrente = trouver(await lire('list_recurring_invoices'), suffixer('Exec récurrente'), 'schedule_id', 'id');
await ex('update_recurring_invoice', () => S.recurrente && { schedule_id: S.recurrente, subject: 'Exec récurrente 2' });
await ex('run_recurring_invoice_now', () => S.recurrente && { schedule_id: S.recurrente });
await ex('delete_recurring_invoice', () => S.recurrente && { schedule_id: S.recurrente });
await ex('create_invoice_template', { name: suffixer('Exec modèle facture'), line_items: [{ description: 'Entretien', qty: 1, unit_price_cents: 5000 }] }, (r) => { S.mfact = trouver(r, null, 'template_id', 'id'); });
if (!S.mfact) S.mfact = trouver(await lire('list_invoice_templates'), suffixer('Exec modèle facture'), 'template_id', 'id');
await ex('update_invoice_template', () => S.mfact && { template_id: S.mfact, name: 'Exec modèle facture 2' });
await ex('delete_invoice_template', () => S.mfact && { template_id: S.mfact });
await ex('update_reminder_settings', { enabled: true });

// ── Listes de vérification, courriels, étiquettes ──
await ex('create_checklist_template', { name: suffixer('Exec liste'), items: [{ id: 'x', type: 'checkbox', label: 'Exec', required: false }] }, (r) => { S.mliste = trouver(r, null, 'template_id', 'id'); });
if (!S.mliste) S.mliste = trouver(await lire('list_checklist_templates'), suffixer('Exec liste'), 'template_id', 'id');
await ex('update_checklist_template', () => S.mliste && { template_id: S.mliste, name: 'Exec liste 2' });
await ex('delete_checklist_template', () => S.mliste && { template_id: S.mliste });
await ex('create_email_template', { name: suffixer('Exec courriel'), type: 'generic', subject: 'Exec', body: 'Exec corps' }, (r) => { S.mcourriel = trouver(r, null, 'template_id', 'id'); });
if (!S.mcourriel) S.mcourriel = trouver(await lire('list_email_templates'), suffixer('Exec courriel'), 'template_id', 'id');
await ex('update_email_template', () => S.mcourriel && { template_id: S.mcourriel, subject: 'Exec 2' });
await ex('set_default_email_template', () => S.mcourriel && { template_id: S.mcourriel });
await ex('duplicate_email_template', () => S.mcourriel && { template_id: S.mcourriel }, (r) => { S.mcourriel2 = trouver(r, null, 'template_id', 'id'); });
await ex('delete_email_template', () => S.mcourriel && { template_id: S.mcourriel });
if (S.mcourriel2) await ex('delete_email_template', { template_id: S.mcourriel2 });
await ex('create_job_tag', { name: 'Exec étiquette', color_hex: '#0ea5e9' });

// ── Tâches ──
await ex('create_task', { title: 'Exec tâche', due_date: jour(2) }, (r) => { S.tache = trouver(r, null, 'task_id', 'id'); });
await ex('create_task', { title: 'Exec tâche 2', due_date: jour(2) }, (r) => { S.tache2 = trouver(r, null, 'task_id', 'id'); });
await ex('update_task', () => S.tache && { task_id: S.tache, description: 'Exec' });
await ex('reschedule_task', () => S.tache && { task_id: S.tache, scheduled_at: heure(2, 14) });
await ex('duplicate_task', () => S.tache && { task_id: S.tache }, (r) => { S.tache3 = trouver(r, null, 'task_id', 'id'); });
await ex('update_task_status', () => S.tache && { task_id: S.tache, status: 'done' });
await ex('bulk_update_task_status', () => S.tache2 && { task_ids: [S.tache2].concat(S.tache3 ? [S.tache3] : []), status: 'done' });
await ex('bulk_delete_tasks', () => S.tache2 && { task_ids: [S.tache2].concat(S.tache3 ? [S.tache3] : []) });
await ex('delete_task', () => S.tache && { task_id: S.tache });

// ── Équipe, paie, pointage, rôles ──
await ex('create_team', { name: suffixer('Exec équipe'), color_hex: '#22c55e' }, (r) => { S.equipe = trouver(r, null, 'team_id', 'id'); });
if (!S.equipe) S.equipe = trouver(await lire('list_teams'), suffixer('Exec équipe'), 'team_id', 'id');
await ex('update_team', () => S.equipe && { team_id: S.equipe, name: 'Exec équipe 2' });
await ex('create_availability', () => S.equipe && { team_id: S.equipe, weekday: 2, start_time: '08:00', end_time: '12:00' }, (r) => { S.dispo = trouver(r, null, 'availability_id', 'id'); });
if (!S.dispo && S.equipe) S.dispo = trouver(await lire('list_availability', { team_id: S.equipe }), null, 'availability_id', 'id');
await ex('delete_availability', () => S.dispo && { availability_id: S.dispo });
await ex('set_default_availability', () => S.equipe && { team_id: S.equipe });
await ex('delete_team', () => S.equipe && { team_id: S.equipe });
await ex('set_hourly_rate', () => S.tech && { user_id: S.tech, hourly_rate_cents: 2500 });
await ex('punch_in', { notes: 'exec' }, (r) => { S.punch = trouver(r, null, 'entry_id', 'id'); });
await ex('start_break', () => ({ ...(S.punch ? { entry_id: S.punch } : {}) }));
await ex('end_break', () => ({ ...(S.punch ? { entry_id: S.punch } : {}) }));
await ex('punch_out', () => ({ ...(S.punch ? { entry_id: S.punch } : {}), notes: 'exec' }));
await ex('approve_timesheet', () => S.tech && { user_id: S.tech, from: jour(-7), to: jour(0) });
await ex('add_payroll_adjustment', () => S.tech && { user_id: S.tech, amount_cents: 100, note: 'exec' });
await ex('mark_payroll_period_paid', () => S.tech && { user_id: S.tech });
await ex('unmark_payroll_period_paid', () => S.tech && { user_id: S.tech });
await ex('update_payroll_settings', { pay_period_type: 'biweekly' });
await ex('update_role_preset', { role: 'technician', permissions: { 'timesheets.update': true } });
await ex('set_member_permissions', () => S.tech && { user_id: S.tech, permissions: { 'timesheets.update': true } });
await ex('reset_member_permissions', () => S.tech && { user_id: S.tech });
await ex('update_member_role', () => S.tech && { user_id: S.tech, role: 'technician' });
await ex('remove_member', () => S.tech && { user_id: S.tech });
await ex('reactivate_member', () => S.tech && { user_id: S.tech });
await ex('invite_member', { email: 'exec.invite@example.com', role: 'technician' }, (r) => { S.invit = trouver(r, null, 'invitation_id', 'id'); });
if (!S.invit) S.invit = trouver(await lire('list_invitations', { status: 'all' }), `exec.${R}.invite`, 'invitation_id', 'id');
await ex('resend_invitation', () => S.invit && { invitation_id: S.invit });
await ex('revoke_invitation', () => S.invit && { invitation_id: S.invit });

// ── Communications, mémoire, notifications ──
if (S.conversation) await ex('mark_conversation_read', { conversation_id: S.conversation }); else exclu('mark_conversation_read', 'aucune conversation texto dans l’org QA (Twilio non branché sur staging)');
exclu('send_sms', 'texto réel (Twilio)'); exclu('send_email', 'courriel réel');
await ex('remember_this', { key: 'exec_test', note: 'Fait retenu pour le test' });
await ex('forget_note', { key: 'exec_test' });
await ex('mark_notifications_read', { ids: [] });
exclu('delete_notification', 'aucune notification ciblable sans en créer une');

// ── Réglages : automatisations, taxes, services, objectifs, rapports ──
// Création par Lumi : un VRAI appel au modèle (Haiku, ~0,3 ¢ la passe) — c'est
// le prix d'une preuve de bout en bout. La règle naît EN PAUSE : rien ne part,
// même en la laissant là. Elle s'accumule sur staging à chaque passe (aucun
// outil Lumi ne supprime une règle) ; son nom est suffixé par la passe, donc
// elle reste reconnaissable et se nettoie depuis la page Automatisations.
await ex('create_automation_from_text',
  { description: 'Après l’envoi d’une soumission, attends 3 jours puis envoie un texto de suivi.' },
  (r) => { S.regleCreee = trouver(r, null, 'rule_id', 'id'); });
await ex('toggle_automation_rule', () => S.regle && { rule_id: S.regle, is_active: false });
await ex('toggle_automation_rule', () => S.regle && { rule_id: S.regle, is_active: true });
await ex('update_automation_message', () => S.regle && { rule_id: S.regle, action_type: 'send_email', body: 'Bonjour {{client_name}}, petit rappel (exec).', subject: 'Rappel' });
await ex('update_automation_sms_body', () => S.regle && { rule_id: S.regle, body: 'Rappel (exec).' });
await ex('set_automation_language', { language: 'fr' });
await ex('create_tax_config', { name: suffixer('Exec taxe'), rate: 1.5, region: 'QC', country: 'CA' }, (r) => { S.taxe = trouver(r, null, 'tax_id', 'id'); });
if (!S.taxe) S.taxe = trouver(await lire('get_tax_config'), suffixer('Exec taxe'), 'tax_id', 'id');
await ex('update_tax_config', () => S.taxe && { tax_id: S.taxe, rate: 2 });
await ex('delete_tax_config', () => S.taxe && { tax_id: S.taxe });
await ex('set_default_tax_group', () => S.groupeTaxes && { group_id: S.groupeTaxes });
exclu('setup_taxes', 'créerait un second groupe régional complet dans l’org QA');
await ex('create_service', { name: suffixer('Exec service'), price_cents: 1000 }, (r) => { S.service = trouver(r, null, 'service_id', 'id'); });
if (!S.service) S.service = trouver(await lire('list_services'), suffixer('Exec service'), 'service_id', 'id');
await ex('update_service', () => S.service && { service_id: S.service, price_cents: 1200 });
await ex('archive_service', () => S.service && { service_id: S.service });
await ex('set_goal', { metric: 'jobs', target_value: 10, period: 'monthly', start_date: jour(30), end_date: jour(60) }, (r) => { S.objectif = trouver(r, null, 'goal_id', 'id'); });
if (!S.objectif) S.objectif = trouver(await lire('list_goals'), null, 'goal_id', 'id');
await ex('delete_goal', () => S.objectif && { goal_id: S.objectif });
await ex('create_scheduled_report', { recipient_email: 'exec.rapport@example.com', frequency: 'weekly', day_of_week: 1 }, (r) => { S.rapport = trouver(r, null, 'report_id', 'id'); });
if (!S.rapport) S.rapport = trouver(await lire('list_scheduled_reports'), `exec.${R}.rapport`, 'report_id', 'id');
await ex('update_scheduled_report', () => S.rapport && { report_id: S.rapport, frequency: 'monthly', day_of_month: 2 });
if (process.env.RESEND_API_KEY || process.env.SMTP_HOST) await ex('send_scheduled_report_now', () => S.rapport && { report_id: S.rapport });
else exclu('send_scheduled_report_now', 'aucun fournisseur de courriel configuré dans cet environnement (RESEND_API_KEY / SMTP_HOST absents)');
await ex('delete_scheduled_report', () => S.rapport && { report_id: S.rapport });

// ── Terrain, formations ──
await ex('create_house', { address: suffixer('9 rue Exec'), lat: 45.51, lng: -73.56, status: 'unknown' }, (r) => { S.maison = trouver(r, null, 'house_id', 'id'); });
if (!S.maison) S.maison = trouver(await lire('list_houses', { query: 'Exec' }), suffixer('9 rue Exec'), 'house_id', 'id');
await ex('update_house', () => S.maison && { house_id: S.maison, status: 'callback' });
await ex('log_house_event', () => S.maison && { house_id: S.maison, event_type: 'knock', note_text: 'exec' });
await ex('create_territory', { name: suffixer('Exec territoire'), polygon: [[-73.6, 45.5], [-73.6, 45.51], [-73.59, 45.51], [-73.59, 45.5]] }, (r) => { S.territoire = trouver(r, null, 'territory_id', 'id'); });
if (!S.territoire) S.territoire = trouver(await lire('list_territories'), suffixer('Exec territoire'), 'territory_id', 'id');
await ex('update_territory', () => S.territoire && { territory_id: S.territoire, color: '#f97316' });
await ex('create_rep', () => S.tech && { user_id: S.tech, display_name: 'Antoine (exec)' });
await ex('create_d2d_team', { name: 'Exec d2d' });
await ex('update_d2d_pipeline_item', () => S.deal && { deal_id: S.deal, d2d_status: 'follow_up' });
await ex('update_d2d_settings', { feature_enabled: true });
for (const n of ['start_field_session', 'pause_field_session', 'resume_field_session', 'end_field_session']) exclu(n, 'exige le consentement au partage de position du compte (règle de l’app : « Location sharing consent has not been granted »)');
await ex('create_badge', { slug: 'exec_badge', name_fr: 'Exec badge' });
await ex('create_challenge', { name_fr: 'Exec défi', type: 'weekly', metric_slug: 'knocks', start_date: jour(1), end_date: jour(7) });
await ex('create_battle', () => S.tech && { name: 'Exec bataille', metric_slug: 'knocks', opponent_user_id: S.tech, start_date: jour(1), end_date: jour(7) });
await ex('create_course', { title: 'Exec formation' }, (r) => { S.cours = trouver(r, null, 'course_id', 'id'); });
await ex('create_course_module', () => S.cours && { course_id: S.cours, title: 'Exec module' }, (r) => { S.module = trouver(r, null, 'module_id', 'id'); });
await ex('create_course_lesson', () => S.module && { module_id: S.module, title: 'Exec leçon', content_type: 'text', text_content: 'Exec' }, (r) => { S.lecon = trouver(r, null, 'lesson_id', 'id'); });
await ex('update_course_lesson', () => S.lecon && { lesson_id: S.lecon, title: 'Exec leçon 2' });
await ex('update_course', () => S.cours && { course_id: S.cours, description: 'Exec' });
await ex('publish_course', () => S.cours && { course_id: S.cours, publish: true });
await ex('assign_course', () => S.cours && S.tech && { course_id: S.cours, user_ids: [S.tech] });

// ── Ménage : le client de test, ses jobs, les prospects (convertis ou non) — sinon les évaluations tombent dessus ──
if (S.jobDuLead) await ex('delete_job', { job_id: S.jobDuLead });
if (S.clientDuLead) await ex('delete_client', { client_id: S.clientDuLead });
if (S.lead2) await ex('delete_lead', { lead_id: S.lead2 });
await ex('delete_job', () => S.job && { job_id: S.job });
if (S.jobFacture) await ex('delete_job', { job_id: S.jobFacture });
await ex('delete_client', () => S.client && { client_id: S.client });

// ── Bilan ──
const noms = new Set(AGENT_TOOLS.filter((t) => t.kind === 'write').map((t) => t.declaration.name));
const vus = new Set(resultats.map((r) => r.outil));
for (const n of noms) if (!vus.has(n) && (!SEULEMENT || SEULEMENT.has(n))) resultats.push({ outil: n, verdict: 'non_couvert', detail: 'pas de scénario', duree_ms: 0 });
const bilan = { ok: 0, erreur: 0, exclu: 0, non_couvert: 0 } as Record<string, number>;
for (const r of resultats) bilan[r.verdict] += 1;
console.log(`\nTOTAL ${bilan.ok} ok · ${bilan.erreur} erreur · ${bilan.exclu} exclu · ${bilan.non_couvert} non couvert / ${resultats.length}`);
for (const r of resultats.filter((x) => x.verdict === 'erreur')) console.log(`  ERR  ${r.outil.padEnd(30)} ${r.detail}`);
for (const r of resultats.filter((x) => x.verdict === 'non_couvert')) console.log(`  ?    ${r.outil.padEnd(30)} ${r.detail}`);
writeFileSync(arg('--sortie') || (process.env.TEMP + '/qa-execution.json'), JSON.stringify({ bilan, resultats }, null, 1));
process.exit(bilan.erreur ? 1 : 0);
