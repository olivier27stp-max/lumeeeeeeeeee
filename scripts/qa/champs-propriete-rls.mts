/**
 * Objet « Propriété » (migration 20260929180000) contre staging, vrais jetons :
 *   · le propriétaire écrit et relit une valeur sur une propriété de son client ;
 *   · une autre entreprise ne la lit pas, ne l'écrit pas, ne la trouve pas ;
 *   · impossible de viser la propriété d'une autre entreprise (FK composite) ;
 *   · cf_filtrer et cf_rechercher connaissent l'objet ;
 *   · l'effacement du client (anonymize_client) retire les valeurs de ses propriétés.
 *
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/qa/champs-propriete-rls.mts
 */
import crypto from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL!;
const ANON = process.env.VITE_SUPABASE_ANON_KEY!;
if (!url.includes(process.env.SUPABASE_PROJECT_REF!) || url.includes(process.env.SUPABASE_PROJECT_REF_PROD!)) throw new Error('staging seulement');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const s = Date.now().toString(36);
const ok: string[] = []; const ko: string[] = [];
const verifier = (n: string, c: boolean, d = '') => (c ? ok : ko).push(`${n}${d ? ` — ${d}` : ''}`);
const nettoyer: Array<() => PromiseLike<unknown>> = [];

async function entreprise(nom: string): Promise<{ org: string; uid: string; db: SupabaseClient }> {
  const courriel = `qa.cfprop.${nom}.${s}@exemple.invalid`; const mdp = crypto.randomBytes(18).toString('base64url');
  const { data: u } = await admin.auth.admin.createUser({ email: courriel, password: mdp, email_confirm: true });
  nettoyer.unshift(() => admin.auth.admin.deleteUser(u.user!.id));
  const { data: o } = await admin.from('orgs').insert({ name: `QA cfprop ${nom} ${s}`, created_by: u.user!.id }).select('id').single();
  const org = o!.id as string;
  nettoyer.unshift(() => admin.from('orgs').delete().eq('id', org));
  nettoyer.unshift(() => admin.from('memberships').delete().eq('org_id', org));
  nettoyer.unshift(() => admin.from('clients').delete().eq('org_id', org));
  nettoyer.unshift(() => admin.from('properties').delete().eq('org_id', org));
  nettoyer.unshift(() => admin.from('custom_fields').delete().eq('org_id', org));
  nettoyer.unshift(() => admin.from('custom_field_values').delete().eq('org_id', org));
  nettoyer.unshift(() => admin.from('audit_events').delete().eq('org_id', org));
  await admin.from('memberships').upsert({ user_id: u.user!.id, org_id: org, role: 'owner', status: 'active' }, { onConflict: 'user_id,org_id' });
  const { data: sess } = await createClient(url, ANON, { auth: { persistSession: false } }).auth.signInWithPassword({ email: courriel, password: mdp });
  return { org, uid: u.user!.id, db: createClient(url, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${sess.session!.access_token}` } } }) };
}

try {
  const A = await entreprise('a');
  const B = await entreprise('b');
  const { data: c } = await admin.from('clients').insert({ org_id: A.org, first_name: 'Marie', last_name: s, created_by: A.uid }).select('id').single();
  const { data: p, error: eP } = await admin.from('properties').insert({ org_id: A.org, client_id: c!.id, name: 'Chalet', address: '1 rue du Lac', created_by: A.uid }).select('id').single();
  if (eP) throw eP;
  const { data: champ, error: eC } = await A.db.rpc('cf_creer_champ', { p_org: A.org, p_object: 'property', p_folder: null, p_champ: { key: 'code_barriere', label: 'Code de la barrière', field_type: 'single_line', is_searchable: true } });
  verifier('champ « Propriété » créé', !eC && !!champ, eC?.message);

  const ecrit = await A.db.rpc('cf_ecrire_valeur', { p_field: champ, p_entity: p!.id, p_cols: { value_text: 'A1234Z' } });
  verifier('A écrit sur sa propriété', !ecrit.error, ecrit.error?.message);
  const lu = await A.db.from('custom_field_values').select('value_text, property_id').eq('field_id', champ as string);
  verifier('A relit la valeur', lu.data?.[0]?.value_text === 'A1234Z' && lu.data?.[0]?.property_id === p!.id, lu.error?.message ?? JSON.stringify(lu.data));

  const luB = await B.db.from('custom_field_values').select('id').eq('property_id', p!.id);
  verifier('B ne lit pas la valeur de A', (luB.data ?? []).length === 0, `${luB.data?.length}`);
  const ecritB = await B.db.rpc('cf_ecrire_valeur', { p_field: champ, p_entity: p!.id, p_cols: { value_text: 'volé' } });
  verifier('B ne peut pas écrire sur le champ/la propriété de A', !!ecritB.error, ecritB.error?.message ?? 'accepté !');
  const cherB = await B.db.rpc('cf_rechercher', { p_org: A.org, p_q: 'A1234' });
  verifier('B ne trouve rien en cherchant chez A', (cherB.data ?? []).length === 0, cherB.error?.message ?? `${cherB.data?.length}`);

  // FK composite : un champ de B ne peut pas viser la propriété de A (même avec la clé service).
  const { data: champB } = await B.db.rpc('cf_creer_champ', { p_org: B.org, p_object: 'property', p_folder: null, p_champ: { key: 'code', label: 'Code', field_type: 'single_line' } });
  const croise = await admin.from('custom_field_values').insert({ org_id: B.org, field_id: champB, object_type: 'property', property_id: p!.id, value_text: 'x' });
  verifier('FK composite : impossible de viser la propriété d’une autre entreprise', !!croise.error, croise.error?.message ?? 'accepté !');

  const filtre = await A.db.rpc('cf_filtrer', { p_org: A.org, p_object: 'property', p_conditions: [{ field_id: champ, op: 'is', value: 'a1234z' }] });
  const ids = ((filtre.data ?? []) as unknown[]).map((x) => (typeof x === 'string' ? x : String(Object.values(x as object)[0])));
  verifier('cf_filtrer sur l’objet Propriété', JSON.stringify(ids) === JSON.stringify([p!.id]), filtre.error?.message ?? JSON.stringify(ids));
  const cher = await A.db.rpc('cf_rechercher', { p_org: A.org, p_q: 'a1234' });
  verifier('cf_rechercher trouve la propriété', (cher.data ?? []).some((r: { object_type: string; entity_id: string }) => r.object_type === 'property' && r.entity_id === p!.id), cher.error?.message ?? JSON.stringify(cher.data));

  // Effacement du client (Loi 25).
  const eff = await A.db.rpc('anonymize_client', { p_client_id: c!.id });
  const reste = await admin.from('custom_field_values').select('id').eq('property_id', p!.id);
  verifier('anonymize_client retire les valeurs des propriétés du client', !eff.error && (reste.data ?? []).length === 0, eff.error?.message ?? `${reste.data?.length} restante(s)`);
} finally {
  for (const n of nettoyer) { try { await n(); } catch (e) { console.error('nettoyage', e); } }
}
for (const x of ok) console.log('  ✓', x);
for (const x of ko) console.log('  ✗', x);
console.log(`\n${ok.length}/${ok.length + ko.length}`);
if (ko.length) process.exit(1);
