/**
 * Types « Case à cocher », « URL » et « Fichier » (migration 20260929170000) contre staging,
 * avec un vrai jeton de propriétaire, par l'API de la base (cf_ecrire_valeur,
 * cf_filtrer, cf_ordre_ids) :
 *   · une case s'écrit oui / non ; un texte dans une case est refusé ;
 *   · « est non » trouve aussi la fiche jamais cochée ;
 *   · une URL http(s) passe ; « javascript: » et « data: » sont refusées ;
 *   · une URL se filtre « contient » comme un texte ;
 *   · le tri par la case met les cochées d'un côté ;
 *   · fichier : téléversé dans le dossier de l'entreprise, relu par lien signé ;
 *     une autre entreprise ne peut ni l'écrire chez elle, ni le lire, ni le
 *     rattacher à ses fiches ; un chemin hors dossier est refusé par le trigger.
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa/champs-types-case-url.mts
 */
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
if (!url.includes(process.env.SUPABASE_PROJECT_REF!) || url.includes(process.env.SUPABASE_PROJECT_REF_PROD!)) throw new Error('staging seulement');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const s = Date.now().toString(36);
const ok: string[] = []; const ko: string[] = [];
const verifier = (n: string, c: boolean, d = '') => (c ? ok : ko).push(`${n}${d ? ` — ${d}` : ''}`);
const nettoyer: Array<() => PromiseLike<unknown>> = [];

