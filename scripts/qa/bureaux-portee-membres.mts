/**
 * Portée de visibilité d'un membre (self / team / company) — prouvée contre la
 * base staging avec de VRAIS jetons (PostgREST + RLS), sans passer par le serveur.
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa/bureaux-portee-membres.mts
 *
 * Un bureau A avec : propriétaire, rep « moi seulement », tech1 et tech2 « mon équipe »
 * (même équipe), rep2 « tout le bureau ». Données :
 *   c1 créé par rep ; c2 créé par le propriétaire ; c3 assigné à rep ;
 *   c4 client de la job j1 assignée à tech1 ; c5 client de la soumission q1 vendue par rep ;
 *   conversation v1 du client c1, avec un message ; conversation v2 du client c2.
 * Attendu :
 *   propriétaire et rep2 : tout ; rep : c1 c3 c5, q1, v1 (+ son message), rien de j1 ;
 *   tech1 et tech2 (même équipe) : j1 et c4, pas c1 ; un rep « moi seulement » crée un client et le voit.
 * Tout ce qui est créé est retiré à la fin.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const API = (process.env.API_URL_QA || 'http://localhost:3188').replace(/\/$/, '');
const BASE = (process.env.FRONTEND_URL_QA || 'http://localhost:5288').replace(/\/$/, '');

const url = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
if (!url.includes(process.env.SUPABASE_PROJECT_REF!) || url.includes(process.env.SUPABASE_PROJECT_REF_PROD!)) throw new Error('staging seulement');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

const s = Date.now().toString(36);
const ok: string[] = [];
const ko: string[] = [];
const verifier = (nom: string, cond: boolean, detail = '') => (cond ? ok : ko).push(`${nom}${detail ? ` — ${detail}` : ''}`);
const nettoyer: Array<() => PromiseLike<unknown>> = [];

async function utilisateur(etiquette: string) {
  const courriel = `qa.portee.${etiquette}.${s}@exemple.invalid`;
  const mdp = crypto.randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({ email: courriel, password: mdp, email_confirm: true });
  if (error || !data.user) throw error ?? new Error('utilisateur');
  nettoyer.unshift(() => admin.auth.admin.deleteUser(data.user!.id));
  const anon = createClient(url, ANON, { auth: { persistSession: false } });
  const { data: sess, error: eS } = await anon.auth.signInWithPassword({ email: courriel, password: mdp });
  if (eS || !sess.session) throw eS ?? new Error('session');
  return { id: data.user.id, jeton: sess.session.access_token, session: sess.session };
}
const client = (jeton: string, org: string): SupabaseClient => createClient(url, ANON, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${jeton}`, 'x-lume-org': org } },
});
const ids = async (c: SupabaseClient, table: string, org: string) => {
  const { data, error } = await c.from(table).select('id').eq('org_id', org);
  if (error) throw new Error(`${table} : ${error.message}`);
  return new Set((data || []).map((r: any) => r.id as string));
};
const pareil = (a: Set<string>, attendu: string[]) => a.size === attendu.length && attendu.every((x) => a.has(x));

try {
  const proprio = await utilisateur('proprio');
  const rep = await utilisateur('rep');
  const rep2 = await utilisateur('rep2');
  const tech1 = await utilisateur('tech1');
  const tech2 = await utilisateur('tech2');
  const { data: A, error: eA } = await admin.from('orgs').insert({ name: `QA portee ${s}`, created_by: proprio.id }).select('id').single();
  if (eA) throw eA;
  nettoyer.unshift(() => admin.from('orgs').delete().eq('id', A.id));
  nettoyer.unshift(() => admin.from('memberships').delete().eq('org_id', A.id));
  const { data: equipe, error: eT } = await admin.from('teams').insert({ org_id: A.id, name: `QA équipe ${s}` }).select('id').single();
  if (eT) throw eT;
  nettoyer.unshift(() => admin.from('teams').delete().eq('org_id', A.id));
  const adh = async (u: string, role: string, scope: string, team_id: string | null = null) => {
    const { error } = await admin.from('memberships').upsert({ user_id: u, org_id: A.id, role, status: 'active', scope, team_id }, { onConflict: 'user_id,org_id' });
    if (error) throw new Error(`adhésion : ${error.message}`);
    await admin.from('memberships').update({ scope, team_id }).eq('user_id', u).eq('org_id', A.id);
  };
  await adh(proprio.id, 'owner', 'company');
  await adh(rep.id, 'sales_rep', 'self');
  await adh(rep2.id, 'sales_rep', 'company');
  await adh(tech1.id, 'technician', 'team', equipe.id);
  await adh(tech2.id, 'technician', 'team', equipe.id);
  const { data: plan } = await admin.from('plans').select('id').eq('includes_sms', true).limit(1).single();
  const { data: abo, error: eAbo } = await admin.from('subscriptions').insert({ user_id: proprio.id, org_id: A.id, plan_id: plan!.id, status: 'active' }).select('id').single();
  if (eAbo) throw eAbo;
  nettoyer.unshift(() => admin.from('subscriptions').delete().eq('id', abo!.id));

  const ins = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await admin.from(table).insert({ org_id: A.id, ...row }).select('id').single();
    if (error) throw new Error(`${table} : ${error.message}`);
    return data.id as string;
  };
  for (const t of ['messages', 'conversations', 'invoices', 'quotes', 'schedule_events', 'tasks', 'jobs', 'clients']) nettoyer.unshift(() => admin.from(t).delete().eq('org_id', A.id));
  const c1 = await ins('clients', { first_name: 'C1', last_name: s, created_by: rep.id });
  const c2 = await ins('clients', { first_name: 'C2', last_name: s, created_by: proprio.id });
  const c3 = await ins('clients', { first_name: 'C3', last_name: s, created_by: proprio.id, assigned_to: rep.id });
  const c4 = await ins('clients', { first_name: 'C4', last_name: s, created_by: proprio.id });
  const c5 = await ins('clients', { first_name: 'C5', last_name: s, created_by: proprio.id });
  const j1 = await ins('jobs', { client_id: c4, title: `J1 ${s}`, created_by: proprio.id, assigned_user_id: tech1.id });
  const q1 = await ins('quotes', { client_id: c5, quote_number: `QP-${s}`, title: 'Q1', created_by: proprio.id, salesperson_id: rep.id });
  const v1 = await ins('conversations', { phone_number: '+15145550121', client_id: c1, client_name: 'C1' });
  const v2 = await ins('conversations', { phone_number: '+15145550122', client_id: c2, client_name: 'C2' });
  const m1 = await ins('messages', { conversation_id: v1, phone_number: '+15145550121', direction: 'inbound', message_text: 'm1', status: 'received' });
  await ins('messages', { conversation_id: v2, phone_number: '+15145550122', direction: 'inbound', message_text: 'm2', status: 'received' });

  const tous = [c1, c2, c3, c4, c5];
  // Propriétaire et rep « tout le bureau »
  for (const [nom, u] of [['propriétaire', proprio], ['rep tout le bureau', rep2]] as const) {
    const cl = await ids(client(u.jeton, A.id), 'clients', A.id);
    verifier(`1. ${nom} : voit tous les clients`, tous.every((x) => cl.has(x)), `${cl.size} client(s)`);
  }
  // Rep « moi seulement »
  const cr = client(rep.jeton, A.id);
  const clientsRep = await ids(cr, 'clients', A.id);
  verifier('2. rep « moi seulement » : ses clients (créé, assigné, de sa soumission), pas les autres', pareil(clientsRep, [c1, c3, c5]), `${[...clientsRep].length} client(s)`);
  verifier('2b. rep : sa soumission, aucune job des autres', pareil(await ids(cr, 'quotes', A.id), [q1]) && (await ids(cr, 'jobs', A.id)).size === 0);
  verifier('2c. rep : la conversation de son client et son message seulement', pareil(await ids(cr, 'conversations', A.id), [v1]) && pareil(await ids(cr, 'messages', A.id), [m1]));
  // Techniciens « mon équipe »
  for (const [nom, u] of [['tech1 (assigné)', tech1], ['tech2 (coéquipier)', tech2]] as const) {
    const ct = client(u.jeton, A.id);
    const jobs = await ids(ct, 'jobs', A.id);
    const cl = await ids(ct, 'clients', A.id);
    verifier(`3. ${nom} « mon équipe » : la job de l’équipe et son client, rien d’autre`, pareil(jobs, [j1]) && pareil(cl, [c4]), `${jobs.size} job(s), ${cl.size} client(s)`);
  }
  // Créer en « moi seulement »
  const { data: cree, error: eCree } = await cr.from('clients').insert({ org_id: A.id, first_name: 'Nouveau', last_name: s }).select('id').single();
  verifier('4. rep « moi seulement » : crée un client et le voit', !eCree && !!cree && (await ids(cr, 'clients', A.id)).has(cree.id), eCree?.message ?? '');
  // Modifier une fiche invisible : aucune ligne touchée
  const { data: modif } = await cr.from('clients').update({ first_name: 'Piraté' }).eq('id', c2).select('id');
  const { data: c2apres } = await admin.from('clients').select('first_name').eq('id', c2).single();
  verifier('5. rep « moi seulement » : ne peut pas modifier un client qu’il ne voit pas', (modif || []).length === 0 && c2apres?.first_name === 'C2');
  // Propriétaire toujours tout, même si sa portée enregistrée était restreinte
  await admin.from('memberships').update({ scope: 'self' }).eq('user_id', proprio.id).eq('org_id', A.id);
  const clProp = await ids(client(proprio.jeton, A.id), 'clients', A.id);
  verifier('6. propriétaire : tout, quelle que soit sa portée enregistrée', tous.every((x) => clProp.has(x)));
  await admin.from('memberships').update({ scope: 'company' }).eq('user_id', proprio.id).eq('org_id', A.id);
  // Recherche globale (serveur, clé de service) : filtrée pour le rep « moi seulement »
  const chercher = async (jeton: string, chemin: string) => {
    const r = await fetch(`${API}${chemin}`, { headers: { Authorization: `Bearer ${jeton}`, 'x-org-id': A.id } });
    return { status: r.status, j: await r.json().catch(() => null) as any };
  };
  const sugRep = await chercher(rep.jeton, `/api/search/suggestions?q=${s}&limit=12`);
  // Un client sans statut sort comme « lead » dans la recherche : on regarde les deux groupes.
  const clientsSug = new Set([...(sugRep.j?.grouped?.clients || []), ...(sugRep.j?.grouped?.leads || [])].map((c: any) => c.id));
  verifier('8. recherche du rep « moi seulement » : seulement ses clients', sugRep.status === 200 && !clientsSug.has(c2) && !clientsSug.has(c4) && [c1, c3, c5].every((x) => clientsSug.has(x)),
    `HTTP ${sugRep.status}, ${clientsSug.size} client(s)`);
  const resRep = await chercher(rep.jeton, `/api/search/results?q=${s}&tab=all`);
  const resProp = await chercher(proprio.jeton, `/api/search/results?q=${s}&tab=all`);
  verifier('8b. compteurs de recherche : ceux du rep ne révèlent pas le bureau', (resRep.j?.counts?.clients + resRep.j?.counts?.leads) === 4 && (resProp.j?.counts?.clients + resProp.j?.counts?.leads) >= 6,
    `rep ${resRep.j?.counts?.clients + resRep.j?.counts?.leads}, propriétaire ${resProp.j?.counts?.clients + resProp.j?.counts?.leads}`);

  // Page Équipe : le propriétaire règle « Voit » du rep2 sur « Ses fiches seulement »
  const dir = path.join(process.cwd(), 'qa-captures');
  fs.mkdirSync(dir, { recursive: true });
  const nav = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const erreurs: string[] = [];
  try {
    const page = await nav.newPage();
    page.on('pageerror', (e) => erreurs.push(e instanceof Error ? e.message : String(e)));
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((t, o) => {
      localStorage.setItem('lume-auth-token', JSON.stringify(t)); localStorage.setItem('lume-active-org', o);
      localStorage.setItem('lume-language', 'fr'); localStorage.setItem('lume-setup-dismissed', '1');
      localStorage.setItem('lume.cookieConsent.v1', JSON.stringify({ analytics: false, marketing: false, preferences: false, decidedAt: new Date().toISOString(), docVersion: 'cookie-policy-2026-07-23' }));
    }, { ...proprio.session, token_type: 'bearer' }, A.id);
    await page.goto(`${BASE}/settings/team`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Refuser')?.click());
    const selects = await page.waitForFunction(() => document.querySelectorAll('select[aria-label="Ce que cette personne voit"]').length >= 4, { timeout: 20000 }).then(() => true).catch(() => false);
    const n = await page.evaluate(() => document.querySelectorAll('select[aria-label="Ce que cette personne voit"]').length);
    // Le rep2 est le seul réglé « Tout le bureau » parmi les restreints ; on trouve sa ligne par sa valeur.
    const idx = await page.evaluate(() => [...document.querySelectorAll('select[aria-label="Ce que cette personne voit"]')].findIndex((el) => (el as HTMLSelectElement).value === 'company'));
    if (idx >= 0) {
      const handles = await page.$$('select[aria-label="Ce que cette personne voit"]');
      await handles[idx].select('self');
    }
    let scopeRep2 = '';
    for (let i = 0; i < 20 && scopeRep2 !== 'self'; i++) {
      scopeRep2 = (await admin.from('memberships').select('scope').eq('user_id', rep2.id).eq('org_id', A.id).single()).data?.scope;
      if (scopeRep2 !== 'self') await new Promise((r) => setTimeout(r, 400));
    }
    await page.screenshot({ path: path.join(dir, 'portee-equipe.png') });
    verifier('9. page Équipe : régler « Voit » l’enregistre (rep2 → ses fiches seulement)', selects && scopeRep2 === 'self', `${n} sélecteur(s), portée ${scopeRep2}`);
    const clRep2Apres = await ids(client(rep2.jeton, A.id), 'clients', A.id);
    verifier('9b. rep2 ne voit plus que ses fiches (aucune ici)', clRep2Apres.size === 0, `${clRep2Apres.size} client(s)`);
    await page.close();
  } finally { await nav.close(); }
  verifier('9c. aucune erreur navigateur', erreurs.length === 0, erreurs.join(' | '));

  // Repasser le rep en « tout le bureau » : il voit tout, immédiatement (même jeton)
  await admin.from('memberships').update({ scope: 'company' }).eq('user_id', rep.id).eq('org_id', A.id);
  const clRep2 = await ids(cr, 'clients', A.id);
  verifier('7. rep repassé « tout le bureau » : voit tout sans se reconnecter', tous.every((x) => clRep2.has(x)));
} finally {
  for (const f of nettoyer) { try { await f(); } catch (e) { console.error('nettoyage :', e); } }
}
for (const x of ok) console.log('  ✓', x);
for (const x of ko) console.log('  ✗', x);
console.log(`${ok.length}/${ok.length + ko.length}`);
process.exit(ko.length ? 1 : 0);
