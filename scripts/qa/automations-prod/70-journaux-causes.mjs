// Vrai site, onglet « Journaux » de l'éditeur : la cause d'un échec est dite en français, jamais en anglais brut.
// Crée UN brouillon de test et DEUX lignes de journal de test (causes écrites par le moteur en anglais),
// lit l'onglet, puis retire le tout. Bureau de test en bac à sable : rien n'est exécuté ni envoyé.
import { randomUUID } from 'node:crypto';
import { ouvrir, capture, admin, ORG } from './outils.mjs';

const CAUSES = [
  ['Review requests are disabled in Settings → Customer reviews.', /demandes d’avis sont désactivées/i],
  ['A review request was already sent to this client in the last 7 days.', /déjà été envoyée à ce client/i],
];

const { data: regle, error } = await admin.from('automation_rules').insert({
  org_id: ORG, name: '[QA-UI p70] journaux', trigger_event: 'job.completed', conditions: {}, delay_seconds: 0,
  actions: [{ type: 'request_review', config: {} }],
  steps: [{ id: 'e1', type: 'action', action: { type: 'request_review', config: {} }, suivant: null }], is_active: false,
}).select('id').single();
if (error) throw new Error(`création du brouillon de test : ${error.message}`);
const lignes = CAUSES.map(([cause]) => ({
  org_id: ORG, automation_rule_id: regle.id, trigger_event: 'job.completed', entity_type: 'job', entity_id: randomUUID(),
  action_type: 'request_review', action_config: {}, result_success: false, result_error: cause, duration_ms: 1,
}));
const { error: e2 } = await admin.from('automation_execution_logs').insert(lignes);

let ok = 0; let total = 0;
const o = await ouvrir({});
const { page } = o;
try {
  total += 1;
  if (e2) throw new Error(`lignes de journal de test : ${e2.message}`);
  await page.goto(`https://lumecrm.net/automations/${regle.id}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Mes automatisations/ }).first().waitFor({ timeout: 60_000 });
  await o.temoins();
  await page.getByRole('tab', { name: 'Journaux' }).or(page.getByRole('button', { name: /^Journaux$/ })).first().click();
  await page.getByText('Journaux d’exécution').waitFor({ timeout: 30_000 });
  await page.getByText(/^2 ligne/).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1_000);
  const texte = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  await capture(page, 'p70-journaux-causes');
  const anglais = CAUSES.filter(([cause]) => texte.includes(cause)).map(([cause]) => cause);
  const manquantes = CAUSES.filter(([, attendu]) => !attendu.test(texte)).map(([cause]) => cause);
  if (anglais.length) throw new Error(`cause affichée en anglais brut : ${anglais.join(' | ')}`);
  if (manquantes.length) throw new Error(`traduction absente de l’écran pour : ${manquantes.join(' | ')}`);
  ok += 1;
  console.log('✓ journaux-causes-en-francais — les deux causes écrites en anglais par le moteur sont lues en français dans l’onglet Journaux');
} catch (e) {
  console.log(`✗ journaux-causes-en-francais : ${String(e).split('\n')[0].slice(0, 320)}`);
  await capture(page, 'p70-echec');
} finally {
  await o.fermer();
  await admin.from('automation_execution_logs').delete().eq('automation_rule_id', regle.id).eq('org_id', ORG);
  const { error: e3 } = await admin.from('automation_rules').delete().eq('id', regle.id).eq('org_id', ORG);
  console.log(e3 ? `MÉNAGE EN ÉCHEC : ${e3.message} (id ${regle.id})` : 'ménage : brouillon et journaux de test retirés');
  console.log(`BILAN : ${ok}/${total}`);
}
