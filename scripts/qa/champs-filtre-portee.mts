/**
 * cf_filtrer_brut n'expose plus les fiches cachées par la RLS (20260929140000).
 * Staging, vrais jetons : propriétaire → le filtre trouve les 2 clients ;
 * rep « moi seulement » → seulement le sien, par cf_filtrer ET par cf_filtrer_brut appelée directement.
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa/champs-filtre-portee.mts
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
  const courriel = `qa.cffiltre.${e}.${s}@exemple.invalid`; const mdp = crypto.randomBytes(18).toString('base64url');
  const { data } = await admin.auth.admin.createUser({ email: courriel, password: mdp, email_confirm: true });
  nettoyer.unshift(() => admin.auth.admin.deleteUser(data.user!.id));
  const { data: sess } = await createClient(url, ANON, { auth: { persistSession: false } }).auth.signInWithPassword({ email: courriel, password: mdp });
  return { id: data.user!.id, jeton: sess.session!.access_token };
}
const client = (jeton: string, org: string) => createClient(url, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jeton}`, 'x-lume-org': org } } });

try {
  const proprio = await utilisateur('proprio'); const rep = await utilisateur('rep');
  const { data: A } = await admin.from('orgs').insert({ name: `QA cf ${s}`, created_by: proprio.id }).select('id').single();
  nettoyer.unshift(() => admin.from('orgs').delete().eq('id', A!.id));
  nettoyer.unshift(() => admin.from('memberships').delete().eq('org_id', A!.id));
  for (const [u, role, scope] of [[proprio.id, 'owner', 'company'], [rep.id, 'sales_rep', 'self']] as const) {
    await admin.from('memberships').upsert({ user_id: u, org_id: A!.id, role, status: 'active', scope }, { onConflict: 'user_id,org_id' });
    await admin.from('memberships').update({ scope }).eq('user_id', u).eq('org_id', A!.id);
  }
  nettoyer.unshift(() => admin.from('clients').delete().eq('org_id', A!.id));
  nettoyer.unshift(() => admin.from('custom_fields').delete().eq('org_id', A!.id));
  nettoyer.unshift(() => admin.from('custom_field_values').delete().eq('org_id', A!.id));
  const { data: c1 } = await admin.from('clients').insert({ org_id: A!.id, first_name: 'Du rep', last_name: s, created_by: rep.id }).select('id').single();
  const { data: c2 } = await admin.from('clients').insert({ org_id: A!.id, first_name: 'Du proprio', last_name: s, created_by: proprio.id }).select('id').single();
  const { data: f } = await admin.from('custom_fields').insert({ org_id: A!.id, object_type: 'client', key: `toit_${s}`, label: 'Toit', field_type: 'single_line' }).select('id').single();
  for (const c of [c1!, c2!]) {
    const { error } = await admin.from('custom_field_values').insert({ org_id: A!.id, field_id: f!.id, object_type: 'client', client_id: c.id, value_text: 'bardeau' });
    if (error) throw error;
  }
  const cond = [{ field_id: f!.id, op: 'is', value: 'bardeau' }];
  const viaFiltrer = async (j: string) => ((await client(j, A!.id).rpc('cf_filtrer', { p_org: A!.id, p_object: 'client', p_conditions: cond })).data ?? []).map((r: any) => (typeof r === 'string' ? r : r.cf_filtrer ?? r.id));
  const viaBrut = async (j: string) => { const r = await client(j, A!.id).rpc('cf_filtrer_brut', { p_org: A!.id, p_object: 'client', p_conditions: cond }); return { ids: (r.data ?? []).map((x: any) => (typeof x === 'string' ? x : Object.values(x)[0])), err: r.error?.message }; };
  const p = await viaFiltrer(proprio.jeton);
  verifier('propriétaire : le filtre trouve les 2 clients', p.length === 2, `${p.length}`);
  const r = await viaFiltrer(rep.jeton);
  verifier('rep « moi seulement » : cf_filtrer ne rend que son client', r.length === 1 && r[0] === c1!.id, `${r.length}`);
  const b = await viaBrut(rep.jeton);
  verifier('rep : cf_filtrer_brut appelée directement ne révèle plus le client du propriétaire', !b.ids.includes(c2!.id), b.err ?? `${b.ids.length} id(s)`);
} finally {
  for (const n of nettoyer) { try { await n(); } catch (e) { console.error('nettoyage', e); } }
}
for (const x of ok) console.log('  ✓', x);
for (const x of ko) console.log('  ✗', x);
console.log(`${ok.length}/${ok.length + ko.length}`);
process.exit(ko.length ? 1 : 0);
