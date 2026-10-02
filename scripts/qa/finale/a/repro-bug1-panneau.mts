/**
 * Reproduction AU VRAI NAVIGATEUR du bug n° 1 de la mission, chemin (a) :
 * le panneau « Construire avec Lumi » de l'éditeur (POST /api/automations/rules/generer).
 *
 *   QA_AUTO_SUFFIXE=a npx tsx --env-file=.env.local scripts/qa/finale/a/repro-bug1-panneau.mts [ferme|ouvert] ["demande"]
 *
 *   ferme  : le panneau d'étape est FERMÉ quand on parle à Lumi (cas simple).
 *   ouvert : l'étape a été enregistrée puis ROUVERTE ; son panneau est ouvert pendant que Lumi répond.
 *   frais  : LE GESTE DU PROPRIÉTAIRE — il vient de choisir « Envoyer un texto » dans le tiroir ;
 *            le panneau de la nouvelle étape s'est ouvert tout seul (texte d'exemple) et il parle
 *            à Lumi sans y toucher. Après la réponse, on ferme le panneau par sa croix.
 *
 * Trace : chaque appel /api, la ligne `automation_rules` (steps ET actions) à chaque moment,
 * et ce que montrent la carte du canevas, le panneau d'étape, la liste dépliée, Réglages ›
 * Messagerie et l'aperçu — sans recharger, puis après rechargement.
 * Sortie : D:/lume-final/sorties/a/repro-bug1-panneau-<variante>.json (+ captures).
 */
import { bureauA, capturer, ecrireSortie, fermerNavigateur, lireRegle, messagesDe, nettoyerDepuis, ouvrirOnglet, depenseDepuis, APP, marque } from './outils.mts';

const variante = (['ouvert', 'frais'].includes(process.argv[2] ?? '') ? process.argv[2] : 'ferme') as 'ferme' | 'ouvert' | 'frais';
const DEMANDE = process.argv[3] ?? 'change le message de l’automatisation';
const M = marque(`bug1-${variante}`);
const UUID = /\/automations\/([0-9a-f-]{36})/;
const trace: Array<Record<string, unknown>> = [];
const noter = (etape: string, donnees: Record<string, unknown>) => { trace.push({ etape, ...donnees }); console.log(`\n── ${etape}\n${JSON.stringify(donnees, null, 1).slice(0, 2500)}`); };

const b = await bureauA();
const debut = new Date().toISOString();
const o = await ouvrirOnglet();
const { page } = o;

async function cartes(): Promise<Array<[string, string]>> {
  const boutons = page.locator('div.relative.w-\\[260px\\] > button:first-child');
  const out: Array<[string, string]> = [];
  for (let i = 0; i < await boutons.count(); i++) {
    const spans = boutons.nth(i).locator('span.min-w-0 > span');
    out.push([((await spans.nth(0).textContent()) ?? '').trim(), (await spans.count()) > 1 ? ((await spans.nth(1).textContent()) ?? '').trim() : '']);
  }
  return out;
}
const etat = () => page.locator('header span.text-xs').last();
async function attendreEnregistre(delai = 40_000): Promise<string> {
  const fin = Date.now() + delai;
  let t = '';
  while (Date.now() < fin) {
    t = ((await etat().textContent().catch(() => '')) ?? '').trim();
    if (t === 'Enregistré') return t;
    await page.waitForTimeout(400);
  }
  return t;
}
const panneau = () => page.getByRole('complementary', { name: 'Modifier l’étape' });
async function choisirDansTiroir(titre: 'Actions' | 'Déclencheurs', choix: string) {
  const t = page.getByRole('complementary', { name: titre });
  await t.waitFor();
  await t.getByRole('searchbox').fill(choix);
  await t.getByRole('button', { name: new RegExp(`^${choix}`) }).first().click();
}
const base = async (id: string) => { const r = await lireRegle(id); return { ...messagesDe(r), is_active: r.is_active, updated_at: r.updated_at, nb_steps: r.steps?.length ?? 0, conversation: r.lumi_conversation?.length ?? 0 }; };

