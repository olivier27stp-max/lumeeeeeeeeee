// Usage : node --env-file=.env.local scripts/qa/verifier-pipelines-admins-masquables.mjs  (STAGING seulement)
// STAGING — un administrateur peut désormais être exclu d'un pipeline.
import { createClient } from '@supabase/supabase-js';
const URL = process.env.VITE_SUPABASE_URL, ANON = process.env.VITE_SUPABASE_ANON_KEY, SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.SUPABASE_PROJECT_REF === process.env.SUPABASE_PROJECT_REF_PROD) throw new Error('prod refusée');
const admin = createClient(URL, SR, { auth: { persistSession: false } });
async function session(userId, orgId) {
  const { data: u } = await admin.auth.admin.getUserById(userId);
  const { data: lien } = await admin.auth.admin.generateLink({ type: 'magiclink', email: u.user.email });
  const { data: s } = await createClient(URL, ANON, { auth: { persistSession: false } }).auth.verifyOtp({ type: 'magiclink', token_hash: lien.properties.hashed_token });
  return createClient(URL, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${s.session.access_token}`, 'x-lume-org': orgId } } });
}
const { data: org } = await admin.from('orgs').select('id').eq('name', 'Vision Lavage').single();
const role = async (r) => (await admin.from('memberships').select('user_id').eq('org_id', org.id).eq('role', r).eq('status', 'active').limit(1).single()).data.user_id;
const [idProprio, idAdmin, idRep] = [await role('owner'), await role('admin'), await role('sales_rep')];
const proprio = await session(idProprio, org.id), adm = await session(idAdmin, org.id), rep = await session(idRep, org.id);

let ok = 0, ko = 0, P = null; const deals = [], clients = [];
const verif = (n, c, d = '') => { c ? ok++ : ko++; console.log(`${c ? '✅' : '❌'} ${n}${d ? '  — ' + d : ''}`); };
const voit = async (cli) => ((await cli.from('pipelines_ventes').select('id').eq('id', P)).data ?? []).length === 1;
const ordreAvant = (await admin.from('pipelines_ventes').select('id').eq('org_id', org.id).is('archived_at', null).order('position')).data.map((x) => x.id);
try {
  const r = await proprio.rpc('pipeline_enregistrer', { p_id: null, p_nom: 'ZZSonde Confidentiel', p_color_mode: 'none', p_use_deal_probability: false, p_etapes: [{ nom_fr: 'Étape 1' }] });
  if (r.error) throw r.error; P = r.data;
  const d = await proprio.rpc('pipeline_creer_deal', { p_first_name: 'ZZSonde', p_last_name: 'Secret', p_pipeline_id: P });
  if (d.error) throw d.error; deals.push(d.data.deal_id); clients.push(d.data.client_id);

  verif('Liste vide : l’admin voit le pipeline (ouvert à tous)', await voit(adm));

  // Le propriétaire réserve le pipeline au seul vendeur.
  const { error: e1 } = await proprio.from('pipeline_acces').insert({ org_id: org.id, pipeline_id: P, user_id: idRep });
  if (e1) throw e1;
  verif('Admin NON coché : ne voit plus le pipeline', !(await voit(adm)));
  const dealsAdm = (await adm.from('deals').select('id').eq('id', deals[0])).data ?? [];
  verif('Admin NON coché : ne voit pas non plus ses deals', dealsAdm.length === 0);
  const etapesAdm = (await adm.from('pipeline_stages').select('id').eq('pipeline_id', P)).data ?? [];
  verif('Admin NON coché : ne voit pas ses étapes', etapesAdm.length === 0);
  const { error: eSelf } = await adm.from('pipeline_acces').insert({ org_id: org.id, pipeline_id: P, user_id: idAdmin });
  verif('Admin NON coché : ne peut PAS se redonner l’accès', !!eSelf, eSelf?.message?.slice(0, 70));
  const dup = await adm.rpc('pipeline_dupliquer', { p_id: P });
  verif('Admin NON coché : ne peut pas le dupliquer', !!dup.error, dup.error?.message);
  const sup = await adm.rpc('pipeline_supprimer', { p_id: P });
  verif('Admin NON coché : ne peut pas le supprimer', !!sup.error, sup.error?.message);
  const { data: renomme } = await adm.from('pipelines_ventes').update({ name: 'piraté' }).eq('id', P).select('id');
  verif('Admin NON coché : ne peut pas le modifier', (renomme ?? []).length === 0);
  const visibles = (await adm.from('pipelines_ventes').select('id').eq('org_id', org.id).is('archived_at', null).order('position')).data.map((x) => x.id);
  const reo = await adm.rpc('pipeline_reordonner', { p_ids: [...visibles].reverse() });
  verif('Admin NON coché : peut quand même réordonner CE QU’IL VOIT', !reo.error, reo.error?.message);
  const posP = (await admin.from('pipelines_ventes').select('position').eq('id', P).single()).data.position;
  const posAvant = ordreAvant.length + 1;
  verif('… et le pipeline caché garde sa place', posP === posAvant, `position ${posP}`);

  verif('Propriétaire : voit toujours tout', await voit(proprio));
  verif('Vendeur coché : voit le pipeline', await voit(rep));

  // Le propriétaire coche l'administrateur.
  const { error: e2 } = await proprio.from('pipeline_acces').insert({ org_id: org.id, pipeline_id: P, user_id: idAdmin });
  if (e2) throw e2;
  verif('Admin coché : voit à nouveau le pipeline', await voit(adm));
  const { data: ren2 } = await adm.from('pipelines_ventes').update({ name: 'ZZSonde Confidentiel B' }).eq('id', P).select('id');
  verif('Admin coché : peut le modifier sans case « Modifier »', (ren2 ?? []).length === 1);
  const { data: vendeurRen } = await rep.from('pipelines_ventes').update({ name: 'ZZSonde vendeur' }).eq('id', P).select('id');
  verif('Vendeur coché « Voir » seulement : ne peut pas modifier', (vendeurRen ?? []).length === 0);
} catch (e) { ko++; console.log('💥', e.message ?? e); }
finally {
  if (P) {
    await admin.from('pipeline_acces').delete().eq('pipeline_id', P);
    for (const id of deals) { await admin.from('pipeline_events').delete().eq('deal_id', id); await admin.from('deals').delete().eq('id', id); }
    for (const id of clients) await admin.from('clients').delete().eq('id', id);
    await admin.from('pipelines_ventes').delete().eq('id', P);
  }
  let pos = 1; for (const id of ordreAvant) await admin.from('pipelines_ventes').update({ position: pos++ }).eq('id', id);
  await admin.rpc('pipeline_resynchroniser_defaut', { p_org: org.id }).then(() => {}, () => {});
  const reste = (await admin.from('pipelines_ventes').select('id').ilike('name', 'ZZSonde%')).data.length;
  const apres = (await admin.from('pipelines_ventes').select('id').eq('org_id', org.id).is('archived_at', null).order('position')).data.map((x) => x.id);
  console.log(`\n${ok} ✅  ${ko} ❌  — nettoyage : ${reste === 0 ? 'rien ne reste' : reste + ' restant(s)'} ; ordre ${JSON.stringify(apres) === JSON.stringify(ordreAvant) ? 'rétabli' : 'DIFFÉRENT'}`);
}
