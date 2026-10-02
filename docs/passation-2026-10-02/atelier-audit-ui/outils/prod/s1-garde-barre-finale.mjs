// LECTURES SEULES sur lumecrm.net, compte TECHNICIEN du bureau de test « Grok Audit (TEST) ».
// La garde de permission se contourne-t-elle par une barre finale / une autre casse ? (GET uniquement)
import { session, comptes, ORG, SITE } from '../nav-prod.mjs';

const c = await comptes();
const tech = await session(c.technician.email);
const proprio = await session(c.owner.email);
const appel = async (jeton, chemin) => {
  const r = await fetch(SITE + chemin, { headers: jeton ? { Authorization: `Bearer ${jeton}`, 'x-org-id': ORG, 'x-requested-with': 'XMLHttpRequest' } : { 'x-requested-with': 'XMLHttpRequest' } });
  const t = await r.text();
  return `${r.status} ${t.replace(/\s+/g, ' ').slice(0, 110)}`;
};
const routes = [
  '/api/automations/pause',           // état « Tout arrêter » du bureau (automations.read)
  '/api/automations/rules/catalogue', // catalogue
  '/api/billing/current',             // facturation
  '/api/team/members',                // équipe
];
for (const base of routes) {
  console.log(`\n${base}`);
  console.log('  propriétaire, chemin exact :', await appel(proprio.access_token, base));
  for (const variante of [base, `${base}/`, base.replace('/api/', '/API/'), base.replace('/api/', '//api/')]) {
    console.log(`  technicien  ${variante.padEnd(40)} →`, await appel(tech.access_token, variante));
  }
  console.log(`  sans jeton  ${(base + '/').padEnd(40)} →`, await appel(null, `${base}/`));
}
