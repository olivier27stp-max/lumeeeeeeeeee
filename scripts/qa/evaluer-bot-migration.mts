/**
 * Essai de bout en bout du bot de migration sur STAGING :
 *   node --env-file=.env.local --import tsx scripts/qa/evaluer-bot-migration.mts
 * Crée une migration Jobber synthétique (clients + jobs, avec un doublon par
 * courriel, une colonne inconnue, une date ambiguë), dépose les CSV dans le
 * bucket comme le portail le ferait, puis fait passer le bot jusqu'à ce qu'il
 * s'arrête. Répond aux questions du bot par la première option, relance.
 * Vérifie : statut final = waiting_for_approval (jamais approved), décisions
 * auditées 'assistant', questions posées, coût modèle. Nettoie à la fin.
 */
// EN PREMIER : pose le palier économe avant que bot.ts ne lise LUMI_MODEL_MIGRATION
// et LUMI_EFFORT_MIGRATION au chargement du module (incident 2026-09-18).
import './reglages-eval.mts';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { executerBotMigration, TYPE_NOTIFICATION_ADMIN } from '../../server/lib/migration/bot';
import { approuverAuNomDuClient } from '../../server/lib/migration/execution';

/** QA_BOT_MODE=client rejoue l'ancien parcours (questions au client) ; défaut : autonome, le client ne fait rien. */
const MODE: 'client' | 'autonome' = process.env.QA_BOT_MODE === 'client' ? 'client' : 'autonome';
import { MIGRATION_BUCKET } from '../../server/lib/migration/pipeline';

const url = process.env.VITE_SUPABASE_URL!;
const ref = process.env.SUPABASE_PROJECT_REF!;
if (!url.includes(ref) || (process.env.SUPABASE_PROJECT_REF_PROD && url.includes(process.env.SUPABASE_PROJECT_REF_PROD))) throw new Error('pas staging — abandon');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const email = process.env.QA_COMPTE || 'willhebert30@gmail.com';

const { data: lien, error: eLien } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
if (eLien || !lien?.user) throw new Error(`compte ${email} introuvable : ${eLien?.message ?? ''}`);
const userId = lien.user.id as string;
const { data: m } = await admin.from('memberships').select('org_id').eq('user_id', userId).eq('status', 'active').limit(1).maybeSingle();
const orgId = m!.org_id as string;
const { data: clientExistant } = await admin.from('clients').select('email, first_name, last_name').eq('org_id', orgId).is('deleted_at', null).not('email', 'is', null).limit(1).maybeSingle();

// ── CSV synthétiques (export Jobber) ──
const clientsCsv = [
  'Client Name,Company Name,Email,Phone Number,Alternate Phone,Street 1,City,Province,Postal Code,Tags,Lead Source,Created On,Zone tarifaire',
  'Marie Tremblay,,marie.tremblay@example.com,514-555-0101,,12 rue des Pins,Longueuil,QC,J4K 1A1,vip,Google,03/04/2024,Nord',
  'Luc Lavoie,Lavoie inc.,luc@lavoie.example,450-555-0102,450-555-0199,987 ch. Sainte-Foy,Québec,QC,G1S 2J5,,Référence,11/07/2023,Sud',
  `${clientExistant ? `${clientExistant.first_name ?? 'Existant'} ${clientExistant.last_name ?? 'Test'}` : 'Existant Test'},,${clientExistant?.email ?? 'existant@example.com'},418-555-0103,,1 rue Test,Lévis,QC,G6V 1A1,,,05/06/2024,Est`,
  'Sophie Bouchard,,sophie.b@example.com,819-555-0104,,55 av. du Parc,Sherbrooke,QC,J1H 1A1,,Site web,12/12/2023,Nord',
].join('\n');
const jobsCsv = [
  'Job #,Title,Client Name,Property Address,Scheduled Start,Scheduled End,Status,Total,Assigned To,Instructions internes',
  '1001,Lavage de vitres,Marie Tremblay,12 rue des Pins Longueuil,06/15/2024 09:00,06/15/2024 11:00,Completed,275.00,Marc,apporter escabeau',
  '1002,Garde-gouttières,Luc Lavoie,987 ch. Sainte-Foy Québec,07/02/2024 13:00,07/02/2024 16:00,Scheduled,1910.00,Marc,',
  '1003,Nettoyage,Client Inconnu,1 rue Nulle Part,08/01/2024 08:00,08/01/2024 09:00,Completed,120.00,,',
].join('\n');

