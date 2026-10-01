// Vrai site, comportements du navigateur dans l'éditeur : rechargement, retour arrière, liens directs
// (règle inexistante, règle à la corbeille), coupure de réseau, deux onglets sur la même automatisation.
// Travaille sur DEUX brouillons de test créés ici (jamais publiés, bureau en bac à sable), retirés à la fin.
import { ouvrir, capture, admin, ORG, retirerBrouillon } from './outils.mjs';

const steps = [
  { id: 'e1', type: 'action', action: { type: 'create_task', config: { title: 'Rappeler [client_name]' } }, suivant: null },
];
const creer = async (nom, extra = {}) => {
  const { data, error } = await admin.from('automation_rules').insert({
    org_id: ORG, name: nom, trigger_event: 'lead.created', conditions: {}, delay_seconds: 0,
    actions: [{ type: 'create_task', config: steps[0].action.config }], steps, is_active: false, ...extra,
  }).select('id').single();
  if (error) throw new Error(`création du brouillon de test : ${error.message}`);
  return data.id;
};
const vivante = await creer('[QA-UI p50] comportements');
const corbeille = await creer('[QA-UI p50] à la corbeille', { deleted_at: new Date().toISOString() });
const lire = async (id) => (await admin.from('automation_rules').select('name, steps, updated_at').eq('id', id).eq('org_id', ORG).maybeSingle()).data;

const o = await ouvrir({});
const { page, context, m } = o;
let ok = 0; let total = 0;
const verifier = async (nom, f) => {
  total += 1;
  const i = m.marque();
  try {
    const d = await f();
    const apres = m.depuis(i);
    const exceptions = apres.exceptions.length;
    if (exceptions) throw new Error(`${exceptions} exception(s) de page : ${apres.exceptions[0].texte.slice(0, 160)}`);
    ok += 1; console.log(`✓ ${nom} — ${d}`);
  } catch (e) { console.log(`✗ ${nom} : ${String(e).split('\n')[0].slice(0, 320)}`); await capture(page, `p50-echec-${nom}`); }
};
const exiger = (c, msg) => { if (!c) throw new Error(msg); };
const editeurPret = (p = page) => p.getByText('Créer une tâche').first().waitFor({ timeout: 60_000 });
/** Le haut de l'écran de l'ÉDITEUR (nom, indicateur d'enregistrement). */
const titre = (p = page) => p.evaluate(() => {
  // La barre de l'éditeur : le conteneur du bouton de retour « Mes automatisations » (l'app derrière garde son menu dans le DOM).
  const retour = [...document.querySelectorAll('button')].find((b) => /Mes automatisations/.test(b.textContent || '') && b.querySelector('svg'));
  return (retour?.parentElement?.innerText ?? '').replace(/\s+/g, ' ');
});
/** L'app a fini de démarrer (« Chargement de l'espace… » parti). */
const appPrete = (p = page) => p.getByText(/Chargement de l.espace/).waitFor({ state: 'hidden', timeout: 90_000 }).catch(() => undefined);

