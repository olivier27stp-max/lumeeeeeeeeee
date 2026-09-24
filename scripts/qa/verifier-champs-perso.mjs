/**
 * verifier-champs-perso.mjs — les champs personnalisés v2 sont-ils étanches ?
 *
 *   node --env-file=.env.local scripts/qa/verifier-champs-perso.mjs
 *
 * 1. Invariants de la base (scripts/qa/champs-perso-invariants.sql, via
 *    l'API de gestion, dans une transaction ANNULÉE) : CHECK, FK composites,
 *    cascades, unicité normalisée, conversions, lot tout-ou-rien, filtres,
 *    copie deal → job, Loi 25.
 * 2. RLS avec de VRAIS comptes, directement contre PostgREST (clé anon +
 *    session), sur deux orgs jetables supprimées à la fin :
 *      · l'entreprise B ne lit ni n'écrit rien de l'entreprise A ;
 *      · un technicien de A lit les définitions mais ne les modifie pas ;
 *      · il ne voit pas les valeurs d'une facture (montants masqués).
 *
 * Staging SEULEMENT : le script refuse de tourner si l'URL pointe la prod.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const url = process.env.VITE_SUPABASE_URL;
const ref = process.env.SUPABASE_PROJECT_REF;
const refProd = process.env.SUPABASE_PROJECT_REF_PROD;
if (!url || !ref) throw new Error('VITE_SUPABASE_URL / SUPABASE_PROJECT_REF manquants');
if (!url.includes(ref) || (refProd && url.includes(refProd))) throw new Error('VITE_SUPABASE_URL ne pointe pas sur staging - abandon');

const resultats = [];
const ok = (nom, cond, detail = '') => { resultats.push({ nom, ok: !!cond }); console.log(`${cond ? 'OK   ' : 'ECHEC'} ${nom}${detail ? ' — ' + detail : ''}`); };

// ── 1. Invariants SQL ──
{
  const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'champs-perso-invariants.sql'), 'utf8');
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const texte = await res.text();
  ok('invariants de la base (CHECK, FK, cascades, unicité, conversions, lot, filtres, Loi 25)', res.ok, res.ok ? '' : texte.slice(0, 400));
}

// ── 2. RLS ──
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const MDP = 'Xx-Champs-Perso-1234!';
const stamp = Date.now();
const crees = { users: [], orgs: [] };

async function compte(orgId, role, nom) {
  const email = `qa-cf-${nom}-${stamp}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: MDP, email_confirm: true });
  if (error) throw error;
  crees.users.push(data.user.id);
  const { error: e2 } = await admin.from('memberships').insert({ user_id: data.user.id, org_id: orgId, role });
  if (e2) throw e2;
  const c = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: e3 } = await c.auth.signInWithPassword({ email, password: MDP });
  if (e3) throw e3;
  return { c, uid: data.user.id };
}

async function org(nom) {
  const { data, error } = await admin.from('orgs').insert({ name: `QA champs ${nom} ${stamp}`, created_by: null }).select('id').single();
  if (error) throw error;
  crees.orgs.push(data.id);
  return data.id;
}

/** Une écriture « réussit » si elle ne renvoie pas d'erreur ET touche une ligne. */
async function tente(promesse) {
  const { data, error } = await promesse;
  if (error) return { reussi: false, detail: `${error.code || ''} ${error.message}`.trim() };
  const n = Array.isArray(data) ? data.length : data ? 1 : 0;
  return { reussi: n > 0, detail: n > 0 ? '' : '0 ligne (RLS)' };
}

