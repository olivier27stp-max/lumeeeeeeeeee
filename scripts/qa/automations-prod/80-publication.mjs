// Vrai site, liste : publier puis repasser en brouillon avec l'INTERRUPTEUR, et relire la base à chaque fois.
// La publication ne s'écrit plus avec la session de l'utilisateur (le serveur publie, la base garde la table) :
// ce script prouve que le bouton, lui, marche toujours — avant ET après la migration de garde.
// Crée UN brouillon de test (déclencheur « devis refusé », une tâche interne), le retire à la fin.
// Bureau de test en bac à sable : rien n'est envoyé.
import { ouvrir, capture, admin, ORG } from './outils.mjs';

const NOM = `[QA-UI p80] publication ${Date.now().toString(36)}`;
const { data: regle, error } = await admin.from('automation_rules').insert({
  org_id: ORG, name: NOM, trigger_event: 'quote.declined', conditions: {}, delay_seconds: 0,
  actions: [{ type: 'create_task', config: { title: 'Rappeler [client_name] — essai de publication' } }],
  steps: [{ id: 'e1', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler [client_name] — essai de publication' } }, suivant: null }],
  is_active: false,
}).select('id').single();
if (error) throw new Error(`création du brouillon de test : ${error.message}`);

const lireActif = async () => (await admin.from('automation_rules').select('is_active').eq('id', regle.id).maybeSingle()).data?.is_active;
async function attendreActif(voulu) {
  const fin = Date.now() + 25_000;
  for (;;) {
    const v = await lireActif();
    if (v === voulu) return;
    if (Date.now() > fin) throw new Error(`en base, is_active vaut ${v} au lieu de ${voulu} après 25 s`);
    await new Promise((r) => setTimeout(r, 700));
  }
}

let ok = 0; let total = 0;
const o = await ouvrir({});
const { page } = o;
const refus = [];
page.on('response', (r) => { if (r.url().includes('/api/automations') && r.status() >= 400) refus.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
const interrupteur = () => page.getByRole('row').filter({ hasText: NOM }).getByRole('switch');
const etape = async (nom, faire) => {
  total += 1;
  try { await faire(); ok += 1; console.log(`✓ ${nom}`); } catch (e) { console.log(`✗ ${nom} : ${String(e).split('\n')[0].slice(0, 300)}${refus.length ? ` · refus : ${refus.join(' | ')}` : ''}`); await capture(page, `p80-echec-${total}`); }
};
try {
  await page.goto('https://lumecrm.net/automations', { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 60_000 });
  await o.temoins();
  await page.getByPlaceholder('Rechercher').first().fill('QA-UI p80');
  await interrupteur().waitFor({ timeout: 30_000 });

  await etape('publier-par-l-interrupteur — la base passe à « publiée », l’écran aussi', async () => {
    await interrupteur().click();
    // Une confirmation peut s'ouvrir (texte d'exemple, client inactif) : ici le texte est rédigé, aucune n'est attendue.
    await attendreActif(true);
    await page.waitForFunction((nom) => [...document.querySelectorAll('tr')].some((l) => l.textContent.includes(nom) && l.querySelector('[role="switch"][aria-checked="true"]')), NOM, { timeout: 10_000 });
  });
  await etape('rechargement — la règle est toujours publiée à l’écran', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 60_000 });
    await page.getByPlaceholder('Rechercher').first().fill('QA-UI p80');
    await interrupteur().waitFor({ timeout: 30_000 });
    if ((await interrupteur().getAttribute('aria-checked')) !== 'true') throw new Error('interrupteur éteint après rechargement');
  });
  await etape('repasser-en-brouillon — la base repasse à « brouillon »', async () => {
    await interrupteur().click();
    await attendreActif(false);
  });
  await capture(page, 'p80-publication');
  if (refus.length) console.log(`refus de l’API relevés : ${refus.join(' | ')}`);
} finally {
  await o.fermer();
  await admin.from('automation_scheduled_tasks').delete().eq('automation_rule_id', regle.id);
  await admin.from('automation_execution_logs').delete().eq('automation_rule_id', regle.id).eq('org_id', ORG);
  const { error: e3 } = await admin.from('automation_rules').delete().eq('id', regle.id).eq('org_id', ORG);
  console.log(e3 ? `MÉNAGE EN ÉCHEC : ${e3.message} (id ${regle.id})` : 'ménage : brouillon de test retiré');
  console.log(`BILAN : ${ok}/${total}`);
}
