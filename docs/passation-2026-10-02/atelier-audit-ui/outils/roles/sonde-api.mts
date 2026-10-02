/**
 * Sonde jetable : appelle chaque route du tableau avec chaque rôle et imprime code + extrait + effet.
 *   cd D:/lume-uiaudit/wt && QA_AUTO_SUFFIXE=roles node --env-file=.env.local node_modules/tsx/dist/cli.mjs ../outils/roles/sonde-api.mts [API-03 …]
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { assurerBureauTest, COMPTES } from '../../wt/tests/automations-suite/harnais/bureau-test';
import { assurerComptesPerso, sessionParEmail, TOUS_LES_ROLES, type Role } from '../../wt/e2e/automations/roles/_comptes';
import { ROUTES, assurerDecor, type Outils } from '../../wt/e2e/automations/roles/_routes';

const BASE = process.env.SONDE_BASE || 'http://127.0.0.1:5183';
const filtre = process.argv.slice(2);
const b = await assurerBureauTest();
const emailAdmin = COMPTES.proprioA.email.replace('proprio-a', 'admin-a');
{
  // Même compte admin que le banc.
  const cree = await b.admin.auth.admin.createUser({ email: emailAdmin, password: randomBytes(24).toString('base64url'), email_confirm: true, user_metadata: { full_name: 'QA Admin A' } });
  let id = cree.data?.user?.id;
  if (!id) { const { data: lien } = await b.admin.auth.admin.generateLink({ type: 'magiclink', email: emailAdmin }); id = lien?.user?.id; }
  if (!id) throw new Error('compte admin introuvable');
  const { error } = await b.admin.from('memberships').upsert({ user_id: id, org_id: b.orgA, role: 'admin', status: 'active', full_name: 'QA Admin A' }, { onConflict: 'user_id,org_id' });
  if (error) throw new Error(error.message);
}
const perso = await assurerComptesPerso(b.admin, b.orgA, COMPTES.proprioA.email);
const emails: Record<Role, string> = {
  proprioA: COMPTES.proprioA.email, adminA: emailAdmin, techA: COMPTES.techA.email, proprioB: COMPTES.proprioB.email,
  vendeurA: perso.vendeurA.email, lecteurA: perso.lecteurA.email, editeurA: perso.editeurA.email,
};
const jetons = {} as Record<Role, string>;
for (const r of TOUS_LES_ROLES) jetons[r] = (await sessionParEmail(b.admin, emails[r])).access_token;
const decor = await assurerDecor(b.admin, b.orgA, b.users.proprioA);
console.log('orgA', b.orgA, 'orgB', b.orgB, 'decor', JSON.stringify(decor));

async function appel(jeton: string | null, org: string | null, methode: string, chemin: string, corps?: unknown) {
  const h: Record<string, string> = { 'Content-Type': 'application/json', 'x-requested-with': 'XMLHttpRequest' };
  if (jeton) h.Authorization = `Bearer ${jeton}`;
  if (org) h['x-org-id'] = org;
  const r = await fetch(`${BASE}${chemin}`, { method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps) });
  const texte = await r.text();
  return { status: r.status, texte };
}

// Un modèle valide pour API-07.
const mod = await appel(jetons.proprioA, b.orgA, 'GET', '/api/automations/templates');
let modele = '';
try { const j = JSON.parse(mod.texte); const liste = Array.isArray(j) ? j : (j.templates ?? j.modeles ?? []); modele = liste[0]?.id ?? ''; console.log('modèles', liste.length, 'premier', modele, 'clés', Object.keys(j).join(',')); } catch { console.log('templates illisible', mod.texte.slice(0, 200)); }

const sortie: unknown[] = [];
for (const route of ROUTES) {
  if (filtre.length && !filtre.includes(route.id)) continue;
  const marque = `[E2E ${route.id} ${randomBytes(3).toString('hex')}]`;
  const o: Outils = { admin: b.admin, orgA: b.orgA, orgB: b.orgB, idProprioA: b.users.proprioA, marque, decor: { ...decor, modele } };
  console.log(`\n=== ${route.id} ${route.methode} ${route.gabarit}  [${route.cle}]`);
  const cas: Array<{ nom: string; jeton: string | null; org: string | null }> = [
    ...TOUS_LES_ROLES.filter((r) => r !== 'proprioB').map((r) => ({ nom: r as string, jeton: jetons[r], org: b.orgA })),
    { nom: 'proprioB(orgB)', jeton: jetons.proprioB, org: b.orgB },
    { nom: 'proprioB(x-org=A)', jeton: jetons.proprioB, org: b.orgA },
    { nom: 'anonyme', jeton: null, org: b.orgA },
  ];
  for (const c of cas) {
    const s = c.nom.replace(/[^a-zA-Z]/g, '');
    try {
      const ctx = route.preparer ? await route.preparer(o, s) : {};
      const r = await appel(c.jeton, c.org, route.methode, route.chemin(ctx, o), route.corps?.(ctx, o, s));
      const ecrit = route.aEcrit ? await route.aEcrit(o, ctx, s) : null;
      const fuite = route.secret ? r.texte.includes(route.secret(ctx, o, s)) : null;
      console.log(`  ${c.nom.padEnd(18)} ${r.status}  écrit=${ecrit}  contientSecret=${fuite}  ${r.texte.slice(0, 170).replace(/\s+/g, ' ')}`);
      sortie.push({ route: route.id, cas: c.nom, status: r.status, ecrit, fuite, corps: r.texte.slice(0, 400) });
      if (route.menage) await route.menage(o, ctx, s);
    } catch (e) { console.log(`  ${c.nom.padEnd(18)} ERREUR ${(e as Error).message}`); }
  }
  // Ménage des règles marquées.
  for (const org of [b.orgA, b.orgB]) {
    const { data } = await b.admin.from('automation_rules').select('id').eq('org_id', org).ilike('name', `%${marque}%`);
    const ids = (data ?? []).map((l) => l.id as string);
    if (!ids.length) continue;
    await b.admin.from('automation_scheduled_tasks').delete().in('automation_rule_id', ids);
    await b.admin.from('automation_execution_logs').delete().in('automation_rule_id', ids);
    await b.admin.from('automation_rules').delete().in('id', ids);
  }
}
writeFileSync('D:/lume-uiaudit/sorties/roles/sonde-api.json', JSON.stringify(sortie, null, 1));
process.exit(0);
