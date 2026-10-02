/**
 * Quel écran lit `steps`, lequel lit `actions` ? Mesuré au vrai navigateur.
 *
 * Monte en base la règle DANS L'ÉTAT EXACT relevé en prod pour le bug n° 1 :
 *   steps[0].action.config.body = le NOUVEAU texte (écrit après la réponse de Lumi)
 *   actions[0].config.body      = « À compléter » (le texte provisoire de la création)
 * puis ouvre chaque écran qui montre le message et note lequel des deux textes il affiche.
 *
 *   QA_AUTO_SUFFIXE=a npx tsx --env-file=.env.local scripts/qa/finale/a/ecrans-regle.mts
 * Sortie : D:/lume-final/sorties/a/ecrans-regle.json
 */
import { admin, bureauA, capturer, ecrireSortie, fermerNavigateur, marque, nettoyer, ouvrirOnglet, APP, sessionApi, appelApi } from './outils.mts';
import { semer } from './semer.mts';

const NOUVEAU = 'Bonjour [client_first_name], votre facture [invoice_number] est en retard. NOUVEAU-TEXTE-LUMI [invoice_link]';
const ANCIEN = 'À compléter';
const M = marque('ecrans');
const b = await bureauA();
await semer();
const { data: regle, error } = await admin.from('automation_rules').insert({
  org_id: b.orgA, name: `${M} Relance facture en retard`, trigger_event: 'invoice.overdue', conditions: {}, delay_seconds: 0, is_active: false,
  actions: [{ type: 'send_sms', config: { body: ANCIEN } }],
  steps: [{ id: 'e1', type: 'action', action: { type: 'send_sms', config: { body: NOUVEAU } }, suivant: null }],
}).select('id, name').single();
if (error) throw new Error(error.message);
const id = regle.id as string;

const constats: Array<{ ecran: string; montre: 'steps (nouveau)' | 'actions (À compléter)' | 'les deux' | 'aucun'; extrait: string }> = [];
const juger = (ecran: string, texte: string) => {
  const n = texte.includes('NOUVEAU-TEXTE-LUMI');
  const a = texte.includes(ANCIEN);
  const i = n ? texte.indexOf('NOUVEAU-TEXTE-LUMI') : a ? texte.indexOf(ANCIEN) : 0;
  const c = { ecran, montre: (n && a ? 'les deux' : n ? 'steps (nouveau)' : a ? 'actions (À compléter)' : 'aucun') as never, extrait: texte.slice(Math.max(0, i - 120), i + 80).replace(/\s+/g, ' ') };
  constats.push(c);
  console.log(JSON.stringify(c));
};

const o = await ouvrirOnglet();
const { page } = o;
try {
  // 1. Éditeur : carte du canevas.
  await page.goto(`${APP}/automations/${id}`);
  await page.getByRole('tab', { name: 'Parcours' }).waitFor({ timeout: 90_000 });
  await page.waitForTimeout(1200);
  juger('éditeur — carte du canevas', (await page.locator('div.relative.w-\\[260px\\]').allTextContents()).join(' | '));
  // 2. Éditeur : panneau d'étape.
  await page.locator('div.relative.w-\\[260px\\]').first().locator('button').first().click();
  const panneau = page.getByRole('complementary', { name: 'Modifier l’étape' });
  await panneau.waitFor();
  juger('éditeur — panneau d’étape', await panneau.getByLabel(/Texte du message/).inputValue());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // 3. Éditeur : « Aperçu ».
  await page.getByRole('button', { name: 'Aperçu', exact: true }).click();
  await page.getByText(/Aperçu seulement/).waitFor({ timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(2500);
  juger('éditeur — Aperçu (« ce qui partirait »)', (await page.locator('body').textContent()) ?? '');
  await capturer(page, 'ecrans-apercu');
  // 3b. La route d'aperçu elle-même.
  const s = await sessionApi();
  const ap = await appelApi(s, 'POST', `/api/automations/rules/${id}/apercu`);
  juger('route POST /rules/:id/apercu', JSON.stringify(ap.json));

  // 4. Liste : ligne dépliée « voir les messages ».
  await page.goto(`${APP}/automations`);
  await page.getByRole('heading', { name: 'Mes automatisations' }).waitFor({ timeout: 60_000 });
  await page.locator('#rech-automations').fill('QA-A ecrans');
  await page.waitForTimeout(1500);
  await capturer(page, 'ecrans-liste-avant');
  const lignes = await page.locator('tbody tr').allTextContents();
  juger('liste — ligne (résumé, sans déplier)', lignes.find((l) => l.includes('QA-A ecrans')) ?? lignes.join(' | ').slice(0, 400));
  const voir = page.getByRole('button', { name: /Voir les messages de/ });
  if (await voir.count()) {
    await voir.first().click();
    await page.waitForTimeout(800);
    juger('liste — ligne dépliée « voir les messages »', (await page.locator('tbody').textContent()) ?? '');
  } else {
    constats.push({ ecran: 'liste — ligne dépliée', montre: 'aucun', extrait: 'bouton « Voir les messages » introuvable' });
  }
  await capturer(page, 'ecrans-liste');

  // 5. Aperçu de la liste (/automations/apercu) et Réglages des automatisations.
  for (const [nom, chemin] of [['page /automations/apercu', '/automations/apercu'], ['page /automations/reglages', '/automations/reglages']] as const) {
    await page.goto(`${APP}${chemin}`);
    await page.waitForTimeout(5000);
    juger(nom, (await page.locator('body').textContent()) ?? '');
  }

  // 6. Réglages › Messagerie (section « textos automatiques »).
  await page.goto(`${APP}/settings/messaging`);
  await page.waitForTimeout(6000);
  const corps = (await page.locator('body').textContent()) ?? '';
  juger('Réglages › Messagerie — présence de la règle', corps.includes('QA-A ecrans') ? corps.slice(corps.indexOf('QA-A ecrans') - 20, corps.indexOf('QA-A ecrans') + 500) : 'règle absente de la page');
  const bouton = page.getByRole('button', { name: /QA-A ecrans/ }).first();
  if (await bouton.count()) {
    await bouton.click().catch(() => undefined);
    await page.waitForTimeout(800);
    const zones = await page.locator('textarea').evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value));
    juger('Réglages › Messagerie — texte modifiable', zones.join(' | ') || ((await page.locator('body').textContent()) ?? ''));
  }
  await capturer(page, 'ecrans-reglages-messagerie');

  // 7. Bibliothèque de modèles : elle ne montre pas les règles de l'entreprise (seulement le catalogue).
  // 8. Ce que le clavardage général de Lumi peut LIRE de la règle (list_automations) : voir relire-apres-ecriture.
} finally {
  console.log('sortie :', ecrireSortie('ecrans-regle.json', { regle: id, constats, erreurs_console: o.erreurs.slice(-8) }));
  await o.fermer();
  await fermerNavigateur();
  if (!process.env.QA_A_GARDER) await nettoyer(M);
}
