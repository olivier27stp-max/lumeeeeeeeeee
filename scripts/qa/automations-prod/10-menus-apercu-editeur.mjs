// Vrai site, lot 1 (PR #859) : vérifie SUR lumecrm.net, dans le bureau de test en bac à sable,
// que chaque correctif du lot se voit à l'écran. N'envoie rien : « M'envoyer un essai » n'est PAS cliqué.
import { ouvrir, capture, admin, ORG, nettoyer, retirerBrouillon } from './outils.mjs';

const MARQUE = '[QA-UI p4]';
const o = await ouvrir({});
const { page, m } = o;
const resultats = [];
const idsCrees = [];
const verifier = async (nom, f) => {
  const i = m.marque();
  try {
    const detail = await f();
    const d = m.depuis(i);
    const pb = [...d.console, ...d.exceptions, ...d.reseau, ...d.echecs];
    resultats.push({ nom, ok: true, detail, pb: pb.length });
    console.log(`✓ ${nom} — ${detail}${pb.length ? ` — ⚠ ${pb.length} problème(s) : ${JSON.stringify(pb).slice(0, 300)}` : ''}`);
  } catch (e) {
    resultats.push({ nom, ok: false, detail: String(e).split('\n')[0].slice(0, 300) });
    console.log(`✗ ${nom} : ${String(e).split('\n')[0].slice(0, 300)}`);
    await capture(page, `p4-echec-${nom}`);
  }
};
const exiger = (cond, msg) => { if (!cond) throw new Error(msg); };

