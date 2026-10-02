// Ajoute au bureau A de test un compte de rôle « admin » (la suite n'a que propriétaire et technicien).
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { admin, etat, SORTIES } from './nav.mjs';

const e = etat();
const email = 'qa-auto-admin-a+uiaudit@lume-qa.test';
let id;
const { data, error } = await admin.auth.admin.createUser({
  email, password: randomBytes(24).toString('base64url'), email_confirm: true, user_metadata: { full_name: 'QA Admin A' },
});
if (data?.user) id = data.user.id;
else {
  const { data: lien, error: e2 } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (!lien?.user) throw new Error(`compte admin : ${error?.message} / ${e2?.message}`);
  id = lien.user.id;
}
const { error: e3 } = await admin.from('memberships')
  .upsert({ user_id: id, org_id: e.orgA, role: 'admin', status: 'active', full_name: 'QA Admin A' }, { onConflict: 'user_id,org_id' });
if (e3) throw new Error(`adhésion admin : ${e3.message}`);
await admin.from('profiles').update({ location_consent: false, location_consent_at: new Date().toISOString() }).eq('id', id);

const chemin = `${SORTIES}/serveurs.json`;
const j = JSON.parse(readFileSync(chemin, 'utf8'));
j.comptes.adminA = { email, role: 'admin', id };
writeFileSync(chemin, JSON.stringify(j, null, 2));
const { data: m } = await admin.from('memberships').select('role, status, user_id').eq('org_id', e.orgA);
console.log('membres du bureau A :', JSON.stringify(m));
