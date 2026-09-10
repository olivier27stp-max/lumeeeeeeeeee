/**
 * verifier-rls-roles.mjs — la RLS applique-t-elle le RÔLE, pas seulement l'org ?
 *
 * Audit bloc 3 (2026-09-10), C1 : un technicien ne pouvait pas créer une
 * facture, mais pouvait la supprimer — DELETE /rest/v1/invoices?id=eq.… ne
 * passe que par la RLS, qui ne regardait pas le rôle. Ce script rejoue
 * l'attaque avec trois comptes (admin, sales_rep, technician) DIRECTEMENT
 * contre PostgREST (supabase-js, clé anon + session utilisateur), sur
 * staging, avec une org jetable qu'il supprime à la fin.
 *
 *   node --env-file=.env.local scripts/qa/verifier-rls-roles.mjs
 *
 * Matrice attendue (ROLE_PRESETS, src/lib/permissions.ts) :
 *                     admin  sales_rep  technician
 *   invoices insert    oui     non        non
 *   invoices update    oui     non        non
 *   invoices delete    oui     non        non
 *   invoices soft-del  oui     non        non   (PATCH deleted_at)
 *   quotes   insert    oui     oui        non
 *   quotes   update    oui     oui        non
 *   quotes   delete    oui     non        non
 *   payments insert    non     non        non   (privilège table : écrit par le serveur seulement)
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const ref = process.env.SUPABASE_PROJECT_REF;
const refProd = process.env.SUPABASE_PROJECT_REF_PROD;
if (!url || !ref) throw new Error('VITE_SUPABASE_URL / SUPABASE_PROJECT_REF manquants');
if (!url.includes(ref) || (refProd && url.includes(refProd))) throw new Error('VITE_SUPABASE_URL ne pointe pas sur staging - abandon');

const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const MDP = 'Xx-Rls-Roles-1234!';
const stamp = Date.now();
const resultats = [];
const ok = (nom, cond, detail = '') => { resultats.push({ nom, ok: !!cond, detail }); console.log(`${cond ? 'OK   ' : 'ECHEC'} ${nom}${detail ? ' — ' + detail : ''}`); };

const crees = { users: [], orgId: null };

async function compte(role) {
  const email = `qa-rls-${role}-${stamp}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: MDP, email_confirm: true });
  if (error) throw error;
  crees.users.push(data.user.id);
  const { error: e2 } = await admin.from('memberships').insert({ user_id: data.user.id, org_id: crees.orgId, role });
  if (e2) throw e2;
  const c = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: e3 } = await c.auth.signInWithPassword({ email, password: MDP });
  if (e3) throw e3;
  return c;
}

/** Une écriture PostgREST « réussit » si elle ne renvoie pas d'erreur ET touche une ligne. */
async function tente(promesse) {
  const { data, error } = await promesse;
  if (error) return { reussi: false, detail: `${error.code || ''} ${error.message}`.trim() };
  const n = Array.isArray(data) ? data.length : data ? 1 : 0;
  return { reussi: n > 0, detail: n > 0 ? '' : '0 ligne touchée (RLS)' };
}