try {
  /* ── Liste ─────────────────────────────────────────────────────── */
  await page.goto('https://lumecrm.net/automations', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Actions pour / }).first().waitFor({ timeout: 60_000 });
  await o.temoins();
  await page.waitForTimeout(800);

  await verifier('menu-ligne-entier', async () => {
    const boutons = page.getByRole('button', { name: /^Actions pour / });
    const n = await boutons.count();
    const dernier = boutons.nth(n - 1);
    await dernier.scrollIntoViewIfNeeded();
    await dernier.click();
    const menu = page.getByRole('menu').last();
    await menu.waitFor({ timeout: 5_000 });
    const r = await menu.boundingBox();
    const vue = page.viewportSize();
    await capture(page, 'p4-01-menu-derniere-ligne');
    exiger(r && r.y >= 0 && r.y + r.height <= vue.height && r.x >= 0 && r.x + r.width <= vue.width, `menu hors écran : ${JSON.stringify(r)}`);
    const items = await menu.getByRole('menuitem').allInnerTexts();
    exiger(items.length >= 3, `menu incomplet : ${items.join(' | ')}`);
    // (Une automatisation de base n'a pas « Supprimer » : c'est voulu.)
    // Chaque entrée doit être réellement cliquable (ni rognée, ni recouverte).
    for (const it of await menu.getByRole('menuitem').all()) await it.click({ trial: true, timeout: 3_000 });
    return `${n} lignes ; menu de la dernière entier (${Math.round(r.y)}→${Math.round(r.y + r.height)} / ${vue.height}) ; ${items.length} entrées cliquables`;
  });

  await verifier('echap-ferme-le-menu', async () => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    exiger((await page.getByRole('menu').count()) === 0, 'le menu est resté ouvert');
    const focus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || '');
    exiger(/^Actions pour /.test(focus), `focus non rendu au bouton : « ${focus} »`);
    return `fermé, focus rendu à « ${focus.slice(0, 50)} »`;
  });

  /* ── Éditeur de courriel ───────────────────────────────────────── */
  const { data: regles } = await admin.from('automation_rules').select('id, name, trigger_event, actions, steps, deleted_at').eq('org_id', ORG).is('deleted_at', null);
  const avecCourriel = (regles ?? []).find((r) => JSON.stringify(r.actions ?? []).includes('send_email') && !JSON.stringify(r.steps ?? null).includes('"type":"action"'))
    ?? (regles ?? []).find((r) => JSON.stringify(r.actions ?? []).includes('send_email'));
  console.log('  règle avec courriel :', avecCourriel ? `${avecCourriel.name} / ${avecCourriel.trigger_event}` : 'AUCUNE');

  await verifier('palette-inserer-bornee', async () => {
    exiger(avecCourriel, 'aucune règle avec courriel dans le bureau de test');
    const voir = page.getByRole('button', { name: /^Voir les messages de / });
    const total = await voir.count();
    let ouvert = false;
    for (let i = 0; i < total && !ouvert; i++) {
      await voir.nth(i).scrollIntoViewIfNeeded();
      await voir.nth(i).click();
      await page.waitForTimeout(500);
      if (await page.getByText('Courriel envoyé au client').count()) { ouvert = true; break; }
      await voir.nth(i).click();
    }
    exiger(ouvert, 'aucune ligne ne montre « Courriel envoyé au client »');
    await page.getByText('Courriel envoyé au client').first().locator('xpath=ancestor::div[2]').getByRole('button', { name: /^Modifier$/ }).click();
    const palette = page.getByTestId('palette-variables');
    await palette.waitFor({ timeout: 10_000 });
    await page.waitForTimeout(600);
    const r = await palette.boundingBox();
    const nb = await palette.getByRole('button').count();
    const vue = page.viewportSize();
    await capture(page, 'p4-02-editeur-courriel-modifier');
    exiger(r.height <= 80, `palette trop haute : ${r.height}px`);
    const objet = await page.getByLabel('Objet du courriel').boundingBox();
    const enregistrer = await page.getByRole('button', { name: /^Enregistrer/ }).last().boundingBox();
    exiger(enregistrer && enregistrer.y + enregistrer.height <= vue.height, '« Enregistrer » hors écran');
    const recherche = page.getByLabel('Chercher une variable à insérer');
    await recherche.fill('telephone');
    await page.waitForTimeout(300);
    const filtres = await palette.getByRole('button').count();
    exiger(filtres > 0 && filtres < nb, `filtre sans effet : ${filtres} / ${nb}`);
    await capture(page, 'p4-03-editeur-courriel-recherche');
    await recherche.fill('');
    return `${nb} variables dans ${Math.round(r.height)} px (avant : ≈ 450 px) ; zone du courriel ${Math.round(r.y - (objet?.y ?? 0))} px ; « telephone » → ${filtres} `;
  });

  await verifier('apercu-reel-fidele', async () => {
    await page.getByRole('button', { name: /^Aperçu réel$/ }).click();
    const cadre = page.frameLocator('iframe').last();
    await cadre.locator('body').waitFor({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    const texte = await cadre.locator('body').innerText();
    await capture(page, 'p4-04-apercu-reel');
    exiger(texte.trim().length > 40, 'aperçu vide');
    const essai = await page.getByRole('button', { name: /M’envoyer un essai/ }).boundingBox();
    exiger(essai && essai.y + essai.height <= page.viewportSize().height, '« M’envoyer un essai » hors écran');
    exiger(!/Montant à payer|1 220,17|Carte de crédit/.test(texte), `bloc de paiement inventé encore là : ${texte.replace(/\s+/g, ' ').slice(0, 200)}`);
    const bouton = /Approuver la soumission|Payer la facture/.exec(texte)?.[0] ?? 'aucun bouton';
    return `aucun bloc de paiement ; ${bouton} (déclencheur ${avecCourriel?.trigger_event}) ; ${texte.replace(/\s+/g, ' ').slice(0, 90)}…`;
  });
  await page.keyboard.press('Escape').catch(() => undefined);
  const fermer = page.getByRole('button', { name: /^Fermer$/ });
  if (await fermer.count()) await fermer.first().click().catch(() => undefined);

  /* ── Automatisation neuve ──────────────────────────────────────── */
  await page.goto('https://lumecrm.net/automations/nouvelle', { waitUntil: 'domcontentloaded' });
  await page.getByText('Décris ton automatisation à Lumi').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);

  await verifier('neuve-pas-encore-enregistree', async () => {
    const corps = await page.locator('body').innerText();
    await capture(page, 'p4-05-neuve');
    exiger(/Pas encore enregistrée/.test(corps), '« Pas encore enregistrée » absent');
    exiger(!/chose[s]? à régler|bloque la publication/i.test(corps), 'alerte de publication affichée sur une automatisation vide');
    return '« Pas encore enregistrée », aucune alerte de publication';
  });

  await verifier('etape-visee-en-menu', async () => {
    await page.getByRole('button', { name: /Choisir le déclencheur|Cliquer pour choisir un autre déclencheur/ }).first().click();
    const recherche = page.getByPlaceholder(/Rechercher/).last();
    await recherche.fill('opportunité');
    await page.waitForTimeout(500);
    await capture(page, 'p4-06-declencheurs-opportunite');
    await page.getByRole('button', { name: /opportunité|Opportunité/ }).filter({ hasNotText: /Rechercher/ }).first().click();
    await page.waitForURL(/automations\/[0-9a-f-]{36}/, { timeout: 20_000 });
    const id = page.url().match(/automations\/([0-9a-f-]{36})/)[1];
    // Retiré PAR IDENTIFIANT à la fin : l'enregistrement automatique de l'éditeur réécrit le nom.
    idsCrees.push(id);
    await page.getByRole('button', { name: /Ajouter une première étape/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /^Déplacer l.opportunité/ }).first().click();
    await page.waitForTimeout(800);
    // La cible « Une étape précise ».
    const cible = page.locator('select').filter({ has: page.locator('option', { hasText: /Une étape précise/ }) }).first();
    await cible.selectOption({ label: 'Une étape précise' });
    await page.waitForTimeout(600);
    const libelle = page.locator('label', { hasText: 'L’étape visée' }).first();
    await libelle.waitFor({ timeout: 5_000 });
    const pour = await libelle.getAttribute('for');
    const info = await page.evaluate((idChamp) => {
      const el = document.getElementById(idChamp);
      return el ? { balise: el.tagName, options: el.tagName === 'SELECT' ? Array.from(el.options).map((x) => x.textContent) : [], texte: el.textContent } : null;
    }, pour);
    await capture(page, 'p4-07-etape-visee');
    exiger(info, 'contrôle lié au libellé introuvable');
    exiger(info.balise === 'SELECT' || /Aucune étape de pipeline/.test(info.texte ?? ''), `ce n’est pas un menu : ${info.balise}`);
    return info.balise === 'SELECT' ? `menu de ${info.options.length - 1} étape(s) : ${info.options.slice(0, 4).join(' | ')}` : 'aucun pipeline dans ce bureau : le panneau le dit';
  });
} finally {
  console.log('MONITEUR total : console', m.console.length, '| exceptions', m.exceptions.length, '| réseau >=400', m.reseau.length, '| échecs', m.echecs.length);
  if (m.reseau.length) console.log('  réseau :', JSON.stringify(m.reseau).slice(0, 600));
  await o.fermer();
  let retirees = await nettoyer(MARQUE);
  for (const id of idsCrees) if (await retirerBrouillon(id)) retirees += 1;
  console.log('ménage :', retirees, 'règle(s) retirée(s)');
  console.log(`BILAN : ${resultats.filter((r) => r.ok).length}/${resultats.length}`);
}
