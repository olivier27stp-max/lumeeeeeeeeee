// Passe prod, lot 2 : vérifie sur lumecrm.net (bureau de test en bac à sable) ce que le lot 2 change à l'écran et à l'API.
// Lancé AVANT le déploiement (les défauts doivent se voir) puis APRÈS (ils doivent avoir disparu).
import { ouvrir, capture, admin, ORG, nettoyer, session } from '../nav-prod.mjs';

const MARQUE = '[QA-UI p6]';
const o = await ouvrir({});
const { page, m } = o;
const resultats = [];
const idsCrees = [];
const verifier = async (nom, f) => {
  try { const d = await f(); resultats.push([nom, true]); console.log(`✓ ${nom} — ${d}`); }
  catch (e) { resultats.push([nom, false]); console.log(`✗ ${nom} : ${String(e).split('\n')[0].slice(0, 320)}`); await capture(page, `p6-echec-${nom}`); }
};
const exiger = (c, msg) => { if (!c) throw new Error(msg); };
const api = async (jeton, methode, chemin, corps) => {
  const r = await fetch(`https://lumecrm.net${chemin}`, {
    method: methode,
    headers: { Authorization: `Bearer ${jeton}`, 'x-org-id': ORG, 'Content-Type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await r.text();
  let json = null; try { json = JSON.parse(texte); } catch { /* pas du JSON */ }
  return { status: r.status, json, texte };
};

try {
  /* ── API ───────────────────────────────────────────────────────── */
  await verifier('api-regle-inexistante-404', async () => {
    const r = await api(o.jeton, 'PATCH', '/api/automations/rules/00000000-0000-4000-8000-000000000000', { name: 'x' });
    exiger(r.status === 404, `statut ${r.status} : ${r.texte.slice(0, 120)}`);
    return `404 « ${r.json?.error} »`;
  });
  await verifier('api-refus-lisible', async () => {
    const tech = await session('grok3.audit@lume-test.ca');
    const r = await api(tech.access_token, 'GET', '/api/automations/rules');
    exiger(r.status === 403, `statut ${r.status}`);
    exiger(r.json?.error === 'Permission denied: automations.read', `error : ${r.json?.error}`);
    exiger(r.json?.message === 'Votre rôle ne permet pas de voir les automatisations.', `message : ${r.json?.message}`);
    return `403, message « ${r.json.message} »`;
  });

  /* ── Liste ─────────────────────────────────────────────────────── */
  await page.goto('https://lumecrm.net/automations', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /^Actions pour / }).first().waitFor({ timeout: 60_000 });
  await o.temoins();
  await page.waitForTimeout(800);

  await verifier('liste-ordre-alphabetique', async () => {
    const noms = (await page.getByRole('button', { name: /^Actions pour / }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? '')))
      .map((n) => n.replace(/^Actions pour /, ''));
    const tries = [...noms].sort((a, b) => a.localeCompare(b, 'fr-CA', { sensitivity: 'base', numeric: true }));
    exiger(noms.length >= 5, `seulement ${noms.length} lignes`);
    exiger(JSON.stringify(noms) === JSON.stringify(tries), `ordre affiché : ${noms.slice(0, 6).join(' | ')} — attendu : ${tries.slice(0, 6).join(' | ')}`);
    return `${noms.length} lignes dans l’ordre : ${noms.slice(0, 4).join(' | ')}…`;
  });

  await verifier('un-seul-menu', async () => {
    await page.getByRole('button', { name: /^Actions pour / }).first().click();
    await page.getByRole('menu').first().waitFor({ timeout: 5_000 });
    await page.getByRole('button', { name: /^Créer$/ }).click();
    await page.waitForTimeout(400);
    const n = await page.getByRole('menu').count();
    await capture(page, 'p6-01-menus');
    await page.keyboard.press('Escape');
    exiger(n === 1, `${n} menus ouverts en même temps`);
    return 'un seul menu ouvert';
  });

  await verifier('sous-navigation-liens', async () => {
    const vus = [];
    for (const [chemin, attendu] of [['/automations', '/automations'], ['/automations/apercu', '/automations/apercu'], ['/automations/reglages', '/automations/reglages']]) {
      await page.goto(`https://lumecrm.net${chemin}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('navigation', { name: 'Sections' }).waitFor({ timeout: 60_000 });
      const nav = page.getByRole('navigation', { name: 'Sections' });
      const liens = await nav.getByRole('link').count();
      const courant = await nav.locator('[aria-current="page"]').getAttribute('href').catch(() => null);
      vus.push(`${chemin} : ${liens} liens, courant=${courant}`);
      exiger(liens === 3, `${chemin} : ${liens} liens (attendu 3)`);
      exiger(courant === attendu, `${chemin} : section courante « ${courant} »`);
    }
    return vus.join(' ; ');
  });

  /* ── Bibliothèque de modèles ───────────────────────────────────── */
  await verifier('modele-etapes-et-conditions', async () => {
    await page.goto('https://lumecrm.net/automations', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^Créer$/ }).waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: /^Créer$/ }).click();
    await page.getByRole('menuitem', { name: /Partir d.un modèle/ }).click();
    await page.getByText('Bibliothèque de modèles').first().waitFor({ timeout: 20_000 });
    const recherche = page.getByPlaceholder(/Rechercher/).last();
    await page.getByText(/^\d+ étapes?$/).first().waitFor({ timeout: 30_000 });
    await recherche.fill('Relance de devis');
    await page.waitForTimeout(900);
    const liste = await page.locator('body').innerText();
    await capture(page, 'p6-02-bibliotheque-relance-devis');
    // Le nombre annoncé SUR LA CARTE de « Relance de devis » (pas la première carte venue).
    const annonce = await page.getByText(/^Relance de devis —/).first().evaluate((el) => {
      for (let n = el; n; n = n.parentElement) {
        const vu = /(\d+) étapes?/.exec(n.innerText ?? '');
        if (vu) return vu[1];
      }
      return null;
    });
    void liste;
    await page.getByText(/^Relance de devis —/).first().click();
    await page.waitForTimeout(900);
    const apercu = await page.locator('body').innerText();
    await capture(page, 'p6-03-apercu-relance-devis');
    exiger(annonce === '23', `la carte annonce « ${annonce} étapes » (le modèle en compte 23)`);
    exiger(!/channel\s*=|≠|request_form|= sms/.test(apercu), `conditions techniques dans l’aperçu : ${(/.{0,40}(channel|≠|request_form).{0,40}/.exec(apercu) ?? [''])[0]}`);
    return `23 étapes annoncées, aucune clé technique dans l’aperçu`;
  });
  await page.keyboard.press('Escape').catch(() => undefined);

  /* ── Éditeur ───────────────────────────────────────────────────── */
  await page.goto('https://lumecrm.net/automations/nouvelle', { waitUntil: 'domcontentloaded' });
  await page.getByText('Décris ton automatisation à Lumi').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(800);

  await verifier('tiroir-recherche-et-echap', async () => {
    await page.getByRole('button', { name: /Cliquer pour choisir un autre déclencheur|Choisir le déclencheur/ }).first().click();
    const recherche = page.getByPlaceholder(/Rechercher/).last();
    await recherche.waitFor({ timeout: 5_000 });
    await page.waitForTimeout(500);
    const aLeFocus = await recherche.evaluate((el) => el === document.activeElement);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    const ferme = (await page.getByPlaceholder(/Rechercher dans/).count()) === 0;
    await capture(page, 'p6-04-tiroir-apres-echap');
    exiger(aLeFocus, 'le champ de recherche n’a pas le curseur à l’ouverture');
    exiger(ferme, 'Échap n’a pas fermé le tiroir');
    return 'curseur dans la recherche, Échap ferme';
  });

  await verifier('ctrl-z-annule', async () => {
    await page.getByRole('button', { name: /Cliquer pour choisir un autre déclencheur|Choisir le déclencheur/ }).first().click();
    await page.getByPlaceholder(/Rechercher/).last().fill('prospect');
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /Nouveau prospect|Prospect créé/ }).first().click();
    await page.waitForURL(/automations\/[0-9a-f-]{36}/, { timeout: 20_000 });
    const id = page.url().match(/automations\/([0-9a-f-]{36})/)[1];
    // Retirée PAR IDENTIFIANT à la fin : l'enregistrement automatique de l'éditeur réécrit le nom, la marque ne tient pas.
    idsCrees.push(id);
    await page.getByRole('button', { name: /Ajouter une première étape/ }).click();
    await page.waitForTimeout(500);
    await page.getByPlaceholder(/Rechercher/).last().fill('tâche');
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: /^Créer une tâche/ }).first().click();
    await page.waitForTimeout(1200);
    // Ferme le panneau s'il s'est ouvert, puis sort de tout champ.
    const enregistrer = page.getByRole('button', { name: /^Enregistrer$/ });
    if (await enregistrer.count()) await enregistrer.first().click().catch(() => undefined);
    await page.waitForTimeout(800);
    await page.mouse.click(700, 120);
    await capture(page, 'p6-05a-avant-ctrl-z');
    const avant =await page.getByRole('button', { name: /Ajouter une première étape/ }).count();
    // Ajouter l'étape puis l'enregistrer dans son panneau = deux pas d'historique : on annule jusqu'à trois fois.
    let apres = 0; let pressions = 0;
    while (apres === 0 && pressions < 3) {
      await page.keyboard.press('Control+z');
      pressions += 1;
      await page.waitForTimeout(900);
      apres = await page.getByRole('button', { name: /Ajouter une première étape/ }).count();
    }
    await capture(page, 'p6-05-apres-ctrl-z');
    exiger(avant === 0, 'l’étape n’a pas été ajoutée : cas non rejoué');
    exiger(apres === 1, 'Ctrl+Z n’a pas retiré l’étape ajoutée');
    return `Ctrl+Z retire l’étape qu’on vient d’ajouter (${pressions} pression(s))`;
  });
} finally {
  console.log('MONITEUR : console', m.console.length, '| exceptions', m.exceptions.length, '| réseau >=400', m.reseau.length, '| échecs', m.echecs.length);
  if (m.reseau.length) console.log('  réseau :', JSON.stringify(m.reseau).slice(0, 500));
  await o.fermer();
  let retirees = await nettoyer(MARQUE);
  for (const id of idsCrees) {
    const { data: r } = await admin.from('automation_rules').select('id, is_active').eq('org_id', ORG).eq('id', id).maybeSingle();
    if (!r || r.is_active) continue;
    await admin.from('automation_scheduled_tasks').delete().eq('automation_rule_id', id).eq('org_id', ORG);
    const { error } = await admin.from('automation_rules').delete().eq('id', id).eq('org_id', ORG);
    if (!error) retirees += 1;
  }
  console.log('ménage :', retirees, 'règle(s) retirée(s)');
  console.log(`BILAN : ${resultats.filter((r) => r[1]).length}/${resultats.length}`);
}