try {
  const orgA = await org('A');
  const orgB = await org('B');
  const a = await compte(orgA, 'owner', 'a-owner');
  const tech = await compte(orgA, 'technician', 'a-tech');
  const b = await compte(orgB, 'owner', 'b-owner');

  const { data: clientA, error: ec } = await admin.from('clients').insert({ org_id: orgA, first_name: 'QA', last_name: 'A', created_by: a.uid }).select('id').single();
  if (ec) throw ec;
  const { data: invA, error: ei } = await admin.from('invoices').insert({ org_id: orgA, client_id: clientA.id, created_by: a.uid, status: 'draft', invoice_number: `QA-CF-${stamp}`, subtotal_cents: 100, tax_cents: 0, total_cents: 100, balance_cents: 100 }).select('id').single();
  if (ei) throw ei;

  // Le propriétaire de A crée un dossier + 2 champs en UN appel.
  const { data: dossierId, error: ed } = await a.c.rpc('cf_creer_dossier', {
    p_org: orgA, p_object: 'client', p_nom: 'Terrain',
    p_champs: [{ label: 'Superficie', field_type: 'number' }, { label: 'Type', field_type: 'dropdown_single', options: [{ label: 'Asphalte' }] }],
  });
  ok('propriétaire A : crée un dossier + champs en lot', !ed && dossierId, ed?.message);
  const { data: champs } = await a.c.from('custom_fields').select('id, key, field_type').eq('org_id', orgA);
  const superficie = champs?.find((f) => f.key === 'superficie');
  ok('propriétaire A : lit ses champs', champs?.length === 2);

  let r = await tente(a.c.from('custom_field_values').insert({ org_id: orgA, field_id: superficie.id, object_type: 'client', client_id: clientA.id, value_number: 1200 }).select('id'));
  ok('propriétaire A : écrit une valeur sur son client', r.reussi, r.detail);

  const { data: fInv } = await admin.from('custom_fields').insert({ org_id: orgA, object_type: 'invoice', key: '', label: 'Bon de commande', field_type: 'single_line' }).select('id').single();
  await admin.from('custom_field_values').insert({ org_id: orgA, field_id: fInv.id, object_type: 'invoice', invoice_id: invA.id, value_text: 'PO-1234' });

  // ── Entreprise B ──
  const { data: lusB } = await b.c.from('custom_fields').select('id').eq('org_id', orgA);
  ok('entreprise B : ne lit AUCUN champ de A', (lusB || []).length === 0, `${(lusB || []).length} lu(s)`);
  const { data: valsB } = await b.c.from('custom_field_values').select('id').eq('org_id', orgA);
  ok('entreprise B : ne lit AUCUNE valeur de A', (valsB || []).length === 0);
  r = await tente(b.c.from('custom_field_values').insert({ org_id: orgA, field_id: superficie.id, object_type: 'client', client_id: clientA.id, value_number: 1 }).select('id'));
  ok('entreprise B : ne peut pas écrire une valeur chez A', !r.reussi, r.detail);
  r = await tente(b.c.from('custom_fields').update({ label: 'piraté' }).eq('id', superficie.id).select('id'));
  ok('entreprise B : ne peut pas renommer un champ de A', !r.reussi, r.detail);
  r = await tente(b.c.from('custom_fields').insert({ org_id: orgA, object_type: 'client', key: '', label: 'Intrus', field_type: 'single_line' }).select('id'));
  ok('entreprise B : ne peut pas créer un champ chez A', !r.reussi, r.detail);
  const { error: eLotB } = await b.c.rpc('cf_creer_dossier', { p_org: orgA, p_object: 'client', p_nom: 'Intrus', p_champs: [] });
  ok('entreprise B : ne peut pas créer un dossier chez A par RPC', !!eLotB, eLotB?.message);
  const { data: filtreB } = await b.c.rpc('cf_filtrer', { p_org: orgA, p_object: 'client', p_conditions: [] });
  ok('entreprise B : cf_filtrer sur A ne renvoie rien', (filtreB || []).length === 0);
  const { data: rechB } = await b.c.rpc('cf_rechercher', { p_org: orgA, p_q: '1200' });
  ok('entreprise B : cf_rechercher sur A ne renvoie rien', (rechB || []).length === 0);
  const { error: ePurgeB } = await b.c.rpc('cf_purger_champ', { p_field: superficie.id, p_valeurs_confirmees: 1 });
  ok('entreprise B : ne peut pas purger un champ de A', !!ePurgeB, ePurgeB?.message);

  // ── Technicien de A ──
  const { data: lusTech } = await tech.c.from('custom_fields').select('id').eq('org_id', orgA);
  ok('technicien A : lit les définitions', (lusTech || []).length >= 2);
  r = await tente(tech.c.from('custom_fields').update({ label: 'modifié' }).eq('id', superficie.id).select('id'));
  ok('technicien A : ne modifie pas une définition (settings.update)', !r.reussi, r.detail);
  const { data: valInvTech } = await tech.c.from('custom_field_values').select('id').eq('field_id', fInv.id);
  ok('technicien A : ne voit pas la valeur d\'une facture (montants masqués)', (valInvTech || []).length === 0);

  // ── Anonyme ──
  const anon = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: lusAnon, error: eAnon } = await anon.from('custom_fields').select('id').limit(1);
  ok('anonyme : aucun accès', !!eAnon || (lusAnon || []).length === 0, eAnon?.message);
} finally {
  for (const o of crees.orgs) {
    for (const t of ['custom_field_values', 'custom_field_options', 'custom_fields', 'custom_field_folders', 'invoices', 'clients', 'memberships', 'team_members']) {
      await admin.from(t).delete().eq('org_id', o).then(() => {}, () => {});
    }
    await admin.from('orgs').delete().eq('id', o);
  }
  for (const u of crees.users) await admin.auth.admin.deleteUser(u).catch(() => {});
}

const echecs = resultats.filter((x) => !x.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
process.exit(echecs.length ? 1 : 0);