try {
  await page.goto(`https://lumecrm.net/automations/${vivante}`, { waitUntil: 'domcontentloaded' });
  await editeurPret();
  await o.temoins();

  await verifier('recharger-garde-le-parcours', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await editeurPret();
    const t = await titre();
    exiger(/\[QA-UI p50\] comportements/.test(t), `nom absent après rechargement : ${t.slice(0, 120)}`);
    return 'après F5 : même automatisation, même étape, aucun écran blanc';
  });

  await verifier('retour-arriere-puis-avancer', async () => {
    await page.getByRole('button', { name: /Mes automatisations/ }).first().click();
    await page.getByRole('button', { name: /^Actions pour / }).first().waitFor({ timeout: 60_000 });
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await editeurPret();
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^Actions pour / }).first().waitFor({ timeout: 60_000 });
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await editeurPret();
    return 'liste ⇄ éditeur par les flèches du navigateur, chaque écran se recharge';
  });

  await verifier('lien-direct-regle-inexistante', async () => {
    await page.goto('https://lumecrm.net/automations/00000000-0000-4000-8000-000000000000', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_500);
    await appPrete();
    await page.getByText(/introuvable|n’existe plus/i).first().waitFor({ timeout: 45_000 }).catch(() => undefined);
    const corps = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    await capture(page, 'p50-regle-inexistante');
    exiger(corps.trim().length > 40, 'écran vide');
    exiger(/introuvable|n’existe plus|n'existe plus|Mes automatisations/i.test(corps), `aucun message : ${corps.slice(0, 160)}`);
    const phrase = /Cette automatisation[^.]*(introuvable|n’existe plus)[^.]*\./i.exec(corps)?.[0];
    exiger(!!phrase, `message attendu absent : ${corps.slice(0, 160)}`);
    exiger((await page.getByRole('button', { name: /^Mes automatisations$/ }).count()) >= 1, 'bouton « Mes automatisations » absent');
    return `l’écran le dit : « ${phrase} », avec « Mes automatisations »`;
  });

  await verifier('lien-direct-regle-a-la-corbeille', async () => {
    await page.goto(`https://lumecrm.net/automations/${corbeille}`, { waitUntil: 'domcontentloaded' });
    await page.getByText(/à la corbeille/i).first().waitFor({ timeout: 30_000 });
    const restaurer = await page.getByRole('button', { name: /^Restaurer$/ }).count();
    await capture(page, 'p50-regle-corbeille');
    exiger(restaurer === 1, '« Restaurer » absent');
    exiger((await page.getByText('Créer une tâche').count()) === 0, 'le canevas d’édition est affiché pour une règle à la corbeille');
    return 'écran « à la corbeille » avec « Restaurer », pas d’éditeur';
  });

  await verifier('hors-ligne-puis-retour', async () => {
    await page.goto(`https://lumecrm.net/automations/${vivante}`, { waitUntil: 'domcontentloaded' });
    await editeurPret();
    const avant = await lire(vivante);
    let pendant = '';
    await context.setOffline(true);
    try {
      // Renommer hors ligne : l'écran ne doit PAS dire « Enregistré ».
      await page.getByRole('button', { name: /\[QA-UI p50\] comportements/ }).first().click();
      const champ = page.getByLabel('Nom de l’automatisation');
      await champ.waitFor({ timeout: 8_000 });
      await champ.fill('[QA-UI p50] comportements hors ligne');
      await champ.press('Enter');
      await page.waitForTimeout(7_000);
      pendant = await titre();
      await capture(page, 'p50-hors-ligne');
      const enBase = await lire(vivante);
      exiger(enBase.name === avant.name, 'la base a changé alors que le navigateur était hors ligne');
      exiger(pendant.length > 10, 'barre de l’éditeur introuvable');
      exiger(!/Enregistré/.test(pendant), `l’écran dit « Enregistré » alors que rien n’a pu partir : ${pendant.slice(0, 200)}`);
    } finally { await context.setOffline(false); }
    // De retour en ligne : la modification finit par s'enregistrer (d'elle-même ou au prochain geste).
    let apres = null;
    for (let i = 0; i < 15; i++) { await page.waitForTimeout(2_000); apres = await lire(vivante); if (apres.name !== avant.name) break; }
    return `hors ligne : l’écran dit « ${pendant.slice(-40).trim()} », rien n’est écrit ; de retour en ligne : ${apres.name !== avant.name ? 'le nouveau nom est enregistré' : 'NON enregistré de lui-même (à refaire à la main)'}`;
  });

  await verifier('deux-onglets-meme-automatisation', async () => {
    const autre = await context.newPage();
    try {
      await autre.goto(`https://lumecrm.net/automations/${vivante}`, { waitUntil: 'domcontentloaded' });
      await editeurPret(autre);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await editeurPret();
      // Onglet 1 supprime la règle… côté base (comme le ferait l'autre onglet) : l'onglet 2 doit le dire à sa prochaine écriture.
      await admin.from('automation_rules').delete().eq('id', vivante).eq('org_id', ORG);
      await autre.getByRole('button', { name: /^Ajouter$/ }).first().click();
      await autre.getByPlaceholder(/Rechercher/).last().fill('tâche');
      await autre.waitForTimeout(400);
      await autre.getByRole('button', { name: /^Créer une tâche/ }).first().click();
      await autre.waitForTimeout(600);
      const enregistrer = autre.getByRole('button', { name: /^Enregistrer$/ });
      if (await enregistrer.count()) await enregistrer.first().click().catch(() => undefined);
      await autre.getByText(/n’existe plus/).first().waitFor({ timeout: 30_000 });
      await capture(autre, 'p50-deux-onglets');
      return 'la règle supprimée ailleurs : l’onglet resté ouvert dit « Cette automatisation n’existe plus. » au lieu d’enregistrer dans le vide';
    } finally { await autre.close().catch(() => undefined); }
  });
} finally {
  await o.fermer();
  let retires = 0;
  for (const id of [vivante, corbeille]) {
    const { data } = await admin.from('automation_rules').select('id').eq('id', id).eq('org_id', ORG).maybeSingle();
    if (!data) continue;
    if (await retirerBrouillon(id)) retires += 1;
    else { const { error } = await admin.from('automation_rules').delete().eq('id', id).eq('org_id', ORG).eq('is_active', false); if (!error) retires += 1; }
  }
  console.log('ménage :', retires, 'brouillon(s) de test retiré(s)');
  console.log(`BILAN : ${ok}/${total}`);
}