try {
  const courriel = `qa.cftypes.${s}@exemple.invalid`; const mdp = crypto.randomBytes(18).toString('base64url');
  const { data: u } = await admin.auth.admin.createUser({ email: courriel, password: mdp, email_confirm: true });
  nettoyer.unshift(() => admin.auth.admin.deleteUser(u.user!.id));
  const { data: o } = await admin.from('orgs').insert({ name: `QA cftypes ${s}`, created_by: u.user!.id }).select('id').single();
  const org = o!.id as string;
  nettoyer.unshift(() => admin.from('orgs').delete().eq('id', org));
  nettoyer.unshift(() => admin.from('memberships').delete().eq('org_id', org));
  nettoyer.unshift(() => admin.from('clients').delete().eq('org_id', org));
  nettoyer.unshift(() => admin.from('custom_fields').delete().eq('org_id', org));
  nettoyer.unshift(() => admin.from('custom_field_values').delete().eq('org_id', org));
  await admin.from('memberships').upsert({ user_id: u.user!.id, org_id: org, role: 'owner', status: 'active' }, { onConflict: 'user_id,org_id' });
  const { data: sess } = await createClient(url, ANON, { auth: { persistSession: false } }).auth.signInWithPassword({ email: courriel, password: mdp });
  const db = createClient(url, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${sess.session!.access_token}` } } });

  const champ = async (key: string, type: string) => {
    const { data, error } = await db.rpc('cf_creer_champ', { p_org: org, p_object: 'client', p_folder: null, p_champ: { key, label: key, field_type: type } });
    if (error) throw new Error(`${type} : ${error.message}`);
    return data as string;
  };
  const caseId = await champ('garantie', 'checkbox');
  const urlId = await champ('site_web', 'url');
  verifier('les deux types se créent', !!caseId && !!urlId);

  const clients: string[] = [];
  for (const n of ['A', 'B', 'C']) {
    const { data } = await admin.from('clients').insert({ org_id: org, first_name: n, last_name: s, created_by: u.user!.id }).select('id').single();
    clients.push(data!.id);
  }
  const ecrire = (f: string, e: string, cols: Record<string, unknown> | null) => db.rpc('cf_ecrire_valeur', { p_field: f, p_entity: e, p_cols: cols });

  // Case : A cochée, B décochée, C jamais remplie.
  const a = await ecrire(caseId, clients[0], { value_boolean: true });
  const b = await ecrire(caseId, clients[1], { value_boolean: false });
  verifier('case : oui et non s’écrivent', !a.error && !b.error, a.error?.message ?? b.error?.message);
  const mauvais = await ecrire(caseId, clients[2], { value_text: 'peut-être' });
  verifier('case : un texte est refusé', !!mauvais.error, mauvais.error?.message ?? 'accepté !');
  const filtre = async (conditions: unknown[]) => {
    const r = await db.rpc('cf_filtrer', { p_org: org, p_object: 'client', p_conditions: conditions });
    if (r.error) throw new Error(r.error.message);
    return ((r.data ?? []) as unknown[]).map((x) => (typeof x === 'string' ? x : String(Object.values(x as object)[0]))).sort();
  };
  const oui = await filtre([{ field_id: caseId, op: 'is', value: true }]);
  verifier('filtre « est oui » : seulement A', JSON.stringify(oui) === JSON.stringify([clients[0]]), JSON.stringify(oui));
  const non = await filtre([{ field_id: caseId, op: 'is', value: false }]);
  verifier('filtre « est non » : B ET C (jamais cochée)', JSON.stringify(non) === JSON.stringify([clients[1], clients[2]].sort()), JSON.stringify(non));

  // URL
  const bon = await ecrire(urlId, clients[0], { value_text: 'https://toiture-exemple.ca/devis' });
  verifier('url https acceptée', !bon.error, bon.error?.message);
  for (const piege of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'toiture.ca']) {
    const r = await ecrire(urlId, clients[1], { value_text: piege });
    verifier(`url refusée : ${piege}`, !!r.error, r.error?.message ?? 'acceptée !');
  }
  const contient = await filtre([{ field_id: urlId, op: 'contains', value: 'TOITURE' }]);
  verifier('url : filtre « contient » (sans casse)', JSON.stringify(contient) === JSON.stringify([clients[0]]), JSON.stringify(contient));

  // Tri par la case.
  const ordre = async (asc: boolean) => ((await db.rpc('cf_ordre_ids', { p_field: caseId, p_asc: asc })).data ?? []) as string[];
  const desc = await ordre(false);
  verifier('tri décroissant : cochée d’abord', desc[0] === clients[0], JSON.stringify(desc));
  const asc = await ordre(true);
  verifier('tri croissant : non cochée d’abord', asc[0] === clients[1], JSON.stringify(asc));

  // Lecture par PostgREST (colonne value_boolean exposée).
  const { data: lu, error: eLu } = await db.from('custom_field_values').select('value_boolean').eq('field_id', caseId).eq('client_id', clients[0]).single();
  verifier('value_boolean se relit', !eLu && lu?.value_boolean === true, eLu?.message ?? JSON.stringify(lu));

  // ── Fichier ──
  const fichierId = await champ('plan_toiture', 'file');
  const chemin = `${org}/${crypto.randomUUID()}/plan.pdf`;
  const pdf = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' });
  const up = await db.storage.from('custom-field-files').upload(chemin, pdf, { contentType: 'application/pdf' });
  verifier('fichier téléversé dans le dossier de l’entreprise', !up.error, up.error?.message);
  nettoyer.unshift(() => admin.storage.from('custom-field-files').remove([chemin]));
  const html = await db.storage.from('custom-field-files').upload(`${org}/${crypto.randomUUID()}/x.html`, new Blob(['<script>1</script>'], { type: 'text/html' }), { contentType: 'text/html' });
  verifier('HTML refusé par le bucket', !!html.error, html.error?.message ?? 'accepté !');
  const ecrit = await ecrire(fichierId, clients[0], { value_text: chemin });
  verifier('valeur fichier = chemin accepté', !ecrit.error, ecrit.error?.message);
  const signe = await db.storage.from('custom-field-files').createSignedUrl(chemin, 60);
  const recu = signe.data?.signedUrl ? await fetch(signe.data.signedUrl) : null;
  verifier('lien signé : le fichier se relit', !!recu && recu.ok && (await recu.text()).startsWith('%PDF'), signe.error?.message ?? String(recu?.status));

  // Une autre entreprise.
  const courriel2 = `qa.cftypes.b.${s}@exemple.invalid`; const mdp2 = crypto.randomBytes(18).toString('base64url');
  const { data: u2 } = await admin.auth.admin.createUser({ email: courriel2, password: mdp2, email_confirm: true });
  nettoyer.unshift(() => admin.auth.admin.deleteUser(u2.user!.id));
  const { data: o2 } = await admin.from('orgs').insert({ name: `QA cftypes B ${s}`, created_by: u2.user!.id }).select('id').single();
  const org2 = o2!.id as string;
  nettoyer.unshift(() => admin.from('orgs').delete().eq('id', org2));
  nettoyer.unshift(() => admin.from('memberships').delete().eq('org_id', org2));
  nettoyer.unshift(() => admin.from('clients').delete().eq('org_id', org2));
  nettoyer.unshift(() => admin.from('custom_fields').delete().eq('org_id', org2));
  nettoyer.unshift(() => admin.from('custom_field_values').delete().eq('org_id', org2));
  await admin.from('memberships').upsert({ user_id: u2.user!.id, org_id: org2, role: 'owner', status: 'active' }, { onConflict: 'user_id,org_id' });
  const { data: sess2 } = await createClient(url, ANON, { auth: { persistSession: false } }).auth.signInWithPassword({ email: courriel2, password: mdp2 });
  const db2 = createClient(url, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${sess2.session!.access_token}` } } });
  const intrus = await db2.storage.from('custom-field-files').upload(`${org}/${crypto.randomUUID()}/intrus.pdf`, pdf, { contentType: 'application/pdf' });
  verifier('autre entreprise : ne peut pas écrire dans le dossier de A', !!intrus.error, intrus.error?.message ?? 'accepté !');
  const vol = await db2.storage.from('custom-field-files').createSignedUrl(chemin, 60);
  verifier('autre entreprise : ne peut pas lire le fichier de A', !!vol.error || !vol.data?.signedUrl, vol.error?.message ?? 'lien obtenu !');
  const { data: fB } = await db2.rpc('cf_creer_champ', { p_org: org2, p_object: 'client', p_folder: null, p_champ: { key: 'plan', label: 'Plan', field_type: 'file' } });
  const { data: cB } = await admin.from('clients').insert({ org_id: org2, first_name: 'B', last_name: s, created_by: u2.user!.id }).select('id').single();
  const rattache = await db2.rpc('cf_ecrire_valeur', { p_field: fB, p_entity: cB!.id, p_cols: { value_text: chemin } });
  verifier('autre entreprise : ne peut pas rattacher le fichier de A à ses fiches', !!rattache.error, rattache.error?.message ?? 'accepté !');
  const hors = await ecrire(fichierId, clients[1], { value_text: 'plan.pdf' });
  verifier('chemin hors dossier refusé', !!hors.error, hors.error?.message ?? 'accepté !');
} finally {
  for (const n of nettoyer) { try { await n(); } catch (e) { console.error('nettoyage', e); } }
}
for (const x of ok) console.log('  ✓', x);
for (const x of ko) console.log('  ✗', x);
console.log(`\n${ok.length}/${ok.length + ko.length}`);
if (ko.length) process.exit(1);
