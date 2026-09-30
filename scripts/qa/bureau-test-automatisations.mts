/**
 * Crée (ou retrouve) le bureau de test de `npm run test:automations` sur
 * STAGING et affiche ses identifiants. Idempotent. Voir
 * tests/automations-suite/harnais/bureau-test.ts.
 *
 *   npx tsx --env-file=.env.local scripts/qa/bureau-test-automatisations.mts
 */
import { assurerBureauTest } from '../../tests/automations-suite/harnais/bureau-test';

const b = await assurerBureauTest();
const { data } = await b.admin.from('orgs_envois_simules').select('org_id, mode').in('org_id', [b.orgA, b.orgB]);
console.log(JSON.stringify({ orgA: b.orgA, orgB: b.orgB, comptes: b.users, bac_a_sable: data }, null, 2));