try {
  const { data: org, error: eo } = await admin.from('orgs').insert({ name: `QA RLS rôles ${stamp}`, created_by: null }).select('id').single();
  if (eo) throw eo;
  crees.orgId = org.id;

  const owner = await compte('owner');
  const { data: { user: ownerUser } } = await owner.auth.getUser();
  await admin.from('orgs').update({ created_by: ownerUser.id }).eq('id', org.id);
  const { data: client, error: ec } = await admin.from('clients').insert({ org_id: org.id, first_name: 'QA', last_name: 'Rôles', created_by: ownerUser.id }).select('id').single();
  if (ec) throw ec;

  const comptes = { admin: await compte('admin'), sales_rep: await compte('sales_rep'), technician: await compte('technician') };
  const attendu = {
    admin:      { inv_insert: true,  inv_update: true,  inv_delete: true,  inv_soft: true,  q_insert: true,  q_update: true,  q_delete: true,  pay_insert: false },
    sales_rep:  { inv_insert: false, inv_update: false, inv_delete: false, inv_soft: false, q_insert: true,  q_update: true,  q_delete: false, pay_insert: false },
    technician: { inv_insert: false, inv_update: false, inv_delete: false, inv_soft: false, q_insert: false, q_update: false, q_delete: false, pay_insert: false },
  };

  for (const [role, c] of Object.entries(comptes)) {
    const a = attendu[role];
    const uid = (await c.auth.getUser()).data.user.id;
    // Cibles fraîches créées par le service_role pour chaque rôle.
    const { data: inv, error: ei } = await admin.from('invoices').insert({ org_id: org.id, client_id: client.id, created_by: ownerUser.id, status: 'draft', invoice_number: `QA-${role}-${stamp}`, subtotal_cents: 100, tax_cents: 0, total_cents: 100, balance_cents: 100 }).select('id').single();
    if (ei) throw ei;
    const { data: q, error: eq } = await admin.from('quotes').insert({ org_id: org.id, client_id: client.id, created_by: ownerUser.id, status: 'draft', quote_number: `QA-${role}-${stamp}` }).select('id').single();
    if (eq) throw eq;

    let r = await tente(c.from('invoices').insert({ org_id: org.id, client_id: client.id, created_by: uid, status: 'draft', invoice_number: `QA-I-${role}-${stamp}`, subtotal_cents: 1, tax_cents: 0, total_cents: 1, balance_cents: 1 }).select('id'));
    ok(`${role} : INSERT invoices ${a.inv_insert ? 'autorisé' : 'refusé'}`, r.reussi === a.inv_insert, r.detail);
    r = await tente(c.from('invoices').update({ subject: 'modifié' }).eq('id', inv.id).select('id'));
    ok(`${role} : UPDATE invoices ${a.inv_update ? 'autorisé' : 'refusé'}`, r.reussi === a.inv_update, r.detail);
    r = await tente(c.from('invoices').update({ deleted_at: new Date().toISOString() }).eq('id', inv.id).select('id'));
    ok(`${role} : PATCH deleted_at (suppression douce) invoices ${a.inv_soft ? 'autorisé' : 'refusé'}`, r.reussi === a.inv_soft, r.detail);
    await admin.from('invoices').update({ deleted_at: null }).eq('id', inv.id);
    r = await tente(c.from('invoices').delete().eq('id', inv.id).select('id'));
    ok(`${role} : DELETE invoices ${a.inv_delete ? 'autorisé' : 'refusé'} (LE BUG)`, r.reussi === a.inv_delete, r.detail);

    r = await tente(c.from('quotes').insert({ org_id: org.id, client_id: client.id, created_by: uid, status: 'draft', quote_number: `QA2-${role}-${stamp}` }).select('id'));
    ok(`${role} : INSERT quotes ${a.q_insert ? 'autorisé' : 'refusé'}`, r.reussi === a.q_insert, r.detail);
    r = await tente(c.from('quotes').update({ title: 'modifié' }).eq('id', q.id).select('id'));
    ok(`${role} : UPDATE quotes ${a.q_update ? 'autorisé' : 'refusé'}`, r.reussi === a.q_update, r.detail);
    r = await tente(c.from('quotes').delete().eq('id', q.id).select('id'));
    ok(`${role} : DELETE quotes ${a.q_delete ? 'autorisé' : 'refusé'}`, r.reussi === a.q_delete, r.detail);

    r = await tente(c.from('payments').insert({ org_id: org.id, created_by: uid, invoice_id: inv.id, amount_cents: 100, paid_at: new Date().toISOString(), method: 'cash', provider: 'manual' }).select('id'));
    ok(`${role} : INSERT payments ${a.pay_insert ? 'autorisé' : 'refusé'}`, r.reussi === a.pay_insert, r.detail);
  }
} finally {
  if (crees.orgId) {
    for (const t of ['payments', 'quote_line_items', 'invoice_items', 'quotes', 'invoices', 'clients', 'memberships']) {
      await admin.from(t).delete().eq('org_id', crees.orgId).then(() => {}, () => {});
    }
    await admin.from('orgs').delete().eq('id', crees.orgId);
  }
  for (const u of crees.users) await admin.auth.admin.deleteUser(u).catch(() => {});
}

const echecs = resultats.filter((r) => !r.ok);
console.log(`\n${resultats.length - echecs.length}/${resultats.length} vérifications passées`);
process.exit(echecs.length ? 1 : 0);