// ── Migration + fichiers, comme le portail ──
const { data: mig, error: eMig } = await admin.from('data_migrations').insert({
  org_id: orgId, source_crm: 'jobber', status: 'files_uploaded', categories: ['clients', 'jobs'], priority: 'normal', bot_mode: MODE,
  internal_notes: 'QA bot de migration (synthétique) — à supprimer', invited_email: email, invited_user_id: userId, assigned_admin: userId, created_by: userId,
}).select('id').single();
if (eMig) throw eMig;
const migId = mig.id as string;
async function deposer(nom: string, contenu: string) {
  const fileId = crypto.randomUUID();
  const path = `${orgId}/${migId}/${fileId}/${nom}`;
  const buf = Buffer.from(contenu, 'utf8');
  const { error: up } = await admin.storage.from(MIGRATION_BUCKET).upload(path, buf, { contentType: 'text/csv', upsert: false });
  if (up) throw up;
  const { error } = await admin.from('migration_files').insert({ id: fileId, migration_id: migId, storage_path: path, original_name: nom, mime_type: 'text/csv', size_bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), kind: 'data', security_status: 'uploaded', parse_status: 'pending', uploaded_by: userId });
  if (error) throw error;
}
await deposer('clients.csv', clientsCsv);
await deposer('jobs.csv', jobsCsv);
console.log(`migration ${migId} créée (org ${orgId}) avec 2 fichiers — mode ${MODE}`);

