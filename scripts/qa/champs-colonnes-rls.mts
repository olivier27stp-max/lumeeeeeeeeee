/**
 * Colonnes par utilisateur (table_view_preferences) et tri par champ
 * (cf_ordre_ids) — migration 20260929160000. Staging, vrais jetons :
 *   · chacun lit/écrit SES colonnes ; un collègue de la même entreprise ne les voit pas ;
 *   · impossible d'écrire des colonnes pour une entreprise dont on n'est pas membre,
 *     ni au nom d'un autre utilisateur ;
 *   · cf_ordre_ids trie par la valeur typée et ne sort rien d'une autre entreprise.
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa/champs-colonnes-rls.mts
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

async function utilisateur(e: string) {
  const courriel = `qa.cfcol.${e}.${s}@exemple.invalid`; const mdp = crypto.randomBytes(18).toString('base64url');
  const { data } = await admin.auth.admin.createUser({ email: courriel, password: mdp, email_confirm: true });
  nettoyer.unshift(() => admin.auth.admin.deleteUser(data.user!.id));
  const { data: sess } = await createClient(url, ANON, { auth: { persistSession: false } }).auth.signInWithPassword({ email: courriel, password: mdp });
  return { id: data.user!.id, jeton: sess.session!.access_token };
}
const client = (jeton: string, org: string) => createClient(url, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jeton}`, 'x-lume-org': org } } });
async function entreprise(nom: string, membres: Array<[string, string]>) {
  const { data: o } = await admin.from('orgs').insert({ name: `QA cfcol ${nom} ${s}`, created_by: membres[0][0] }).select('id').single();
  nettoyer.unshift(() => admin.from('orgs').delete().eq('id', o!.id));
  nettoyer.unshift(() => admin.from('memberships').delete().eq('org_id', o!.id));
  nettoyer.unshift(() => admin.from('clients').delete().eq('org_id', o!.id));
  nettoyer.unshift(() => admin.from('custom_fields').delete().eq('org_id', o!.id));
  nettoyer.unshift(() => admin.from('custom_field_values').delete().eq('org_id', o!.id));
  for (const [u, role] of membres) await admin.from('memberships').upsert({ user_id: u, org_id: o!.id, role, status: 'active' }, { onConflict: 'user_id,org_id' });
  return o!.id as string;
}

try {
  const alice = await utilisateur('alice'); const bruno = await utilisateur('bruno'); const chloe = await utilisateur('chloe');
  const A = await entreprise('A', [[alice.id, 'owner'], [bruno.id, 'admin']]);
  const B = await entreprise('B', [[chloe.id, 'owner']]);

  // Colonnes : chacun les siennes.
  const ecrire = (u: { id: string; jeton: string }, org: string, colonnes: string[], pour = u.id) =>
    client(u.jeton, org).from('table_view_preferences').upsert({ org_id: org, user_id: pour, object_type: 'client', columns: colonnes });
  const e1 = await ecrire(alice, A, ['nom', 'statut', 'cf:x']);
  verifier('Alice enregistre ses colonnes', !e1.error, e1.error?.message);
  const lu = await client(alice.jeton, A).from('table_view_preferences').select('columns').eq('org_id', A).eq('object_type', 'client');
  verifier('Alice relit ses colonnes', JSON.stringify(lu.data?.[0]?.columns) === '["nom","statut","cf:x"]', JSON.stringify(lu.data));
  const luB = await client(bruno.jeton, A).from('table_view_preferences').select('user_id');
  verifier('Bruno (même entreprise, admin) ne voit PAS les colonnes d’Alice', (luB.data ?? []).length === 0, `${luB.data?.length}`);
  const usurpe = await ecrire(bruno, A, ['nom'], alice.id);
  verifier('Bruno ne peut pas écrire au nom d’Alice', !!usurpe.error, usurpe.error?.message ?? 'accepté !');
  const ailleurs = await ecrire(chloe, A, ['nom']);
  verifier('Chloé (autre entreprise) ne peut pas écrire dans A', !!ailleurs.error, ailleurs.error?.message ?? 'accepté !');
  const luC = await client(chloe.jeton, A).from('table_view_preferences').select('user_id').eq('org_id', A);
  verifier('Chloé ne lit rien de A', (luC.data ?? []).length === 0, `${luC.data?.length}`);
  const trop = await ecrire(alice, A, Array.from({ length: 81 }, (_, i) => `c${i}`));
  verifier('plus de 80 colonnes refusé par la base', !!trop.error, trop.error?.message ?? 'accepté !');

  // Tri par champ.
  const { data: f } = await admin.from('custom_fields').insert({ org_id: A, object_type: 'client', key: `superficie_${s}`, label: 'Superficie', field_type: 'number' }).select('id').single();
  const valeurs = [30, 5, 120];
  const ids: string[] = [];
  for (const v of valeurs) {
    const { data: c } = await admin.from('clients').insert({ org_id: A, first_name: `Sup ${v}`, last_name: s, created_by: alice.id }).select('id').single();
    ids.push(c!.id);
    const { error } = await admin.from('custom_field_values').insert({ org_id: A, field_id: f!.id, object_type: 'client', client_id: c!.id, value_number: v });
    if (error) throw error;
  }
  const ordre = async (u: { jeton: string }, org: string, asc: boolean) => {
    const r = await client(u.jeton, org).rpc('cf_ordre_ids', { p_field: f!.id, p_asc: asc });
    return { ids: (r.data ?? []).map((x: unknown) => (typeof x === 'string' ? x : Object.values(x as object)[0])) as string[], err: r.error?.message };
  };
  const asc = await ordre(alice, A, true);
  verifier('tri croissant : 5, 30, 120', JSON.stringify(asc.ids) === JSON.stringify([ids[1], ids[0], ids[2]]), asc.err ?? JSON.stringify(asc.ids));
  const desc = await ordre(alice, A, false);
  verifier('tri décroissant : 120, 30, 5', JSON.stringify(desc.ids) === JSON.stringify([ids[2], ids[0], ids[1]]), desc.err ?? JSON.stringify(desc.ids));
  const fuite = await ordre(chloe, B, true);
  verifier('Chloé (autre entreprise) : le tri ne révèle aucune fiche de A', fuite.ids.length === 0, fuite.err ?? `${fuite.ids.length} id(s)`);
  const anon = await createClient(url, ANON, { auth: { persistSession: false } }).rpc('cf_ordre_ids', { p_field: f!.id });
  verifier('anonyme : refusé', !!anon.error || (anon.data ?? []).length === 0, anon.error?.message ?? 'vide');
} finally {
  for (const n of nettoyer) { try { await n(); } catch (e) { console.error('nettoyage', e); } }
}
for (const x of ok) console.log('  ✓', x);
for (const x of ko) console.log('  ✗', x);
console.log(`\n${ok.length}/${ok.length + ko.length}`);
if (ko.length) process.exit(1);