try {
  // 1. Créer « Facture en retard » + une étape texto, dans l'éditeur, comme le propriétaire.
  await page.goto(`${APP}/automations/nouvelle`);
  await page.getByRole('button', { name: /Cliquer pour choisir un autre déclencheur/ }).waitFor({ timeout: 90_000 });
  await page.getByRole('button', { name: /Nouvelle automatisation/ }).click();
  const champNom = page.getByRole('textbox', { name: 'Nom de l’automatisation' });
  await champNom.fill(`${M} Relance facture en retard`);
  await champNom.press('Enter');
  await page.waitForURL(UUID, { timeout: 30_000 });
  const id = page.url().match(UUID)![1];
  await page.getByRole('button', { name: /Cliquer pour choisir un autre déclencheur/ }).click();
  await choisirDansTiroir('Déclencheurs', 'Facture en retard');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /Ajouter une première étape/ }).click();
  await choisirDansTiroir('Actions', 'Envoyer un texto');
  await panneau().waitFor();
  const texteExemple = await panneau().getByLabel(/Texte du message/).inputValue();
  if (variante !== 'frais') {
    await panneau().getByRole('button', { name: 'Enregistrer' }).click();
    await panneau().waitFor({ state: 'hidden' });
  }
  const e1 = await attendreEnregistre();
  noter('1. automatisation créée dans l’éditeur', { id, nom_donne_par_l_utilisateur: (await lireRegle(id)).name, indicateur: e1, texte_exemple_du_panneau: texteExemple, cartes: await cartes(), base: await base(id), declencheur: (await lireRegle(id)).trigger_event });

  if (variante === 'ouvert') {
    // Le propriétaire a l'étape ouverte (il regarde son texte) pendant qu'il parle à Lumi.
    await page.locator('div.relative.w-\\[260px\\]').first().locator('button').first().click();
    await panneau().waitFor();
    noter('1b. panneau de l’étape texto rouvert AVANT de parler à Lumi', { texte_du_panneau: await panneau().getByLabel(/Texte du message/).inputValue() });
  }

  // 2. La demande, mot pour mot, dans le champ de Lumi de l'éditeur.
  const nAppels = o.appels.length;
  const champLumi = page.getByLabel('Décris ton automatisation');
  await champLumi.fill(DEMANDE);
  await capturer(page, `bug1-${variante}-avant-envoi`);
  await page.getByRole('button', { name: /^(Construire|Envoyer)$/ }).click();
  await page.locator('[data-sonner-toast]').filter({ hasText: /Lumi a construit|Lumi|parcours/ }).first().waitFor({ timeout: 90_000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
  const toasts = await page.locator('[data-sonner-toast]').allTextContents();
  const fil = await page.getByRole('complementary', { name: 'Clavardage avec Lumi' }).locator('p.whitespace-pre-wrap').allTextContents().catch(() => []);
  const appelGenerer = o.appels.slice(nAppels).find((a) => a.chemin.includes('/generer'));
  noter('2. réponse de Lumi (panneau de l’éditeur)', {
    demande: DEMANDE, toasts, fil_de_lumi: fil,
    route: appelGenerer ? { methode: appelGenerer.methode, chemin: appelGenerer.chemin, statut: appelGenerer.statut, envoye: appelGenerer.envoye.slice(0, 1500) } : 'AUCUN appel /generer',
    base_juste_apres_la_reponse: await base(id),
  });
  await capturer(page, `bug1-${variante}-reponse-lumi`);

  // 3. Sans recharger : ce que montrent la carte et le panneau.
  const indicateur = await attendreEnregistre(variante === 'ferme' ? 40_000 : 12_000);
  const ecritures = o.appels.slice(nAppels).filter((a) => a.methode !== 'GET' && a.chemin.includes('/automations/rules')).map((a) => ({ methode: a.methode, chemin: a.chemin, statut: a.statut, cles_envoyees: (() => { try { return Object.keys(JSON.parse(a.envoye)); } catch { return a.envoye.slice(0, 80); } })() }));
  const texteOuvert = await panneau().isVisible().catch(() => false) ? await panneau().getByLabel(/Texte du message/).inputValue() : null;
  noter('3. SANS recharger', { nom_en_base_apres_lumi: (await lireRegle(id)).name, indicateur_enregistrement: indicateur, cartes_du_canevas: await cartes(), panneau_d_etape_reste_ouvert_texte: texteOuvert, ecritures_reseau: ecritures, base: await base(id) });
  await capturer(page, `bug1-${variante}-sans-recharger`);

  if (variante === 'frais' && texteOuvert !== null) {
    // Le propriétaire ne voit pas son changement dans le panneau : il le ferme par la croix.
    await capturer(page, 'bug1-frais-panneau-perime');
    await panneau().getByRole('button', { name: /Fermer/ }).first().click();
    await page.waitForTimeout(800);
    const dialogue = page.getByRole('dialog');
    const question = await dialogue.isVisible().catch(() => false) ? ((await dialogue.textContent()) ?? '').slice(0, 300) : null;
    await capturer(page, 'bug1-frais-fermeture');
    noter('3a. fermeture du panneau par la croix (rien n’a été tapé dedans)', { boite_de_confirmation: question ?? 'aucune', base: await base(id) });
    if (question) { await dialogue.getByRole('button').last().click().catch(() => undefined); await page.waitForTimeout(600); }
    noter('3a-bis. après la boîte', { panneau_encore_ouvert: await panneau().isVisible().catch(() => false), cartes_du_canevas: await cartes(), base: await base(id) });
  } else if (variante === 'ouvert' && texteOuvert !== null) {
    // Le geste naturel : « Enregistrer » dans le panneau resté ouvert (il montre l'ancien texte).
    await panneau().getByRole('button', { name: 'Enregistrer' }).click();
    await panneau().waitFor({ state: 'hidden' }).catch(() => undefined);
    const ind = await attendreEnregistre();
    noter('3b. clic « Enregistrer » dans le panneau resté ouvert', { indicateur: ind, cartes_du_canevas: await cartes(), base: await base(id) });
  } else {
    // Rouvrir le panneau de l'étape : quel texte ?
    await page.locator('div.relative.w-\\[260px\\]').first().locator('button').first().click();
    await panneau().waitFor();
    noter('3c. panneau d’étape rouvert après Lumi', { texte_du_panneau: await panneau().getByLabel(/Texte du message/).inputValue() });
    await panneau().getByRole('button', { name: /Annuler|Fermer/ }).first().click().catch(() => undefined);
  }

  // 4. Aperçu (« Aperçu » de la barre du haut).
  await page.getByRole('button', { name: 'Aperçu', exact: true }).click().catch(() => undefined);
  await page.waitForTimeout(2500);
  const apercuTexte = await page.locator('text=Aperçu seulement').locator('xpath=ancestor::div[2]').textContent().catch(() => null);
  noter('4. aperçu', { texte: apercuTexte?.slice(0, 600) ?? 'aperçu non lu' });
  await capturer(page, `bug1-${variante}-apercu`);

  // 5. Après rechargement : éditeur.
  await page.reload();
  await page.getByRole('tab', { name: 'Parcours' }).waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1500);
  noter('5. APRÈS rechargement — éditeur', { cartes_du_canevas: await cartes(), base: await base(id) });

  // 6. Liste : ligne dépliée « voir les messages ».
  await page.goto(`${APP}/automations`);
  await page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 60_000 });
  const recherche = page.locator('#rech-automations');
  await recherche.waitFor({ timeout: 30_000 });
  await recherche.fill('QA-A bug1');
  await page.waitForTimeout(1500);
  const voir = page.getByRole('button', { name: new RegExp('Voir les messages de') }).first();
  await voir.click();
  await page.waitForTimeout(800);
  const ligne = await page.locator('tr.bg-surface-secondary\\/30').last().textContent().catch(() => null);
  noter('6. liste — ligne dépliée « voir les messages »', { texte: ligne?.slice(0, 600) });
  await capturer(page, `bug1-${variante}-liste`);

  // 7. Réglages › Messagerie.
  await page.goto(`${APP}/settings/messaging`);
  await page.waitForTimeout(5000);
  const corpsPage = (await page.locator('main').textContent().catch(() => '')) ?? '';
  const iNom = corpsPage.indexOf(M);
  noter('7. Réglages › Messagerie', { regle_listee: iNom >= 0, extrait: iNom >= 0 ? corpsPage.slice(iNom, iNom + 400) : corpsPage.slice(0, 300) });
  await capturer(page, `bug1-${variante}-reglages-messagerie`);

  const cout = await depenseDepuis(b.orgA, debut);
  noter('coût (ai_usage du bureau, depuis le début du script)', cout);
  noter('erreurs console', { erreurs: o.erreurs.slice(-10) });
} finally {
  console.log('\nsortie :', ecrireSortie(`repro-bug1-panneau-${variante}.json`, trace));
  await o.fermer();
  await fermerNavigateur();
  if (!process.env.QA_A_GARDER) await nettoyerDepuis(debut);
}