const fautes: string[] = [];
let cout = 0;
try {
  for (let passe = 1; passe <= 4; passe++) {
    const r = await executerBotMigration(admin, migId, { acteurId: userId, declencheur: 'manuel' });
    cout += r.cout_cents ?? 0;
    console.log(`\n── passe ${passe} : ${r.statut_avant} → ${r.statut_apres} · ${r.decisions.length} décisions · arrêt : ${r.arret}${r.cout_cents != null ? ` · ${r.cout_cents.toFixed(2)} ¢` : ''}`);
    for (const d of r.decisions) console.log(`   [${d.etape}] ${d.cible} — ${d.decision}${d.detail ? ` (${d.detail})` : ''}`);
    if (r.statut_apres === 'waiting_for_approval') break;
    if (r.arret.startsWith('erreur interne')) { fautes.push(r.arret); break; }
    const { data: qs } = await admin.from('migration_issues').select('id, title, options').eq('migration_id', migId).eq('client_visible', true).is('client_answer', null).is('resolved_at', null);
    if (MODE === 'autonome') {
      // Le client n'a rien à faire : aucune question visible ne doit exister, et le bot ne doit pas attendre le client.
      if (qs?.length) fautes.push(`${qs.length} question(s) visible(s) par le client en mode autonome : ${qs.map((q) => q.title).join(' | ')}`);
      if (r.statut_apres === 'waiting_for_client') fautes.push('statut waiting_for_client en mode autonome');
      if (fautes.length) break;
      continue;
    }
    // Mode client : le « client » répond à chaque question ouverte par la première option.
    if (!qs?.length) { if (passe === 4) fautes.push(`arrêt sans question ni approbation : ${r.arret}`); continue; }
    for (const q of qs) {
      const rep = Array.isArray(q.options) && q.options.length ? String(q.options[0]) : 'MM/JJ';
      await admin.from('migration_issues').update({ client_answer: rep, client_answered_at: new Date().toISOString() }).eq('id', q.id);
      console.log(`   client répond « ${rep} » à : ${q.title}`);
    }
  }
  const { data: fin } = await admin.from('data_migrations').select('status, bot_dernier_rapport').eq('id', migId).single();
  console.log(`\nstatut final : ${fin!.status}`);
  if (fin!.status !== 'waiting_for_approval') fautes.push(`statut final ${fin!.status} (attendu waiting_for_approval)`);
  const { data: audit } = await admin.from('migration_audit_logs').select('action, actor_role').eq('migration_id', migId);
  const parRole = (audit ?? []).reduce((a: Record<string, number>, x: any) => { a[x.actor_role] = (a[x.actor_role] ?? 0) + 1; return a; }, {});
  console.log('audit par acteur :', JSON.stringify(parRole));
  if (!(parRole.assistant > 0)) fautes.push('aucune décision auditée comme assistant');
  if ((audit ?? []).some((x: any) => /approval\.decide|import\.final/.test(x.action))) fautes.push('le bot a touché à l’approbation ou à l’import final');
  const { data: maps } = await admin.from('migration_field_mappings').select('status, decided_role').eq('migration_id', migId);
  const c = (maps ?? []).reduce((a: Record<string, number>, x: any) => { const k = `${x.status}/${x.decided_role ?? '-'}`; a[k] = (a[k] ?? 0) + 1; return a; }, {});
  console.log('correspondances :', JSON.stringify(c));
  const { data: dups } = await admin.from('migration_duplicate_candidates').select('decision, score').eq('migration_id', migId);
  console.log('doublons :', JSON.stringify(dups ?? []));
  if (MODE === 'autonome' && fin!.status === 'waiting_for_approval') {
    const { data: notifs } = await admin.from('notifications').select('id, user_id, title').eq('type', TYPE_NOTIFICATION_ADMIN).eq('link', `/admin/migrations#${migId}`);
    console.log(`notifications admin : ${(notifs ?? []).length}`);
    if (!(notifs ?? []).some((n) => n.user_id === userId)) fautes.push("aucune notification d'approbation pour l'admin assigné");
    const { data: visibles } = await admin.from('migration_issues').select('id').eq('migration_id', migId).eq('client_visible', true).is('resolved_at', null);
    if (visibles?.length) fautes.push(`${visibles.length} question(s) encore visible(s) par le client`);
    // L'admin approuve au nom du client (geste humain, hors bot) : la migration passe à approved.
    const { data: mAvant } = await admin.from('data_migrations').select('*').eq('id', migId).single();
    const refus = await approuverAuNomDuClient(admin, mAvant as any, { id: userId, role: 'platform_admin' }, { commentaire: 'QA' });
    if (refus) fautes.push(`approbation au nom du client refusée : ${refus}`);
    const { data: apres } = await admin.from('data_migrations').select('status').eq('id', migId).single();
    console.log(`après approbation au nom du client : ${apres!.status}`);
    if (apres!.status !== 'approved') fautes.push(`statut ${apres!.status} après approbation au nom du client (attendu approved)`);
    const { data: appr } = await admin.from('migration_approvals').select('decision, confirmed_text, comment').eq('migration_id', migId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!appr || appr.decision !== 'approved' || appr.confirmed_text !== null || !/au nom du client/.test(String(appr.comment))) fautes.push('ligne d’approbation au nom du client incorrecte');
  }
  const { data: msgs } = await admin.from('migration_messages').select('author_kind, body').eq('migration_id', migId).order('created_at');
  for (const x of msgs ?? []) console.log(`message ${x.author_kind} : ${String(x.body).slice(0, 160).replace(/\n/g, ' / ')}`);
  console.log(`coût modèle total : ${cout.toFixed(2)} ¢`);
} finally {
  await admin.from('data_migrations').update({ status: 'cancelled', deleted_at: new Date().toISOString() }).eq('id', migId);
  await admin.from('notifications').update({ deleted_at: new Date().toISOString(), is_read: true }).eq('type', TYPE_NOTIFICATION_ADMIN).eq('link', `/admin/migrations#${migId}`);
  console.log('migration QA marquée annulée + supprimée (soft), notifications QA retirées');
}
console.log(fautes.length ? `\nECHEC : ${fautes.join(' ; ')}` : MODE === 'autonome' ? '\nOK : le bot a mené la migration jusqu’à l’approbation sans rien demander au client ; l’admin a approuvé au nom du client.' : '\nOK : le bot a mené la migration jusqu’à la demande d’approbation, sans la franchir.');
process.exit(fautes.length ? 1 : 0);
